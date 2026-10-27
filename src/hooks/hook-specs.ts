// Which Claude Code hook entries the plugin writes, and how their command looks.
// Pure Node (no "obsidian" import).
import { ECOSYSTEM_ID } from "../types";

export type HookEvent = "PreToolUse" | "PostToolUseFailure" | "SessionStart" | "UserPromptSubmit";
// "execucao" is retired: no entry is written any more, the type stays so that entries from older versions are recognized and removed.
// "despacho" is the single PreToolUse entry that runs the protection of every module in one process (see DISPATCH_SPEC).
export type HookType = "protecao" | "setup" | "falha" | "aprovacao" | "execucao" | "resumo" | "despacho";

export const HOOK_SCRIPT_NAME = "ai-ecosystem-hook.mjs";
/** Seconds Claude Code waits for the script (a timeout never blocks the tool call). */
export const HOOK_TIMEOUT_SECONDS = 10;

export interface HookSpec {
  module: string;
  type: HookType;
  event: HookEvent;
  /** Absent for events without a matcher (SessionStart, UserPromptSubmit). */
  matcher?: string;
}

/** Protection hooks by module. Modules not listed here (Telegram...) have no protection hook. */
const PROTECTION_SPECS: Record<string, Pick<HookSpec, "event" | "matcher">> = {
  "ai-vault-search": { event: "PreToolUse", matcher: "Grep|Glob|Bash|PowerShell" },
  "environment-variables": { event: "PreToolUse", matcher: "Bash|PowerShell" },
  "ai-scripts": { event: "PreToolUse", matcher: "Bash|PowerShell" },
  "ai-templates": { event: "PreToolUse", matcher: "Write" },
  "ai-git-tools": { event: "PreToolUse", matcher: "Bash|PowerShell" },
};

/** Every tool name the protection hooks look at, joined as one matcher (Grep|Glob|Bash|PowerShell|Write). */
export const DISPATCH_MATCHER = Array.from(new Set(Object.values(PROTECTION_SPECS).flatMap((spec) => (spec.matcher ?? "").split("|")))).join("|");

/**
 * One entry that runs the protection of every module in a single process (type despacho), instead of
 * one Node process per protection hook. Its decisions are the same as the separate hooks'. Not in CORE_SPECS.
 */
export const DISPATCH_SPEC: HookSpec = { module: ECOSYSTEM_ID, type: "despacho", event: "PreToolUse", matcher: DISPATCH_MATCHER };

/**
 * The merge approval of AI Git Tools: always on (whatever the mode of the module's protection
 * hook), it makes Claude Code ask the user before git_pr_merge runs.
 */
export const APPROVAL_SPEC: HookSpec = {
  module: "ai-git-tools",
  type: "aprovacao",
  event: "PreToolUse",
  matcher: "mcp__.*__git_pr_merge",
};

/** No module installs an approval entry any more (the merge question was removed); kept for the hook manager. */
export function approvalSpecs(_moduleId: string): HookSpec[] {
  return [];
}

/** Every permanent entry of a module: its protection hook and its approval hooks. */
export function moduleHookSpecs(moduleId: string): HookSpec[] {
  const protection = protectionSpec(moduleId);
  return [...(protection ? [protection] : []), ...approvalSpecs(moduleId)];
}

/** The core's own entry: marks MCP tool failures so the protection hooks step aside. */
export const CORE_FAILURE_SPEC: HookSpec = {
  module: ECOSYSTEM_ID,
  type: "falha",
  event: "PostToolUseFailure",
  matcher: "mcp__.*",
};

/** The core entry: short summary of the active modules at the start of a session. */
export const CORE_SUMMARY_SPEC: HookSpec = {
  module: ECOSYSTEM_ID,
  type: "resumo",
  event: "SessionStart",
};

/** Every entry the core installs on its own (once Node.js is found). */
export const CORE_SPECS: readonly HookSpec[] = [CORE_FAILURE_SPEC, CORE_SUMMARY_SPEC];

/** Ids of the modules that have a protection hook. */
export function protectionModuleIds(): string[] {
  return Object.keys(PROTECTION_SPECS);
}

export function protectionSpec(moduleId: string): HookSpec | undefined {
  const spec = PROTECTION_SPECS[moduleId];
  return spec ? { module: moduleId, type: "protecao", ...spec } : undefined;
}

/** Events of the temporary setup hook: a new session and any message of a session already open. */
export const SETUP_EVENTS: HookEvent[] = ["SessionStart", "UserPromptSubmit"];

/** The temporary entries (SessionStart and UserPromptSubmit) that send the agent to the module's setup skill. */
export function setupSpecs(moduleId: string): HookSpec[] {
  return SETUP_EVENTS.map((event) => ({ module: moduleId, type: "setup", event }));
}

/** Vault path with forward slashes and no trailing slash (works in Git Bash and PowerShell). */
export function toSlashPath(p: string): string {
  const slashed = p.replace(/\\/g, "/");
  return slashed.length > 1 ? slashed.replace(/\/+$/, "") : slashed;
}

export function hookScriptPath(vaultPath: string): string {
  return `${toSlashPath(vaultPath)}/.claude/ai-ecosystem/hooks/${HOOK_SCRIPT_NAME}`;
}

export function buildCommand(vaultPath: string, module: string, type: HookType): string {
  return `node "${hookScriptPath(vaultPath)}" ${module} ${type}`;
}

export interface ParsedCommand {
  module: string;
  type: HookType;
}

const COMMAND_PATTERN = /ai-ecosystem-hook\.mjs"?\s+([a-z0-9][a-z0-9-]*)\s+(protecao|setup|falha|aprovacao|execucao|resumo|despacho)(?=\s|$)/;

/** Reads "<module> <type>" from a plugin command. Undefined when the command is not ours. */
export function parseCommand(command: unknown): ParsedCommand | undefined {
  if (typeof command !== "string") return undefined;
  const match = COMMAND_PATTERN.exec(command);
  if (!match?.[1] || !match[2]) return undefined;
  return { module: match[1], type: match[2] as HookType };
}
