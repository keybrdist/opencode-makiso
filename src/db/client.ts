import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";
import { SCHEMA_SQL, SCHEMA_VERSION } from "./schema.js";

export type DatabaseOptions = {
  path: string;
  defaultOrg: string;
};

export type DatabaseClient = DatabaseType;

const hasColumn = (db: DatabaseClient, tableName: string, columnName: string): boolean => {
  const rows = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  return rows.some((row) => row.name === columnName);
};

const ensureScopeColumns = (db: DatabaseClient): void => {
  if (!hasColumn(db, "events", "org_id")) {
    db.exec("ALTER TABLE events ADD COLUMN org_id TEXT");
  }
  if (!hasColumn(db, "events", "workspace_id")) {
    db.exec("ALTER TABLE events ADD COLUMN workspace_id TEXT");
  }
  if (!hasColumn(db, "events", "project_id")) {
    db.exec("ALTER TABLE events ADD COLUMN project_id TEXT");
  }
  if (!hasColumn(db, "events", "repo_id")) {
    db.exec("ALTER TABLE events ADD COLUMN repo_id TEXT");
  }
};

const ensureScopeIndexes = (db: DatabaseClient): void => {
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_events_org_topic_status_created ON events(org_id, topic, status, created_at)"
  );
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_events_org_workspace_topic_status_created ON events(org_id, workspace_id, topic, status, created_at)"
  );
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_events_org_project_topic_status_created ON events(org_id, project_id, topic, status, created_at)"
  );
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_events_org_repo_topic_status_created ON events(org_id, repo_id, topic, status, created_at)"
  );
};

const applyMigrations = (db: DatabaseClient, defaultOrg: string): void => {
  ensureScopeColumns(db);
  ensureScopeIndexes(db);
  db.prepare("UPDATE events SET org_id = ? WHERE org_id IS NULL OR org_id = ''").run(defaultOrg);
};

export const openDatabase = ({ path, defaultOrg }: DatabaseOptions): DatabaseClient => {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA_SQL);

  const versionRow = db
    .prepare("SELECT value FROM metadata WHERE key = ?")
    .get("schema_version") as { value?: string } | undefined;
  const version = Number(versionRow?.value ?? "1");

  if (version < SCHEMA_VERSION) {
    applyMigrations(db, defaultOrg);
  } else {
    ensureScopeColumns(db);
    ensureScopeIndexes(db);
  }

  db.prepare(
    `INSERT INTO metadata (key, value)
     VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run("schema_version", String(SCHEMA_VERSION));

  return db;
};
