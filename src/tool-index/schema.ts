// DDL of the per-module tool index (<vault>/<configDir>/plugins/<id>/tools.db). Pure Node.

import { DatabaseSync } from "node:sqlite";

/** 2: columns kind and exemplo_json (added in place to version 1 files). */
export const TOOL_INDEX_SCHEMA_VERSION = 2;

export const TOOL_INDEX_DDL = `
CREATE TABLE IF NOT EXISTS tools (
  name TEXT PRIMARY KEY,
  module_id TEXT NOT NULL,
  title TEXT,
  description TEXT NOT NULL DEFAULT '',
  categoria TEXT NOT NULL DEFAULT '',
  resumo TEXT NOT NULL DEFAULT '',
  efeito TEXT NOT NULL DEFAULT 'externo',
  exposicao TEXT NOT NULL DEFAULT 'indice',
  aprovacao TEXT,
  input_schema TEXT,
  hash TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  kind TEXT NOT NULL DEFAULT 'tool',
  exemplo_json TEXT
);
CREATE TABLE IF NOT EXISTS tool_tags (
  tool_name TEXT NOT NULL REFERENCES tools(name) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  PRIMARY KEY (tool_name, tag)
);
CREATE INDEX IF NOT EXISTS idx_tool_tags_tag ON tool_tags(tag);
CREATE VIRTUAL TABLE IF NOT EXISTS tools_fts USING fts5(name, resumo, categoria, tags, description);
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

/** Columns added after version 1, with their definition for ALTER TABLE. */
const ADDED_COLUMNS: ReadonlyArray<[string, string]> = [
  ["kind", "kind TEXT NOT NULL DEFAULT 'tool'"],
  ["exemplo_json", "exemplo_json TEXT"],
];

/** Adds the columns a version 1 file lacks. Idempotent. */
export function migrateToolIndexDb(db: DatabaseSync): void {
  const columns = new Set((db.prepare("PRAGMA table_info(tools)").all() as Array<{ name: string }>).map((c) => c.name));
  for (const [name, definition] of ADDED_COLUMNS) {
    if (!columns.has(name)) db.exec(`ALTER TABLE tools ADD COLUMN ${definition}`);
  }
  db.prepare("INSERT INTO meta (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(
    String(TOOL_INDEX_SCHEMA_VERSION),
  );
}

/** Opens (or creates) the database, applies the pragmas, creates the tables and migrates old files. */
export function openToolIndexDb(filePath: string): DatabaseSync {
  const db = new DatabaseSync(filePath);
  try {
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec("PRAGMA synchronous = NORMAL;");
    db.exec("PRAGMA busy_timeout = 3000;");
    db.exec("PRAGMA foreign_keys = ON;");
    db.exec(TOOL_INDEX_DDL);
    migrateToolIndexDb(db);
  } catch (err) {
    db.close();
    throw err;
  }
  return db;
}
