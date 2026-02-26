#!/usr/bin/env node
import { Command, Option } from "commander";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import { getDefaultConfig } from "./config.js";
import {
  clearSavedContext,
  getStoredContext,
  resolveScopeContext,
  saveContext,
  type ScopeInputOptions
} from "./context.js";
import { openDatabase } from "./db/client.js";
import { cleanupEvents } from "./db/cleanup.js";
import { claimNextEvent, insertEvent, updateEventStatus } from "./db/events.js";
import { claimNextHandoffEvent } from "./db/handoffs.js";
import { insertMentions } from "./db/mentions.js";
import { buildScopeCondition, normalizeScopeLevel } from "./db/scope.js";
import { insertToolCalls } from "./db/tools.js";
import { getTopicByName, listTopics, upsertTopic } from "./db/topics.js";
import type { ScopeLevel } from "./db/types.js";

const program = new Command();

const ensureDataDir = (dataDir: string) => {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
};

const openDb = () => {
  const config = getDefaultConfig();
  ensureDataDir(config.dataDir);
  const db = openDatabase({ path: config.dbPath, defaultOrg: config.defaultOrg });
  return { config, db };
};

const addScopeOptions = (
  command: Command,
  options?: { includeScopeLevel?: boolean; includeUnscoped?: boolean }
): Command => {
  command
    .option("--org <id>", "organization identifier")
    .option("--workspace <id>", "workspace identifier")
    .option("--project <id>", "project identifier")
    .option("--repo <id>", "repository identifier");

  if (options?.includeScopeLevel) {
    command.addOption(
      new Option("--scope <level>", "scope level").choices([
        "repo",
        "project",
        "workspace",
        "org"
      ])
    );
  }

  if (options?.includeUnscoped) {
    command.option("--include-unscoped", "include events without org scope");
  }

  return command;
};

const resolveScopedOptions = (
  db: ReturnType<typeof openDb>["db"],
  config: ReturnType<typeof openDb>["config"],
  options: ScopeInputOptions
) => {
  const scope = resolveScopeContext(db, config, options);
  const scopeLevel = normalizeScopeLevel(scope, options.scope);
  return {
    scope,
    scopeLevel,
    includeUnscoped: Boolean(options.includeUnscoped)
  };
};

const normalizeAgent = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) {
    return trimmed;
  }
  if (trimmed.startsWith("@")) {
    return trimmed;
  }
  return `@${trimmed}`;
};

const plainAgent = (value: string): string => normalizeAgent(value).replace(/^@/, "");

const parseList = (value?: string): string[] => {
  if (!value) {
    return [];
  }
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => Boolean(item));
};

