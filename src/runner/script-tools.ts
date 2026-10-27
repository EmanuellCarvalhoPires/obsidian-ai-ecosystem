// The AI Ecosystem's own MCP tools and REST routes for scripts. Pure Node.

import * as fs from "node:fs";
import * as nodePath from "node:path";
import * as os from "node:os";
import { randomUUID } from "node:crypto";
import { ECOSYSTEM_ID, SCRIPT_LANGUAGES } from "../types";
import type {
  ClientContext,
  HubRoute,
  HubScriptOptions,
  HubTool,
  HubToolResult,
  ScriptExecutionResult,
  ScriptLanguage,
  ScriptSettings,
} from "../types";
import { ScriptRefusedError } from "./script-engine";
import type { ScriptEngine } from "./script-engine";

const MAX_DEPTH = 6;
const MAX_FILES = 500;
const DEFAULT_OUTPUT_CHARS = 4000;
const MAX_OUTPUT_CHARS = 100_000;
const SPILL_DIR_NAME = "ai-ecosystem-runs";
const SPILL_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const EXTENSION_LANGUAGE: Record<string, ScriptLanguage> = {
  ".py": "python",
  ".js": "node",
  ".mjs": "node",
  ".cjs": "node",
  ".sh": "bash",
  ".ps1": "powershell",
};

export interface ListedScript {
  path: string;
  language: ScriptLanguage;
}

/** The part of the AI Scripts service that script_id needs (its items are checked at runtime). */
export interface ScriptsLookup {
  listScripts(): Promise<unknown[]> | unknown[];
}

