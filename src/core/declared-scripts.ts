// Scripts declared by notes tagged #mcp/script with a "script: <vault path>" property.
import type { App } from "obsidian";

const SCRIPT_TAG = "mcp/script";

function cleanTag(tag: string): string {
  return tag.trim().replace(/^#/, "").toLowerCase();
}

function frontmatterTags(frontmatter: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const key of ["tags", "tag"]) {
    const value = frontmatter[key];
    if (Array.isArray(value)) {
      for (const item of value) if (typeof item === "string") out.push(item);
    } else if (typeof value === "string") {
      out.push(...value.split(/[\s,]+/));
    }
  }
  return out;
}

function toVaultPath(value: string): string | undefined {
  const parts = value
    .trim()
    .replace(/\\/g, "/")
    .split("/")
    .filter((p) => p !== "" && p !== ".");
  if (parts.length === 0 || parts.some((p) => p === "..")) return undefined;
  if (/^[A-Za-z]:$/.test(parts[0] ?? "")) return undefined;
  return parts.join("/");
}

/**
 * The script declared by a note, or undefined. The note must carry the tag mcp/script (with or
 * without "#", in the frontmatter tags or as an inline tag) and a `script` property with a
 * vault-relative path.
 */
export function extractDeclaredScript(frontmatter: unknown, tags: string[]): string | undefined {
  if (typeof frontmatter !== "object" || frontmatter === null || Array.isArray(frontmatter)) return undefined;
  const fm = frontmatter as Record<string, unknown>;
  if (typeof fm.script_id === "string" && fm.script_id.trim() !== "" && typeof fm.script_path === "string") {
    return toVaultPath(fm.script_path);
  }
  const script = fm.script;
  if (typeof script !== "string") return undefined;
  const all = [...tags, ...frontmatterTags(fm)].map(cleanTag);
  if (!all.includes(SCRIPT_TAG)) return undefined;
  return toVaultPath(script);
}

/** Vault-relative paths of every script declared in the vault, without duplicates. */
export function collectDeclaredScripts(app: App): string[] {
  const found = new Set<string>();
  for (const file of app.vault.getMarkdownFiles()) {
    const cache = app.metadataCache.getFileCache(file);
    if (!cache?.frontmatter) continue;
    const inline = (cache.tags ?? []).map((t) => t.tag);
    const script = extractDeclaredScript(cache.frontmatter, inline);
    if (script) found.add(script);
  }
  return [...found].sort();
}
