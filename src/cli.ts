#!/usr/bin/env node
import { Command } from "commander";
import fs from "node:fs";
import { getDefaultConfig } from "./config.js";
import { openDatabase } from "./db/client.js";
import { cleanupEvents } from "./db/cleanup.js";
import { insertEvent, claimNextEvent, updateEventStatus } from "./db/events.js";
import { insertMentions } from "./db/mentions.js";
import { insertToolCalls } from "./db/tools.js";
import { getTopicByName, listTopics, upsertTopic } from "./db/topics.js";

const program = new Command();

const ensureDataDir = (dataDir: string) => {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
};

program
  .name("oc-events")
  .description("Local-first event bus for OpenCode agents")
  .version("0.1.0");

program
  .command("push")
  .description("Publish an event")
  .argument("<topic>", "event topic")
  .requiredOption("--body <text>", "event body")
  .option("--meta <json>", "metadata JSON")
  .option("--correlation-id <id>", "correlation id")
  .option("--parent-id <id>", "parent event id")
  .option("--source <source>", "event source", "agent")
  .action((topic, options) => {
    const config = getDefaultConfig();
    ensureDataDir(config.dataDir);
    const db = openDatabase({ path: config.dbPath });

    const event = insertEvent(db, {
      topic,
      body: options.body,
      metadata: options.meta ?? null,
      correlationId: options.correlationId ?? null,
      parentId: options.parentId ?? null,
      source: options.source
    });

    insertMentions(db, event.id, event.body);
    insertToolCalls(db, event.id, event.body);

    process.stdout.write(JSON.stringify(event, null, 2));
    process.stdout.write("\n");
  });

program
  .command("pull")
  .description("Claim the next pending event for a topic")
  .argument("<topic>", "event topic")
  .requiredOption("--agent <id>", "agent identifier")
  .action((topic, options) => {
    const config = getDefaultConfig();
    ensureDataDir(config.dataDir);
    const db = openDatabase({ path: config.dbPath });

    const event = claimNextEvent(db, { topic, agent: options.agent });
    if (!event) {
      process.stdout.write("\n");
      return;
    }

    const topicRow = getTopicByName(db, topic);
    const payload = {
      ...event,
      system_prompt: topicRow?.system_prompt ?? null
    };

    process.stdout.write(JSON.stringify(payload, null, 2));
    process.stdout.write("\n");
  });

program
  .command("reply")
  .description("Reply to an event with a new event and update status")
  .argument("<id>", "event id")
  .requiredOption("--status <status>", "completed or failed")
  .requiredOption("--body <text>", "reply body")
  .option("--meta <json>", "metadata JSON")
  .option("--source <source>", "event source", "agent")
  .action((id, options) => {
    const config = getDefaultConfig();
    ensureDataDir(config.dataDir);
    const db = openDatabase({ path: config.dbPath });

    const original = db
      .prepare("SELECT * FROM events WHERE id = ?")
      .get(id) as { correlation_id?: string; topic?: string } | undefined;

    if (!original?.topic) {
      process.stderr.write(`Event not found: ${id}\n`);
      process.exit(1);
    }

    updateEventStatus(db, id, options.status);

    const reply = insertEvent(db, {
      topic: original.topic,
      body: options.body,
      metadata: options.meta ?? null,
      correlationId: original.correlation_id ?? id,
      parentId: id,
      source: options.source
    });

    insertMentions(db, reply.id, reply.body);
    insertToolCalls(db, reply.id, reply.body);

    process.stdout.write(JSON.stringify(reply, null, 2));
    process.stdout.write("\n");
  });

program
  .command("query")
  .description("Query events by mention or tool")
  .option("--mention <mention>", "mention to filter")
  .option("--tool <tool>", "tool name to filter")
  .action((options) => {
    const config = getDefaultConfig();
    ensureDataDir(config.dataDir);
    const db = openDatabase({ path: config.dbPath });

    if (options.mention) {
      const rows = db
        .prepare(
          `SELECT events.* FROM events
           INNER JOIN mentions ON mentions.event_id = events.id
           WHERE mentions.mention = ?
           ORDER BY events.created_at DESC`
        )
        .all(options.mention);
      process.stdout.write(JSON.stringify(rows, null, 2));
      process.stdout.write("\n");
      return;
    }

    if (options.tool) {
      const rows = db
        .prepare(
          `SELECT events.* FROM events
           INNER JOIN tool_calls ON tool_calls.event_id = events.id
           WHERE tool_calls.tool_name = ?
           ORDER BY events.created_at DESC`
        )
        .all(options.tool);
      process.stdout.write(JSON.stringify(rows, null, 2));
      process.stdout.write("\n");
      return;
    }

    process.stdout.write("[]\n");
  });

program
  .command("search")
  .description("Full-text search event bodies")
  .argument("<query>", "search query")
  .action((query) => {
    const config = getDefaultConfig();
    ensureDataDir(config.dataDir);
    const db = openDatabase({ path: config.dbPath });

    const rows = db
      .prepare(
        `SELECT events.* FROM events
         INNER JOIN events_fts ON events_fts.rowid = events.rowid
         WHERE events_fts MATCH ?
         ORDER BY events.created_at DESC`
      )
      .all(query);

    process.stdout.write(JSON.stringify(rows, null, 2));
    process.stdout.write("\n");
  });

