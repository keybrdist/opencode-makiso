import type { DatabaseClient } from "./client.js";
import { buildScopeCondition } from "./scope.js";
import type { EventScope, ScopeLevel } from "./types.js";

export type CleanupOptions = {
  completedRetentionDays: number;
  pendingRetentionDays: number;
  scope?: EventScope;
  scopeLevel?: ScopeLevel;
  includeUnscoped?: boolean;
};

export const cleanupEvents = (db: DatabaseClient, options: CleanupOptions): number => {
  const now = Date.now();
  const completedCutoff = now - options.completedRetentionDays * 24 * 60 * 60 * 1000;
  const pendingCutoff = now - options.pendingRetentionDays * 24 * 60 * 60 * 1000;
  const whereParts = [
    `((status IN ('completed', 'failed') AND created_at < ?)
      OR (status = 'pending' AND created_at < ?))`
  ];
  const params: Array<number | string> = [completedCutoff, pendingCutoff];

  if (options.scope) {
    const scopeCondition = buildScopeCondition({
      scope: options.scope,
      scopeLevel: options.scopeLevel,
      includeUnscoped: options.includeUnscoped,
      tableAlias: "events"
    });
    whereParts.push(scopeCondition.sql);
    params.push(...scopeCondition.params);
  }

  const stmt = db.prepare(
    `DELETE FROM events
     WHERE ${whereParts.join(" AND ")}`
  );

  const result = stmt.run(...params);
  return result.changes;
};
