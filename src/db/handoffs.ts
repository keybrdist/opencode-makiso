import type { DatabaseClient } from "./client.js";
import { buildScopeCondition } from "./scope.js";
import type { EventRecord, EventScope, ScopeLevel } from "./types.js";

export type ClaimHandoffOptions = {
  topic: string;
  agent: string;
  recipient: string;
  scope: EventScope;
  scopeLevel?: ScopeLevel;
  includeUnscoped?: boolean;
};

const toMention = (value: string): string => {
  if (value.startsWith("@")) {
    return value;
  }
  return `@${value}`;
};

const toPlain = (value: string): string => value.replace(/^@/, "");

export const claimNextHandoffEvent = (
  db: DatabaseClient,
  options: ClaimHandoffOptions
): EventRecord | null => {
  const now = Date.now();
  const recipientMention = toMention(options.recipient);
  const recipientPlain = toPlain(options.recipient);
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
           AND (
             (json_valid(metadata) AND (
               json_extract(metadata, '$.handoff.to_agent') = ?
               OR json_extract(metadata, '$.handoff.to') = ?
               OR json_extract(metadata, '$.to_agent') = ?
               OR json_extract(metadata, '$.to') = ?
             ))
             OR body LIKE ?
           )
         ORDER BY created_at ASC
         LIMIT 1`
      )
      .get(
        options.topic,
        ...scopeCondition.params,
        recipientMention,
        recipientPlain,
        recipientMention,
        recipientPlain,
        `%${recipientMention}%`
      ) as { id?: string } | undefined;

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
