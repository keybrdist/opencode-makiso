import path from "node:path";

export type AppConfig = {
  dataDir: string;
  dbPath: string;
  promptsDir: string;
  pollTopic: string;
  pollAgent: string;
  pollIntervalMs: number;
};

export type WebhookConfig = {
  port: number;
  secret: string | null;
  routeMap: Record<string, string>;
  source: string;
};

const parseRouteMap = (value?: string): Record<string, string> => {
  if (!value) return {};
  const trimmed = value.trim();
  if (!trimmed) return {};

  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      return Object.fromEntries(
        Object.entries(parsed).map(([key, topic]) => [key, String(topic)])
      );
    } catch {
      return {};
    }
  }

  const map: Record<string, string> = {};
  for (const entry of trimmed.split(",")) {
    const [route, topic] = entry.split(/[:=]/);
    if (!route || !topic) continue;
    map[route.trim()] = topic.trim();
  }

  return map;
};

export const getDefaultConfig = (): AppConfig => {
  const home = process.env.HOME ?? ".";
  const dataDir = path.join(home, ".config", "opencode", "event-crusher");
  return {
    dataDir,
    dbPath: path.join(dataDir, "events.db"),
    promptsDir: path.join(dataDir, "prompts"),
    pollTopic: process.env.OC_EVENTS_TOPIC ?? "inbox",
    pollAgent: process.env.OC_AGENT_ID ?? "@opencode",
    pollIntervalMs: Number(process.env.OC_EVENTS_POLL_INTERVAL_MS ?? "60000")
  };
};

export const getWebhookConfig = (): WebhookConfig => {
  return {
    port: Number(process.env.OC_EVENTS_WEBHOOK_PORT ?? "8787"),
    secret: process.env.OC_EVENTS_WEBHOOK_SECRET ?? null,
    routeMap: parseRouteMap(process.env.OC_EVENTS_WEBHOOK_ROUTES),
    source: process.env.OC_EVENTS_WEBHOOK_SOURCE ?? "webhook"
  };
};
