// AI Ecosystem hook for Claude Code. Usage: node ai-ecosystem-hook.mjs <module> <type>
//
// Written by the AI Ecosystem plugin to <vault>/.claude/ai-ecosystem/hooks/ and registered
// in the Claude Code settings. Types: protecao (PreToolUse), despacho (PreToolUse: the protection of every
// module in one process), setup (SessionStart, UserPromptSubmit), falha (PostToolUseFailure), resumo
// (SessionStart: short summary of the active modules), aprovacao and execucao
// (both retired: no decision, kept so old settings entries stay harmless).
// Plain Node, no dependencies, no network.
//
// This script must never get in the way of the agent: any problem (missing or invalid state
// file, unexpected input, exception, more than 2 seconds) ends with exit code 0 and no
// output, which lets the tool call proceed.
//
// The script never answers permissionDecision "allow": that would approve the call and skip the
// normal Claude Code permission prompt. A reminder (mode avisar, repetition lock) goes out as
// additionalContext only, so the call follows the user's usual permission rules.
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

const GUARD_MS = 2000;
const HEARTBEAT_MAX_AGE_MS = 45_000;
const FAILURE_TTL_MS = 10 * 60_000;
const LOCK_WINDOW_MS = 10 * 60_000;
const LOCK_PASS_ATTEMPT = 3;
const WINDOWS = process.platform === "win32";
const TYPE = process.argv[3];

/** Mode of a module with no entry in config.modos (same table as defaultMode in state-dir.ts). */
const DEFAULT_MODES = { "ai-git-tools": "avisar" };

const MESSAGES = {
  "ai-vault-search":
    "Use search (conteúdo), find (nome), list_files ou get_section (AI Vault Search). O terminal só vale se o plugin estiver fora do ar.",
  "environment-variables":
    "Este host tem secret no Environment Keys: use search_vault_tools e run_vault_tool (ou http_request com {{secret:NOME}}).",
  "ai-scripts":
    "Este script está numa pasta permitida: rode com ecosystem_run_script (ou run_ai_script se estiver registrado no AI Scripts).",
  "ai-templates": "Já existe molde para esta nota: use create_note_from_template (AI Templates).",
  "ai-git-tools":
    "Para git e para as APIs de GitHub e Bitbucket use as tools do AI Git Tools (git_status, git_commit, git_push, git_pr_criar...).",
};

const HTTP_COMMANDS = ["curl", "wget", "invoke-restmethod", "invoke-webrequest", "irm", "iwr"];
const SCRIPT_RUNNERS = ["python", "python3", "py", "node", "pwsh", "powershell", "bash", "sh"];
const GIT_COMMANDS = ["git", "gh"];
const GIT_HELP_WORDS = ["--version", "version", "help", "-h", "--help"];
const GIT_HOSTS = ["api.github.com", "github.com", "api.bitbucket.org", "bitbucket.org"];

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/** Ends the process without output (the call proceeds). */
function allow() {
  process.exit(0);
}

let answered = false;

/** No decision and no output: the user's normal permission rules decide (used by aprovacao and execucao). */
function pass() {
  if (answered) return;
  answered = true;
  process.exit(0);
}

/** Prints one JSON line and ends. Falls back to exit 0 if the write fails. */
function respond(output) {
  if (answered) return;
  answered = true;
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
      if (type === "despacho") return dispatch(stateDir, input);
      if (type === "setup") return setup(stateDir, moduleId, input);
      if (type === "falha") return failure(stateDir, input);
      if (type === "resumo") return summary(stateDir, input);
      if (type === "aprovacao" || type === "execucao") return pass();
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
  const decision = evaluateProtection(stateDir, moduleId, input);
  if (decision.kind === "allow") return allow();
  if (decision.kind === "remind") return respond(remind(decision.message));
  return block(stateDir, input, decision.message);
}

/**
 * Decides one module's rule for a tool call without answering or writing anything:
 * { kind: "allow" }, { kind: "remind", message } (mode avisar) or { kind: "block", message } (mode bloquear).
 */
