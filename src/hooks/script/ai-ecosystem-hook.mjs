// AI Ecosystem hook for Claude Code. Usage: node ai-ecosystem-hook.mjs <module> <type>
//
// Written by the AI Ecosystem plugin to <vault>/.claude/ai-ecosystem/hooks/ and registered
// in the Claude Code settings. Types: protecao (PreToolUse), setup (SessionStart, UserPromptSubmit), falha
// (PostToolUseFailure). Plain Node, no dependencies, no network.
//
// This script must never get in the way of the agent: any problem (missing or invalid state
// file, unexpected input, exception, more than 2 seconds) ends with exit code 0 and no
// output, which lets the tool call proceed.
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

const GUARD_MS = 2000;
const HEARTBEAT_MAX_AGE_MS = 45_000;
const FAILURE_TTL_MS = 10 * 60_000;
const LOCK_WINDOW_MS = 10 * 60_000;
const LOCK_PASS_ATTEMPT = 3;
const WINDOWS = process.platform === "win32";

const MESSAGES = {
  "ai-vault-search":
    "Use search_notes, list_files ou get_section (AI Vault Search). O terminal só vale se o plugin estiver fora do ar.",
  "environment-variables":
    "Este host tem secret no Environment Keys: use search_vault_tools e run_vault_tool (ou http_request com {{secret:NOME}}).",
  "ai-scripts":
    "Este script está numa pasta permitida: rode com ecosystem_run_script (ou run_ai_script se estiver registrado no AI Scripts).",
  "ai-templates": "Já existe molde para esta nota: use create_note_from_template (AI Templates).",
};

const HTTP_COMMANDS = ["curl", "wget", "invoke-restmethod", "invoke-webrequest", "irm", "iwr"];
const SCRIPT_RUNNERS = ["python", "python3", "py", "node", "pwsh", "powershell", "bash", "sh"];

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/** Ends the process without output (the call proceeds). */
function allow() {
  process.exit(0);
}

/** Prints one JSON line and ends. Falls back to exit 0 if the write fails. */
function respond(output) {
  const text = JSON.stringify(output) + "\n";
  try {
    process.stdout.write(text, () => process.exit(0));
  } catch {
    process.exit(0);
  }
}

function main() {
  const [moduleId, type] = process.argv.slice(2);
  if (!moduleId || !type) return allow();
  const stateDir = path.dirname(path.dirname(path.resolve(process.argv[1] ?? "")));

  readStdin((raw) => {
    let input;
    try {
      // Windows PowerShell 5.1 pipes add a BOM in front of the JSON.
      input = JSON.parse(raw.replace(/^﻿/, ""));
    } catch {
      return allow();
    }
    if (!isObject(input)) return allow();
    try {
      if (type === "protecao") return protect(stateDir, moduleId, input);
      if (type === "setup") return setup(stateDir, moduleId, input);
      if (type === "falha") return failure(stateDir, input);
    } catch {
      // Fail open.
    }
    allow();
  });
}

function readStdin(done) {
  const chunks = [];
  process.stdin.on("data", (chunk) => chunks.push(chunk));
  process.stdin.on("end", () => done(Buffer.concat(chunks).toString("utf8")));
  process.stdin.on("error", () => allow());
}

process.on("uncaughtException", () => allow());
setTimeout(allow, GUARD_MS);
try {
  main();
} catch {
  allow();
}

// ---------------------------------------------------------------------------
// State files
// ---------------------------------------------------------------------------

function readJson(stateDir, rel) {
  try {
    const text = fs.readFileSync(path.join(stateDir, rel), "utf8").replace(/^\ufeff/, "");
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function writeJson(stateDir, rel, value) {
  const file = path.join(stateDir, rel);
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(value), "utf8");
    fs.renameSync(tmp, file);
  } catch {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      // Nothing to clean.
    }
  }
}

/** True when the file exists but is not a JSON object: the hook then steps aside. */
function isCorrupt(stateDir, rel) {
  return fs.existsSync(path.join(stateDir, rel)) && !isObject(readJson(stateDir, rel));
}

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringList(value) {
  return Array.isArray(value) ? value.filter((v) => typeof v === "string" && v.trim() !== "") : [];
}

