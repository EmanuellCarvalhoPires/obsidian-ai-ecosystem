// Which Claude Code hook entries the plugin writes, and how their command looks.
// Pure Node (no "obsidian" import).
import { ECOSYSTEM_ID } from "../types";

export type HookEvent = "PreToolUse" | "PostToolUseFailure" | "SessionStart" | "UserPromptSubmit";
export type HookType = "protecao" | "setup" | "falha" | "aprovacao" | "execucao";

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

/** The approval entries of a module (installed and removed together with its protection entry). */
export function approvalSpecs(moduleId: string): HookSpec[] {
  return moduleId === APPROVAL_SPEC.module ? [{ ...APPROVAL_SPEC }] : [];
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

/**
 * The core's approval of tools_run: always on (whatever the modes), it reads the efeito and
 * aprovacao of the tool being run from the tools.db files and makes Claude Code ask the user for
 * efeito "externo" (and whenever it cannot tell). It never allows a call by itself.
 */
export const CORE_RUN_SPEC: HookSpec = {
  module: ECOSYSTEM_ID,
  type: "execucao",
  event: "PreToolUse",
  matcher: "mcp__.*__tools_run",
};

/** Every entry the core installs on its own (once Node.js is found). */
export const CORE_SPECS: readonly HookSpec[] = [CORE_FAILURE_SPEC, CORE_RUN_SPEC];

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

const COMMAND_PATTERN = /ai-ecosystem-hook\.mjs"?\s+([a-z0-9][a-z0-9-]*)\s+(protecao|setup|falha|aprovacao|execucao)(?=\s|$)/;

/** Reads "<module> <type>" from a plugin command. Undefined when the command is not ours. */
export function parseCommand(command: unknown): ParsedCommand | undefined {
  if (typeof command !== "string") return undefined;
  const match = COMMAND_PATTERN.exec(command);
  if (!match?.[1] || !match[2]) return undefined;
  return { module: match[1], type: match[2] as HookType };
}
