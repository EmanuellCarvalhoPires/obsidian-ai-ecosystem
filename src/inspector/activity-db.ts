import { DatabaseSync } from "node:sqlite";
import * as fs from "node:fs";
import * as path from "node:path";
import type { ActivityEntry } from "../types";

export interface ActivityDatabaseOptions {
  /** Absolute path to the sqlite file on disk, or ":memory:". */
  filePath: string;
}

interface ActivityRow {
  id: string | number;
  time: number;
  kind: string;
  method: string;
  target: string;
  module_id: string | null;
  client: string | null;
  status: number;
  duration_ms: number;
  request_headers: string | null;
  payload: string | null;
  response: string | null;
  output: string | null;
  alert: number;
  running: number;
  tokens_input: number | null;
  tokens_output: number | null;
  tokens_total: number | null;
}

export class ActivityDatabase {
  private db: DatabaseSync | null = null;
  private readonly filePath: string;
  private insertStmt: ReturnType<DatabaseSync["prepare"]> | null = null;
  private updateStmt: ReturnType<DatabaseSync["prepare"]> | null = null;
  private clearStmt: ReturnType<DatabaseSync["prepare"]> | null = null;

  constructor(opts: ActivityDatabaseOptions) {
    this.filePath = opts.filePath;
    this.init();
  }

  private init(): void {
    if (this.filePath !== ":memory:") {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    this.db = new DatabaseSync(this.filePath);

    // Pragmas for performance and concurrency
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA synchronous = NORMAL;");

    // Table definition
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS activity_log (
        id TEXT PRIMARY KEY,
        time INTEGER NOT NULL,
        kind TEXT NOT NULL,
        method TEXT NOT NULL,
        target TEXT NOT NULL,
        module_id TEXT,
        client TEXT,
        status INTEGER NOT NULL,
        duration_ms REAL NOT NULL,
        request_headers TEXT,
        payload TEXT,
        response TEXT,
        output TEXT,
        alert INTEGER NOT NULL,
        running INTEGER NOT NULL,
        tokens_input INTEGER,
        tokens_output INTEGER,
        tokens_total INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_activity_time ON activity_log(time DESC);
      CREATE INDEX IF NOT EXISTS idx_activity_module ON activity_log(module_id);
      CREATE INDEX IF NOT EXISTS idx_activity_client ON activity_log(client);
    `);

    this.insertStmt = this.db.prepare(`
      INSERT INTO activity_log (
        id, time, kind, method, target, module_id, client, status, duration_ms,
        request_headers, payload, response, output, alert, running,
        tokens_input, tokens_output, tokens_total
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?
      )
      ON CONFLICT(id) DO UPDATE SET
        time = excluded.time,
        status = excluded.status,
        duration_ms = excluded.duration_ms,
        request_headers = excluded.request_headers,
        payload = excluded.payload,
        response = excluded.response,
        output = excluded.output,
        alert = excluded.alert,
        running = excluded.running,
        tokens_input = excluded.tokens_input,
        tokens_output = excluded.tokens_output,
        tokens_total = excluded.tokens_total
    `);

    this.updateStmt = this.db.prepare(`
      UPDATE activity_log SET
        time = ?,
        status = ?,
        duration_ms = ?,
        request_headers = ?,
        payload = ?,
        response = ?,
        output = ?,
        alert = ?,
        running = ?,
        tokens_input = ?,
        tokens_output = ?,
        tokens_total = ?
      WHERE id = ?
    `);

    this.clearStmt = this.db.prepare("DELETE FROM activity_log");
  }

  save(entry: ActivityEntry): void {
    if (!this.db || !this.insertStmt) return;
    try {
      this.insertStmt.run(
        entry.id,
        entry.time,
        entry.kind,
        entry.method,
        entry.target,
        entry.moduleId ?? "",
        entry.client ?? "",
        entry.status,
        entry.durationMs,
        JSON.stringify(entry.requestHeaders ?? {}),
        entry.payload ?? "",
        entry.response ?? "",
        entry.output ?? "",
        entry.alert ? 1 : 0,
        entry.running ? 1 : 0,
        entry.tokens?.input ?? null,
        entry.tokens?.output ?? null,
        entry.tokens?.total ?? null,
      );
    } catch (err) {
      console.warn("Failed to save activity entry to SQLite database", err);
    }
  }

  update(entry: ActivityEntry): void {
    if (!this.db || !this.updateStmt) return;
    try {
      this.updateStmt.run(
        entry.time,
        entry.status,
        entry.durationMs,
        JSON.stringify(entry.requestHeaders ?? {}),
        entry.payload ?? "",
        entry.response ?? "",
        entry.output ?? "",
        entry.alert ? 1 : 0,
        entry.running ? 1 : 0,
        entry.tokens?.input ?? null,
        entry.tokens?.output ?? null,
        entry.tokens?.total ?? null,
        entry.id,
      );
    } catch (err) {
      console.warn("Failed to update activity entry in SQLite database", err);
    }
  }

  getRecent(limit = 500): ActivityEntry[] {
    if (!this.db) return [];
    try {
      const rows = this.db.prepare(`
        SELECT * FROM (
          SELECT * FROM activity_log
          ORDER BY time DESC, id DESC
          LIMIT ?
        ) ORDER BY time ASC, id ASC
      `).all(limit) as unknown as ActivityRow[];

      return rows.map((row) => this.mapRow(row));
    } catch (err) {
      console.warn("Failed to query recent activity from SQLite database", err);
      return [];
    }
  }

  clear(): void {
    if (!this.db || !this.clearStmt) return;
    try {
      this.clearStmt.run();
    } catch (err) {
      console.warn("Failed to clear activity log in SQLite database", err);
    }
  }

  close(): void {
    if (this.db) {
      try {
        this.db.close();
      } catch {
        // Ignore errors on close
      }
      this.db = null;
    }
  }

  private mapRow(row: ActivityRow): ActivityEntry {
    let headers: Record<string, string> = {};
    if (typeof row.request_headers === "string" && row.request_headers) {
      try {
        const parsed = JSON.parse(row.request_headers) as unknown;
        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
          headers = parsed as Record<string, string>;
        }
      } catch {
        headers = {};
      }
    }

    const entry: ActivityEntry = {
      id: String(row.id),
      time: Number(row.time),
      kind: row.kind as ActivityEntry["kind"],
      method: String(row.method),
      target: String(row.target),
      moduleId: row.module_id ?? "",
      client: row.client ?? "",
      status: Number(row.status),
      durationMs: Number(row.duration_ms),
      requestHeaders: headers,
      payload: row.payload ?? "",
      response: row.response ?? "",
      output: row.output ?? "",
      alert: Boolean(row.alert),
      running: Boolean(row.running),
    };

    if (row.tokens_total !== null && row.tokens_total !== undefined) {
      entry.tokens = {
        input: Number(row.tokens_input ?? 0),
        output: Number(row.tokens_output ?? 0),
        total: Number(row.tokens_total),
      };
    }

    return entry;
  }
}
