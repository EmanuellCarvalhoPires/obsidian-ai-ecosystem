// A real Ecosystem (MCP server, registry, hooks, setup) over a temporary vault, for the setup tests.
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { Ecosystem } from "../../src/core/ecosystem";
import { protectionSpec } from "../../src/hooks/hook-specs";
import { NodeChecker } from "../../src/hooks/node-check";
import type { Lang } from "../../src/i18n";
import { createClient } from "../../src/server/auth";
import { normalizeSettings } from "../../src/settings/settings-store";
import type { AIEcosystemSettings, HubModuleRegistration, SetupHandler } from "../../src/types";
import { makeVault, nodeDetector, removeVault, writeFile } from "../runner/helpers";

export interface SetupRig {
  eco: Ecosystem;
  vault: string;
  base: string;
  token: string;
  settings: AIEcosystemSettings;
  /** Plugin ids the fake Obsidian reports as enabled. */
  enabled: Set<string>;
  saves: number;
  /** Folders announced to the user (the Obsidian notice) by the guided setup. */
  announced: string[][];
  language: { current: Lang };
}

export interface RigOptions {
  vault?: string;
  /** Default true. */
  node?: boolean;
  language?: Lang;
  handlerTimeoutMs?: number;
  clientName?: string;
  /** Called with the vault before the Ecosystem starts (to prepare files). */
  prepare?: (vault: string) => void;
}

const running: SetupRig[] = [];

export async function startRig(options: RigOptions = {}): Promise<SetupRig> {
  const vault = options.vault ?? makeVault();
  options.prepare?.(vault);
  const { record, token } = createClient(options.clientName ?? "Claude Code");
  const settings = normalizeSettings({});
  settings.port = 0;
  settings.alternativePort = 0;
  settings.clients = [record];
  const rig = { vault, token, settings, enabled: new Set<string>(), saves: 0, announced: [], language: { current: options.language ?? "en" } } as unknown as SetupRig;
  const available = options.node ?? true;
  rig.eco = new Ecosystem({
    vaultBasePath: vault,
    vaultName: "TestVault",
    version: "1.0.0",
    getSettings: () => settings,
    trigger: () => undefined,
    getDeclaredScripts: () => [],
    importClients: async () => 0,
    detector: nodeDetector(),
    configDir: ".obsidian",
    language: () => rig.language.current,
    setupHandlerTimeoutMs: options.handlerTimeoutMs,
    saveSettings: async () => {
      rig.saves++;
    },
    onScriptFoldersAdded: (folders) => rig.announced.push(folders),
    isPluginEnabled: (id) => rig.enabled.has(id),
    hooks: {
      nodeChecker: new NodeChecker(async () => (available ? { available: true, version: "v22.0.0" } : { available: false })),
      heartbeatIntervalMs: 50,
      disableCheckDelayMs: 20,
      ruleDebounceMs: 10,
    },
  });
  const status = await rig.eco.start();
  if (!status.running) throw new Error("server did not start");
  rig.base = `http://127.0.0.1:${status.port}`;
  await rig.eco.hooks?.whenReady();
  await rig.eco.setup?.whenIdle();
  running.push(rig);
  return rig;
}

export async function stopRigs(): Promise<void> {
  for (const rig of running.splice(0)) {
    await rig.eco.unload();
    removeVault(rig.vault);
  }
}

/** Stops the Ecosystem of a rig but keeps its vault, to start another one over the same files. */
export async function restartRig(rig: SetupRig, options: RigOptions = {}): Promise<SetupRig> {
  await rig.eco.unload();
  running.splice(running.indexOf(rig), 1);
  return startRig({ ...options, vault: rig.vault });
}

let rpcId = 0;

export async function rpc(r: SetupRig, method: string, params?: unknown, headers: Record<string, string> = {}): Promise<{ json: any; headers: Headers }> {
  const res = await fetch(`${r.base}/mcp`, {
    method: "POST",
    headers: { Authorization: `Bearer ${r.token}`, "Content-Type": "application/json", Accept: "application/json", ...headers },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
  });
  return { json: await res.json(), headers: res.headers };
}

/** An MCP session that identifies itself as the given client. */
export async function session(r: SetupRig, clientName: string): Promise<Record<string, string>> {
  const init = await rpc(r, "initialize", { protocolVersion: "2025-06-18", clientInfo: { name: clientName, version: "1" } });
  return { "Mcp-Session-Id": init.headers.get("mcp-session-id") ?? "" };
}

export const claudeSession = (r: SetupRig) => session(r, "claude-code");
export const antigravitySession = (r: SetupRig) => session(r, "antigravity");

export async function toolNames(r: SetupRig, headers: Record<string, string> = {}): Promise<string[]> {
  const listed = await rpc(r, "tools/list", undefined, headers);
  return (listed.json.result.tools as Array<{ name: string }>).map((t) => t.name);
}

