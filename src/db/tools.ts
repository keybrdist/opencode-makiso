import type { DatabaseClient } from "./client.js";

const toolPattern = /\b(bash|read|write|edit|glob|grep|task|question)\b/g;

export const extractToolCalls = (body: string): string[] => {
  const matches = body.match(toolPattern) ?? [];
  return Array.from(new Set(matches));
};

export const insertToolCalls = (
  db: DatabaseClient,
  eventId: string,
  body: string
): void => {
  const tools = extractToolCalls(body);
  if (!tools.length) return;

  const stmt = db.prepare("INSERT INTO tool_calls (event_id, tool_name) VALUES (?, ?)");
  const insertMany = db.transaction((items: string[]) => {
    for (const tool of items) {
      stmt.run(eventId, tool);
    }
  });

  insertMany(tools);
};