function evaluateProtection(stateDir, moduleId, input) {
  if (!coreIsAlive(stateDir)) return { kind: "allow" };

  const state = readJson(stateDir, `modules/${moduleId}.json`);
  if (!isObject(state) || state.estado !== "configurado") return { kind: "allow" };

  if (isCorrupt(stateDir, "falhas.json")) return { kind: "allow" };
  const failures = readJson(stateDir, "falhas.json");
  const failedAt = isObject(failures) ? Number(failures[moduleId]) : NaN;
  if (Number.isFinite(failedAt) && Date.now() - failedAt < FAILURE_TTL_MS) return { kind: "allow" };

  const config = readJson(stateDir, "config.json");
  if (!isObject(config) || typeof config.vaultPath !== "string") return { kind: "allow" };
  const mode = resolveMode(config, moduleId);
  if (mode === "off") return { kind: "allow" };

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
  if (!message) return { kind: "allow" };

  if (mode === "avisar") return { kind: "remind", message };
  return { kind: "block", message };
}

/** The block mode: the repetition lock may let the 3rd identical attempt through, otherwise the call is denied. */
function block(stateDir, input, message) {
  const toolName = typeof input.tool_name === "string" ? input.tool_name : "";
  const toolInput = isObject(input.tool_input) ? input.tool_input : {};

  if (isCorrupt(stateDir, "bloqueios.json")) {
    writeJson(stateDir, "bloqueios.json", {});
    return allow();
  }

  if (repeatedThreeTimes(stateDir, toolName, toolInput)) {
    return respond(remind(`Liberado pela trava de repetição (3ª tentativa idêntica em 10 minutos). Prefira o caminho indicado: ${message}`));
  }
  respond({
    hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: message },
  });
}

/** A reminder for the model with no permission decision: the normal permission prompt still applies. */
function remind(context) {
  return { hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: context } };
}

function resolveMode(config, moduleId) {
  const override = process.env.AI_ECOSYSTEM_HOOKS;
  if (override === "off" || override === "avisar" || override === "bloquear") return override;
  const own = isObject(config.modos) ? config.modos[moduleId] : undefined;
  if (own === "off" || own === "avisar" || own === "bloquear") return own;
  return DEFAULT_MODES[moduleId] ?? "bloquear";
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
    case "ai-git-tools":
      return gitRule(toolName, toolInput);
    default:
      return undefined;
  }
}

// ---- ai-vault-search -------------------------------------------------------

function vaultSearchRule(toolName, toolInput, env) {
  const shell = toolName === "Bash" || toolName === "PowerShell";
  if (toolName !== "Grep" && toolName !== "Glob" && !shell) return undefined;
  const pastas = readJson(env.stateDir, "pastas.json");
  if (!isObject(pastas)) return undefined;
  const outside = [...stringList(pastas.foraDoIndice), ...stringList(pastas.notasDeTools)];
  if (shell) return shellSearchRule(toolInput, env, outside);

  let target;
  if (typeof toolInput.path === "string" && toolInput.path !== "") target = toolInput.path;
  else if (toolName === "Glob" && typeof toolInput.pattern === "string" && isAbsolutePath(toolInput.pattern)) {
    target = fixedPrefix(toolInput.pattern);
  } else target = env.cwd;

  if (!searchesIndexedFolder(target, env, outside)) return undefined;
  return `${MESSAGES["ai-vault-search"]} ${vaultSearchCall(toolName, toolInput, relativeKeepCase(target, env))}`;
}

/** True when the folder is in the vault and not in .claude, the config folder or a folder left out of the index. */
function searchesIndexedFolder(target, env, outside) {
  const rel = relativeToVault(normalizePath(target, env.cwd), env.vault);
  if (rel === undefined) return false;
  const segments = rel === "" ? [] : rel.split("/");
  const guarded = [".claude", env.configDir];
  if (guarded.some((dir) => insideFolder(segments, dir))) return false;
  return !outside.some((glob) => insideFolder(segments, glob));
}

/** Content searchers that read stdin when they are the target of a pipe. */
const STDIN_SEARCHERS = ["grep", "egrep", "fgrep", "rg", "ag", "ack", "findstr", "select-string", "sls"];
/** Name or content searchers that walk folders by themselves. */
const FOLDER_SEARCHERS = ["find", "fd", "fdfind"];
/** Listers that only count as a search when they recurse. */
const LISTERS = ["ls", "dir", "gci", "get-childitem"];
const SEARCH_WRAPPERS = ["rtk", "proxy", "command", "sudo", "time", "&"];