/** The core is alive when its heartbeat file is fresh. */
function coreIsAlive(stateDir) {
  try {
    const written = Number(fs.readFileSync(path.join(stateDir, "heartbeat"), "utf8").trim());
    return Number.isFinite(written) && Date.now() - written <= HEARTBEAT_MAX_AGE_MS;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// protecao (PreToolUse)
// ---------------------------------------------------------------------------

function protect(stateDir, moduleId, input) {
  if (!coreIsAlive(stateDir)) return allow();

  const state = readJson(stateDir, `modules/${moduleId}.json`);
  if (!isObject(state) || state.estado !== "configurado") return allow();

  if (isCorrupt(stateDir, "falhas.json")) return allow();
  const failures = readJson(stateDir, "falhas.json");
  const failedAt = isObject(failures) ? Number(failures[moduleId]) : NaN;
  if (Number.isFinite(failedAt) && Date.now() - failedAt < FAILURE_TTL_MS) return allow();

  const config = readJson(stateDir, "config.json");
  if (!isObject(config) || typeof config.vaultPath !== "string") return allow();
  const mode = resolveMode(config, moduleId);
  if (mode === "off") return allow();

  const toolName = typeof input.tool_name === "string" ? input.tool_name : "";
  const toolInput = isObject(input.tool_input) ? input.tool_input : {};
  const cwd = typeof input.cwd === "string" && input.cwd !== "" ? input.cwd : process.cwd();
  const env = {
    vault: normalizePath(config.vaultPath, cwd),
    configDir: typeof config.configDir === "string" && config.configDir !== "" ? config.configDir : ".obsidian",
    cwd,
    stateDir,
  };

  const message = matchRule(moduleId, toolName, toolInput, env);
  if (!message) return allow();

  if (mode === "avisar") return respond(allowWith(message));

  if (isCorrupt(stateDir, "bloqueios.json")) {
    writeJson(stateDir, "bloqueios.json", {});
    return allow();
  }

  if (repeatedThreeTimes(stateDir, toolName, toolInput)) {
    return respond(allowWith(`Liberado pela trava de repetição (3ª tentativa idêntica em 10 minutos). Prefira o caminho indicado: ${message}`));
  }
  respond({
    hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: message },
  });
}

function allowWith(context) {
  return {
    hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow", additionalContext: context },
  };
}

function resolveMode(config, moduleId) {
  const override = process.env.AI_ECOSYSTEM_HOOKS;
  if (override === "off" || override === "avisar" || override === "bloquear") return override;
  const own = isObject(config.modos) ? config.modos[moduleId] : undefined;
  return own === "off" || own === "avisar" ? own : "bloquear";
}

/** Returns the message when the module rule matches the tool call, otherwise undefined. */
function matchRule(moduleId, toolName, toolInput, env) {
  switch (moduleId) {
    case "ai-vault-search":
      return vaultSearchRule(toolName, toolInput, env);
    case "environment-variables":
      return envKeysRule(toolName, toolInput, env);
    case "ai-scripts":
      return scriptsRule(toolName, toolInput, env);
    case "ai-templates":
      return templatesRule(toolName, toolInput, env);
    default:
      return undefined;
  }
}

// ---- ai-vault-search -------------------------------------------------------

function vaultSearchRule(toolName, toolInput, env) {
  if (toolName !== "Grep" && toolName !== "Glob") return undefined;
  const pastas = readJson(env.stateDir, "pastas.json");
  if (!isObject(pastas)) return undefined;
  const outside = [...stringList(pastas.foraDoIndice), ...stringList(pastas.notasDeTools)];

  let target;
  if (typeof toolInput.path === "string" && toolInput.path !== "") target = toolInput.path;
  else if (toolName === "Glob" && typeof toolInput.pattern === "string" && isAbsolutePath(toolInput.pattern)) {
    target = fixedPrefix(toolInput.pattern);
  } else target = env.cwd;

  const rel = relativeToVault(normalizePath(target, env.cwd), env.vault);
  if (rel === undefined) return undefined;
  const segments = rel === "" ? [] : rel.split("/");
  const guarded = [".claude", env.configDir];
  if (guarded.some((dir) => insideFolder(segments, dir))) return undefined;
  if (outside.some((glob) => insideFolder(segments, glob))) return undefined;
  return MESSAGES["ai-vault-search"];
}

/** The part of a glob pattern before its first wildcard segment. */
function fixedPrefix(pattern) {
  const parts = pattern.replace(/\\/g, "/").split("/");
  const fixed = [];
  for (const part of parts) {
    if (/[*?[\]{}]/.test(part)) break;
    fixed.push(part);
  }
  return fixed.join("/") || "/";
}

// ---- environment-variables -------------------------------------------------

function envKeysRule(toolName, toolInput, env) {
  if (toolName !== "Bash" && toolName !== "PowerShell") return undefined;
  const command = typeof toolInput.command === "string" ? toolInput.command : "";
  if (!hasHttpCommand(command)) return undefined;
  const hosts = readJson(env.stateDir, "hosts.json");
  const patterns = isObject(hosts) ? stringList(hosts.hosts) : [];
  if (patterns.length === 0) return undefined;
  for (const url of extractUrls(command)) {
    if (patterns.some((pattern) => hostMatches(pattern, url))) return MESSAGES["environment-variables"];
  }
  return undefined;
}

function hasHttpCommand(command) {
  const words = command.toLowerCase().split(/[\s;&|(){}`'"]+/);
  return words.some((word) => HTTP_COMMANDS.includes(word.replace(/\.exe$/, "")));
}

function extractUrls(command) {
  const out = [];
  for (const match of command.matchAll(/https?:\/\/[^\s'"`<>)\\]+/gi)) {
    try {
      out.push(new URL(match[0]));
    } catch {
      // Not a URL.
    }
  }
  return out;
}

