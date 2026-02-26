import { ulid } from "ulid";
import fs from "node:fs";
import path from "node:path";
import type { DatabaseClient } from "./client.js";
import { buildScopeCondition } from "./scope.js";
import type { EventRecord, EventScope, EventStatus, ScopeLevel } from "./types.js";

// Touch trigger file to notify watchers
const touchTrigger = () => {
  const triggerPath = path.join(
    process.env.HOME ?? ".",
    ".config", "opencode", "makiso", ".trigger"
  );
  try {
    fs.writeFileSync(triggerPath, Date.now().toString());
  } catch {
    // Ignore errors - watcher is optional
  }
};

export type NewEventInput = {
  topic: string;
  body: string;
  metadata?: string | null;
  correlationId?: string | null;
  parentId?: string | null;
  source?: string;
  status?: EventStatus;
  orgId: string;
  workspaceId?: string | null;
  projectId?: string | null;
  repoId?: string | null;
};

export type ClaimOptions = {
  topic: string;
  agent: string;
  scope: EventScope;
  scopeLevel?: ScopeLevel;
  includeUnscoped?: boolean;
};

export const insertEvent = (db: DatabaseClient, input: NewEventInput): EventRecord => {
  const now = Date.now();
  const id = ulid();
  const stmt = db.prepare(
    `INSERT INTO events (
      id, topic, body, metadata, correlation_id, parent_id, status, source, org_id, workspace_id, project_id, repo_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
    input.orgId,
    input.workspaceId ?? null,
    input.projectId ?? null,
    input.repoId ?? null,
    now
  );

  const row = db.prepare("SELECT * FROM events WHERE id = ?").get(id) as EventRecord;

  // Notify watchers
  touchTrigger();

  return row;
};

export const claimNextEvent = (
  db: DatabaseClient,
  options: ClaimOptions
): EventRecord | null => {
  const now = Date.now();
  const scopeCondition = buildScopeCondition({
    scope: options.scope,
    scopeLevel: options.scopeLevel,
    includeUnscoped: options.includeUnscoped,
    tableAlias: "events"
  });

  const claim = db.transaction(() => {
    const candidate = db
      .prepare(
        `SELECT id FROM events
         WHERE topic = ? AND status = 'pending' AND ${scopeCondition.sql}
         ORDER BY created_at ASC
         LIMIT 1`
      )
      .get(options.topic, ...scopeCondition.params) as { id?: string } | undefined;

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
