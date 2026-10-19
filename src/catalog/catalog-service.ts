import { requestUrl } from "obsidian";
import type { Catalog, CatalogEntry } from "../types";

export const CATALOG_URL =
  "https://raw.githubusercontent.com/EmanuellCarvalhoPires/obsidian-ai-ecosystem/main/catalog.json";
export const ALLOWED_OWNER = "EmanuellCarvalhoPires";

const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const REPO_RE = /^([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100})$/;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** True when "owner/name" is well formed and owned by ALLOWED_OWNER (case-insensitive). */
export function isAllowedRepo(repo: unknown): repo is string {
  if (typeof repo !== "string") return false;
  const m = REPO_RE.exec(repo);
  return !!m && m[1].toLowerCase() === ALLOWED_OWNER.toLowerCase();
}

export function validateCatalog(raw: unknown): Catalog {
  const out: Catalog = { version: 1, modules: [] };
  if (!isRecord(raw)) return out;
  if (typeof raw.version === "number") out.version = raw.version;
  if (!Array.isArray(raw.modules)) return out;
  const seen = new Set<string>();
  for (const item of raw.modules as unknown[]) {
    if (!isRecord(item)) continue;
    const id = str(item.id);
    if (!ID_RE.test(id) || seen.has(id)) continue;
    if (!isAllowedRepo(item.repo)) continue;
    const name = str(item.name);
    const desc = isRecord(item.description) ? item.description : {};
    const en = str(desc.en);
    const pt = str(desc.pt);
    if (!name || (!en && !pt)) continue;
    const entry: CatalogEntry = {
      id,
      repo: item.repo,
      name,
      description: { en: en || pt, pt: pt || en },
      icon: str(item.icon) || "puzzle",
      minEcosystemVersion: str(item.minEcosystemVersion) || "1.0.0",
    };
    seen.add(id);
    out.modules.push(entry);
  }
  return out;
}

async function defaultFetchJson(url: string): Promise<unknown> {
  const res = await requestUrl({ url, throw: false });
  if (res.status >= 400) throw new Error(`HTTP ${res.status}`);
  return JSON.parse(res.text) as unknown;
}

export interface CatalogServiceOptions {
  remoteUrl?: string;
  embedded: Catalog;
  fetchJson?: (url: string) => Promise<unknown>;
  ttlMs?: number;
}

export class CatalogService {
  private readonly remoteUrl: string;
  private readonly embedded: Catalog;
  private readonly fetchJson: (url: string) => Promise<unknown>;
  private readonly ttlMs: number;
  private cache: { at: number; catalog: Catalog } | undefined;

  constructor(opts: CatalogServiceOptions) {
    this.remoteUrl = opts.remoteUrl ?? CATALOG_URL;
    this.embedded = opts.embedded;
    this.fetchJson = opts.fetchJson ?? defaultFetchJson;
    this.ttlMs = opts.ttlMs ?? 60 * 60 * 1000;
  }

  async load(force = false): Promise<{ catalog: Catalog; source: "remote" | "embedded" }> {
    if (!force && this.cache && Date.now() - this.cache.at < this.ttlMs) {
      return { catalog: this.cache.catalog, source: "remote" };
    }
    try {
      const catalog = validateCatalog(await this.fetchJson(this.remoteUrl));
      if (catalog.modules.length > 0) {
        this.cache = { at: Date.now(), catalog };
        return { catalog, source: "remote" };
      }
    } catch {
      // fall through to the embedded copy
    }
    return { catalog: validateCatalog(this.embedded), source: "embedded" };
  }
}
