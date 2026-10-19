// The AI Ecosystem's own MCP tools and REST routes for scripts. Pure Node.

import * as fs from "node:fs";
import * as nodePath from "node:path";
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
const AGENT_OUTPUT_CHARS = 20_000;

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

export interface ScriptToolsDeps {
  engine: ScriptEngine;
  vaultBasePath: string;
  getSettings: () => ScriptSettings;
  getDeclaredScripts: () => string[];
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

type ParsedRequest = { ok: true; options: HubScriptOptions } | { ok: false; message: string };

/** Turns tool arguments or a REST body into engine options. Shape errors are reported, policy is left to the engine. */
function parseRunRequest(raw: unknown): ParsedRequest {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, message: "Arguments must be an object." };
  }
  const a = raw as Record<string, unknown>;
  if (a.path !== undefined && typeof a.path !== "string") return { ok: false, message: "path must be a string." };
  if (a.code !== undefined && typeof a.code !== "string") return { ok: false, message: "code must be a string." };
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

  const path = typeof a.path === "string" ? a.path : "";
  const language = (a.language as ScriptLanguage | undefined) ?? (path ? inferLanguage(path) : undefined);
  if (a.code === undefined && !path) return { ok: false, message: "path is required (or code with language)." };
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
  };
}

function tail(text: string, max: number): string {
  if (text.length <= max) return text;
  return `[${text.length - max} earlier characters omitted]\n` + text.slice(text.length - max);
}

function formatRun(result: ScriptExecutionResult): HubToolResult {
  const stdout = tail(result.stdout, AGENT_OUTPUT_CHARS);
  const stderr = tail(result.stderr, AGENT_OUTPUT_CHARS);
  const lines = [`Exit code: ${result.exitCode}`, `Killed: ${result.killed ? "yes (timeout or cancel)" : "no"}`, `Duration: ${result.durationMs} ms`];
  lines.push("", "stdout:", stdout || "(empty)", "", "stderr:", stderr || "(empty)");
  return {
    content: [{ type: "text", text: lines.join("\n") }],
    structuredContent: { exitCode: result.exitCode, killed: result.killed, durationMs: result.durationMs, stdout, stderr },
    isError: result.exitCode !== 0,
  };
}

async function runFromArgs(
  deps: ScriptToolsDeps,
  args: unknown,
  client: ClientContext | undefined,
): Promise<{ kind: "invalid"; message: string } | { kind: "refused"; code: string; message: string } | { kind: "done"; result: ScriptExecutionResult }> {
  const parsed = parseRunRequest(args);
  if (!parsed.ok) return { kind: "invalid", message: parsed.message };
  try {
    const result = await deps.engine.run(parsed.options, { moduleId: ECOSYSTEM_ID, client });
    return { kind: "done", result };
  } catch (err) {
    if (err instanceof ScriptRefusedError) return { kind: "refused", code: err.code, message: err.message };
    throw err;
  }
}

export function createScriptTools(deps: ScriptToolsDeps): HubTool[] {
  const list = async (): Promise<{ scripts: ListedScript[]; restrictionsOn: boolean }> => {
    const settings = deps.getSettings();
    const scripts = await listAllowedScripts(deps.vaultBasePath, settings.allowedFolders, deps.getDeclaredScripts());
    return { scripts, restrictionsOn: !settings.restrictionsDisabled };
  };

  const listTool: HubTool = {
    name: "ecosystem_list_scripts",
    title: "List runnable scripts",
    description:
      "Lists the vault scripts that ecosystem_run_script can run: files in the allowed script folders and scripts declared by #mcp/script notes. Paths are relative to the vault root.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { title: "List runnable scripts", readOnlyHint: true, openWorldHint: false },
    handler: async () => {
      const { scripts, restrictionsOn } = await list();
      const text = scripts.length
        ? scripts.map((s) => `${s.path} (${s.language})`).join("\n")
        : "No scripts are available. Add a folder under Settings > AI Ecosystem > Scripts > Allowed folders.";
      return {
        content: [{ type: "text", text }],
        structuredContent: { scripts, restrictionsOn },
      };
    },
  };

  const runTool: HubTool = {
    name: "ecosystem_run_script",
    title: "Run a vault script",
    description:
      "Runs a script stored in the vault (Python, Node.js, Bash or PowerShell) and returns its exit code, stdout and stderr. " +
      "Only scripts in the allowed script folders or declared by #mcp/script notes can run (see ecosystem_list_scripts). " +
      "Inline code (the code argument) works only when the user has turned off the Script Engine restrictions; otherwise it is refused. " +
      "Environment values may use {{secret:NAME}} placeholders: they are resolved by Environment Keys directly into the process and never returned. " +
      "The process is killed when the timeout expires.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Script path relative to the vault root, e.g. \"Scripts/report.py\". Required unless code is given.",
        },
        args: { type: "array", items: { type: "string" }, description: "Command-line arguments passed to the script." },
        cwd: { type: "string", description: "Working directory relative to the vault root. Default: the vault root." },
        timeoutSeconds: { type: "number", minimum: 1, description: "Timeout in seconds. Capped by the maximum in the settings." },
        env: {
          type: "object",
          additionalProperties: { type: "string" },
          description: "Extra environment variables. Values may be {{secret:NAME}} placeholders.",
        },
        language: {
          type: "string",
          enum: [...SCRIPT_LANGUAGES],
          description: "Inferred from the file extension (.py, .js/.mjs/.cjs, .sh, .ps1) when omitted. Required with code.",
        },
        code: {
          type: "string",
          description: "Inline source code to run instead of a file. Only works when the Script Engine restrictions are turned off.",
        },
      },
      additionalProperties: false,
    },
    annotations: { title: "Run a vault script", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    handler: async (args, ctx) => {
      const outcome = await runFromArgs(deps, args, ctx.client);
      if (outcome.kind === "invalid") {
        return { content: [{ type: "text", text: `Invalid arguments: ${outcome.message}` }], isError: true };
      }
      if (outcome.kind === "refused") {
        return {
          content: [{ type: "text", text: `Script refused (${outcome.code}): ${outcome.message}` }],
          structuredContent: { refused: outcome.code, reason: outcome.message },
          isError: true,
        };
      }
      return formatRun(outcome.result);
    },
  };

  return [listTool, runTool];
}

export function createScriptRoutes(deps: ScriptToolsDeps): HubRoute[] {
  const listTools = createScriptTools(deps)[0];
  return [
    {
      method: "GET",
      path: "/scripts",
      description: "Lists the scripts that can run.",
      handler: async (req) => {
        const res = await listTools.handler({}, { client: req.client, moduleId: ECOSYSTEM_ID });
        return { status: 200, body: res.structuredContent };
      },
    },
    {
      method: "POST",
      path: "/scripts/run",
      description: "Runs a script. Body: { path, args?, cwd?, timeoutSeconds?, env?, language?, code? }.",
      handler: async (req) => {
        const outcome = await runFromArgs(deps, req.body, req.client);
        if (outcome.kind === "invalid") {
          return { status: 400, body: { error: { code: "invalid-request", message: outcome.message } } };
        }
        if (outcome.kind === "refused") {
          return { status: 403, body: { error: { code: outcome.code, message: outcome.message } } };
        }
        const { exitCode, stdout, stderr, durationMs, killed } = outcome.result;
        return { status: 200, body: { exitCode, killed, durationMs, stdout, stderr } };
      },
    },
  ];
}
