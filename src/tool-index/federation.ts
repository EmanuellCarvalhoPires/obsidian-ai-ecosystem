// Federated search over the tool indexes of the registered modules. Pure Node.
//
// One in-memory SQLite connection ATTACHes the tools.db of every registered module (a module that
// leaves the registry leaves the search). SQLite allows 10 attached databases per connection, so
// more modules spread over extra connections. The "main" schema of the first connection holds a
// live copy of the registered MCP tools, so tools of modules that never wrote a tools.db are found
// too; a row of a module's own tools.db wins over the live copy of the same tool.
import * as fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { clearTimeout, setTimeout } from "node:timers";
import { DISCOVERY_TOOL_NAMES } from "../types";
import type { RegisteredTool, RegistryChange, ToolEffect, ToolExposure, ToolIndexEntry, ToolKind } from "../types";
import { openToolIndexDb } from "./schema";
import { syncToolIndexDb, toIndexEntry } from "./tool-index-writer";

/** Attached databases per connection (the SQLite default limit is 10). */
export const MAX_ATTACHED_PER_CONNECTION = 8;
/** Connections (and the file handles of the attached tools.db) are closed after this idle time. */
export const FEDERATION_IDLE_CLOSE_MS = 30_000;
export const DEFAULT_FIND_LIMIT = 10;
export const MAX_FIND_LIMIT = 50;
const MAX_QUERY_TOKENS = 8;
const LIVE_SCHEMA = "main";

export interface FederationDeps {
  /** Ids of the registered modules. */
  listModuleIds: () => string[];
  /** The registered MCP tools (the live part of the index). */
  listTools: () => RegisteredTool[];
  /** Path of a module's tools.db. Undefined, or a missing file, means the module has none. */
  indexPath?: (moduleId: string) => string | undefined;
  idleCloseMs?: number;
}

export interface IndexedTool {
  name: string;
  moduleId: string;
  kind: ToolKind;
  title: string | null;
  description: string;
  categoria: string;
  tags: string[];
  resumo: string;
  efeito: ToolEffect;
  exposicao: ToolExposure;
  aprovacao: string | null;
  inputSchema?: Record<string, unknown>;
  exemplo?: Record<string, unknown>;
  /** "index": a module's tools.db; "registry": the live copy of a registered tool. */
  source: "index" | "registry";
  /** BM25 rank (lower is better); 0 without a text query. */
  score: number;
}

export interface FindQuery {
  /** Free text, matched with FTS5 (prefix match per word, all words first, then any word). */
  q?: string;
  tag?: string;
  /** Exact category, or a parent category ("git" also finds "git/leitura"). */
  categoria?: string;
  modulo?: string;
  kind?: string;
  efeito?: string;
  limit?: number;
}

export interface FindResult {
  tools: IndexedTool[];
  /** More tools matched than the limit. */
  more: boolean;
}

interface Attached {
  alias: string;
  moduleId: string;
  file: string;
}

interface Connection {
  db: DatabaseSync;
  attached: Attached[];
  /** The live copy of the registry is in this connection's main schema. */
  live: boolean;
}

