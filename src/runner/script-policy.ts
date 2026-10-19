// Script Engine policy: decides whether a run is allowed and builds the run plan. Pure Node.

import * as fs from "node:fs";
import * as nodePath from "node:path";
import { SCRIPT_LANGUAGES } from "../types";
import type { HubScriptOptions, ScriptCaller, ScriptLanguage, ScriptSettings } from "../types";

export interface RunPlan {
  language: ScriptLanguage;
  /** Absolute path of the script file (undefined for inline code). */
  scriptAbsPath?: string;
  inlineCode?: string;
  cwdAbs: string;
  args: string[];
  timeoutMs: number;
  /** The env given by the caller (may hold {{secret:...}} placeholders). Never process.env. */
  env: Record<string, string>;
  needsSecrets: boolean;
  /** True when the restrictions are off, so the Inspector shows an alert badge. */
  unrestricted: boolean;
  /** Vault-relative path (forward slashes), absolute path, or "inline (<language>)". */
  displayTarget: string;
}

export interface PolicyContext {
  vaultBasePath: string;
  settings: ScriptSettings;
  /** Vault-relative paths of #mcp/script notes. */
  declaredScripts: string[];
  isRegisteredModule: (id: string) => boolean;
  secretsAvailable: boolean;
  secretsLocked: boolean;
  /** Test hooks. Defaults use the real file system. */
  fileExists?: (abs: string) => boolean;
  dirExists?: (abs: string) => boolean;
  realpath?: (abs: string) => string;
  platform?: NodeJS.Platform;
}

export type PolicyResult =
  | { ok: true; plan: RunPlan }
  | { ok: false; code: string; reason: string };

export const SCRIPT_EXTENSIONS: Record<ScriptLanguage, readonly string[]> = {
  python: [".py"],
  node: [".js", ".mjs", ".cjs"],
  bash: [".sh"],
  powershell: [".ps1"],
};