/** The search a Bash or PowerShell command runs inside the indexed part of the vault, as a message, or undefined. */
function shellSearchRule(toolInput, env, outside) {
  const command = typeof toolInput.command === "string" ? toolInput.command : "";
  let cwd = env.cwd;
  for (const { text, piped } of splitPipeline(command)) {
    const tokens = tokenize(text);
    const moved = changeDirectory(tokens, cwd);
    if (moved !== undefined) {
      cwd = moved;
      continue;
    }
    const search = shellSearch(tokens, piped);
    if (!search) continue;
    const targets = search.paths.length > 0 ? search.paths : [cwd];
    const hit = targets.find((p) => searchesIndexedFolder(normalizePath(p, cwd), { ...env, cwd }, outside));
    if (hit === undefined) continue;
    const folder = relativeKeepCase(normalizePath(hit, cwd, true), { ...env, cwd });
    return `${MESSAGES["ai-vault-search"]} ${vaultSearchCall(search.content ? "Grep" : "Glob", { pattern: search.pattern }, folder)}`;
  }
  return undefined;
}

/** The search done by one command ({ content, pattern, paths }), or undefined when it is not a folder search. */
function shellSearch(tokens, piped) {
  let i = 0;
  while (i < tokens.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i]) || SEARCH_WRAPPERS.includes(tokens[i].toLowerCase()))) i++;
  const name = (tokens[i] ?? "").replace(/\\/g, "/").split("/").pop().toLowerCase().replace(/\.exe$/, "");
  const args = tokens.slice(i + 1);
  const content = STDIN_SEARCHERS.includes(name);
  if (content && piped) return undefined;
  if (name === "find" && piped) return undefined;
  if (!content && !FOLDER_SEARCHERS.includes(name)) {
    if (!LISTERS.includes(name) || !recurses(name, args)) return undefined;
  }
  const options = (a) => a.startsWith("-") || (name === "dir" && /^\/[A-Za-z]$/.test(a));
  const positional = args.filter((a) => !options(a));
  const hasPatternOption = args.some((a) => /^(-e|-f|--regexp|--file|-pattern)$/i.test(a));
  const pattern = content && !hasPatternOption ? (positional.shift() ?? "") : "";
  const pathLike = (a) => isAbsolutePath(a) || /[\\/]/.test(a) || a.startsWith(".");
  const explicit = args.findIndex((a) => /^-(path|literalpath)$/i.test(a));
  const paths = explicit >= 0 && args[explicit + 1] ? [args[explicit + 1]] : positional.filter(pathLike);
  return { content, pattern, paths };
}

function recurses(name, args) {
  if (name === "ls") return args.some((a) => /^-[A-Za-z]*R/.test(a) || a === "--recursive");
  return args.some((a) => /^(-r|-rec\w*|\/s)$/i.test(a));
}

/** Like splitCommands, but each part says whether it reads the output of the part before it (a pipe). */
function splitPipeline(command) {
  const out = [];
  let current = "";
  let quote = "";
  let piped = false;
  const flush = (nextPiped) => {
    if (current.trim()) out.push({ text: current.trim(), piped });
    current = "";
    piped = nextPiped;
  };
  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (quote) {
      current += ch;
      if (ch === quote) quote = "";
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
    } else if (ch === "|" && command[i + 1] !== "|" && command[i - 1] !== "|") flush(true);
    else if (ch === ";" || ch === "|" || ch === "&" || ch === "\n" || ch === "\r") flush(false);
    else current += ch;
  }
  flush(false);
  return out;
}

/** The ready call that replaces a Grep (search) or a Glob (list_files through tools_run). */
function vaultSearchCall(toolName, toolInput, folder) {
  if (toolName === "Glob") {
    const args = folder ? { pasta: folder, recursivo: true } : { recursivo: true };
    return `Chamada pronta: tools_run ${JSON.stringify({ id: "list_files", args })} (para buscar por conteúdo, search; por nome, find).`;
  }
  const termos = searchTerms(typeof toolInput.pattern === "string" ? toolInput.pattern : "");
  return `Chamada pronta: search ${JSON.stringify(termos.length ? { termos } : {})}.`;
}

/** The plain words of a regular expression (escapes like \s and \b dropped), at most 6. */
function searchTerms(pattern) {
  const words = pattern.replace(/\\[A-Za-z]/g, " ").match(/[\p{L}\p{N}]{2,}/gu) ?? [];
  return [...new Set(words)].slice(0, 6);
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
    if (patterns.some((pattern) => hostMatches(pattern, url))) return `${MESSAGES["environment-variables"]} ${httpCalls(command, url)}`;
  }
  return undefined;
}