/** Patterns are "host[/prefix]"; "*.example.com" matches subdomains, not the root domain. */
function hostMatches(pattern, url) {
  const clean = pattern.trim().toLowerCase().replace(/^https?:\/\//, "");
  const slash = clean.indexOf("/");
  const hostPattern = slash === -1 ? clean : clean.slice(0, slash);
  const prefix = slash === -1 ? "" : clean.slice(slash).replace(/\/+$/, "");
  const host = url.hostname.toLowerCase();

  const hostOk = hostPattern.startsWith("*.") ? host.endsWith(hostPattern.slice(1)) : host === hostPattern;
  if (!hostOk) return false;
  if (prefix === "") return true;
  const pathname = url.pathname.toLowerCase();
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

// ---- ai-scripts ------------------------------------------------------------

function scriptsRule(toolName, toolInput, env) {
  if (toolName !== "Bash" && toolName !== "PowerShell") return undefined;
  const command = typeof toolInput.command === "string" ? toolInput.command : "";
  const pastas = readJson(env.stateDir, "pastas.json");
  const folders = isObject(pastas) ? stringList(pastas.scripts) : [];
  if (folders.length === 0) return undefined;

  let cwd = env.cwd;
  for (const segment of splitCommands(command)) {
    const tokens = tokenize(segment);
    const moved = changeDirectory(tokens, cwd);
    if (moved !== undefined) {
      cwd = moved;
      continue;
    }
    const file = scriptFile(tokens);
    if (!file) continue;
    const rel = relativeToVault(normalizePath(file, cwd), env.vault);
    if (rel === undefined) continue;
    const segments = rel.split("/");
    if (folders.some((glob) => insideFolder(segments.slice(0, -1), glob))) return MESSAGES["ai-scripts"];
  }
  return undefined;
}

/** Splits a shell command line at ;, &&, ||, | and line breaks (quotes are respected). */
function splitCommands(command) {
  const out = [];
  let current = "";
  let quote = "";
  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (quote) {
      current += ch;
      if (ch === quote) quote = "";
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
    } else if (ch === ";" || ch === "|" || ch === "&" || ch === "\n" || ch === "\r") {
      if (current.trim()) out.push(current.trim());
      current = "";
    } else current += ch;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

function tokenize(segment) {
  const tokens = [];
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
  for (const match of segment.matchAll(pattern)) tokens.push(match[1] ?? match[2] ?? match[3] ?? "");
  return tokens;
}

function changeDirectory(tokens, cwd) {
  const head = (tokens[0] ?? "").toLowerCase();
  if ((head === "cd" || head === "set-location" || head === "sl") && tokens[1] && !tokens[1].startsWith("-")) {
    return normalizePath(tokens[1], cwd);
  }
  return undefined;
}

/** The script file a "python x.py" style command runs, or undefined. */
function scriptFile(tokens) {
  let i = 0;
  while (i < tokens.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i]) || tokens[i] === "&")) i++;
  const runner = (tokens[i] ?? "").replace(/\\/g, "/").split("/").pop().toLowerCase().replace(/\.exe$/, "");
  if (!SCRIPT_RUNNERS.includes(runner)) return undefined;

  const powershell = runner === "pwsh" || runner === "powershell";
  for (let j = i + 1; j < tokens.length; j++) {
    const token = tokens[j];
    const lower = token.toLowerCase();
    if (powershell) {
      if (lower === "-file" || lower === "-f") return tokens[j + 1];
      if (!token.startsWith("-") && lower.endsWith(".ps1")) return token;
      continue;
    }
    if (token === "-m" || token === "-c" || token === "-e" || token === "--eval" || token === "--print") return undefined;
    if (!token.startsWith("-")) return token;
  }
  return undefined;
}