const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SECRET_PLACEHOLDER = /\{\{(secret|basic|bearer):/;

/** Variables that make an interpreter load foreign code. Refused while the restrictions are on. */
const DANGEROUS_ENV_KEYS = new Set([
  "PATH",
  "PATHEXT",
  "NODE_OPTIONS",
  "NODE_PATH",
  "LD_PRELOAD",
  "LD_LIBRARY_PATH",
  "DYLD_INSERT_LIBRARIES",
  "DYLD_LIBRARY_PATH",
  "PYTHONSTARTUP",
  "PYTHONPATH",
  "PYTHONHOME",
  "BASH_ENV",
  "ENV",
  "PSMODULEPATH",
  "COMSPEC",
]);

const RESTRICTIONS_HINT =
  "Turn them off in Settings > AI Ecosystem > Scripts.";

type PathApi = typeof nodePath.posix;

function refuse(code: string, reason: string): PolicyResult {
  return { ok: false, code, reason };
}

function toPosix(p: string): string {
  return p.replace(/\\/g, "/");
}

function isAbsoluteLike(raw: string): boolean {
  return /^[A-Za-z]:/.test(raw) || raw.startsWith("/") || raw.startsWith("\\") || raw.startsWith("~");
}

/** True when `rel` (from path.relative) points at or below its base. */
function isInside(p: PathApi, rel: string): boolean {
  if (rel === "") return true;
  if (p.isAbsolute(rel)) return false;
  return rel !== ".." && !rel.startsWith("../") && !rel.startsWith("..\\");
}

function normalizeVaultRelative(value: string): string | undefined {
  let v = toPosix(value.trim());
  while (v.startsWith("./")) v = v.slice(2);
  v = nodePath.posix.normalize(v);
  v = v.replace(/\/+$/, "");
  if (v === "" || v === "." || v === ".." || v.startsWith("../") || v.startsWith("/")) return undefined;
  return v;
}

function folderContains(folder: string, rel: string): boolean {
  return rel === folder || rel.startsWith(folder + "/");
}

function defaultFileExists(abs: string): boolean {
  try {
    return fs.statSync(abs).isFile();
  } catch {
    return false;
  }
}

function defaultDirExists(abs: string): boolean {
  try {
    return fs.statSync(abs).isDirectory();
  } catch {
    return false;
  }
}

function checkShape(options: HubScriptOptions): PolicyResult | undefined {
  if (!SCRIPT_LANGUAGES.includes(options.language)) {
    return refuse("invalid-language", `Unknown script language "${String(options.language)}". Use one of: ${SCRIPT_LANGUAGES.join(", ")}.`);
  }
  if (options.args !== undefined && (!Array.isArray(options.args) || options.args.some((a) => typeof a !== "string"))) {
    return refuse("invalid-args", "args must be an array of strings.");
  }
  if (options.env !== undefined) {
    if (typeof options.env !== "object" || options.env === null || Array.isArray(options.env)) {
      return refuse("invalid-env", "env must be an object of string values.");
    }
    for (const [key, value] of Object.entries(options.env)) {
      if (!ENV_KEY.test(key)) return refuse("invalid-env", `Invalid environment variable name "${key}".`);
      if (typeof value !== "string") return refuse("invalid-env", `Environment variable ${key} must be a string.`);
    }
  }
  if (options.cwd !== undefined && typeof options.cwd !== "string") {
    return refuse("invalid-cwd", "cwd must be a string.");
  }
  return undefined;
}

export function validateRun(
  options: HubScriptOptions,
  caller: ScriptCaller,
  ctx: PolicyContext,
): PolicyResult {
  if (!caller || typeof caller.moduleId !== "string" || !ctx.isRegisteredModule(caller.moduleId)) {
    return refuse(
      "caller-not-registered",
      `Module "${String(caller?.moduleId)}" is not registered with the AI Ecosystem, so it cannot run scripts.`,
    );
  }
  const shapeError = checkShape(options);
  if (shapeError) return shapeError;

  const platform = ctx.platform ?? process.platform;
  const p: PathApi = platform === "win32" ? nodePath.win32 : nodePath.posix;
  const caseInsensitive = platform === "win32";
  const fileExists = ctx.fileExists ?? defaultFileExists;
  const dirExists = ctx.dirExists ?? (ctx.fileExists ? ctx.fileExists : defaultDirExists);
  const realpath = ctx.realpath ?? ((abs: string) => fs.realpathSync(abs));
  const safeReal = (abs: string): string => {
    try {
      return realpath(abs);
    } catch {
      return abs;
    }
  };
  const fold = (s: string): string => (caseInsensitive ? s.toLowerCase() : s);

  const unrestricted = ctx.settings.restrictionsDisabled === true;
  const base = p.resolve(ctx.vaultBasePath);
  const env = { ...(options.env ?? {}) };
  const args = [...(options.args ?? [])];

  if (!unrestricted && options.inlineCode !== undefined) {
    return refuse(
      "inline-refused",
      `Inline code is refused while the Script Engine restrictions are on. ${RESTRICTIONS_HINT}`,
    );
  }

  if (!unrestricted) {
    for (const key of Object.keys(env)) {
      if (DANGEROUS_ENV_KEYS.has(key.toUpperCase())) {
        return refuse(
          "env-key-refused",
          `The environment variable ${key} cannot be set while the Script Engine restrictions are on. ${RESTRICTIONS_HINT}`,
        );
      }
    }
  }

  const needsSecrets = Object.values(env).some((v) => SECRET_PLACEHOLDER.test(v));
  if (needsSecrets) {
    if (!ctx.secretsAvailable) {
      return refuse("secrets-unavailable", "Environment variables with {{secret:...}} placeholders need the Environment Keys plugin.");
    }
    if (ctx.secretsLocked) {
      return refuse("secrets-locked", "The Environment Keys vault is locked. Unlock it in Obsidian (Environment Keys panel) and try again.");
    }
  }

  // Timeout
  const maxRaw = Number(ctx.settings.maxTimeoutSeconds);
  const maxSeconds = Number.isFinite(maxRaw) && maxRaw >= 1 ? Math.floor(maxRaw) : 300;
  const requested = options.timeoutSeconds;
  const seconds =
    typeof requested === "number" && Number.isFinite(requested)
      ? Math.min(Math.max(Math.ceil(requested), 1), maxSeconds)
      : maxSeconds;
  const timeoutMs = seconds * 1000;

  // Working directory
  let cwdAbs = base;
  const rawCwd = options.cwd?.trim();
  if (rawCwd) {
    if (!unrestricted && (isAbsoluteLike(rawCwd) || rawCwd.includes("\0"))) {
      return refuse("cwd-not-allowed", `The working directory must be relative to the vault while the Script Engine restrictions are on. ${RESTRICTIONS_HINT}`);
    }
    cwdAbs = p.resolve(base, unrestricted ? rawCwd : toPosix(rawCwd));
    if (!unrestricted) {
      if (!isInside(p, p.relative(base, cwdAbs))) {
        return refuse("cwd-not-allowed", `The working directory "${rawCwd}" is outside the vault. ${RESTRICTIONS_HINT}`);
      }
      if (dirExists(cwdAbs) && !isInside(p, p.relative(safeReal(base), safeReal(cwdAbs)))) {
        return refuse("cwd-not-allowed", `The working directory "${rawCwd}" resolves outside the vault.`);
      }
    }
  }
  if (!dirExists(cwdAbs)) {
    return refuse("cwd-not-found", `The working directory "${rawCwd || "."}" does not exist.`);
  }

  const common = { language: options.language, args, cwdAbs, timeoutMs, env, needsSecrets, unrestricted };

  // Inline code
  if (options.inlineCode !== undefined) {
    if (typeof options.inlineCode !== "string" || options.inlineCode.trim() === "") {
      return refuse("invalid-code", "Inline code must be a non-empty string.");
    }
    return {
      ok: true,
      plan: { ...common, inlineCode: options.inlineCode, displayTarget: `inline (${options.language})` },
    };
  }

  // Script file
  const rawPath = typeof options.scriptPath === "string" ? options.scriptPath.trim() : "";
  if (!rawPath) return refuse("invalid-path", "scriptPath is required.");
  if (rawPath.includes("\0")) return refuse("path-not-allowed", "The script path contains an invalid character.");

  if (unrestricted) {
    const abs = p.resolve(base, rawPath);
    if (!fileExists(abs)) return refuse("script-not-found", `Script not found: ${rawPath}`);
    const rel = p.relative(base, abs);
    const display = isInside(p, rel) && rel !== "" ? toPosix(rel) : abs;
    return { ok: true, plan: { ...common, scriptAbsPath: abs, displayTarget: display } };
  }

  if (isAbsoluteLike(rawPath)) {
    return refuse(
      "path-not-allowed",
      `The script path must be relative to the vault while the Script Engine restrictions are on (got "${rawPath}"). ${RESTRICTIONS_HINT}`,
    );
  }
  const abs = p.resolve(base, toPosix(rawPath));
  const relNative = p.relative(base, abs);
  if (relNative === "" || !isInside(p, relNative)) {
    return refuse("path-not-allowed", `The script path "${rawPath}" is outside the vault.`);
  }

  const folders = (ctx.settings.allowedFolders ?? [])
    .map((f) => (typeof f === "string" ? normalizeVaultRelative(f) : undefined))
    .filter((f): f is string => f !== undefined)
    .map(fold);
  const declared = (ctx.declaredScripts ?? [])
    .map((s) => (typeof s === "string" ? normalizeVaultRelative(s) : undefined))
    .filter((s): s is string => s !== undefined)
    .map(fold);
  const isAllowed = (rel: string): boolean => {
    const r = fold(toPosix(rel));
    return declared.includes(r) || folders.some((f) => folderContains(f, r));
  };
  const allowedHelp = folders.length
    ? `Allowed folders: ${(ctx.settings.allowedFolders ?? []).join(", ")}.`
    : "No allowed folders are configured.";
  const notAllowed = (): PolicyResult =>
    refuse(
      "path-not-allowed",
      `The script "${toPosix(relNative)}" is not inside an allowed scripts folder and is not a declared #mcp/script note. ${allowedHelp} Add its folder under Settings > AI Ecosystem > Scripts > Allowed folders.`,
    );

  if (!isAllowed(relNative)) return notAllowed();

  const ext = p.extname(abs).toLowerCase();
  if (!SCRIPT_EXTENSIONS[options.language].includes(ext)) {
    return refuse(
      "extension-mismatch",
      `A ${options.language} script must have the extension ${SCRIPT_EXTENSIONS[options.language].join(", ")} (got "${ext || "none"}").`,
    );
  }

  if (!fileExists(abs)) return refuse("script-not-found", `Script not found: ${toPosix(relNative)}`);

  const realRel = p.relative(safeReal(base), safeReal(abs));
  if (realRel === "" || !isInside(p, realRel)) {
    return refuse("path-not-allowed", `The script "${toPosix(relNative)}" resolves outside the vault (symbolic link).`);
  }
  if (!isAllowed(realRel)) return notAllowed();

  return { ok: true, plan: { ...common, scriptAbsPath: abs, displayTarget: toPosix(relNative) } };
}
