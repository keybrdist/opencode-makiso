import type { Plugin } from "@opencode-ai/plugin";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
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

export const EventCrusherPlugin: Plugin = async ({ client }) => {
  const config = getDefaultConfig();
  const triggerPath = path.join(config.dataDir, ".trigger");
  let watcher: fs.FSWatcher | null = null;
  let initialized = false;

  log("EventCrusherPlugin initialized");

  // Ensure trigger file exists
  try {
    fs.mkdirSync(path.dirname(triggerPath), { recursive: true });
    if (!fs.existsSync(triggerPath)) {
      fs.writeFileSync(triggerPath, "0");
    }
  } catch (error) {
    log("Error creating trigger file:", error);
  }

  const checkForEvents = async () => {
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
        
        // Show toast notification
        await client.tui.showToast({
          body: {
            title: "Event Crusher",
            message: `${count} pending event${count > 1 ? "s" : ""} - use /event-crusher`,
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

  // Set up file watcher
  const startWatcher = () => {
    if (watcher) return;

    try {
      watcher = fs.watch(triggerPath, { persistent: false }, (eventType) => {
        if (eventType === "change") {
          log("Trigger file changed");
          checkForEvents();
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
      // Start watcher on first session event
      if (!initialized && (event.type === "session.status" || event.type === "session.idle")) {
        initialized = true;
        startWatcher();
      }
    }
  };
};

export default EventCrusherPlugin;
