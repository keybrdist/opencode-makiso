import type { Plugin } from "@opencode-ai/plugin";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { getDefaultConfig } from "./config.js";

const LOG_ENABLED = process.env.OC_EVENTS_DEBUG === "1";
const LOG_PATH = path.join(process.env.HOME ?? ".", ".config", "opencode", "makiso", "plugin.log");

const log = (message: string, data?: unknown) => {
  if (!LOG_ENABLED) return;
  const timestamp = new Date().toISOString();
  const logLine = data
    ? `[${timestamp}] ${message} ${JSON.stringify(data, null, 2)}\n`
    : `[${timestamp}] ${message}\n`;
  fs.appendFileSync(LOG_PATH, logLine);
};

// Mode: "notify" (toast only) | "auto" (auto-process in current session)
const MODE = process.env.OC_EVENTS_MODE ?? "notify";

export const EventCrusherPlugin: Plugin = async ({ client, directory }) => {
  const config = getDefaultConfig();
  const triggerPath = path.join(config.dataDir, ".trigger");
  let watcher: fs.FSWatcher | null = null;
  let initialized = false;
  let processing = false;
  let currentSessionId: string | null = null;

  log("EventCrusherPlugin initialized", { mode: MODE });

  // Ensure trigger file exists
  try {
    fs.mkdirSync(path.dirname(triggerPath), { recursive: true });
    if (!fs.existsSync(triggerPath)) {
      fs.writeFileSync(triggerPath, "0");
    }
  } catch (error) {
    log("Error creating trigger file:", error);
  }

  const processEventInCurrentSession = async () => {
    if (processing || !currentSessionId) {
      log("Already processing or no session", { processing, currentSessionId });
      return;
    }
    processing = true;

    try {
      // Pull and claim the event
      const cmd = `oc-events pull ${config.pollTopic} --agent ${config.pollAgent}`;
      const output = execSync(cmd, { encoding: "utf8", timeout: 5000 }).trim();

      if (!output) {
        log("No pending events");
        return;
      }

      const event = JSON.parse(output);
      log("Processing event in current session:", event);

      // Build the prompt
      const prompt = [
        "[INCOMING EVENT]",
        event.system_prompt ?? "Process this event and complete the requested task.",
        "",
        "---",
        event.body,
        "---",
        "",
        `When done, run: oc-events reply ${event.id} --status completed --body "your summary"`
      ].join("\n");

      // Inject into current session
      await client.session.prompt({
        path: { id: currentSessionId },
        body: {
          parts: [{ type: "text", text: prompt }]
        },
        query: { directory }
      });

      log("Event injected into current session:", { sessionId: currentSessionId, eventId: event.id });

    } catch (error) {
      log("Error processing event:", error);
    } finally {
      processing = false;
    }
  };

  const notifyOnly = async () => {
    try {
      // Count pending events without claiming
      const cmd = `oc-events search "a" 2>/dev/null || echo "[]"`;
      const output = execSync(cmd, { encoding: "utf8", timeout: 5000, shell: "/bin/bash" }).trim();

      let count = 0;
      try {
        const events = JSON.parse(output);
        count = events.filter((e: { status: string }) => e.status === "pending").length;
      } catch {
        // Ignore parse errors
      }

      if (count > 0) {
        log(`Found ${count} pending events`);

        await client.tui.showToast({
          body: {
            title: "Event Crusher",
            message: `${count} pending event${count > 1 ? "s" : ""} - use /makiso`,
            variant: "info",
            duration: 4000
          }
        });
        log("Toast shown");
      }
    } catch (error) {
      log("Error checking events:", error);
    }
  };

  const onTrigger = () => {
    log("Trigger file changed", { mode: MODE });
    if (MODE === "auto") {
      processEventInCurrentSession();
    } else {
      notifyOnly();
    }
  };

  // Set up file watcher
  const startWatcher = () => {
    if (watcher) return;

    try {
      watcher = fs.watch(triggerPath, { persistent: false }, (eventType) => {
        if (eventType === "change") {
          onTrigger();
        }
      });

      watcher.on("error", (error) => {
        log("Watcher error:", error);
      });

      log(`File watcher started: ${triggerPath}`);
    } catch (error) {
      log("Failed to start file watcher:", error);
    }
  };

  return {
    event: async ({ event }) => {
      // Track session and start watcher
      if (event.type === "session.status" || event.type === "session.idle") {
        const sessionId = event.properties.sessionID as string | undefined;
        if (sessionId) {
          currentSessionId = sessionId;
        }

        if (!initialized) {
          initialized = true;
          startWatcher();
        }
      }
    }
  };
};

export default EventCrusherPlugin;