interface Row {
  src: string;
  name: string;
  module_id: string;
  kind: string | null;
  title: string | null;
  description: string | null;
  categoria: string | null;
  resumo: string | null;
  efeito: string | null;
  exposicao: string | null;
  aprovacao: string | null;
  input_schema: string | null;
  exemplo_json: string | null;
  tags: string | null;
  score: number | null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseObject(text: string | null): Record<string, unknown> | undefined {
  if (!text) return undefined;
  try {
    const parsed = JSON.parse(text) as unknown;
    return isObject(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** FTS5 expression of a free-text query: each word quoted, as a prefix. Undefined without words. */
export function ftsExpression(q: string, op: "AND" | "OR"): string | undefined {
  const tokens = (q.normalize("NFKC").match(/[\p{L}\p{N}]+/gu) ?? []).slice(0, MAX_QUERY_TOKENS);
  if (tokens.length === 0) return undefined;
  return tokens.map((t) => `"${t}"*`).join(` ${op} `);
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function columns(schema: string, t: string): string {
  return [
    `'${schema}' AS src`,
    `${t}.name AS name`,
    `${t}.module_id AS module_id`,
    `${t}.kind AS kind`,
    `${t}.title AS title`,
    `${t}.description AS description`,
    `${t}.categoria AS categoria`,
    `${t}.resumo AS resumo`,
    `${t}.efeito AS efeito`,
    `${t}.exposicao AS exposicao`,
    `${t}.aprovacao AS aprovacao`,
    `${t}.input_schema AS input_schema`,
    `${t}.exemplo_json AS exemplo_json`,
    `(SELECT group_concat(g.tag, ' ') FROM ${schema}.tool_tags g WHERE g.tool_name = ${t}.name) AS tags`,
  ].join(", ");
}

/** WHERE clause of the filters (the discovery tools themselves are never part of the index). */
function filters(schema: string, t: string, query: FindQuery, params: Array<string | number>): string {
  const where = [`${t}.name NOT IN (${DISCOVERY_TOOL_NAMES.map((n) => `'${n}'`).join(", ")})`];
  if (query.modulo) {
    where.push(`${t}.module_id = ?`);
    params.push(query.modulo);
  }
  if (query.kind) {
    where.push(`${t}.kind = ?`);
    params.push(query.kind);
  }
  if (query.efeito) {
    where.push(`${t}.efeito = ?`);
    params.push(query.efeito);
  }
  if (query.categoria) {
    where.push(`(lower(${t}.categoria) = lower(?) OR lower(${t}.categoria) LIKE lower(?) ESCAPE '\\')`);
    params.push(query.categoria, `${escapeLike(query.categoria)}/%`);
  }
  if (query.tag) {
    where.push(`EXISTS (SELECT 1 FROM ${schema}.tool_tags g2 WHERE g2.tool_name = ${t}.name AND lower(g2.tag) = lower(?))`);
    params.push(query.tag);
  }
  return where.join(" AND ");
}

const BM25 = "bm25(tools_fts, 10.0, 4.0, 2.0, 3.0, 1.0)";

export class ToolFederation {
  private connections: Connection[] = [];
  private signature: string | undefined;
  private liveDirty = true;
  private liveCount = 0;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  /** tools.db files already migrated to the current schema in this session. */
  private readonly migrated = new Set<string>();
  private closed = false;

  constructor(private readonly deps: FederationDeps) {}

  /** Searches every index. Never throws: a broken index is skipped. */
  find(query: FindQuery): FindResult {
    const limit = Math.min(MAX_FIND_LIMIT, Math.max(1, Math.trunc(Number(query.limit ?? DEFAULT_FIND_LIMIT)) || DEFAULT_FIND_LIMIT));
    if (!this.ensure()) return { tools: [], more: false };
    const text = typeof query.q === "string" ? query.q.trim() : "";
    let rows: Row[];
    const all = ftsExpression(text, "AND");
    if (all) {
      rows = this.collect(query, all, limit);
      const any = ftsExpression(text, "OR");
      if (rows.length === 0 && any && any !== all) rows = this.collect(query, any, limit);
    } else {
      rows = this.collect(query, undefined, limit);
    }

    const merged = this.merge(rows);
    // An exact tool name always comes first, even when its words rank lower.
    if (text && /^[\w.:-]+$/.test(text)) {
      const exact = this.lookup([text], query).get(text);
      if (exact) merged.set(text, { ...exact, score: Number.NEGATIVE_INFINITY });
    }
    const list = [...merged.values()].sort((a, b) =>
      all || text
        ? a.score - b.score || a.name.localeCompare(b.name)
        : a.moduleId.localeCompare(b.moduleId) || a.name.localeCompare(b.name),
    );
    this.touch();
    return { tools: list.slice(0, limit).map((t) => (Number.isFinite(t.score) ? t : { ...t, score: 0 })), more: list.length > limit };
  }

  /** The index entries of these names (a module's own tools.db first, then the live registry copy). */
  get(names: string[]): Map<string, IndexedTool> {
    if (!this.ensure()) return new Map();
    const found = this.lookup(names, {});
    this.touch();
    return found;
  }

  /** Every change of the registry refreshes the live copy; a module leaving releases its file at once. */
  handleRegistryChange(change: RegistryChange): void {
    if (change.type === "prompts-changed") return;
    this.liveDirty = true;
    if (change.type === "module-unregistered") this.closeConnections();
  }

  /** A tools.db was written (it may be new): the attachments and the live copy are checked again. */
  invalidate(): void {
    this.signature = undefined;
    this.liveDirty = true;
  }

  close(): void {
    this.closed = true;
    this.closeConnections();
  }

  // ---- connections ----------------------------------------------------------

  /** Opens or reopens the connections when the set of index files changed. False when closed or broken. */
  private ensure(): boolean {
    if (this.closed) return false;
    try {
      const files: Array<{ moduleId: string; file: string }> = [];
      for (const moduleId of this.deps.listModuleIds()) {
        const file = this.deps.indexPath?.(moduleId);
        if (file && fs.existsSync(file)) files.push({ moduleId, file });
      }
      const signature = files.map((f) => `${f.moduleId}=${f.file}`).join("|");
      if (signature !== this.signature || this.connections.length === 0) {
        this.open(files);
        this.signature = signature;
        this.liveDirty = true;
      }
      if (this.liveDirty) this.rebuildLive();
      return true;
    } catch (err) {
      console.warn("[AI Ecosystem] Could not open the tool index", err);
      this.closeConnections();
      return false;
    }
  }

  private open(files: Array<{ moduleId: string; file: string }>): void {
    this.closeConnections();
    const usable = files.filter((f) => this.migrate(f.file));
    const first: Connection = { db: openToolIndexDb(":memory:"), attached: [], live: true };
    this.connections = [first];
    let current = first;
    usable.forEach((f, i) => {
      if (current.attached.length >= MAX_ATTACHED_PER_CONNECTION) {
        const db = new DatabaseSync(":memory:");
        db.exec("PRAGMA busy_timeout = 3000;");
        current = { db, attached: [], live: false };
        this.connections.push(current);
      }
      const alias = `m${i}`;
      try {
        current.db.prepare(`ATTACH DATABASE ? AS ${alias}`).run(f.file);
        current.attached.push({ alias, moduleId: f.moduleId, file: f.file });
      } catch (err) {
        console.warn(`[AI Ecosystem] Could not attach the tool index of ${f.moduleId}`, err);
      }
    });
  }

  /** Brings a file to the current schema once per session. False when it is not a usable index. */
  private migrate(file: string): boolean {
    if (this.migrated.has(file)) return true;
    try {
      openToolIndexDb(file).close();
      this.migrated.add(file);
      return true;
    } catch (err) {
      console.warn(`[AI Ecosystem] Skipping the tool index ${file}`, err);
      return false;
    }
  }

  private rebuildLive(): void {
    const live = this.connections.find((c) => c.live);
    if (!live) return;
    const byModule = new Map<string, ToolIndexEntry[]>();
    for (const { moduleId, tool } of this.deps.listTools()) {
      if (DISCOVERY_TOOL_NAMES.includes(tool.name)) continue;
      const list = byModule.get(moduleId) ?? [];
      list.push(toIndexEntry(tool));
      byModule.set(moduleId, list);
    }
    const stale = (live.db.prepare("SELECT DISTINCT module_id FROM tools").all() as Array<{ module_id: string }>).map((r) => r.module_id);
    for (const moduleId of stale) if (!byModule.has(moduleId)) syncToolIndexDb(live.db, moduleId, []);
    let count = 0;
    for (const [moduleId, entries] of byModule) {
      syncToolIndexDb(live.db, moduleId, entries);
      count += entries.length;
    }
    this.liveCount = count;
    this.liveDirty = false;
  }

  private closeConnections(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
    for (const c of this.connections) {
      try {
        c.db.close();
      } catch {
        // Already closed.
      }
    }
    this.connections = [];
    this.signature = undefined;
    this.liveDirty = true;
  }

  /** Closes the connections after a while without queries, so no file stays open for long. */
  private touch(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.idleTimer = undefined;
      this.closeConnections();
    }, this.deps.idleCloseMs ?? FEDERATION_IDLE_CLOSE_MS);
    this.idleTimer.unref?.();
  }

  // ---- queries ----------------------------------------------------------------

  private schemas(c: Connection): string[] {
    return [...(c.live ? [LIVE_SCHEMA] : []), ...c.attached.map((a) => a.alias)];
  }

  /** The best `limit + 1` rows of each connection (plus room for live rows that a module's index replaces). */
  private collect(query: FindQuery, match: string | undefined, limit: number): Row[] {
    const out: Row[] = [];
    for (const c of this.connections) {
      const params: Array<string | number> = [];
      const branches = this.schemas(c).map((s) => {
        if (match) {
          params.push(match);
          const from = `(SELECT name, ${BM25} AS score FROM ${s}.tools_fts WHERE tools_fts MATCH ?) f JOIN ${s}.tools t ON t.name = f.name`;
          return `SELECT ${columns(s, "t")}, f.score AS score FROM ${from} WHERE ${filters(s, "t", query, params)}`;
        }
        return `SELECT ${columns(s, "t")}, 0 AS score FROM ${s}.tools t WHERE ${filters(s, "t", query, params)}`;
      });
      if (branches.length === 0) continue;
      const order = match ? "score, name" : "module_id, name";
      params.push(limit + 1 + (c.live ? this.liveCount : 0));
      const sql = `SELECT * FROM (${branches.join(" UNION ALL ")}) ORDER BY ${order} LIMIT ?`;
      try {
        out.push(...(c.db.prepare(sql).all(...params) as unknown as Row[]));
      } catch (err) {
        console.warn("[AI Ecosystem] Tool index query failed", err);
        this.signature = undefined;
      }
    }
    return out;
  }

  private lookup(names: string[], query: FindQuery): Map<string, IndexedTool> {
    const unique = [...new Set(names.filter((n) => typeof n === "string" && n !== ""))].slice(0, 200);
    if (unique.length === 0) return new Map();
    const rows: Row[] = [];
    for (const c of this.connections) {
      for (const s of this.schemas(c)) {
        const params: Array<string | number> = [...unique];
        const where = filters(s, "t", query, params);
        const sql = `SELECT ${columns(s, "t")}, 0 AS score FROM ${s}.tools t WHERE t.name IN (${unique.map(() => "?").join(", ")}) AND ${where}`;
        try {
          rows.push(...(c.db.prepare(sql).all(...params) as unknown as Row[]));
        } catch (err) {
          console.warn("[AI Ecosystem] Tool index lookup failed", err);
          this.signature = undefined;
        }
      }
    }
    return this.merge(rows);
  }

  /** One entry per name: a module's own index wins over the live copy; the best score wins otherwise. */
  private merge(rows: Row[]): Map<string, IndexedTool> {
    const out = new Map<string, IndexedTool>();
    for (const row of rows) {
      const tool = toIndexedTool(row);
      const previous = out.get(tool.name);
      if (!previous) {
        out.set(tool.name, tool);
        continue;
      }
      if (previous.source === "registry" && tool.source === "index") out.set(tool.name, tool);
      else if (previous.source === tool.source && tool.score < previous.score) out.set(tool.name, tool);
    }
    return out;
  }
}

function toIndexedTool(row: Row): IndexedTool {
  const tool: IndexedTool = {
    name: row.name,
    moduleId: row.module_id,
    kind: (row.kind ?? "tool") as ToolKind,
    title: row.title,
    description: row.description ?? "",
    categoria: row.categoria ?? "",
    tags: row.tags ? row.tags.split(" ").filter(Boolean).sort() : [],
    resumo: row.resumo ?? "",
    efeito: (row.efeito ?? "externo") as ToolEffect,
    exposicao: (row.exposicao ?? "indice") as ToolExposure,
    aprovacao: row.aprovacao,
    source: row.src === LIVE_SCHEMA ? "registry" : "index",
    score: typeof row.score === "number" ? row.score : 0,
  };
  const schema = parseObject(row.input_schema);
  if (schema) tool.inputSchema = schema;
  const exemplo = parseObject(row.exemplo_json);
  if (exemplo) tool.exemplo = exemplo;
  return tool;
}
