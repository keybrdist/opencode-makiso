import { execFileSync } from "node:child_process";
import path from "node:path";
import type { AppConfig } from "./config.js";
import type { DatabaseClient } from "./db/client.js";
import type { EventScope, ScopeLevel } from "./db/types.js";

export type ScopeInputOptions = {
  org?: string;
  workspace?: string;
  project?: string;
  repo?: string;
  scope?: ScopeLevel;
  includeUnscoped?: boolean;
};

type StoredScope = {
  org_id: string | null;
  workspace_id: string | null;
  project_id: string | null;
  repo_id: string | null;
};

const CONTEXT_KEYS = {
  org_id: "context.org_id",
  workspace_id: "context.workspace_id",
  project_id: "context.project_id",
  repo_id: "context.repo_id"
} as const;

const toNullable = (value?: string | null): string | null => {
  if (value === undefined || value === null) {
    return null;
  }
  const normalized = value.trim();
  if (!normalized) {
    return null;
  }
  if (normalized === "none" || normalized === "null") {
    return null;
  }
  return normalized;
};

const detectGitRepoId = (cwd: string): string | null => {
  try {
    const isInside = execFileSync("git", ["rev-parse", "--is-inside-work-tree"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
    if (isInside !== "true") {
      return null;
    }

    const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();

    const repoId = path.basename(repoRoot);
    return repoId || null;
  } catch {
    return null;
  }
};

export const getStoredContext = (db: DatabaseClient): StoredScope => {
  const rows = db
    .prepare(
      `SELECT key, value FROM metadata
       WHERE key IN (?, ?, ?, ?)`
    )
    .all(
      CONTEXT_KEYS.org_id,
      CONTEXT_KEYS.workspace_id,
      CONTEXT_KEYS.project_id,
      CONTEXT_KEYS.repo_id
    ) as Array<{ key: string; value: string }>;

  const lookup = new Map(rows.map((row) => [row.key, row.value]));

  return {
    org_id: lookup.get(CONTEXT_KEYS.org_id) ?? null,
    workspace_id: lookup.get(CONTEXT_KEYS.workspace_id) ?? null,
    project_id: lookup.get(CONTEXT_KEYS.project_id) ?? null,
    repo_id: lookup.get(CONTEXT_KEYS.repo_id) ?? null
  };
};

export const saveContext = (
  db: DatabaseClient,
  input: Partial<StoredScope> & { org_id?: string | null }
): StoredScope => {
  const current = getStoredContext(db);
  const next: StoredScope = {
    org_id: input.org_id !== undefined ? toNullable(input.org_id) : current.org_id,
    workspace_id:
      input.workspace_id !== undefined ? toNullable(input.workspace_id) : current.workspace_id,
    project_id: input.project_id !== undefined ? toNullable(input.project_id) : current.project_id,
    repo_id: input.repo_id !== undefined ? toNullable(input.repo_id) : current.repo_id
  };

  if (!next.org_id) {
    throw new Error("org_id is required for saved context");
  }

  const entries: Array<[string, string | null]> = [
    [CONTEXT_KEYS.org_id, next.org_id],
    [CONTEXT_KEYS.workspace_id, next.workspace_id],
    [CONTEXT_KEYS.project_id, next.project_id],
    [CONTEXT_KEYS.repo_id, next.repo_id]
  ];

  for (const [key, value] of entries) {
    if (value === null) {
      db.prepare("DELETE FROM metadata WHERE key = ?").run(key);
    } else {
      db.prepare(
        `INSERT INTO metadata (key, value)
         VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      ).run(key, value);
    }
  }

  return next;
};

export const clearSavedContext = (db: DatabaseClient): void => {
  db.prepare(
    `DELETE FROM metadata
     WHERE key IN (?, ?, ?, ?)`
  ).run(
    CONTEXT_KEYS.org_id,
    CONTEXT_KEYS.workspace_id,
    CONTEXT_KEYS.project_id,
    CONTEXT_KEYS.repo_id
  );
};

export const resolveScopeContext = (
  db: DatabaseClient,
  config: AppConfig,
  options: ScopeInputOptions,
  cwd = process.cwd()
): EventScope => {
  const stored = getStoredContext(db);
  const gitRepoId = detectGitRepoId(cwd);

  const orgId = toNullable(options.org) ?? stored.org_id ?? config.defaultOrg;
  const workspaceId =
    toNullable(options.workspace) ?? stored.workspace_id ?? toNullable(config.defaultWorkspace);
  const projectId =
    toNullable(options.project) ?? stored.project_id ?? toNullable(config.defaultProject);
  const repoId =
    toNullable(options.repo) ??
    stored.repo_id ??
    toNullable(config.defaultRepo) ??
    toNullable(gitRepoId);

  return {
    org_id: orgId,
    workspace_id: workspaceId,
    project_id: projectId,
    repo_id: repoId
  };
};