// ---- ai-templates ----------------------------------------------------------

function templatesRule(toolName, toolInput, env) {
  if (toolName !== "Write") return undefined;
  const filePath = typeof toolInput.file_path === "string" ? toolInput.file_path : "";
  if (!filePath) return undefined;
  const rel = relativeToVault(normalizePath(filePath, env.cwd), env.vault);
  if (!rel) return undefined;
  const pastas = readJson(env.stateDir, "pastas.json");
  const globs = isObject(pastas) ? stringList(pastas.templates) : [];
  if (!globs.some((glob) => matchGlob(rel.split("/"), glob))) return undefined;
  if (fs.existsSync(filePath)) return undefined;
  return MESSAGES["ai-templates"];
}

// ---------------------------------------------------------------------------
// Paths and globs
// ---------------------------------------------------------------------------

function isAbsolutePath(p) {
  return /^[A-Za-z]:[\\/]/.test(p) || p.startsWith("/") || p.startsWith("\\\\");
}

/** Absolute, forward-slash path without "." / ".." segments (lowercase on Windows). */
function normalizePath(p, cwd) {
  let value = p.replace(/\\/g, "/");
  // Git Bash style drive paths (/c/Users/x) on Windows.
  if (WINDOWS) value = value.replace(/^\/([A-Za-z])(?=\/|$)/, (_, drive) => `${drive.toUpperCase()}:`);
  if (!isAbsolutePath(value)) value = `${cwd.replace(/\\/g, "/")}/${value}`;
  let out = path.posix.normalize(value);
  if (out.length > 1) out = out.replace(/\/+$/, "");
  return WINDOWS ? out.toLowerCase() : out;
}

/** The path relative to the vault, "" for the vault itself, undefined when it is outside. */
function relativeToVault(abs, vault) {
  if (abs === vault) return "";
  if (abs.startsWith(`${vault}/`)) return abs.slice(vault.length + 1);
  return undefined;
}

/** True when the folder (as path segments) is the glob's folder or inside it. */
function insideFolder(segments, glob) {
  for (let k = 1; k <= segments.length; k++) {
    if (matchGlob(segments.slice(0, k), glob)) return true;
  }
  return false;
}

/** Matches path segments against a vault-relative glob: "*" is one segment, "**" many. */
function matchGlob(segments, glob) {
  const normalized = glob.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  const pattern = (WINDOWS ? normalized.toLowerCase() : normalized).split("/").filter((s) => s !== "");
  const target = WINDOWS ? segments.map((s) => s.toLowerCase()) : segments;
  return matchSegments(target, 0, pattern, 0);
}