export interface ScriptToolsDeps {
  engine: ScriptEngine;
  vaultBasePath: string;
  getSettings: () => ScriptSettings;
  getDeclaredScripts: () => string[];
  /** The AI Scripts service, looked up on each call. Undefined when AI Scripts is not running. */
  getScriptsService?: () => ScriptsLookup | undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function inferLanguage(path: string): ScriptLanguage | undefined {
  return EXTENSION_LANGUAGE[nodePath.extname(path).toLowerCase()];
}

function normalizeRelative(value: string): string | undefined {
  let v = value.trim().replace(/\\/g, "/");
  while (v.startsWith("./")) v = v.slice(2);
  v = nodePath.posix.normalize(v).replace(/\/+$/, "");
  if (v === "" || v === "." || v === ".." || v.startsWith("../") || v.startsWith("/") || /^[A-Za-z]:/.test(v)) return undefined;
  return v;
}

/** Scripts the engine would accept with the restrictions on: files in allowed folders plus declared scripts. */
export async function listAllowedScripts(
  vaultBasePath: string,
  allowedFolders: string[],
  declaredScripts: string[],
): Promise<ListedScript[]> {
  const found = new Map<string, ListedScript>();
  let count = 0;

  const walk = async (relDir: string, depth: number): Promise<void> => {
    if (depth > MAX_DEPTH || count >= MAX_FILES) return;
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(nodePath.join(vaultBasePath, relDir), { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (count >= MAX_FILES) return;
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(rel, depth + 1);
      } else if (entry.isFile()) {
        const language = inferLanguage(entry.name);
        if (language && !found.has(rel)) {
          found.set(rel, { path: rel, language });
          count++;
        }
      }
    }
  };

  for (const folder of allowedFolders) {
    const rel = typeof folder === "string" ? normalizeRelative(folder) : undefined;
    if (rel) await walk(rel, 0);
  }

  for (const declared of declaredScripts) {
    const rel = typeof declared === "string" ? normalizeRelative(declared) : undefined;
    if (!rel || found.has(rel)) continue;
    const language = inferLanguage(rel);
    if (!language) continue;
    try {
      if ((await fs.promises.stat(nodePath.join(vaultBasePath, rel))).isFile()) found.set(rel, { path: rel, language });
    } catch {
      // Declared but missing: not listed.
    }
  }

  return [...found.values()].sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Turns script_id into the path AI Scripts registered for it. Without a script_id the arguments
 * pass through unchanged; the engine still decides whether the resolved path may run.
 */
async function resolveScriptId(
  deps: ScriptToolsDeps,
  raw: unknown,
): Promise<{ ok: true; args: unknown } | { ok: false; message: string }> {
  if (!isPlainObject(raw) || typeof raw.script_id !== "string") return { ok: true, args: raw };
  const scriptId = raw.script_id.trim();
  if (scriptId === "") return { ok: true, args: raw };
  if ((raw.path !== undefined && raw.path !== "") || raw.code !== undefined) {
    return { ok: false, message: "Give path or script_id, not both." };
  }

  const unavailable = `script_id "${scriptId}": AI Scripts is not available. Pass path (a script file of the vault) instead.`;
  const service = deps.getScriptsService?.();
  if (!service || typeof service.listScripts !== "function") return { ok: false, message: unavailable };
  let items: unknown;
  try {
    items = await service.listScripts();
  } catch {
    return { ok: false, message: unavailable };
  }

  const list: unknown[] = Array.isArray(items) ? items : [];
  const item = list.find((x): x is Record<string, unknown> => isPlainObject(x) && x.scriptId === scriptId);
  if (!item) {
    return {
      ok: false,
      message: `script_id "${scriptId}" is not registered in AI Scripts. Call list_ai_scripts to see the ids, or pass path.`,
    };
  }
  const scriptPath = item.scriptPath;
  if (typeof scriptPath !== "string" || scriptPath.trim() === "") {
    return {
      ok: false,
      message: `The script "${scriptId}" is registered in AI Scripts but has no script file here. Run it with run_ai_script {"script_id":"${scriptId}","params":{...}}.`,
    };
  }

  const args: Record<string, unknown> = { ...raw, path: scriptPath };
  delete args.script_id;
  return { ok: true, args };
}

type ParsedRequest = { ok: true; options: HubScriptOptions; maxChars: number } | { ok: false; message: string };

/** Turns tool arguments or a REST body into engine options. Shape errors are reported, policy is left to the engine. */
function parseRunRequest(raw: unknown): ParsedRequest {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, message: "Arguments must be an object." };
  }
  const a = raw as Record<string, unknown>;
  if (a.path !== undefined && typeof a.path !== "string") return { ok: false, message: "path must be a string." };
  if (a.code !== undefined && typeof a.code !== "string") return { ok: false, message: "code must be a string." };
  if (a.script_id !== undefined && typeof a.script_id !== "string") return { ok: false, message: "script_id must be a string." };
  if (a.cwd !== undefined && typeof a.cwd !== "string") return { ok: false, message: "cwd must be a string." };
  if (a.timeoutSeconds !== undefined && (typeof a.timeoutSeconds !== "number" || !Number.isFinite(a.timeoutSeconds))) {
    return { ok: false, message: "timeoutSeconds must be a number." };
  }
  if (a.args !== undefined && (!Array.isArray(a.args) || a.args.some((x) => typeof x !== "string"))) {
    return { ok: false, message: "args must be an array of strings." };
  }
  if (a.env !== undefined) {
    const env = a.env;
    if (typeof env !== "object" || env === null || Array.isArray(env) || Object.values(env).some((v) => typeof v !== "string")) {
      return { ok: false, message: "env must be an object with string values." };
    }
  }
  if (a.language !== undefined && !SCRIPT_LANGUAGES.includes(a.language as ScriptLanguage)) {
    return { ok: false, message: `language must be one of: ${SCRIPT_LANGUAGES.join(", ")}.` };
  }
  if (a.max_chars !== undefined && (typeof a.max_chars !== "number" || !Number.isInteger(a.max_chars) || a.max_chars < 1)) {
    return { ok: false, message: "max_chars must be a positive integer." };
  }

  const path = typeof a.path === "string" ? a.path : "";
  const language = (a.language as ScriptLanguage | undefined) ?? (path ? inferLanguage(path) : undefined);
  if (a.code === undefined && !path) {
    return {
      ok: false,
      message:
        'path is required: a script path of the vault such as "Scripts/report.py" (see ecosystem_list_scripts), a script_id registered in AI Scripts, or code with language.',
    };
  }
  if (!language) {
    return {
      ok: false,
      message: a.code !== undefined
        ? "language is required with code."
        : `Cannot infer the language from "${path}". Pass language (${SCRIPT_LANGUAGES.join(", ")}).`,
    };
  }

  return {
    ok: true,
    options: {
      language,
      scriptPath: path,
      inlineCode: a.code,
      args: a.args as string[] | undefined,
      cwd: a.cwd,
      timeoutSeconds: a.timeoutSeconds,
      env: a.env as Record<string, string> | undefined,
    },
    maxChars: Math.min(typeof a.max_chars === "number" ? a.max_chars : DEFAULT_OUTPUT_CHARS, MAX_OUTPUT_CHARS),
  };
}

export interface ClippedOutput {
  text: string;
  omitted: number;
  file?: string;
}