program
  .command("status")
  .description("Update event status")
  .argument("<id>", "event id")
  .requiredOption("--set <status>", "pending|processing|completed|failed")
  .action((id, options) => {
    const config = getDefaultConfig();
    ensureDataDir(config.dataDir);
    const db = openDatabase({ path: config.dbPath });

    const updated = updateEventStatus(db, id, options.set);
    if (!updated) {
      process.stderr.write(`Event not found: ${id}\n`);
      process.exit(1);
    }

    process.stdout.write(JSON.stringify(updated, null, 2));
    process.stdout.write("\n");
  });

const topicsCommand = program.command("topics").description("Manage topics");

topicsCommand
  .command("list")
  .description("List topics")
  .action(() => {
    const config = getDefaultConfig();
    ensureDataDir(config.dataDir);
    const db = openDatabase({ path: config.dbPath });

    const rows = listTopics(db);
    process.stdout.write(JSON.stringify(rows, null, 2));
    process.stdout.write("\n");
  });

topicsCommand
  .command("set-prompt")
  .description("Create or update a topic prompt")
  .argument("<topic>", "topic name")
  .requiredOption("--prompt-file <path>", "path to prompt file")
  .option("--description <text>", "topic description")
  .action((topic, options) => {
    const config = getDefaultConfig();
    ensureDataDir(config.dataDir);
    const db = openDatabase({ path: config.dbPath });

    const prompt = fs.readFileSync(options.promptFile, "utf-8");
    const row = upsertTopic(db, {
      name: topic,
      systemPrompt: prompt,
      description: options.description ?? null
    });

    process.stdout.write(JSON.stringify(row, null, 2));
    process.stdout.write("\n");
  });

topicsCommand
  .command("create")
  .description("Create a topic with an inline prompt")
  .argument("<topic>", "topic name")
  .requiredOption("--prompt <text>", "system prompt")
  .option("--description <text>", "topic description")
  .action((topic, options) => {
    const config = getDefaultConfig();
    ensureDataDir(config.dataDir);
    const db = openDatabase({ path: config.dbPath });

    const row = upsertTopic(db, {
      name: topic,
      systemPrompt: options.prompt,
      description: options.description ?? null
    });

    process.stdout.write(JSON.stringify(row, null, 2));
    process.stdout.write("\n");
  });

program
  .command("cleanup")
  .description("Remove old events")
  .option("--completed-days <days>", "completed/failed retention days", "30")
  .option("--pending-days <days>", "pending retention days", "7")
  .action((options) => {
    const config = getDefaultConfig();
    ensureDataDir(config.dataDir);
    const db = openDatabase({ path: config.dbPath });

    const completedDays = Number(options.completedDays);
    const pendingDays = Number(options.pendingDays);

    const removed = cleanupEvents(db, {
      completedRetentionDays: completedDays,
      pendingRetentionDays: pendingDays
    });

    process.stdout.write(JSON.stringify({ removed }, null, 2));
    process.stdout.write("\n");
  });

program
  .command("watch")
  .description("Watch for new events and display them in real-time")
  .argument("<topic>", "event topic to watch")
  .requiredOption("--agent <id>", "agent identifier")
  .option("--interval <ms>", "poll interval in milliseconds", "5000")
  .action((topic, options) => {
    const config = getDefaultConfig();
    ensureDataDir(config.dataDir);
    const db = openDatabase({ path: config.dbPath });

    const interval = Number(options.interval);
    
    process.stdout.write(`\n${"=".repeat(80)}\n`);
    process.stdout.write(`Watching topic: ${topic} (polling every ${interval}ms)\n`);
    process.stdout.write(`Agent: ${options.agent}\n`);
    process.stdout.write(`Press Ctrl+C to stop\n`);
    process.stdout.write(`${"=".repeat(80)}\n\n`);

    const poll = () => {
      const event = claimNextEvent(db, { topic, agent: options.agent });
      if (!event) {
        return;
      }

      const topicRow = getTopicByName(db, topic);
      
      process.stdout.write(`\n${"━".repeat(80)}\n`);
      process.stdout.write(`📬 NEW EVENT RECEIVED\n`);
      process.stdout.write(`${"━".repeat(80)}\n`);
      
      if (topicRow?.system_prompt) {
        process.stdout.write(`\n${topicRow.system_prompt}\n\n`);
      }
      
      process.stdout.write(`Topic: ${event.topic}\n`);
      process.stdout.write(`Event ID: ${event.id}\n`);
      process.stdout.write(`Source: ${event.source}\n`);
      process.stdout.write(`Status: ${event.status}\n`);
      process.stdout.write(`Created: ${new Date(event.created_at).toISOString()}\n`);
      
      if (event.correlation_id) {
        process.stdout.write(`Correlation ID: ${event.correlation_id}\n`);
      }
      
      if (event.metadata) {
        process.stdout.write(`\nMetadata:\n${event.metadata}\n`);
      }
      
      process.stdout.write(`\n${"─".repeat(80)}\n`);
      process.stdout.write(`${event.body}\n`);
      process.stdout.write(`${"─".repeat(80)}\n`);
      
      process.stdout.write(`\nTo reply:\n`);
      process.stdout.write(`  oc-events reply ${event.id} --status completed --body "..."\n`);
      process.stdout.write(`${"━".repeat(80)}\n\n`);
    };

    setInterval(poll, interval);
    poll(); // Check immediately
  });

program.parse();
