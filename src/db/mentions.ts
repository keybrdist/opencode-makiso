import type { DatabaseClient } from "./client.js";

const mentionPattern = /@[a-zA-Z0-9_-]+/g;

export const extractMentions = (body: string): string[] => {
  const matches = body.match(mentionPattern) ?? [];
  return Array.from(new Set(matches));
};

export const insertMentions = (
  db: DatabaseClient,
  eventId: string,
  body: string
): void => {
  const mentions = extractMentions(body);
  if (!mentions.length) return;

  const stmt = db.prepare("INSERT INTO mentions (event_id, mention) VALUES (?, ?)");
  const insertMany = db.transaction((items: string[]) => {
    for (const mention of items) {
      stmt.run(eventId, mention);
    }
  });

  insertMany(mentions);
};
