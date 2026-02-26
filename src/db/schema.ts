export const SCHEMA_VERSION = 2;

export const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  topic TEXT NOT NULL,
  body TEXT NOT NULL,
  metadata TEXT,
  correlation_id TEXT,
  parent_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  source TEXT NOT NULL DEFAULT 'agent',
  org_id TEXT,
  workspace_id TEXT,
  project_id TEXT,
  repo_id TEXT,
  created_at INTEGER NOT NULL,
  processed_at INTEGER,
  claimed_by TEXT,
  claimed_at INTEGER,
  expires_at INTEGER,
  FOREIGN KEY (parent_id) REFERENCES events(id)
);

CREATE INDEX IF NOT EXISTS idx_events_topic_status ON events(topic, status);
CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at);
CREATE INDEX IF NOT EXISTS idx_events_correlation_id ON events(correlation_id);
CREATE INDEX IF NOT EXISTS idx_events_claimed_by ON events(claimed_by);
CREATE INDEX IF NOT EXISTS idx_events_org_topic_status_created ON events(org_id, topic, status, created_at);
CREATE INDEX IF NOT EXISTS idx_events_org_workspace_topic_status_created ON events(org_id, workspace_id, topic, status, created_at);
CREATE INDEX IF NOT EXISTS idx_events_org_project_topic_status_created ON events(org_id, project_id, topic, status, created_at);
CREATE INDEX IF NOT EXISTS idx_events_org_repo_topic_status_created ON events(org_id, repo_id, topic, status, created_at);

CREATE VIRTUAL TABLE IF NOT EXISTS events_fts USING fts5(
  body,
  content='events',
  content_rowid='rowid'
);

CREATE TRIGGER IF NOT EXISTS events_ai AFTER INSERT ON events BEGIN
  INSERT INTO events_fts(rowid, body) VALUES (new.rowid, new.body);
END;

CREATE TRIGGER IF NOT EXISTS events_ad AFTER DELETE ON events BEGIN
  INSERT INTO events_fts(events_fts, rowid, body) VALUES ('delete', old.rowid, old.body);
END;

CREATE TRIGGER IF NOT EXISTS events_au AFTER UPDATE ON events BEGIN
  INSERT INTO events_fts(events_fts, rowid, body) VALUES ('delete', old.rowid, old.body);
  INSERT INTO events_fts(rowid, body) VALUES (new.rowid, new.body);
END;

CREATE TABLE IF NOT EXISTS topics (
  name TEXT PRIMARY KEY,
  system_prompt TEXT,
  description TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS mentions (
  event_id TEXT NOT NULL,
  mention TEXT NOT NULL,
  FOREIGN KEY (event_id) REFERENCES events(id)
);

CREATE INDEX IF NOT EXISTS idx_mentions_mention ON mentions(mention);

CREATE TABLE IF NOT EXISTS tool_calls (
  event_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  FOREIGN KEY (event_id) REFERENCES events(id)
);

CREATE INDEX IF NOT EXISTS idx_tool_calls_tool ON tool_calls(tool_name);
`;
