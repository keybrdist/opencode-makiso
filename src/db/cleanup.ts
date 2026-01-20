import type { DatabaseClient } from "./client.js";

export type CleanupOptions = {
  completedRetentionDays: number;
  pendingRetentionDays: number;
};

export const cleanupEvents = (db: DatabaseClient, options: CleanupOptions): number => {
  const now = Date.now();
  const completedCutoff = now - options.completedRetentionDays * 24 * 60 * 60 * 1000;
  const pendingCutoff = now - options.pendingRetentionDays * 24 * 60 * 60 * 1000;

  const stmt = db.prepare(
    `DELETE FROM events
     WHERE (status IN ('completed', 'failed') AND created_at < ?)
        OR (status = 'pending' AND created_at < ?)`
  );

  const result = stmt.run(completedCutoff, pendingCutoff);
  return result.changes;
};
