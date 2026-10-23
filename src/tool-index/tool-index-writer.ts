// Incremental writer of a module's tools.db. Pure Node.

import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { APPROVAL_REQUIRED } from "../types";
import type { HubTool, ToolEffect, ToolExposure, ToolIndexEntry, ToolKind } from "../types";
import { openToolIndexDb } from "./schema";

export const SUMMARY_MAX_LENGTH = 100;

export interface NormalizedToolEntry {
  name: string;
  title: string | null;
  description: string;
  kind: ToolKind;
  categoria: string;
  tags: string[];
  resumo: string;
  efeito: ToolEffect;
  exposicao: ToolExposure;
  aprovacao: string | null;
  inputSchema: string | null;
  exemplo: string | null;
}

export interface ToolIndexSyncResult {
  added: number;
  updated: number;
  removed: number;
  unchanged: number;
}

/** First non-empty line of the text, cut to `max` characters. */
export function summarize(text: string, max = SUMMARY_MAX_LENGTH): string {
  const line = text.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0) ?? "";
  return line.length <= max ? line : `${line.slice(0, max - 1).trimEnd()}…`;
}

/** Fills in what the module left out, using the MCP annotations. */
export function normalizeEntry(entry: ToolIndexEntry): NormalizedToolEntry {
  const hints = entry.annotations ?? {};
  const inferred: ToolEffect = hints.readOnlyHint === true ? "leitura" : "externo";
  const resumo = entry.resumo?.trim() ? summarize(entry.resumo) : summarize(entry.description ?? "");
  const tags = [...new Set((entry.tags ?? []).map((t) => t.trim()).filter(Boolean))].sort();
  return {
    name: entry.name,
    title: entry.title ?? null,
    description: entry.description ?? "",
    kind: entry.kind ?? "tool",
    categoria: entry.categoria?.trim() ?? "",
    tags,
    resumo,
    efeito: entry.efeito ?? inferred,
    exposicao: entry.exposicao ?? "indice",
    aprovacao: entry.aprovacao ?? (hints.destructiveHint === true ? APPROVAL_REQUIRED : null),
    inputSchema: entry.inputSchema ? JSON.stringify(entry.inputSchema) : null,
    exemplo: entry.exemplo ? JSON.stringify(entry.exemplo) : null,
  };
}

/** The index entry of a registered MCP tool (its index metadata included). */
export function toIndexEntry(tool: HubTool): ToolIndexEntry {
  const entry: ToolIndexEntry = { name: tool.name, description: tool.description, inputSchema: tool.inputSchema, kind: "tool" };
  if (tool.title !== undefined) entry.title = tool.title;
  if (tool.annotations !== undefined) entry.annotations = tool.annotations;
  if (tool.categoria !== undefined) entry.categoria = tool.categoria;
  if (tool.tags !== undefined) entry.tags = tool.tags;
  if (tool.resumo !== undefined) entry.resumo = tool.resumo;
  if (tool.efeito !== undefined) entry.efeito = tool.efeito;
  if (tool.exposicao !== undefined) entry.exposicao = tool.exposicao;
  if (tool.aprovacao !== undefined) entry.aprovacao = tool.aprovacao;
  if (tool.exemplo !== undefined) entry.exemplo = tool.exemplo;
  return entry;
}

export function hashEntry(entry: NormalizedToolEntry): string {
  return createHash("sha256").update(JSON.stringify(entry)).digest("hex");
}

/**
 * Writes the entries of one module into an open tools database: new and changed ones (by hash),
 * and removes the ones of that module no longer listed. Runs in one transaction.
 */
export function syncToolIndexDb(db: DatabaseSync, moduleId: string, entries: ToolIndexEntry[]): ToolIndexSyncResult {
  const normalized = new Map<string, NormalizedToolEntry>();
  for (const e of entries) {
    if (e && typeof e.name === "string" && e.name) normalized.set(e.name, normalizeEntry(e));
  }
  const result: ToolIndexSyncResult = { added: 0, updated: 0, removed: 0, unchanged: 0 };
  const existing = new Map<string, string>();
  for (const row of db.prepare("SELECT name, hash FROM tools WHERE module_id = ?").all(moduleId) as Array<{ name: string; hash: string }>) {
    existing.set(row.name, row.hash);
  }
  const upsert = db.prepare(
    `INSERT INTO tools (name, module_id, title, description, categoria, resumo, efeito, exposicao, aprovacao, input_schema, hash, updated_at, kind, exemplo_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(name) DO UPDATE SET module_id = excluded.module_id, title = excluded.title, description = excluded.description,
       categoria = excluded.categoria, resumo = excluded.resumo, efeito = excluded.efeito, exposicao = excluded.exposicao,
       aprovacao = excluded.aprovacao, input_schema = excluded.input_schema, hash = excluded.hash, updated_at = excluded.updated_at,
       kind = excluded.kind, exemplo_json = excluded.exemplo_json`,
  );
  const delTags = db.prepare("DELETE FROM tool_tags WHERE tool_name = ?");
  const insTag = db.prepare("INSERT OR IGNORE INTO tool_tags (tool_name, tag) VALUES (?, ?)");
  const delFts = db.prepare("DELETE FROM tools_fts WHERE name = ?");
  const insFts = db.prepare("INSERT INTO tools_fts (name, resumo, categoria, tags, description) VALUES (?, ?, ?, ?, ?)");
  const delTool = db.prepare("DELETE FROM tools WHERE name = ?");

  db.exec("BEGIN IMMEDIATE");
  try {
    const now = Date.now();
    for (const [name, entry] of normalized) {
      const hash = hashEntry(entry);
      const previous = existing.get(name);
      if (previous === hash) {
        result.unchanged++;
        continue;
      }
      upsert.run(
        name,
        moduleId,
        entry.title,
        entry.description,
        entry.categoria,
        entry.resumo,
        entry.efeito,
        entry.exposicao,
        entry.aprovacao,
        entry.inputSchema,
        hash,
        now,
        entry.kind,
        entry.exemplo,
      );
      delTags.run(name);
      for (const tag of entry.tags) insTag.run(name, tag);
      delFts.run(name);
      insFts.run(name, entry.resumo, entry.categoria, entry.tags.join(" "), entry.description);
      if (previous === undefined) result.added++;
      else result.updated++;
    }
    for (const name of existing.keys()) {
      if (normalized.has(name)) continue;
      delTags.run(name);
      delFts.run(name);
      delTool.run(name);
      result.removed++;
    }
    db.prepare("INSERT INTO meta (key, value) VALUES ('last_sync', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(now));
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  return result;
}

export class ToolIndexWriter {
  constructor(private readonly dbPath: string) {}

  /** Writes new/changed tools, removes the ones no longer listed, skips unchanged hashes. */
  sync(moduleId: string, entries: ToolIndexEntry[]): ToolIndexSyncResult {
    if (this.dbPath !== ":memory:") fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
    const db = openToolIndexDb(this.dbPath);
    try {
      return syncToolIndexDb(db, moduleId, entries);
    } finally {
      db.close();
    }
  }
}

/** <vault>/<configDir>/plugins/<moduleId>/tools.db */
export function toolIndexPath(vaultBasePath: string, configDir: string, moduleId: string): string {
  return path.join(vaultBasePath, configDir, "plugins", moduleId, "tools.db");
}