/** The ready calls for an HTTP request to a host with a secret: look for its vault tool, else http_request. */
function httpCalls(command, url) {
  const method = /(?:^|\s)(?:-X|--request|-Method)\s+['"]?([A-Za-z]+)/i.exec(command)?.[1]?.toUpperCase() ?? "GET";
  const words = [url.hostname.split(".")[0], ...url.pathname.split(/[^A-Za-z]+/).filter((w) => w.length > 2 && !/^v\d*$/i.test(w))].slice(0, 5);
  const href = url.href.length > 300 ? `${url.origin}${url.pathname}`.slice(0, 300) : url.href;
  const request = { id: "http_request", args: { method, url: href, headers: { Authorization: "{{secret:NOME}}" } } };
  return (
    `Chamadas prontas: tools_find ${JSON.stringify({ q: words.join(" ") })} para achar a tool do endpoint e tools_run com o id dela; ` +
    `sem tool própria: tools_run ${JSON.stringify(request)} (troque NOME pela secret certa, veja list_secrets).`
  );
}

/** The lowercase words of a command (or of one segment of it), without quotes and shell punctuation. */
function commandWords(command) {
  return command
    .toLowerCase()
    .split(/[\s;&|(){}`'"]+/)
    .filter((word) => word !== "");
}

function hasHttpCommand(command) {
  return commandWords(command).some((word) => HTTP_COMMANDS.includes(word.replace(/\.exe$/, "")));
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

// ---- ai-git-tools ----------------------------------------------------------

/** git or gh run from the terminal, or curl and friends against the GitHub and Bitbucket APIs. */
function gitRule(toolName, toolInput) {
  if (toolName !== "Bash" && toolName !== "PowerShell") return undefined;
  const command = typeof toolInput.command === "string" ? toolInput.command : "";
  for (const segment of splitCommands(command)) {
    // The quote-aware tokens catch a quoted path with spaces ("C:/Program Files/Git/bin/git.exe").
    const quoted = tokenize(segment).map((token) => token.toLowerCase());
    for (const words of [commandWords(segment), quoted]) {
      if (runsGit(words)) return `${MESSAGES["ai-git-tools"]} ${gitCall(words)}`;
    }
  }
  if (!hasHttpCommand(command)) return undefined;
  for (const url of extractUrls(command)) {
    if (GIT_HOSTS.includes(url.hostname.toLowerCase())) {
      return `${MESSAGES["ai-git-tools"]} Chamada pronta: tools_find ${JSON.stringify({ modulo: "ai-git-tools", q: url.pathname.includes("pull") ? "pr" : "git" })}.`;
    }
  }
  return undefined;
}

/** The AI Git Tools tool of a git subcommand (or of "gh <group> <action>"). */
const GIT_TOOLS = {
  status: "git_status",
  diff: "git_diff",
  log: "git_log",
  blame: "git_blame",
  branch: "git_branches",
  add: "git_add",
  commit: "git_commit",
  push: "git_push",
  pull: "git_pull",
  fetch: "git_fetch",
  checkout: "git_checkout",
  switch: "git_checkout",
  merge: "git_merge",
  revert: "git_revert",
  stash: "git_stash",
  tag: "git_tag",
  clone: "git_clone",
  remote: "git_remote_info",
};
const GH_TOOLS = {
  "pr create": "git_pr_criar",
  "pr list": "git_pr_listar",
  "pr view": "git_pr_obter",
  "pr comment": "git_pr_comentar",
  "pr merge": "git_pr_merge",
  "release create": "git_release_criar",
  "repo create": "git_repo_criar",
  "run list": "git_pipeline_status",
  "run view": "git_pipeline_status",
};
/** Tools that run fine without arguments. */
const GIT_NO_ARGS = new Set(["git_status", "git_diff", "git_log", "git_branches", "git_remote_info", "git_fetch"]);

/** The ready call for a git or gh command line (its words, lowercase). */
function gitCall(words) {
  let i = 0;
  while (i < words.length && /^[a-z_][a-z0-9_]*=/.test(words[i])) i++;
  const head = (words[i] ?? "").split(/[\\/]/).pop().replace(/\.exe$/, "");
  const rest = [];
  for (let j = i + 1; j < words.length; j++) {
    const word = words[j];
    // git -C <dir> / -c <key=value> take a value.
    if (word === "-c" || word === "-C") {
      j++;
      continue;
    }
    if (!word.startsWith("-")) rest.push(word);
  }
  const id = head === "gh" ? GH_TOOLS[`${rest[0] ?? ""} ${rest[1] ?? ""}`] : GIT_TOOLS[rest[0] ?? ""];
  if (!id) return `Chamada pronta: tools_find ${JSON.stringify({ modulo: "ai-git-tools" })}.`;
  if (GIT_NO_ARGS.has(id)) return `Chamada pronta: tools_run ${JSON.stringify({ id, args: {} })}.`;
  return `Chamada pronta: tools_run {"id":"${id}","args":{...}} (os parâmetros aparecem em tools_find ${JSON.stringify({ q: id })}).`;
}

/** True when the words start (after VAR=value assignments) with git or gh, and it is not a help command. */
function runsGit(words) {
  let i = 0;
  while (i < words.length && /^[a-z_][a-z0-9_]*=/.test(words[i])) i++;
  const head = (words[i] ?? "").split(/[\\/]/).pop().replace(/\.exe$/, "");
  if (!GIT_COMMANDS.includes(head)) return false;
  const rest = words.slice(i + 1);
  if (rest.length > 0 && GIT_HELP_WORDS.includes(rest[0])) return false;
  return !rest.includes("--help");
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
    const script = scriptFile(tokens);
    if (!script) continue;
    const rel = relativeToVault(normalizePath(script.file, cwd), env.vault);
    if (rel === undefined) continue;
    const segments = rel.split("/");
    if (folders.some((glob) => insideFolder(segments.slice(0, -1), glob))) {
      const args = { path: relativeKeepCase(script.file, { ...env, cwd }) ?? rel };
      if (script.args.length > 0) args.args = script.args;
      return `${MESSAGES["ai-scripts"]} Chamada pronta: tools_run ${JSON.stringify({ id: "ecosystem_run_script", args })}.`;
    }
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

/** The script file a "python x.py" style command runs, with the arguments after it, or undefined. */
function scriptFile(tokens) {
  let i = 0;
  while (i < tokens.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i]) || tokens[i] === "&")) i++;
  const runner = (tokens[i] ?? "").replace(/\\/g, "/").split("/").pop().toLowerCase().replace(/\.exe$/, "");
  if (!SCRIPT_RUNNERS.includes(runner)) return undefined;

  const found = (j) => (tokens[j] ? { file: tokens[j], args: tokens.slice(j + 1) } : undefined);
  const powershell = runner === "pwsh" || runner === "powershell";
  for (let j = i + 1; j < tokens.length; j++) {
    const token = tokens[j];
    const lower = token.toLowerCase();
    if (powershell) {
      if (lower === "-file" || lower === "-f") return found(j + 1);
      if (!token.startsWith("-") && lower.endsWith(".ps1")) return found(j);
      continue;
    }
    if (token === "-m" || token === "-c" || token === "-e" || token === "--eval" || token === "--print") return undefined;
    if (!token.startsWith("-")) return found(j);
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
  const target = relativeKeepCase(filePath, env) ?? rel;
  const call = { id: "create_note_from_template", args: { template_id: "<molde>", data: {}, target_path: target } };
  return `${MESSAGES["ai-templates"]} Chamadas prontas: tools_find ${JSON.stringify({ kind: "template" })} para achar o molde e tools_run ${JSON.stringify(call)}.`;
}

// ---------------------------------------------------------------------------
// Paths and globs
// ---------------------------------------------------------------------------

function isAbsolutePath(p) {
  return /^[A-Za-z]:[\\/]/.test(p) || p.startsWith("/") || p.startsWith("\\\\");
}

/** Absolute, forward-slash path without "." / ".." segments (lowercase on Windows unless keepCase). */
function normalizePath(p, cwd, keepCase = false) {
  let value = p.replace(/\\/g, "/");
  // Git Bash style drive paths (/c/Users/x) on Windows.
  if (WINDOWS) value = value.replace(/^\/([A-Za-z])(?=\/|$)/, (_, drive) => `${drive.toUpperCase()}:`);
  if (!isAbsolutePath(value)) value = `${cwd.replace(/\\/g, "/")}/${value}`;
  let out = path.posix.normalize(value);
  if (out.length > 1) out = out.replace(/\/+$/, "");
  return WINDOWS && !keepCase ? out.toLowerCase() : out;
}

/** The vault-relative path with its own letter case ("" for the vault, undefined outside it). */
function relativeKeepCase(p, env) {
  const abs = normalizePath(p, env.cwd, true);
  const compared = WINDOWS ? abs.toLowerCase() : abs;
  if (compared === env.vault) return "";
  if (compared.length === abs.length && compared.startsWith(`${env.vault}/`)) return abs.slice(env.vault.length + 1);
  return undefined;
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
// despacho (PreToolUse): the protection of every module in one process
// ---------------------------------------------------------------------------

/** Same table as PROTECTION_SPECS in hook-specs.ts (a test keeps them in sync). */
const PROTECTION_MODULES = [
  ["ai-vault-search", "Grep|Glob|Bash|PowerShell"],
  ["environment-variables", "Bash|PowerShell"],
  ["ai-scripts", "Bash|PowerShell"],
  ["ai-templates", "Write"],
  ["ai-git-tools", "Bash|PowerShell"],
];

/**
 * Each module is decided by evaluateProtection, as its own hook would. The first block (in the table
 * order) goes through block() once; without a block, the reminders of all matching modules are joined.
 */
function dispatch(stateDir, input) {
  if (!coreIsAlive(stateDir)) return allow();
  const toolName = typeof input.tool_name === "string" ? input.tool_name : "";
  const reminders = [];
  let blocked;
  for (const [id, matcher] of PROTECTION_MODULES) {
    if (!new RegExp(`^(?:${matcher})$`).test(toolName)) continue;
    const state = readJson(stateDir, `modules/${id}.json`);
    if (isObject(state) && state.hooksRemovidos === true) continue;
    const decision = evaluateProtection(stateDir, id, input);
    if (decision.kind === "remind") reminders.push(decision.message);
    else if (decision.kind === "block" && blocked === undefined) blocked = decision.message;
  }
  if (blocked !== undefined) return block(stateDir, input, blocked);
  if (reminders.length > 0) return respond(remind(reminders.join("\n")));
  allow();
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
  let tool = parts.slice(2).join("__");
  // A wrong argument or unknown id is an answer of the core, not a failure of the module.
  const message = typeof input.error === "string" ? input.error.trim() : "";
  if (/^(Invalid arguments|Unknown tool)/.test(message)) return allow();
  // A batch (calls) has no single id: the tool resolved would be tools_run itself, so nothing is marked.
  if (tool === "tools_run" && isObject(input.tool_input) && Array.isArray(input.tool_input.calls)) return allow();
  // A failure inside tools_run belongs to the module of the tool it ran.
  if (tool === "tools_run" && isObject(input.tool_input) && typeof input.tool_input.id === "string") tool = input.tool_input.id.trim();
  const tools = readJson(stateDir, "tools.json");
  const moduleId = isObject(tools) ? tools[tool] : undefined;
  if (typeof moduleId !== "string") return allow();
  const failures = readJson(stateDir, "falhas.json");
  const next = isObject(failures) ? failures : {};
  next[moduleId] = Date.now();
  writeJson(stateDir, "falhas.json", next);
  allow();
}

// ---------------------------------------------------------------------------
// resumo (SessionStart)
// ---------------------------------------------------------------------------

/** At the start of a session: one short line with the active and the pending modules (at most 300 characters). */
function summary(stateDir, input) {
  if (process.env.AI_ECOSYSTEM_HOOKS === "off") return allow();
  if (input.hook_event_name !== "SessionStart") return allow();
  if (!coreIsAlive(stateDir)) return allow();
  // With the core still pending, the setup hook already talks to the agent.
  const core = readJson(stateDir, "modules/ai-ecosystem.json");
  if (!isObject(core) || core.estado !== "configurado") return allow();

  let files;
  try {
    files = fs.readdirSync(path.join(stateDir, "modules")).sort();
  } catch {
    return allow();
  }
  const active = [];
  const pending = [];
  for (const file of files) {
    if (!file.endsWith(".json") || file.endsWith(".configurado.json")) continue;
    const id = file.slice(0, -5);
    if (id === "ai-ecosystem") continue;
    const state = readJson(stateDir, `modules/${file}`);
    if (!isObject(state)) continue;
    if (state.estado === "configurado") active.push(id);
    else if (state.estado === "pendente_configuracao") pending.push(id);
  }
  if (active.length === 0 && pending.length === 0) return allow();

  const parts = ["AI Ecosystem ativo."];
  if (active.length > 0) parts.push(`Módulos: ${active.join(", ")}.`);
  if (pending.length > 0) {
    parts.push(`Pendentes: ${pending.map((id) => `${id} (skill configurar-${id})`).join(", ")}.`);
  }
  parts.push("Ache tools com tools_find; ecosystem_status só se precisar de detalhes.");
  let text = parts.join(" ");
  if (text.length > 300) text = `${text.slice(0, 299)}…`;
  respond({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: text } });
}