/** Writes the full output to a temp file. Returns its path, or undefined when the write fails. */
function spillOutput(full: string, stream: "out" | "err"): string | undefined {
  try {
    const dir = nodePath.join(os.tmpdir(), SPILL_DIR_NAME);
    fs.mkdirSync(dir, { recursive: true });
    const now = Date.now();
    for (const name of fs.readdirSync(dir)) {
      try {
        const old = nodePath.join(dir, name);
        if (now - fs.statSync(old).mtimeMs > SPILL_MAX_AGE_MS) fs.unlinkSync(old);
      } catch {
        // Unreadable or busy file: leave it for a later run.
      }
    }
    const file = nodePath.join(dir, `${Date.now()}-${randomUUID().slice(0, 8)}.${stream}.txt`);
    fs.writeFileSync(file, full, "utf8");
    return file;
  } catch {
    return undefined;
  }
}

/** Keeps the start and the end of a long output; the full text goes to a file when possible. */
export function clipOutput(full: string, maxChars: number, stream: "out" | "err"): ClippedOutput {
  if (full.length <= maxChars) return { text: full, omitted: 0 };
  const file = spillOutput(full, stream);
  const head = Math.floor(maxChars / 4);
  const tailLength = maxChars - head;
  const omitted = full.length - maxChars;
  const marker = "\n[... " + omitted + " characters omitted" + (file ? "; full output in " + file : "") + " ...]\n";
  return {
    text: full.slice(0, head) + marker + full.slice(full.length - tailLength),
    omitted,
    ...(file ? { file } : {}),
  };
}

function formatRun(result: ScriptExecutionResult, maxChars: number): HubToolResult {
  const out = clipOutput(result.stdout, maxChars, "out");
  const err = clipOutput(result.stderr, maxChars, "err");
  const lines = [`Exit code: ${result.exitCode}`, `Killed: ${result.killed ? "yes (timeout or cancel)" : "no"}`, `Duration: ${result.durationMs} ms`];
  lines.push("", "stdout:", out.text || "(empty)", "", "stderr:", err.text || "(empty)");
  return {
    content: [{ type: "text", text: lines.join("\n") }],
    structuredContent: {
      exitCode: result.exitCode,
      killed: result.killed,
      durationMs: result.durationMs,
      truncated: out.omitted > 0 || err.omitted > 0,
      ...(out.file ? { stdout_file: out.file } : {}),
      ...(err.file ? { stderr_file: err.file } : {}),
    },
    isError: result.exitCode !== 0,
  };
}

async function runFromArgs(
  deps: ScriptToolsDeps,
  args: unknown,
  client: ClientContext | undefined,
  signal?: AbortSignal,
): Promise<
  | { kind: "invalid"; message: string }
  | { kind: "refused"; code: string; message: string }
  | { kind: "done"; result: ScriptExecutionResult; maxChars: number }
> {
  const resolved = await resolveScriptId(deps, args);
  if (!resolved.ok) return { kind: "invalid", message: resolved.message };
  const parsed = parseRunRequest(resolved.args);
  if (!parsed.ok) return { kind: "invalid", message: parsed.message };
  try {
    const result = await deps.engine.run({ ...parsed.options, ...(signal ? { signal } : {}) }, { moduleId: ECOSYSTEM_ID, client });
    return { kind: "done", result, maxChars: parsed.maxChars };
  } catch (err) {
    if (err instanceof ScriptRefusedError) return { kind: "refused", code: err.code, message: err.message };
    throw err;
  }
}

/** The scripts the engine would accept now, with the restriction flag. Shared by the tool and GET /scripts. */
export async function listScriptsData(deps: ScriptToolsDeps): Promise<{ scripts: ListedScript[]; restrictionsOn: boolean }> {
  const settings = deps.getSettings();
  const scripts = await listAllowedScripts(deps.vaultBasePath, settings.allowedFolders, deps.getDeclaredScripts());
  return { scripts, restrictionsOn: !settings.restrictionsDisabled };
}

