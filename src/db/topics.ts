import type { DatabaseClient } from "./client.js";
import type { TopicRecord } from "./types.js";

export type NewTopicInput = {
  name: string;
  systemPrompt?: string | null;
  description?: string | null;
};

export const listTopics = (db: DatabaseClient): TopicRecord[] => {
  return db
    .prepare("SELECT * FROM topics ORDER BY name ASC")
    .all() as TopicRecord[];
};

export const getTopicByName = (
  db: DatabaseClient,
  name: string
): TopicRecord | null => {
  const row = db.prepare("SELECT * FROM topics WHERE name = ?").get(name) as
    | TopicRecord
    | undefined;
  return row ?? null;
};

export const upsertTopic = (db: DatabaseClient, input: NewTopicInput): TopicRecord => {
  const now = Date.now();
  db.prepare(
    `INSERT INTO topics (name, system_prompt, description, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(name) DO UPDATE SET
       system_prompt = excluded.system_prompt,
       description = excluded.description`
  ).run(input.name, input.systemPrompt ?? null, input.description ?? null, now);

  return db
    .prepare("SELECT * FROM topics WHERE name = ?")
    .get(input.name) as TopicRecord;
};
