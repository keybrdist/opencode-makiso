import type { Plugin } from "@opencode-ai/plugin";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import notifier from "node-notifier";
import { getDefaultConfig } from "./config.js";

const LOG_ENABLED = process.env.OC_EVENTS_DEBUG === "1";
const LOG_PATH = path.join(process.env.HOME ?? ".", ".config", "opencode", "event-crusher", "plugin.log");

const log = (message: string, data?: unknown) => {
  if (!LOG_ENABLED) return;
  const timestamp = new Date().toISOString();
  const logLine = data
    ? `[${timestamp}] ${message} ${JSON.stringify(data, null, 2)}\n`
    : `[${timestamp}] ${message}\n`;
  fs.appendFileSync(LOG_PATH, logLine);
};

const formatEvent = (event: Record<string, unknown>): string => {

  const metadata = event.metadata ? JSON.stringify(event.metadata, null, 2) : "{}";
  return [
    `[INCOMING EVENT: ${event.topic ?? "unknown"}]`,
    event.system_prompt ? String(event.system_prompt) : "",
    "---",
    String(event.body ?? ""),
    "---",
    `Metadata: ${metadata}`,
    `Correlation ID: ${event.correlation_id ?? "none"}`,
    `Event ID: ${event.id ?? "unknown"}`,
    "When complete, run: oc-events reply <id> --status <completed|failed> --body \"...\""
  ]
    .filter((line) => line.length > 0)
    .join("\n");
};

export const EventCrusherPlugin: Plugin = async ({ client, directory }) => {
  let lastPoll = 0;
  let polling = false;

  log("EventCrusherPlugin initialized");
  log(`Directory: ${directory}`);

  return {
    event: async ({ event }) => {
      log(`Event received: ${event.type}`);

      // Poll on session.status instead of session.idle for more frequent checks
      if (event.type !== "session.status") return;

      const config = getDefaultConfig();
      const now = Date.now();
      const timeSinceLastPoll = now - lastPoll;

      log(`Session idle. Time since last poll: ${timeSinceLastPoll}ms, interval: ${config.pollIntervalMs}ms`);

      if (timeSinceLastPoll < config.pollIntervalMs) {
        log("Skipping poll - too soon");
        return;
      }

      if (polling) {
        log("Skipping poll - already polling");
        return;
      }

      lastPoll = now;
      polling = true;

      try {
        const cmd = `oc-events pull ${config.pollTopic} --agent ${config.pollAgent}`;
        log(`Executing: ${cmd}`);

        const output = execSync(cmd, { encoding: "utf8", timeout: 5000 }).trim();

        log(`Command output: ${output}`);

        if (!output) {
          log("No output from pull command");
          return;
        }

        const parsed = JSON.parse(output);
        log("Parsed event:", parsed);

        const content = formatEvent(parsed);
        log(`Formatted content (${content.length} chars)`);

        const sessionID = event.properties.sessionID;
        log(`Injecting into session: ${sessionID}`);
        log(`Event content to inject:`, content);

        // Write event to a visible file for reference
        const notificationPath = path.join(config.dataDir, "last-event.txt");
        fs.writeFileSync(notificationPath, `[${new Date().toISOString()}]\n\n${content}\n`);
        log(`Event written to: ${notificationPath}`);

        // Show system notification
        notifier.notify({
          title: `OpenCode Event: ${parsed.topic}`,
          message: `${String(parsed.body).substring(0, 100)}${String(parsed.body).length > 100 ? "..." : ""}`,
          sound: true,
          wait: false
        });
        log("System notification sent");

        // Also try injecting as prompt (might work in future versions)
        await client.session.prompt({
          path: { id: sessionID },
          body: {
            parts: [{ type: "text", text: content }]
          }
        });

        log("Event processing complete");
      } catch (error) {
        log("Error during poll:", error);
      } finally {
        polling = false;
        log("Polling complete");
      }
    }
  };
};

export default EventCrusherPlugin;
