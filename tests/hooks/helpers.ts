import { spawn, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { HookPastas, HookMode, ModuleState } from "../../src/hooks/state-dir";
import { makeVault, removeVault } from "../runner/helpers";

/** The real hook script of the repository. */
export const HOOK_SCRIPT = fileURLToPath(new URL("../../src/hooks/script/ai-ecosystem-hook.mjs", import.meta.url));

export function slash(p: string): string {
  return p.replace(/\\/g, "/");
}

export interface HookRun {
  status: number | null;
  stdout: string;
  /** Parsed stdout, undefined when the hook printed nothing. */
  json?: { hookSpecificOutput: Record<string, unknown> };
  /** permissionDecision of a PreToolUse answer. */
  decision?: string;
  reason?: string;
  context?: string;
}

function summarize(status: number | null, stdout: string): HookRun {
  const run: HookRun = { status, stdout };
  if (stdout.trim() !== "") {
    run.json = JSON.parse(stdout) as HookRun["json"];
    const out = run.json?.hookSpecificOutput ?? {};
    run.decision = out.permissionDecision as string | undefined;
    run.reason = out.permissionDecisionReason as string | undefined;
    run.context = out.additionalContext as string | undefined;
  }
  return run;
}

/** A temporary vault with the state folder and the real hook script in place. */
export class HookWorld {
  readonly vault = makeVault();
  readonly stateDir = path.join(this.vault, ".claude", "ai-ecosystem");
  readonly script = path.join(this.stateDir, "hooks", "ai-ecosystem-hook.mjs");

  constructor() {
    fs.mkdirSync(path.join(this.stateDir, "hooks"), { recursive: true });
    fs.mkdirSync(path.join(this.stateDir, "modules"), { recursive: true });
    fs.copyFileSync(HOOK_SCRIPT, this.script);
    this.config({});
    this.heartbeat();
    this.pastas({});
    this.hosts([]);
  }

  cleanup(): void {
    removeVault(this.vault);
  }

  /** Absolute path inside the vault. */
  abs(...parts: string[]): string {
    return path.join(this.vault, ...parts);
  }

  json(rel: string, value: unknown): void {
    const file = path.join(this.stateDir, ...rel.split("/"));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value));
  }

  readJson<T = unknown>(rel: string): T | undefined {
    try {
      return JSON.parse(fs.readFileSync(path.join(this.stateDir, ...rel.split("/")), "utf8")) as T;
    } catch {
      return undefined;
    }
  }

  config(extra: { modos?: Record<string, HookMode>; configDir?: string }): void {
    this.json("config.json", { schemaVersion: 1, vaultPath: slash(this.vault), settingsFile: "settings.local.json", modos: {}, ...extra });
  }

  /** Writes the heartbeat `ageMs` old; `null` removes the file. */
  heartbeat(ageMs: number | null = 0): void {
    const file = path.join(this.stateDir, "heartbeat");
    if (ageMs === null) fs.rmSync(file, { force: true });
    else fs.writeFileSync(file, String(Date.now() - ageMs));
  }

  module(id: string, estado: ModuleState["estado"] = "configurado"): void {
    this.json(`modules/${id}.json`, { estado, origem: "catalogo", atualizadoEm: new Date().toISOString(), nome: id, respostas: {} });
  }

  pastas(pastas: Partial<HookPastas>): void {
    this.json("pastas.json", { scripts: [], templates: [], foraDoIndice: [], notasDeTools: [], ...pastas });
  }

  hosts(hosts: string[]): void {
    this.json("hosts.json", { hosts });
  }

  /** Runs the hook with a PreToolUse-like input. */
  run(moduleId: string, type: string, input: Record<string, unknown>, env: Record<string, string> = {}): HookRun {
    const result = spawnSync(process.execPath, [this.script, moduleId, type], {
      input: JSON.stringify({ cwd: this.vault, ...input }),
      encoding: "utf8",
      env: { ...process.env, AI_ECOSYSTEM_HOOKS: "", ...env },
      timeout: 15000,
    });
    return summarize(result.status, result.stdout);
  }

  /** Shortcut for a tool call of a protection hook. */
  tool(moduleId: string, toolName: string, toolInput: Record<string, unknown>, extra: Record<string, unknown> = {}, env: Record<string, string> = {}): HookRun {
    return this.run(moduleId, "protecao", { tool_name: toolName, tool_input: toolInput, ...extra }, env);
  }
}

/** Starts the hook without closing its stdin, to see the internal guard end it. */
export function runWithOpenStdin(world: HookWorld, moduleId: string, type: string): Promise<{ code: number | null; ms: number; stdout: string }> {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, [world.script, moduleId, type], { stdio: ["pipe", "pipe", "ignore"] });
    let stdout = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.on("exit", (code) => resolve({ code, ms: Date.now() - started, stdout }));
  });
}
