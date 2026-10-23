import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { ToolIndexWriter, normalizeEntry, summarize } from "../../src/tool-index/tool-index-writer";
import { AI_ECOSYSTEM_API_MINOR_VERSION } from "../../src/types";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function dbFile(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "toolindex-"));
  dirs.push(dir);
  return path.join(dir, "plugins", "mod", "tools.db");
}

function rows(file: string, sql: string): Array<Record<string, unknown>> {
  const db = new DatabaseSync(file);
  try {
    return db.prepare(sql).all() as Array<Record<string, unknown>>;
  } finally {
    db.close();
  }
}

describe("tool index", () => {
  it("bumps the minor API version", () => {
    expect(AI_ECOSYSTEM_API_MINOR_VERSION).toBe(1);
  });

  it("infers defaults from annotations and cuts the summary to the first line", () => {
    const long = "x".repeat(150);
    const e = normalizeEntry({ name: "a", description: `\n${long}\nsecond`, annotations: { readOnlyHint: true } });
    expect(e.efeito).toBe("leitura");
    expect(e.exposicao).toBe("indice");
    expect(e.resumo.length).toBeLessThanOrEqual(100);
    expect(summarize("one\ntwo")).toBe("one");
    expect(normalizeEntry({ name: "b", description: "d", annotations: { destructiveHint: true } }).efeito).toBe("externo");
  });

  it("syncs incrementally by hash", () => {
    const file = dbFile();
    const w = new ToolIndexWriter(file);
    const a = { name: "a", description: "Alpha tool", tags: ["x", "y"], categoria: "c" };
    const b = { name: "b", description: "Beta tool" };
    expect(w.sync("mod", [a, b])).toEqual({ added: 2, updated: 0, removed: 0, unchanged: 0 });
    expect(w.sync("mod", [a, b])).toEqual({ added: 0, updated: 0, removed: 0, unchanged: 2 });
    expect(w.sync("mod", [{ ...a, tags: ["x"] }])).toEqual({ added: 0, updated: 1, removed: 1, unchanged: 0 });
    expect(rows(file, "SELECT name FROM tools")).toEqual([{ name: "a" }]);
    expect(rows(file, "SELECT tag FROM tool_tags")).toEqual([{ tag: "x" }]);
    expect(rows(file, "SELECT name FROM tools_fts WHERE tools_fts MATCH 'alpha'")).toEqual([{ name: "a" }]);
    expect(rows(file, "SELECT value FROM meta WHERE key = 'schema_version'")).toHaveLength(1);
  });
});
