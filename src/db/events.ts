import { ulid } from "ulid";
import type { DatabaseClient } from "./client.js";
import type { EventRecord, EventStatus } from "./types.js";

export type NewEventInput = {
  topic: string;
  body: string;
  metadata?: string | null;
  correlationId?: string | null;
  parentId?: string | null;
  source?: string;
  status?: EventStatus;
};

export type ClaimOptions = {
  topic: string;
  agent: string;
};

export const insertEvent = (db: DatabaseClient, input: NewEventInput): EventRecord => {
  const now = Date.now();
  const id = ulid();
  const stmt = db.prepare(
    `INSERT INTO events (
      id, topic, body, metadata, correlation_id, parent_id, status, source, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  stmt.run(
    id,
    input.topic,
    input.body,
    input.metadata ?? null,
    input.correlationId ?? null,
    input.parentId ?? null,
    input.status ?? "pending",
    input.source ?? "agent",
    now
  );

  const row = db.prepare("SELECT * FROM events WHERE id = ?").get(id) as EventRecord;
  return row;
};

export const claimNextEvent = (
  db: DatabaseClient,
  options: ClaimOptions
): EventRecord | null => {
  const now = Date.now();
  const claim = db.transaction(() => {
    const candidate = db
      .prepare(
        `SELECT id FROM events
         WHERE topic = ? AND status = 'pending'
         ORDER BY created_at ASC
         LIMIT 1`
      )
      .get(options.topic) as { id?: string } | undefined;

    if (!candidate?.id) {
      return null;
    }

    db.prepare(
      `UPDATE events
       SET status = 'processing', claimed_by = ?, claimed_at = ?
       WHERE id = ? AND status = 'pending'`
    ).run(options.agent, now, candidate.id);

    const row = db.prepare("SELECT * FROM events WHERE id = ?").get(candidate.id) as
      | EventRecord
      | undefined;
    return row ?? null;
  });

  return claim();
};

export const updateEventStatus = (
  db: DatabaseClient,
  id: string,
  status: EventStatus,
  processedAt?: number
): EventRecord | null => {
  db.prepare(
    `UPDATE events
     SET status = ?, processed_at = ?
     WHERE id = ?`
  ).run(status, processedAt ?? Date.now(), id);

  const row = db.prepare("SELECT * FROM events WHERE id = ?").get(id) as
    | EventRecord
    | undefined;

  return row ?? null;
};