export function createScriptTools(deps: ScriptToolsDeps): HubTool[] {
  const listTool: HubTool = {
    name: "ecosystem_list_scripts",
    title: "List runnable scripts",
    description:
      "Lists the vault scripts that ecosystem_run_script can run (one path per line, relative to the vault root; the language comes from the extension). Includes files in the allowed script folders and scripts declared by #mcp/script notes.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { title: "List runnable scripts", readOnlyHint: true, openWorldHint: false },
    handler: async () => {
      const { scripts, restrictionsOn } = await listScriptsData(deps);
      const text = scripts.length
        ? scripts.map((s) => s.path).join("\n")
        : "No scripts are available. Add a folder under Settings > AI Ecosystem > Scripts > Allowed folders.";
      return {
        content: [{ type: "text", text }],
        structuredContent: { scripts: scripts.map((s) => s.path), restrictionsOn },
      };
    },
  };

  const runTool: HubTool = {
    name: "ecosystem_run_script",
    title: "Run a vault script",
    description:
      "Runs a vault script (Python, Node.js, Bash or PowerShell) and returns its exit code, stdout and stderr. Pass a path from ecosystem_list_scripts, or a script_id registered in AI Scripts.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Script path relative to the vault root, e.g. \"Scripts/report.py\". Required unless script_id or code is given.",
        },
        script_id: {
          type: "string",
          description: "Id of a script registered in AI Scripts that is a script file; resolved to its path. Alternative to path.",
        },
        args: { type: "array", items: { type: "string" }, description: "Command-line arguments passed to the script." },
        cwd: { type: "string", description: "Working directory relative to the vault root. Default: the vault root." },
        timeoutSeconds: {
          type: "number",
          minimum: 1,
          description: "Timeout in seconds, capped by the maximum in the settings. The process is killed when it expires.",
        },
        env: {
          type: "object",
          additionalProperties: { type: "string" },
          description:
            "Extra environment variables. Values may be {{secret:NAME}} placeholders, resolved by Environment Keys straight into the process and never returned.",
        },
        language: {
          type: "string",
          enum: [...SCRIPT_LANGUAGES],
          description: "Inferred from the file extension (.py, .js/.mjs/.cjs, .sh, .ps1) when omitted. Required with code.",
        },
        code: {
          type: "string",
          description: "Inline source code to run instead of a file. Refused unless the user turned off the Script Engine restrictions.",
        },
        max_chars: {
          type: "integer",
          minimum: 1,
          maximum: 100000,
          description: "Max characters of stdout and of stderr returned (default 4000; the start and the end are kept and the full output is saved to a file).",
        },
      },
      additionalProperties: false,
    },
    annotations: { title: "Run a vault script", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    handler: async (args, ctx) => {
      const outcome = await runFromArgs(deps, args, ctx.client, ctx.signal);
      if (outcome.kind === "invalid") {
        return { content: [{ type: "text", text: `Invalid arguments: ${outcome.message}` }], isError: true };
      }
      if (outcome.kind === "refused") {
        return {
          content: [
            {
              type: "text",
              text:
                `Script refused (${outcome.code}): ${outcome.message} ` +
                "Only scripts in the allowed script folders or declared by #mcp/script notes can run (see ecosystem_list_scripts); inline code needs the Script Engine restrictions turned off.",
            },
          ],
          structuredContent: { refused: outcome.code, reason: outcome.message },
          isError: true,
        };
      }
      return formatRun(outcome.result, outcome.maxChars);
    },
  };

  return [listTool, runTool];
}

export function createScriptRoutes(deps: ScriptToolsDeps): HubRoute[] {
  return [
    {
      method: "GET",
      path: "/scripts",
      description: "Lists the scripts that can run.",
      handler: async () => {
        const body = await listScriptsData(deps);
        return { status: 200, body };
      },
    },
    {
      method: "POST",
      path: "/scripts/run",
      description:
        "Runs a script. Body: { path, args?, cwd?, timeoutSeconds?, env?, language?, code?, max_chars? }. " +
        "stdout and stderr are cut to max_chars (default 4000); the full output goes to a file.",
      handler: async (req) => {
        const outcome = await runFromArgs(deps, req.body, req.client);
        if (outcome.kind === "invalid") {
          return { status: 400, body: { error: { code: "invalid-request", message: outcome.message } } };
        }
        if (outcome.kind === "refused") {
          return { status: 403, body: { error: { code: outcome.code, message: outcome.message } } };
        }
        const { exitCode, stdout, stderr, durationMs, killed } = outcome.result;
        const out = clipOutput(stdout, outcome.maxChars, "out");
        const err = clipOutput(stderr, outcome.maxChars, "err");
        return {
          status: 200,
          body: {
            exitCode,
            killed,
            durationMs,
            stdout: out.text,
            stderr: err.text,
            truncated: out.omitted > 0 || err.omitted > 0,
            ...(out.file ? { stdout_file: out.file } : {}),
            ...(err.file ? { stderr_file: err.file } : {}),
          },
        };
      },
    },
  ];
}
