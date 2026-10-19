// Loads and normalizes data.json. Never throws: garbage in, defaults out.
import { DEFAULT_SETTINGS, SCRIPT_LANGUAGES } from "../types";
import type { AIEcosystemSettings, ClientRecord, ScriptLanguage, ScriptSettings } from "../types";

export const MIN_PORT = 1024;
export const MAX_PORT = 65535;
export const MIN_TIMEOUT_SECONDS = 1;
export const MAX_TIMEOUT_SECONDS = 3600;
export const MIN_ENTRIES = 50;
export const MAX_ENTRIES = 5000;

const HASH_PATTERN = /^[0-9a-f]{64}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

export function isValidPort(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= MIN_PORT && value <= MAX_PORT;
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/**
 * Normalizes a vault-relative folder: forward slashes, no leading or trailing slash.
 * Returns undefined for empty values, absolute Windows paths and paths with "..".
 */
export function normalizeFolder(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const parts = value
    .trim()
    .replace(/\\/g, "/")
    .split("/")
    .map((p) => p.trim())
    .filter((p) => p !== "" && p !== ".");
  if (parts.length === 0) return undefined;
  if (parts.some((p) => p === "..")) return undefined;
  if (/^[A-Za-z]:$/.test(parts[0] ?? "")) return undefined;
  return parts.join("/");
}

function normalizeFolders(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    const folder = normalizeFolder(item);
    if (folder && !out.includes(folder)) out.push(folder);
  }
  return out;
}

function normalizeClients(value: unknown): ClientRecord[] {
  if (!Array.isArray(value)) return [];
  const out: ClientRecord[] = [];
  const ids = new Set<string>();
  const hashes = new Set<string>();
  for (const raw of value) {
    if (!isRecord(raw)) continue;
    const id = nonEmptyString(raw.id);
    const name = nonEmptyString(raw.name);
    const hash = typeof raw.tokenHash === "string" && HASH_PATTERN.test(raw.tokenHash) ? raw.tokenHash.toLowerCase() : undefined;
    if (!id || !name || !hash || ids.has(id) || hashes.has(hash)) continue;
    const record: ClientRecord = {
      id,
      name,
      tokenHash: hash,
      hint: typeof raw.hint === "string" ? raw.hint : "",
      createdAt: nonEmptyString(raw.createdAt) ?? new Date().toISOString(),
    };
    const lastUsedAt = nonEmptyString(raw.lastUsedAt);
    if (lastUsedAt) record.lastUsedAt = lastUsedAt;
    const importedFrom = nonEmptyString(raw.importedFrom);
    if (importedFrom) record.importedFrom = importedFrom;
    ids.add(id);
    hashes.add(hash);
    out.push(record);
  }
  return out;
}

function normalizeInterpreters(value: unknown): Partial<Record<ScriptLanguage, string>> {
  const out: Partial<Record<ScriptLanguage, string>> = {};
  if (!isRecord(value)) return out;
  for (const language of SCRIPT_LANGUAGES) {
    const path = value[language];
    if (typeof path === "string" && path.trim() !== "") out[language] = path.trim();
  }
  return out;
}

function normalizeScripts(value: unknown): ScriptSettings {
  const raw = isRecord(value) ? value : {};
  const defaults = DEFAULT_SETTINGS.scripts;
  return {
    allowedFolders: normalizeFolders(raw.allowedFolders),
    restrictionsDisabled: raw.restrictionsDisabled === true,
    maxTimeoutSeconds: clampInt(raw.maxTimeoutSeconds, MIN_TIMEOUT_SECONDS, MAX_TIMEOUT_SECONDS, defaults.maxTimeoutSeconds),
    interpreterPaths: normalizeInterpreters(raw.interpreterPaths),
  };
}

function pickAlternativePort(port: number, raw: unknown): number {
  if (isValidPort(raw) && raw !== port) return raw;
  const fallback = DEFAULT_SETTINGS.alternativePort;
  if (fallback !== port) return fallback;
  return port < MAX_PORT ? port + 1 : port - 1;
}

export function normalizeSettings(raw: unknown): AIEcosystemSettings {
  const data = isRecord(raw) ? raw : {};
  const port = isValidPort(data.port) ? data.port : DEFAULT_SETTINGS.port;
  const inspector = isRecord(data.inspector) ? data.inspector : {};
  const imported = Array.isArray(data.importedClientsFrom)
    ? [...new Set(data.importedClientsFrom.filter((v): v is string => typeof v === "string" && v !== ""))]
    : [];
  return {
    port,
    alternativePort: pickAlternativePort(port, data.alternativePort),
    clients: normalizeClients(data.clients),
    importedClientsFrom: imported,
    scripts: normalizeScripts(data.scripts),
    inspector: {
      maxEntries: clampInt(inspector.maxEntries, MIN_ENTRIES, MAX_ENTRIES, DEFAULT_SETTINGS.inspector.maxEntries),
    },
  };
}

// ---------------------------------------------------------------------------
// Control keys of the settings tab
// ---------------------------------------------------------------------------

function interpreterLanguage(key: string): ScriptLanguage | undefined {
  const prefix = "scripts.interpreter.";
  if (!key.startsWith(prefix)) return undefined;
  const language = key.slice(prefix.length);
  return SCRIPT_LANGUAGES.find((l) => l === language);
}

/** Current value of a settings control (keys: port, alternativePort, scripts.maxTimeoutSeconds, scripts.interpreter.<language>, inspector.maxEntries). */
export function readSetting(settings: AIEcosystemSettings, key: string): unknown {
  switch (key) {
    case "port":
      return settings.port;
    case "alternativePort":
      return settings.alternativePort;
    case "scripts.maxTimeoutSeconds":
      return settings.scripts.maxTimeoutSeconds;
    case "inspector.maxEntries":
      return settings.inspector.maxEntries;
    default: {
      const language = interpreterLanguage(key);
      return language ? (settings.scripts.interpreterPaths[language] ?? "") : undefined;
    }
  }
}

export type SettingEffect = "restart-server" | "interpreters";

/** Applies a control value to the settings in place. Returns what the plugin must do afterwards. */
export function writeSetting(settings: AIEcosystemSettings, key: string, value: unknown): SettingEffect[] {
  switch (key) {
    case "port":
      if (!isValidPort(value) || value === settings.alternativePort || value === settings.port) return [];
      settings.port = value;
      return ["restart-server"];
    case "alternativePort":
      if (!isValidPort(value) || value === settings.port || value === settings.alternativePort) return [];
      settings.alternativePort = value;
      return ["restart-server"];
    case "scripts.maxTimeoutSeconds":
      settings.scripts.maxTimeoutSeconds = clampInt(value, MIN_TIMEOUT_SECONDS, MAX_TIMEOUT_SECONDS, settings.scripts.maxTimeoutSeconds);
      return [];
    case "inspector.maxEntries":
      settings.inspector.maxEntries = clampInt(value, MIN_ENTRIES, MAX_ENTRIES, settings.inspector.maxEntries);
      return [];
    default: {
      const language = interpreterLanguage(key);
      if (!language || typeof value !== "string") return [];
      const path = value.trim();
      if (path) settings.scripts.interpreterPaths[language] = path;
      else delete settings.scripts.interpreterPaths[language];
      return ["interpreters"];
    }
  }
}