/** Calls a tool and parses its JSON text. */
export async function callTool(r: SetupRig, name: string, args: Record<string, unknown>, headers: Record<string, string> = {}): Promise<{ isError: boolean; data: any; text: string }> {
  const res = await rpc(r, "tools/call", { name, arguments: args }, headers);
  const result = res.json.result;
  const text = String(result?.content?.[0]?.text ?? "");
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    data = undefined;
  }
  return { isError: result?.isError === true, data, text };
}

export const setupStatus = async (r: SetupRig, modulo: string, completo = false) =>
  (await callTool(r, "ecosystem_setup_status", completo ? { modulo, completo: true } : { modulo })).data;
export const setupSave = (r: SetupRig, modulo: string, chave: string, valor: unknown) => callTool(r, "ecosystem_setup_save", { modulo, chave, valor });
export const setupComplete = (r: SetupRig, modulo: string) => callTool(r, "ecosystem_setup_complete", { modulo });

/** Answers the core round and finishes it. */
export async function configureCore(r: SetupRig): Promise<void> {
  for (const [key, value] of [
    ["agentes", ["claude-code"]],
    ["modo_hooks", "bloquear"],
    ["claude_md", "recusado"],
  ] as const) {
    const saved = await setupSave(r, "ai-ecosystem", key, value);
    if (saved.isError) throw new Error(saved.text);
  }
  const done = await setupComplete(r, "ai-ecosystem");
  if (done.isError) throw new Error(done.text);
}

export function fakeModule(id: string, name = id, extra: Partial<HubModuleRegistration> = {}): HubModuleRegistration {
  const prefix = id.replace(/-/g, "_");
  return {
    id,
    name,
    version: "1.0.0",
    apiVersion: 1,
    tools: [{ name: `${prefix}_ok`, description: "ok", inputSchema: { type: "object" }, handler: async () => ({ content: [{ type: "text", text: "ok" }] }) }],
    ...extra,
  };
}

/** What the installer does after the download: the plugin is enabled and registers itself. */
export function enableModule(r: SetupRig, id: string, name = id): void {
  r.enabled.add(id);
  r.eco.api.registerModule(fakeModule(id, name));
}

export function registerHandler(r: SetupRig, id: string, handler: SetupHandler): () => void {
  const hooks = r.eco.hooks;
  if (!hooks) throw new Error("no hooks");
  return hooks.service.registerSetupHandler(id, handler);
}

// ---- files -------------------------------------------------------------------

export function stateFile(r: SetupRig, rel: string): any {
  try {
    return JSON.parse(fs.readFileSync(path.join(r.vault, ".claude", "ai-ecosystem", ...rel.split("/")), "utf8"));
  } catch {
    return undefined;
  }
}

export function settingsFile(r: SetupRig, file = "settings.local.json"): any {
  try {
    return JSON.parse(fs.readFileSync(path.join(r.vault, ".claude", file), "utf8"));
  } catch {
    return undefined;
  }
}

export function readVaultFile(r: SetupRig, rel: string): string | undefined {
  try {
    return fs.readFileSync(path.join(r.vault, ...rel.split("/")), "utf8");
  } catch {
    return undefined;
  }
}

export function skillText(r: SetupRig, id: string): string | undefined {
  return readVaultFile(r, `.claude/skills/configurar-${id}/SKILL.md`);
}

/** Every command of the plugin's hook entries in a settings file, as "<event>: <command>". */
export function hookCommands(r: SetupRig, file = "settings.local.json"): string[] {
  const hooks = settingsFile(r, file)?.hooks ?? {};
  const out: string[] = [];
  for (const [event, groups] of Object.entries<any[]>(hooks)) {
    for (const group of groups) for (const hook of group.hooks ?? []) out.push(`${event}: ${hook.command}`);
  }
  return out;
}

export function hasHook(r: SetupRig, module: string, type: string, file = "settings.local.json"): boolean {
  return hookCommands(r, file).some((c) => c.includes(`ai-ecosystem-hook.mjs" ${module} ${type}`));
}

/**
 * Whether a module has its protection hook. Either its own "protecao" entry (older versions), or the
 * single dispatch entry of the core, which covers a module that has a protection, is configured and
 * keeps its hooks.
 */
export function hasProtection(r: SetupRig, module: string, file = "settings.local.json"): boolean {
  if (hasHook(r, module, "protecao", file)) return true;
  if (protectionSpec(module) === undefined) return false;
  const state = stateFile(r, `modules/${module}.json`);
  const covered = state?.estado === "configurado" && state?.hooksRemovidos !== true;
  return covered && hasHook(r, "ai-ecosystem", "despacho", file);
}

/** Runs the real hook script of the vault, like Claude Code does at the start of a session. */
export function runSetupHook(r: SetupRig, module: string): string {
  const script = path.join(r.vault, ".claude", "ai-ecosystem", "hooks", "ai-ecosystem-hook.mjs");
  const result = spawnSync(process.execPath, [script, module, "setup"], {
    input: JSON.stringify({ cwd: r.vault, hook_event_name: "SessionStart", source: "startup" }),
    encoding: "utf8",
    timeout: 15000,
  });
  return result.stdout;
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export { writeFile };