const toJsonObject = (value?: string): Record<string, unknown> => {
  if (!value) {
    return {};
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
};

const detectBranch = (cwd: string): string | null => {
  try {
    const branch = execFileSync("git", ["branch", "--show-current"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
    return branch || null;
  } catch {
    return null;
  }
};

const copyToClipboard = (text: string): string | null => {
  const candidates: Array<{ command: string; args: string[] }> = [
    { command: "pbcopy", args: [] },
    { command: "wl-copy", args: [] },
    { command: "xclip", args: ["-selection", "clipboard"] }
  ];

  for (const candidate of candidates) {
    try {
      const result = spawnSync(candidate.command, candidate.args, { input: text });
      if (result.status === 0) {
        return candidate.command;
      }
    } catch {
      continue;
    }
  }

  return null;
};

type HandoffPayload = {
  version: number;
  topic: string;
  to_agent: string;
  from_agent: string;
  summary: string;
  goal: string | null;
  cwd: string | null;
  branch: string | null;
  files: string[];
  next_steps: string[];
  constraints: string[];
  open_questions: string[];
  launch_hint: string | null;
  created_at: string;
};

const commandForAgent = (agent: string): string => {
  const normalized = plainAgent(agent).toLowerCase();
  if (normalized === "claude") {
    return "claude";
  }
  if (normalized === "codex") {
    return "codex";
  }
  if (normalized === "opencode") {
    return "opencode";
  }
  return normalized;
};

const buildHandoffPrompt = (payload: HandoffPayload): string => {
  const lines = [
    "=== BEGIN AGENT HANDOFF ===",
    "You are taking over an in-progress task.",
    "",
    `From Agent: ${payload.from_agent}`,
    `To Agent: ${payload.to_agent}`,
    `Project Path: ${payload.cwd ?? "unknown"}`,
    `Branch: ${payload.branch ?? "unknown"}`,
    `Summary: ${payload.summary}`
  ];

  if (payload.goal) {
    lines.push(`Goal: ${payload.goal}`);
  }

  lines.push("");
  lines.push("Files Changed:");
  if (payload.files.length) {
    for (const file of payload.files) {
      lines.push(`- ${file}`);
    }
  } else {
    lines.push("- none provided");
  }

  lines.push("");
  lines.push("Next Steps:");
  if (payload.next_steps.length) {
    payload.next_steps.forEach((step, index) => {
      lines.push(`${index + 1}. ${step}`);
    });
  } else {
    lines.push("1. Continue from current summary");
  }

  if (payload.constraints.length) {
    lines.push("");
    lines.push("Constraints:");
    for (const constraint of payload.constraints) {
      lines.push(`- ${constraint}`);
    }
  }

  if (payload.open_questions.length) {
    lines.push("");
    lines.push("Open Questions:");
    for (const question of payload.open_questions) {
      lines.push(`- ${question}`);
    }
  }

  if (payload.launch_hint) {
    lines.push("");
    lines.push(`Suggested launch command: ${payload.launch_hint}`);
  }

  lines.push("=== END AGENT HANDOFF ===");
  return lines.join("\n");
};

const payloadFromMetadata = (
  metadata: string | null,
  fallback: {
    toAgent: string;
    fromAgent: string;
    summary: string;
    cwd: string | null;
    branch: string | null;
  }
): HandoffPayload => {
  try {
    const parsed = JSON.parse(metadata ?? "{}") as {
      handoff?: Partial<HandoffPayload>;
      to_agent?: string;
      from_agent?: string;
      summary?: string;
      cwd?: string | null;
      branch?: string | null;
    };
    const handoff = parsed.handoff ?? {};
    return {
      version: Number(handoff.version ?? 1),
      topic: String(handoff.topic ?? "session-handoff"),
      to_agent: String(handoff.to_agent ?? parsed.to_agent ?? fallback.toAgent),
      from_agent: String(handoff.from_agent ?? parsed.from_agent ?? fallback.fromAgent),
      summary: String(handoff.summary ?? parsed.summary ?? fallback.summary),
      goal: handoff.goal ? String(handoff.goal) : null,
      cwd: handoff.cwd ? String(handoff.cwd) : fallback.cwd,
      branch: handoff.branch ? String(handoff.branch) : fallback.branch,
      files: Array.isArray(handoff.files)
        ? handoff.files.map((item) => String(item))
        : [],
      next_steps: Array.isArray(handoff.next_steps)
        ? handoff.next_steps.map((item) => String(item))
        : [],
      constraints: Array.isArray(handoff.constraints)
        ? handoff.constraints.map((item) => String(item))
        : [],
      open_questions: Array.isArray(handoff.open_questions)
        ? handoff.open_questions.map((item) => String(item))
        : [],
      launch_hint: handoff.launch_hint ? String(handoff.launch_hint) : null,
      created_at: handoff.created_at ? String(handoff.created_at) : new Date().toISOString()
    };
  } catch {
    return {
      version: 1,
      topic: "session-handoff",
      to_agent: fallback.toAgent,
      from_agent: fallback.fromAgent,
      summary: fallback.summary,
      goal: null,
      cwd: fallback.cwd,
      branch: fallback.branch,
      files: [],
      next_steps: [],
      constraints: [],
      open_questions: [],
      launch_hint: null,
      created_at: new Date().toISOString()
    };
  }
};

program
  .name("oc-events")
  .description("Local-first event bus for OpenCode agents")
  .version("0.2.0");

addScopeOptions(
  program
    .command("push")
    .description("Publish an event")
    .argument("<topic>", "event topic")
    .requiredOption("--body <text>", "event body")
    .option("--meta <json>", "metadata JSON")
    .option("--correlation-id <id>", "correlation id")
    .option("--parent-id <id>", "parent event id")
    .option("--source <source>", "event source", "agent")
).action((topic, options) => {
  const { config, db } = openDb();
  const scopedOptions = resolveScopedOptions(db, config, options);
  const event = insertEvent(db, {
    topic,
    body: options.body,
    metadata: options.meta ?? null,
    correlationId: options.correlationId ?? null,
    parentId: options.parentId ?? null,
    source: options.source,
    orgId: scopedOptions.scope.org_id,
    workspaceId: scopedOptions.scope.workspace_id,
    projectId: scopedOptions.scope.project_id,
    repoId: scopedOptions.scope.repo_id
  });

  insertMentions(db, event.id, event.body);
  insertToolCalls(db, event.id, event.body);

  process.stdout.write(JSON.stringify(event, null, 2));
  process.stdout.write("\n");
});

addScopeOptions(
  program
    .command("pull")
    .description("Claim the next pending event for a topic")
    .argument("<topic>", "event topic")
    .requiredOption("--agent <id>", "agent identifier"),
  { includeScopeLevel: true, includeUnscoped: true }
).action((topic, options) => {
  const { config, db } = openDb();
  const scopedOptions = resolveScopedOptions(db, config, options);
  const event = claimNextEvent(db, {
    topic,
    agent: options.agent,
    scope: scopedOptions.scope,
    scopeLevel: scopedOptions.scopeLevel,
    includeUnscoped: scopedOptions.includeUnscoped
  });
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
    const { config, db } = openDb();

    const original = db
      .prepare("SELECT * FROM events WHERE id = ?")
      .get(id) as
      | {
          correlation_id?: string;
          topic?: string;
          org_id?: string | null;
          workspace_id?: string | null;
          project_id?: string | null;
          repo_id?: string | null;
        }
      | undefined;

    if (!original?.topic) {
      process.stderr.write(`Event not found: ${id}\n`);
      process.exit(1);
    }

    updateEventStatus(db, id, options.status);
    const fallbackScope = resolveScopeContext(db, config, {});
    const reply = insertEvent(db, {
      topic: original.topic,
      body: options.body,
      metadata: options.meta ?? null,
      correlationId: original.correlation_id ?? id,
      parentId: id,
      source: options.source,
      orgId: original.org_id ?? fallbackScope.org_id,
      workspaceId: original.workspace_id ?? fallbackScope.workspace_id,
      projectId: original.project_id ?? fallbackScope.project_id,
      repoId: original.repo_id ?? fallbackScope.repo_id
    });

    insertMentions(db, reply.id, reply.body);
    insertToolCalls(db, reply.id, reply.body);

    process.stdout.write(JSON.stringify(reply, null, 2));
    process.stdout.write("\n");
  });

addScopeOptions(
  program
    .command("query")
    .description("Query events by mention or tool")
    .option("--mention <mention>", "mention to filter")
    .option("--tool <tool>", "tool name to filter"),
  { includeScopeLevel: true, includeUnscoped: true }
).action((options) => {
  const { config, db } = openDb();
  const scopedOptions = resolveScopedOptions(db, config, options);
  const scopeCondition = buildScopeCondition({
    scope: scopedOptions.scope,
    scopeLevel: scopedOptions.scopeLevel,
    includeUnscoped: scopedOptions.includeUnscoped,
    tableAlias: "events"
  });

  if (options.mention) {
    const rows = db
      .prepare(
        `SELECT events.* FROM events
         INNER JOIN mentions ON mentions.event_id = events.id
         WHERE mentions.mention = ? AND ${scopeCondition.sql}
         ORDER BY events.created_at DESC`
      )
      .all(options.mention, ...scopeCondition.params);
    process.stdout.write(JSON.stringify(rows, null, 2));
    process.stdout.write("\n");
    return;
  }

  if (options.tool) {
    const rows = db
      .prepare(
        `SELECT events.* FROM events
         INNER JOIN tool_calls ON tool_calls.event_id = events.id
         WHERE tool_calls.tool_name = ? AND ${scopeCondition.sql}
         ORDER BY events.created_at DESC`
      )
      .all(options.tool, ...scopeCondition.params);
    process.stdout.write(JSON.stringify(rows, null, 2));
    process.stdout.write("\n");
    return;
  }

  process.stdout.write("[]\n");
});

addScopeOptions(
  program
    .command("search")
    .description("Full-text search event bodies")
    .argument("<query>", "search query"),
  { includeScopeLevel: true, includeUnscoped: true }
).action((query, options) => {
  const { config, db } = openDb();
  const scopedOptions = resolveScopedOptions(db, config, options);
  const scopeCondition = buildScopeCondition({
    scope: scopedOptions.scope,
    scopeLevel: scopedOptions.scopeLevel,
    includeUnscoped: scopedOptions.includeUnscoped,
    tableAlias: "events"
  });

  const rows = db
    .prepare(
      `SELECT events.* FROM events
       INNER JOIN events_fts ON events_fts.rowid = events.rowid
       WHERE events_fts MATCH ? AND ${scopeCondition.sql}
       ORDER BY events.created_at DESC`
    )
    .all(query, ...scopeCondition.params);

  process.stdout.write(JSON.stringify(rows, null, 2));
  process.stdout.write("\n");
});

program
  .command("status")
  .description("Update event status")
  .argument("<id>", "event id")
  .requiredOption("--set <status>", "pending|processing|completed|failed")
  .action((id, options) => {
    const { db } = openDb();
    const updated = updateEventStatus(db, id, options.set);
    if (!updated) {
      process.stderr.write(`Event not found: ${id}\n`);
      process.exit(1);
    }

    process.stdout.write(JSON.stringify(updated, null, 2));
    process.stdout.write("\n");
  });

const handoffCommand = program.command("handoff").description("Create and consume agent handoffs");

addScopeOptions(
  handoffCommand
    .command("push")
    .description("Publish a session handoff event and emit a copy-paste prompt")
    .requiredOption("--to <agent>", "target agent (e.g. claude, codex, opencode)")
    .requiredOption("--summary <text>", "short handoff summary")
    .option("--from <agent>", "source agent", "@opencode")
    .option("--goal <text>", "overall goal")
    .option("--cwd <path>", "project path", process.cwd())
    .option("--branch <name>", "git branch name")
    .option("--files <items>", "comma-separated files")
    .option("--next <items>", "comma-separated next steps")
    .option("--constraints <items>", "comma-separated constraints")
    .option("--questions <items>", "comma-separated open questions")
    .option("--launch <command>", "launch command hint for target agent")
    .option("--topic <topic>", "handoff topic", "session-handoff")
    .option("--meta <json>", "additional metadata JSON object")
    .option("--copy", "copy prompt to clipboard when possible"),
  { includeScopeLevel: false, includeUnscoped: false }
).action((options) => {
  const { config, db } = openDb();
  const scopedOptions = resolveScopedOptions(db, config, options);
  const toAgent = normalizeAgent(options.to);
  const fromAgent = normalizeAgent(options.from);
  const cwd = options.cwd ?? process.cwd();
  const branch = options.branch ?? detectBranch(cwd);
  const launchHint = options.launch ?? commandForAgent(toAgent);

  const payload: HandoffPayload = {
    version: 1,
    topic: options.topic,
    to_agent: toAgent,
    from_agent: fromAgent,
    summary: options.summary,
    goal: options.goal ?? null,
    cwd,
    branch,
    files: parseList(options.files),
    next_steps: parseList(options.next),
    constraints: parseList(options.constraints),
    open_questions: parseList(options.questions),
    launch_hint: launchHint,
    created_at: new Date().toISOString()
  };

  const baseMeta = toJsonObject(options.meta);
  const metadata = JSON.stringify({
    ...baseMeta,
    type: "session_handoff",
    handoff: payload
  });

  const eventBody = [
    `Agent handoff ${fromAgent} -> ${toAgent}`,
    `Summary: ${payload.summary}`,
    payload.goal ? `Goal: ${payload.goal}` : null,
    `Path: ${payload.cwd ?? "unknown"}`,
    `Branch: ${payload.branch ?? "unknown"}`,
    `Mentions: ${fromAgent} ${toAgent}`
  ]
    .filter((item) => Boolean(item))
    .join("\n");

  const event = insertEvent(db, {
    topic: options.topic,
    body: eventBody,
    metadata,
    source: "handoff",
    orgId: scopedOptions.scope.org_id,
    workspaceId: scopedOptions.scope.workspace_id,
    projectId: scopedOptions.scope.project_id,
    repoId: scopedOptions.scope.repo_id
  });

  insertMentions(db, event.id, event.body);
  insertToolCalls(db, event.id, event.body);

  const prompt = buildHandoffPrompt(payload);
  const clipboard = options.copy ? copyToClipboard(prompt) : null;

  process.stdout.write(
    JSON.stringify(
      {
        event,
        launch_command: launchHint,
        prompt,
        copied_with: clipboard
      },
      null,
      2
    )
  );
  process.stdout.write("\n");
});

addScopeOptions(
  handoffCommand
    .command("pull")
    .description("Claim the next handoff intended for an agent and emit resume prompt")
    .requiredOption("--for <agent>", "target agent identity")
    .option("--agent <id>", "claimer identity", "@handoff")
    .option("--topic <topic>", "handoff topic", "session-handoff")
    .option("--copy", "copy prompt to clipboard when possible"),
  { includeScopeLevel: true, includeUnscoped: true }
).action((options) => {
  const { config, db } = openDb();
  const scopedOptions = resolveScopedOptions(db, config, options);
  const recipient = normalizeAgent(options.for);
  const claimer = normalizeAgent(options.agent);
  const event = claimNextHandoffEvent(db, {
    topic: options.topic,
    agent: claimer,
    recipient,
    scope: scopedOptions.scope,
    scopeLevel: scopedOptions.scopeLevel,
    includeUnscoped: scopedOptions.includeUnscoped
  });

  if (!event) {
    process.stdout.write("\n");
    return;
  }

  const payload = payloadFromMetadata(event.metadata, {
    toAgent: recipient,
    fromAgent: "@unknown",
    summary: event.body,
    cwd: null,
    branch: null
  });
  const prompt = buildHandoffPrompt(payload);
  const clipboard = options.copy ? copyToClipboard(prompt) : null;

  process.stdout.write(
    JSON.stringify(
      {
        event,
        prompt,
        launch_command: payload.launch_hint ?? commandForAgent(recipient),
        copied_with: clipboard
      },
      null,
      2
    )
  );
  process.stdout.write("\n");
});

const contextCommand = program.command("context").description("Manage scope context");

contextCommand
  .command("show")
  .description("Show saved and resolved scope context")
  .action(() => {
    const { config, db } = openDb();
    const stored = getStoredContext(db);
    const resolved = resolveScopeContext(db, config, {});
    process.stdout.write(
      JSON.stringify(
        {
          stored,
          resolved,
          default_scope_level: normalizeScopeLevel(resolved)
        },
        null,
        2
      )
    );
    process.stdout.write("\n");
  });

addScopeOptions(
  contextCommand
    .command("set")
    .description("Set saved scope context for future commands"),
  { includeScopeLevel: false, includeUnscoped: false }
).action((options) => {
  const { config, db } = openDb();
  const current = getStoredContext(db);
  const saved = saveContext(db, {
    org_id: options.org ?? current.org_id ?? config.defaultOrg,
    workspace_id: options.workspace,
    project_id: options.project,
    repo_id: options.repo
  });
  process.stdout.write(JSON.stringify(saved, null, 2));
  process.stdout.write("\n");
});

contextCommand
  .command("clear")
  .description("Clear saved scope context")
  .action(() => {
    const { db } = openDb();
    clearSavedContext(db);
    process.stdout.write(JSON.stringify({ cleared: true }, null, 2));
    process.stdout.write("\n");
  });

const topicsCommand = program.command("topics").description("Manage topics");

topicsCommand
  .command("list")
  .description("List topics")
  .action(() => {
    const { db } = openDb();
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
    const { db } = openDb();
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
    const { db } = openDb();
    const row = upsertTopic(db, {
      name: topic,
      systemPrompt: options.prompt,
      description: options.description ?? null
    });

    process.stdout.write(JSON.stringify(row, null, 2));
    process.stdout.write("\n");
  });

addScopeOptions(
  program
    .command("cleanup")
    .description("Remove old events")
    .option("--completed-days <days>", "completed/failed retention days", "30")
    .option("--pending-days <days>", "pending retention days", "7"),
  { includeScopeLevel: true, includeUnscoped: true }
).action((options) => {
  const { config, db } = openDb();
  const completedDays = Number(options.completedDays);
  const pendingDays = Number(options.pendingDays);
  const scopedOptions = resolveScopedOptions(db, config, options);
  const removed = cleanupEvents(db, {
    completedRetentionDays: completedDays,
    pendingRetentionDays: pendingDays,
    scope: scopedOptions.scope,
    scopeLevel: scopedOptions.scopeLevel,
    includeUnscoped: scopedOptions.includeUnscoped
  });

  process.stdout.write(
    JSON.stringify(
      {
        removed,
        scope_level: scopedOptions.scopeLevel,
        scope: scopedOptions.scope,
        include_unscoped: scopedOptions.includeUnscoped
      },
      null,
      2
    )
  );
  process.stdout.write("\n");
});

addScopeOptions(
  program
    .command("watch")
    .description("Watch for new events and display them in real-time")
    .argument("<topic>", "event topic to watch")
    .requiredOption("--agent <id>", "agent identifier")
    .option("--interval <ms>", "poll interval in milliseconds", "5000"),
  { includeScopeLevel: true, includeUnscoped: true }
).action((topic, options) => {
  const { config, db } = openDb();
  const interval = Number(options.interval);
  const scopedOptions = resolveScopedOptions(db, config, options);

  process.stdout.write(`\n${"=".repeat(80)}\n`);
  process.stdout.write(`Watching topic: ${topic} (polling every ${interval}ms)\n`);
  process.stdout.write(`Agent: ${options.agent}\n`);
  process.stdout.write(`Scope: ${scopedOptions.scopeLevel}\n`);
  process.stdout.write(`Press Ctrl+C to stop\n`);
  process.stdout.write(`${"=".repeat(80)}\n\n`);

  const poll = () => {
    const event = claimNextEvent(db, {
      topic,
      agent: options.agent,
      scope: scopedOptions.scope,
      scopeLevel: scopedOptions.scopeLevel,
      includeUnscoped: scopedOptions.includeUnscoped
    });
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
    process.stdout.write(`Org: ${event.org_id}\n`);
    if (event.workspace_id) {
      process.stdout.write(`Workspace: ${event.workspace_id}\n`);
    }
    if (event.project_id) {
      process.stdout.write(`Project: ${event.project_id}\n`);
    }
    if (event.repo_id) {
      process.stdout.write(`Repo: ${event.repo_id}\n`);
    }
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
  poll();
});

program.parse();