function matchSegments(target, ti, pattern, pi) {
  if (pi === pattern.length) return ti === target.length;
  if (pattern[pi] === "**") {
    for (let skip = ti; skip <= target.length; skip++) {
      if (matchSegments(target, skip, pattern, pi + 1)) return true;
    }
    return false;
  }
  if (ti === target.length) return false;
  return segmentMatches(pattern[pi], target[ti]) && matchSegments(target, ti + 1, pattern, pi + 1);
}

function segmentMatches(pattern, value) {
  if (!pattern.includes("*")) return pattern === value;
  const escaped = pattern.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`^${escaped.join(".*")}$`).test(value);
}

// ---------------------------------------------------------------------------
// Repetition lock
// ---------------------------------------------------------------------------

/** Keys sorted, whitespace of `command` collapsed, so the same attempt always hashes the same. */
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!isObject(value)) return value;
  const out = {};
  for (const key of Object.keys(value).sort()) {
    const item = value[key];
    out[key] = key === "command" && typeof item === "string" ? item.replace(/\s+/g, " ").trim() : canonical(item);
  }
  return out;
}

/** Counts this attempt; true (and resets the counter) when it is the 3rd identical one in 10 minutes. */
function repeatedThreeTimes(stateDir, toolName, toolInput) {
  const key = crypto.createHash("sha1").update(toolName + JSON.stringify(canonical(toolInput))).digest("hex");
  const now = Date.now();
  const stored = readJson(stateDir, "bloqueios.json");
  const locks = {};
  if (isObject(stored)) {
    for (const [hash, entry] of Object.entries(stored)) {
      if (isObject(entry) && Number.isFinite(entry.t) && now - entry.t < LOCK_WINDOW_MS) locks[hash] = entry;
    }
  }
  const previous = locks[key];
  const attempts = (previous && Number.isFinite(previous.n) ? previous.n : 0) + 1;
  if (attempts >= LOCK_PASS_ATTEMPT) {
    delete locks[key];
    writeJson(stateDir, "bloqueios.json", locks);
    return true;
  }
  locks[key] = { n: attempts, t: previous ? previous.t : now };
  writeJson(stateDir, "bloqueios.json", locks);
  return false;
}

// ---------------------------------------------------------------------------
// setup (SessionStart, UserPromptSubmit) and falha (PostToolUseFailure)
// ---------------------------------------------------------------------------

function setup(stateDir, moduleId, input) {
  if (!coreIsAlive(stateDir)) return allow();
  const state = readJson(stateDir, `modules/${moduleId}.json`);
  if (!isObject(state) || state.estado !== "pendente_configuracao") return allow();
  if (fs.existsSync(path.join(stateDir, "modules", `${moduleId}.configurado.json`))) return allow();
  const name = typeof state.nome === "string" && state.nome !== "" ? state.nome : moduleId;
  const prompt = input.hook_event_name === "UserPromptSubmit";
  const order = prompt
    ? `O módulo ${name} ainda não foi configurado. ` +
      `Antes de responder à mensagem do usuário, execute a skill configurar-${moduleId}.`
    : `O módulo ${name} foi instalado e ainda não foi configurado. ` +
      `Antes de qualquer outra coisa, execute a skill configurar-${moduleId}.`;
  respond({ hookSpecificOutput: { hookEventName: prompt ? "UserPromptSubmit" : "SessionStart", additionalContext: order } });
}

function failure(stateDir, input) {
  const toolName = typeof input.tool_name === "string" ? input.tool_name : "";
  const parts = toolName.split("__");
  if (parts.length < 3 || parts[0] !== "mcp") return allow();
  const tool = parts.slice(2).join("__");
  const tools = readJson(stateDir, "tools.json");
  const moduleId = isObject(tools) ? tools[tool] : undefined;
  if (typeof moduleId !== "string") return allow();
  const failures = readJson(stateDir, "falhas.json");
  const next = isObject(failures) ? failures : {};
  next[moduleId] = Date.now();
  writeJson(stateDir, "falhas.json", next);
  allow();
}
