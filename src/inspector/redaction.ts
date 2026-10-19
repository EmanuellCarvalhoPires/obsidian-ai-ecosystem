// Redaction of secrets before anything is shown or kept by the Inspector. Pure Node: no "obsidian".
import type { SecretVaultService } from "../types";

export const MASK = "[REDACTED]";

const DEFAULT_MAX_CHARS = 65_536;

export interface Redactor {
  text(s: string): string;
  headers(h: Record<string, string>): Record<string, string>;
  value(v: unknown, maxChars?: number): string;
  /** True when the Environment Keys "secrets" service is not available (fallback patterns only). */
  isLimited(): boolean;
}

// Placeholders ({{secret:X}}, {{basic:X}}, {{bearer:X}}) are not secrets and stay visible.
// Private-use character that brackets placeholder indexes while the patterns run.
const SENTINEL = "\uE000";

const PLACEHOLDER = /\{\{\s*[A-Za-z][\w-]*\s*:[^{}]*\}\}/g;
const ONLY_PLACEHOLDER = /^\s*(?:\{\{\s*[A-Za-z][\w-]*\s*:[^{}]*\}\}\s*)+$/;
const SENTINEL_ONLY = /^(?:\uE000\d+\uE000)+$/;

const SENSITIVE_HEADERS = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "api-key",
  "x-auth-token",
]);
const SENSITIVE_HEADER_PART = /token|secret|password/i;

const SENSITIVE_KEY = /password|passwd|secret|token|api[_-]?key|authorization|private[_-]?key|credential/i;
const NOT_SENSITIVE_KEY = /(?:_|-)(?:type|url|endpoint|count|limit)$|^(?:max|total|input|output|prompt|completion)[_-]?tokens?$/i;

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY.test(key) && !NOT_SENSITIVE_KEY.test(key);
}

function isSensitiveHeader(name: string): boolean {
  const n = name.toLowerCase();
  return SENSITIVE_HEADERS.has(n) || SENSITIVE_HEADER_PART.test(n);
}

const BEARER = /\b(Bearer|Basic)(\s+)([A-Za-z0-9._~+/=-]{8,})/gi;
const PARAM =
  /(^|[^A-Za-z0-9_-])((?:access_token|refresh_token|id_token|token|api_key|apikey|key|secret|password|client_secret|signature|sig))=([^\s&"'<>#;]+)/gi;
const JSON_FIELD = /"([A-Za-z0-9_\-. ]{1,64})"(\s*:\s*)"((?:[^"\\]|\\.)*)"/g;

const TOKEN_SHAPES: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  /\beyJ[A-Za-z0-9_-]{5,}\.eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bxox[abposr]-[A-Za-z0-9-]{10,}/g,
  /\bsk-[A-Za-z0-9_-]{16,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bATATT[A-Za-z0-9_=+/-]{20,}/g,
  /\bevc_[0-9a-fA-F]{8,}/g,
  /\baie_[0-9a-fA-F]{8,}/g,
];
const TELEGRAM = /(^|\D)(\d{8,10}:[A-Za-z0-9_-]{35})(?![A-Za-z0-9_-])/g;

/** Applies the fallback patterns. Placeholders are protected with sentinels while patterns run. */
function applyFallback(input: string): string {
  const placeholders: string[] = [];
  let s = input.replace(/\uE000/g, "\uFFFD").replace(PLACEHOLDER, (m) => {
    placeholders.push(m);
    return `${SENTINEL}${placeholders.length - 1}${SENTINEL}`;
  });

  s = s.replace(BEARER, (m, scheme: string, space: string, token: string) => {
    if (/^basic$/i.test(scheme) && !/[0-9=]|(?=.*[a-z])(?=.*[A-Z])/.test(token)) return m;
    return `${scheme}${space}${MASK}`;
  });
  s = s.replace(PARAM, (m, pre: string, name: string, val: string) =>
    SENTINEL_ONLY.test(val) || val === MASK ? m : `${pre}${name}=${MASK}`,
  );
  s = s.replace(JSON_FIELD, (m, key: string, sep: string, val: string) =>
    isSensitiveKey(key) && !SENTINEL_ONLY.test(val) && val !== MASK ? `"${key}"${sep}"${MASK}"` : m,
  );
  for (const re of TOKEN_SHAPES) s = s.replace(re, MASK);
  s = s.replace(TELEGRAM, (_m, pre: string) => `${pre}${MASK}`);

  return s.replace(/\uE000(\d+)\uE000/g, (_m, i: string) => placeholders[Number(i)] ?? "");
}

function binarySize(v: unknown): number | undefined {
  if (v instanceof ArrayBuffer) return v.byteLength;
  if (ArrayBuffer.isView(v)) return v.byteLength;
  return undefined;
}

const MAX_DEPTH = 24;

/** Plain JSON-safe copy: masks sensitive keys, summarizes binaries, breaks cycles. */
function sanitize(v: unknown, ancestors: Set<object>, depth: number): unknown {
  if (v === null || v === undefined) return v;
  switch (typeof v) {
    case "string":
    case "number":
    case "boolean":
      return v;
    case "bigint":
      return v.toString();
    case "symbol":
    case "function":
      return undefined;
  }
  const size = binarySize(v);
  if (size !== undefined) return `<binary ${size} bytes>`;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString();
  const obj = v;
  if (ancestors.has(obj)) return "[Circular]";
  if (depth >= MAX_DEPTH) return "[Max depth]";
  ancestors.add(obj);
  try {
    if (v instanceof Error) return { name: v.name, message: v.message };
    if (Array.isArray(v)) return v.map((item) => sanitize(item, ancestors, depth + 1) ?? null);
    if (v instanceof Map) return sanitize(Object.fromEntries(v), ancestors, depth + 1);
    if (v instanceof Set) return sanitize([...v], ancestors, depth + 1);
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(obj)) {
      if (isSensitiveKey(key) && val !== null && val !== undefined) {
        if (typeof val === "string") out[key] = ONLY_PLACEHOLDER.test(val) ? val : MASK;
        else if (typeof val === "object" && binarySize(val) === undefined) out[key] = MASK;
        else out[key] = sanitize(val, ancestors, depth + 1);
        continue;
      }
      const clean = sanitize(val, ancestors, depth + 1);
      if (clean !== undefined) out[key] = clean;
    }
    return out;
  } finally {
    ancestors.delete(obj);
  }
}

export function createRedactor(getSecrets: () => SecretVaultService | undefined): Redactor {
  const text = (s: string): string => {
    let out = s;
    const secrets = getSecrets();
    if (secrets) {
      try {
        out = secrets.redact(out);
      } catch {
        // Falls back to the patterns below.
      }
    }
    return applyFallback(out);
  };

  return {
    text,
    isLimited: () => getSecrets() === undefined,
    headers(h) {
      const out: Record<string, string> = {};
      for (const [name, val] of Object.entries(h ?? {})) {
        const str = String(val);
        out[name] = isSensitiveHeader(name) && !ONLY_PLACEHOLDER.test(str) ? MASK : text(str);
      }
      return out;
    },
    value(v, maxChars = DEFAULT_MAX_CHARS) {
      let raw: string;
      if (typeof v === "string") raw = v;
      else {
        const clean = sanitize(v, new Set(), 0);
        raw = clean === undefined ? "" : (JSON.stringify(clean, null, 2) ?? "");
      }
      const redacted = text(raw);
      if (redacted.length <= maxChars) return redacted;
      return `${redacted.slice(0, maxChars)}\n… [truncated ${redacted.length - maxChars} chars]`;
    },
  };
}
