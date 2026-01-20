import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";
import { SCHEMA_SQL, SCHEMA_VERSION } from "./schema.js";

export type DatabaseOptions = {
  path: string;
};

export type DatabaseClient = DatabaseType;

export const openDatabase = ({ path }: DatabaseOptions): DatabaseClient => {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA_SQL);

  const version = db
    .prepare("SELECT value FROM metadata WHERE key = ?")
    .get("schema_version") as { value?: string } | undefined;

  if (!version) {
    db.prepare("INSERT INTO metadata (key, value) VALUES (?, ?)").run(
      "schema_version",
      String(SCHEMA_VERSION)
    );
  }

  return db;
};
