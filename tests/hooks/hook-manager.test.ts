import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Heartbeat } from "../../src/hooks/heartbeat";
import { HOOK_SCRIPT_SOURCE } from "../../src/hooks/hook-script";
import { HookManager, NODE_MISSING } from "../../src/hooks/hook-manager";
import type { HookManagerDeps } from "../../src/hooks/hook-manager";
import { NodeChecker } from "../../src/hooks/node-check";
import { StateDir } from "../../src/hooks/state-dir";
import type { HubTool, ModuleInfo, RegisteredTool } from "../../src/types";
import { makeVault, removeVault } from "../runner/helpers";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function tool(name: string, extra: Partial<HubTool> = {}): HubTool {
  return { name, description: name, inputSchema: { type: "object" }, handler: async () => ({ content: [] }), ...extra };
}

function info(id: string, name = id): ModuleInfo {
  return { id, name, version: "1.0.0", apiVersion: 1, registeredAt: 0, routeCount: 0, legacyAliasPaths: [], toolNames: [], promptNames: [], warnings: [] };
}

class FakeRegistry {
  modules: ModuleInfo[] = [];
  tools: RegisteredTool[] = [];
  add(id: string, tools: string[] = [], name = id): void {
    this.modules.push(info(id, name));
    for (const t of tools) this.tools.push({ moduleId: id, tool: tool(t) });
  }
  remove(id: string): void {
    this.modules = this.modules.filter((m) => m.id !== id);
    this.tools = this.tools.filter((t) => t.moduleId !== id);
  }
}

let vault: string;
let registry: FakeRegistry;
let enabled: Set<string>;
let managers: HookManager[];

const nodeOk = () => new NodeChecker(async () => ({ available: true, version: "v22.0.0" }));
const nodeMissing = () => new NodeChecker(async () => ({ available: false }));

function create(overrides: Partial<HookManagerDeps> = {}): HookManager {
  const manager = new HookManager({
    vaultBasePath: vault,
    configDir: ".obsidian",
    listModules: () => registry.modules,
    listTools: () => registry.tools,
    nodeChecker: nodeOk(),
    isPluginEnabled: (id) => enabled.has(id),
    disableCheckDelayMs: 20,
    heartbeatIntervalMs: 30,
    ruleDebounceMs: 10,
    ...overrides,
  });
  managers.push(manager);
  return manager;
}

async function started(overrides: Partial<HookManagerDeps> = {}): Promise<HookManager> {
  const manager = create(overrides);
  manager.start();
  await manager.whenReady();
  return manager;
}

function state(rel: string): any {
  try {
    return JSON.parse(fs.readFileSync(path.join(vault, ".claude", "ai-ecosystem", ...rel.split("/")), "utf8"));
  } catch {
    return undefined;
  }
}

function settings(file = "settings.local.json"): any {
  try {
    return JSON.parse(fs.readFileSync(path.join(vault, ".claude", file), "utf8"));
  } catch {
    return undefined;
  }
}

/** The vault path as the settings write it (forward slashes). */
function vaultSlash(): string {
  return vault.replace(/\\/g, "/");
}

/** The command of a plugin entry for a module and a type, as the settings hold it. */
function commandOf(module: string, type: string): string {
  return `node "${vaultSlash()}/.claude/ai-ecosystem/hooks/ai-ecosystem-hook.mjs" ${module} ${type}`;
}

/** The single dispatch command the core writes. */
function dispatchCommand(): string {
  return commandOf("ai-ecosystem", "despacho");
}

/** The commands of the PreToolUse groups of a settings file. */
function preCommands(file?: string): string[] {
  const groups: Array<{ hooks?: Array<{ command?: unknown }> }> = settings(file)?.hooks?.PreToolUse ?? [];
  return groups.flatMap((group) => (group.hooks ?? []).map((hook) => String(hook.command)));
}

/** The dispatch commands of a settings file. */
function dispatchCommands(file?: string): string[] {
  return preCommands(file).filter((c) => c.endsWith(" ai-ecosystem despacho"));
}

/** Protection commands of the older format (one per module). */
function legacyCommands(): string[] {
  return preCommands().filter((c) => c.endsWith(" protecao"));
}

/** The entries of a module as the status shows them. */
function installedOf(manager: HookManager, id: string) {
  return manager.getStatus().modules.find((m) => m.id === id)?.installed ?? [];
}

/** Writes the setup state of a module, as the core writes it (the hook script reads the same file). */
function writeState(id: string, estado: string, origem = "legado"): void {
  const dir = path.join(vault, ".claude", "ai-ecosystem", "modules");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify({ estado, origem, atualizadoEm: "2026-10-21T00:00:00.000Z", respostas: {} }));
}

const mineHook = { type: "command", command: "echo mine" };

/** The settings of a vault from an older version: a protection entry per module, a setup entry and a user's hook. */
function oldSettings(): unknown {
  return {
    hooks: {
      PreToolUse: [
        { matcher: "Bash|PowerShell", hooks: [{ type: "command", command: commandOf("ai-git-tools", "protecao"), timeout: 10 }] },
        { matcher: "Bash|PowerShell", hooks: [{ type: "command", command: commandOf("ai-scripts", "protecao"), timeout: 10 }] },
        { hooks: [mineHook] },
      ],
      SessionStart: [{ hooks: [{ type: "command", command: commandOf("ai-scripts", "setup"), timeout: 10 }] }],
    },
  };
}

/** An old vault: both modules configured and their settings in the old format. Returns the settings file. */
async function oldVault(): Promise<string> {
  (await started()).dispose(); // creates the folders of the vault
  writeState("ai-git-tools", "configurado");
  writeState("ai-scripts", "configurado");
  const file = path.join(vault, ".claude", "settings.local.json");
  fs.writeFileSync(file, JSON.stringify(oldSettings()));
  return file;
}

beforeEach(() => {
  vault = makeVault();
  registry = new FakeRegistry();
  enabled = new Set();
  managers = [];
});
afterEach(() => {
  for (const m of managers) m.dispose();
  removeVault(vault);
});

describe("HookManager.isSetupPending", () => {
  it("is false when no module waits for its setup", async () => {
    const manager = await started();
    expect(manager.isSetupPending()).toBe(false);
  });

  it("is true while a registered module waits for its setup (the core, on its first run)", async () => {
    registry.add("ai-ecosystem");
    const manager = await started();
    expect(manager.isSetupPending()).toBe(true);
  });

  it("is true for a module installed from the catalog before it registers", async () => {
    const manager = await started();
    manager.states.reset("ai-templates", { origem: "catalogo", estado: "pendente_configuracao", nome: "AI Templates" });
    expect(manager.isSetupPending()).toBe(true);
  });

  it("is false again once that module is configured or turned off, even though it never registered", async () => {
    const manager = await started();
    manager.states.reset("ai-templates", { origem: "catalogo", estado: "pendente_configuracao", nome: "AI Templates" });
    manager.states.setEstado("ai-templates", "configurado");
    expect(manager.isSetupPending()).toBe(false);

    manager.states.setEstado("ai-templates", "pendente_configuracao");
    expect(manager.isSetupPending()).toBe(true);
    manager.states.setEstado("ai-templates", "desativado");
    expect(manager.isSetupPending()).toBe(false);
  });
});

describe("HookManager.start", () => {
  it("writes the script, config, empty rule data, tools and the heartbeat", async () => {
    registry.add("ai-ecosystem", ["ecosystem_status"]);
    registry.add("ai-scripts", ["run_script"]);
    await started();

    const root = path.join(vault, ".claude", "ai-ecosystem");
    expect(fs.readFileSync(path.join(root, "hooks", "ai-ecosystem-hook.mjs"), "utf8")).toBe(HOOK_SCRIPT_SOURCE);
    expect(state("config.json")).toEqual({
      schemaVersion: 1,
      vaultPath: vault.replace(/\\/g, "/"),
      settingsFile: "settings.local.json",
      configDir: ".obsidian",
      modos: {},
    });
    expect(state("hosts.json")).toEqual({ hosts: [] });
    expect(state("pastas.json")).toEqual({ scripts: [], templates: [], foraDoIndice: [], notasDeTools: [] });
    expect(state("tools.json")).toEqual({ ecosystem_status: "ai-ecosystem", run_script: "ai-scripts" });
    expect(Math.abs(Date.now() - Number(fs.readFileSync(path.join(root, "heartbeat"), "utf8")))).toBeLessThan(5000);
    expect(fs.existsSync(path.join(root, "backups"))).toBe(true);
  });

  it("restores the script when it was changed, and keeps the stored modes and settings file", async () => {
    await started();
    const script = path.join(vault, ".claude", "ai-ecosystem", "hooks", "ai-ecosystem-hook.mjs");
    fs.writeFileSync(script, "// tampered");
    const config = state("config.json");
    fs.writeFileSync(path.join(vault, ".claude", "ai-ecosystem", "config.json"), JSON.stringify({ ...config, settingsFile: "settings.json", modos: { "ai-scripts": "avisar" } }));
    managers[0]!.dispose();

    await started();
    expect(fs.readFileSync(script, "utf8")).toBe(HOOK_SCRIPT_SOURCE);
    expect(state("config.json")).toMatchObject({ settingsFile: "settings.json", modos: { "ai-scripts": "avisar" } });
  });

  it("installs the core failure entry without asking, in the settings file in use", async () => {
    const manager = await started();
    expect(settings().hooks.PostToolUseFailure).toEqual([
      {
        matcher: "mcp__.*",
        hooks: [{ type: "command", command: `node "${vault.replace(/\\/g, "/")}/.claude/ai-ecosystem/hooks/ai-ecosystem-hook.mjs" ai-ecosystem falha`, timeout: 10 }],
      },
    ]);
    const status = manager.getStatus();
    expect(status.coreInstalled).toBe(true);
    expect(status.node).toEqual({ available: true, version: "v22.0.0", checked: true });
    expect(status.lastError).toBeUndefined();
  });

  it("installs the core summary entry (resumo) on SessionStart, next to the failure entry", async () => {
    await started();
    expect(settings().hooks.SessionStart).toContainEqual({
      hooks: [{ type: "command", command: `node "${vault.replace(/\\/g, "/")}/.claude/ai-ecosystem/hooks/ai-ecosystem-hook.mjs" ai-ecosystem resumo`, timeout: 10 }],
    });
  });

  it("writes no hook entry without Node and says so in the status", async () => {
    const manager = await started({ nodeChecker: nodeMissing() });
    expect(settings()).toBeUndefined();
    expect(manager.getStatus().node).toEqual({ available: false, checked: true });
    expect(manager.getStatus().coreInstalled).toBe(false);
    expect(await manager.installProtection("ai-scripts")).toEqual({ ok: false, error: NODE_MISSING });
    expect(settings()).toBeUndefined();
    expect((await manager.planInstall("ai-scripts")).node.available).toBe(false);
  });

  it("follows a moved vault: the entries get the new path, and the old per-module entry becomes the dispatch entry", async () => {
    registry.add("ai-templates");
    registry.add("ai-scripts");
    const claude = path.join(vault, ".claude");
    fs.mkdirSync(claude, { recursive: true });
    const oldPath = "D:/Old/Cofre/.claude/ai-ecosystem/hooks/ai-ecosystem-hook.mjs";
    fs.writeFileSync(
      path.join(claude, "settings.local.json"),
      JSON.stringify({
        hooks: {
          PreToolUse: [
            { matcher: "Grep|Glob|Bash|PowerShell|Write", hooks: [{ type: "command", command: `node "${oldPath}" ai-ecosystem despacho`, timeout: 10 }] },
            { matcher: "Write", hooks: [{ type: "command", command: `node "${oldPath}" ai-templates protecao`, timeout: 10 }] },
          ],
        },
      }),
    );
    await started();
    expect(dispatchCommands()).toEqual([dispatchCommand()]);
    expect(legacyCommands()).toEqual([]);
    expect(JSON.stringify(settings())).not.toContain("D:/Old");
  });

  it("reports a settings file it cannot parse, without touching it", async () => {
    const claude = path.join(vault, ".claude");
    fs.mkdirSync(claude, { recursive: true });
    fs.writeFileSync(path.join(claude, "settings.local.json"), "{ broken");
    const manager = await started();
    expect(fs.readFileSync(path.join(claude, "settings.local.json"), "utf8")).toBe("{ broken");
    expect(manager.getStatus().lastError).toContain("not valid JSON");
  });
});

describe("Heartbeat", () => {
  it("writes now, keeps writing and deletes the file on stop", async () => {
    const dir = new StateDir(vault);
    dir.ensure();
    const beat = new Heartbeat(dir, 20);
    beat.start();
    const first = Number(dir.readText("heartbeat"));
    expect(first).toBeGreaterThan(0);
    await sleep(80);
    expect(Number(dir.readText("heartbeat"))).toBeGreaterThan(first);
    beat.stop();
    expect(dir.exists("heartbeat")).toBe(false);
    beat.stop();
  });

  it("is deleted by dispose, which leaves the hook entries in place", async () => {
    const manager = await started();
    expect(state("config.json")).toBeDefined();
    manager.dispose();
    expect(fs.existsSync(path.join(vault, ".claude", "ai-ecosystem", "heartbeat"))).toBe(false);
    expect(settings().hooks.PostToolUseFailure).toHaveLength(1);
  });
});

describe("module setup states", () => {
  it("starts the core as nucleo and pending its first setup, and keeps a state that already exists", async () => {
    registry.add("ai-ecosystem");
    const manager = await started();
    expect(state("modules/ai-ecosystem.json")).toMatchObject({ estado: "pendente_configuracao", origem: "nucleo" });
    expect(manager.service.getModuleState("ai-ecosystem")).toBe("pendente_configuracao");

    manager.dispose();
    const file = path.join(vault, ".claude", "ai-ecosystem", "modules", "ai-ecosystem.json");
    fs.writeFileSync(file, JSON.stringify({ ...state("modules/ai-ecosystem.json"), estado: "configurado" }));
    const again = await started();
    expect(again.service.getModuleState("ai-ecosystem")).toBe("configurado");
  });

  it("makes the modules of the first run legacy: configured, with protection hooks installed on its own", async () => {
    registry.add("ai-scripts", [], "AI Scripts");
    const manager = await started();
    registry.add("ai-templates", [], "AI Templates");
    manager.handleRegistryChange({ type: "module-registered", moduleId: "ai-templates" });
    await manager.whenReady();

    expect(state("modules/ai-scripts.json")).toMatchObject({ estado: "configurado", origem: "legado", nome: "AI Scripts" });
    expect(state("modules/ai-templates.json")).toMatchObject({ estado: "configurado", origem: "legado" });
    expect(dispatchCommands()).toEqual([dispatchCommand()]);
    expect(legacyCommands()).toEqual([]);
    expect(installedOf(manager, "ai-scripts").map((e) => e.type)).toEqual(["protecao"]);
    expect(installedOf(manager, "ai-templates").map((e) => e.type)).toEqual(["protecao"]);
    expect(state("config.json").modos).toEqual({});
  });

  it("installs the missing entries on load for modules already recorded as legacy or manual", async () => {
    registry.add("ai-scripts");
    registry.add("telegram-ai-gateway");
    const first = await started();
    first.dispose();
    fs.rmSync(path.join(vault, ".claude", "settings.local.json"));
    fs.writeFileSync(
      path.join(vault, ".claude", "ai-ecosystem", "modules", "ai-vault-search.json"),
      JSON.stringify({ estado: "configurado", origem: "manual", atualizadoEm: "2026-10-21T00:00:00.000Z", respostas: {} }),
    );
    registry.add("ai-vault-search");
    expect(settings()).toBeUndefined();

    await started();
    expect(dispatchCommands()).toEqual([dispatchCommand()]);
    expect(legacyCommands()).toEqual([]);
    expect(preCommands().some((c) => c.includes("telegram-ai-gateway"))).toBe(false);
  });

  it("does not reinstall on its own after the user removed the hooks, and the button brings them back", async () => {
    registry.add("ai-scripts");
    const first = await started();
    expect(dispatchCommands()).toHaveLength(1);
    expect(installedOf(first, "ai-scripts").map((e) => e.type)).toEqual(["protecao"]);

    expect(first.removeByUser("ai-scripts")).toEqual({ ok: true, changed: true });
    expect(state("modules/ai-scripts.json").hooksRemovidos).toBe(true);
    first.dispose();

    const second = await started();
    expect(dispatchCommands()).toEqual([]);
    expect(installedOf(second, "ai-scripts")).toEqual([]);
    expect(state("modules/ai-scripts.json").hooksRemovidos).toBe(true);

    await second.installProtection("ai-scripts");
    expect(dispatchCommands()).toHaveLength(1);
    expect(installedOf(second, "ai-scripts").map((e) => e.type)).toEqual(["protecao"]);
    expect(state("modules/ai-scripts.json").hooksRemovidos).toBeUndefined();
  });

  it("writes no protection hook for a legacy module when Node is missing", async () => {
    registry.add("ai-scripts");
    await started({ nodeChecker: nodeMissing() });
    expect(settings()).toBeUndefined();
    expect(state("modules/ai-scripts.json")).toMatchObject({ estado: "configurado", origem: "legado" });
    expect(state("modules/ai-scripts.json").hooksRemovidos).toBeUndefined();
  });

  it("treats a module without state, on a later run, as manual; existing states stay", async () => {
    registry.add("ai-scripts");
    const first = await started();
    first.dispose();
    fs.writeFileSync(
      path.join(vault, ".claude", "ai-ecosystem", "modules", "ai-scripts.json"),
      JSON.stringify({ estado: "pendente_configuracao", origem: "catalogo", atualizadoEm: "2026-10-21T00:00:00.000Z", respostas: { a: 1 } }),
    );
    registry.add("ai-vault-search");

    const second = await started();
    expect(state("modules/ai-vault-search.json")).toMatchObject({ estado: "configurado", origem: "manual" });
    expect(state("modules/ai-scripts.json")).toMatchObject({ estado: "pendente_configuracao", origem: "catalogo", respostas: { a: 1 } });
    expect(second.service.getModuleState("ai-scripts")).toBe("pendente_configuracao");
    expect(second.service.getModuleState("nobody")).toBeUndefined();
  });

  it("marks a module disabled, and removes its hooks, when its plugin is turned off", async () => {
    registry.add("ai-scripts");
    enabled.add("ai-scripts");
    const manager = await started();
    expect((await manager.installProtection("ai-scripts")).ok).toBe(true);
    expect(dispatchCommands()).toHaveLength(1);

    enabled.delete("ai-scripts");
    registry.remove("ai-scripts");
    manager.handleRegistryChange({ type: "module-unregistered", moduleId: "ai-scripts" });
    await sleep(80);

    expect(state("modules/ai-scripts.json").estado).toBe("desativado");
    // It was the only module that needed the dispatch entry, so the entry goes with it.
    expect(dispatchCommands()).toEqual([]);
    expect(JSON.stringify(settings())).toContain("ai-ecosystem falha");
    expect(manager.getStatus().modules.find((m) => m.id === "ai-scripts")).toMatchObject({ estado: "desativado", registered: false });
  });

  it("does nothing when the plugin is still enabled (Obsidian closing or the core reloading)", async () => {
    registry.add("ai-scripts");
    enabled.add("ai-scripts");
    const manager = await started();
    await manager.installProtection("ai-scripts");

    registry.remove("ai-scripts");
    manager.handleRegistryChange({ type: "module-unregistered", moduleId: "ai-scripts" });
    await sleep(80);

    expect(state("modules/ai-scripts.json").estado).toBe("configurado");
    expect(dispatchCommands()).toHaveLength(1);
  });

  it("does nothing when the module registered again before the check, or after dispose", async () => {
    registry.add("ai-scripts");
    const manager = await started();
    manager.handleRegistryChange({ type: "module-unregistered", moduleId: "ai-scripts" });
    await sleep(80);
    expect(state("modules/ai-scripts.json").estado).toBe("configurado");

    registry.remove("ai-scripts");
    manager.handleRegistryChange({ type: "module-unregistered", moduleId: "ai-scripts" });
    manager.dispose();
    await sleep(80);
    expect(state("modules/ai-scripts.json").estado).toBe("configurado");
  });

  it("brings a disabled module back to configured when it registers again", async () => {
    registry.add("ai-scripts");
    const manager = await started();
    registry.remove("ai-scripts");
    manager.handleRegistryChange({ type: "module-unregistered", moduleId: "ai-scripts" });
    await sleep(80);
    expect(state("modules/ai-scripts.json").estado).toBe("desativado");

    registry.add("ai-scripts");
    manager.handleRegistryChange({ type: "module-registered", moduleId: "ai-scripts" });
    expect(state("modules/ai-scripts.json").estado).toBe("configurado");
  });
});

describe("protection hooks of a module", () => {
  /** The PreToolUse groups of the modules. */
  const modulePre = (): any[] => settings()?.hooks?.PreToolUse ?? [];

  it("does not install an approval for tools_run", async () => {
    const manager = await started();
    expect(settings().hooks.PreToolUse).toBeUndefined();
    expect(manager.getStatus()).not.toHaveProperty("coreRunApprovalInstalled");
  });

  it("removes the execucao entry of an older version and keeps the entries of the user", async () => {
    const claude = path.join(vault, ".claude");
    fs.mkdirSync(claude, { recursive: true });
    const oldRun = {
      matcher: "mcp__.*__tools_run",
      hooks: [{ type: "command", command: `node "${vault.replace(/\\/g, "/")}/.claude/ai-ecosystem/hooks/ai-ecosystem-hook.mjs" ai-ecosystem execucao`, timeout: 10 }],
    };
    const mine = { hooks: [{ type: "command", command: "echo oi" }] };
    fs.writeFileSync(path.join(claude, "settings.local.json"), JSON.stringify({ hooks: { PreToolUse: [oldRun, mine] } }));

    await started();
    expect(settings().hooks.PreToolUse).toEqual([mine]);
    expect(JSON.stringify(settings())).not.toContain("execucao");
    expect(JSON.stringify(settings())).toContain("ai-ecosystem falha");
  });

  it("installs one dispatch entry for two modules, once; removing the last module takes it out", async () => {
    registry.add("ai-templates");
    registry.add("ai-scripts");
    const manager = await started();
    // Both modules are legacy, so the core already installed the single dispatch entry.
    expect(dispatchCommands()).toEqual([dispatchCommand()]);
    expect(legacyCommands()).toEqual([]);
    expect(installedOf(manager, "ai-templates").map((e) => e.type)).toEqual(["protecao"]);

    expect(await manager.installProtection("ai-templates")).toEqual({ ok: true, changed: false });
    expect(dispatchCommands()).toHaveLength(1);

    // The other module still needs the entry: only the line of the removed module goes.
    expect(manager.removeByUser("ai-templates")).toEqual({ ok: true, changed: false });
    expect(dispatchCommands()).toHaveLength(1);
    expect(installedOf(manager, "ai-templates")).toEqual([]);
    expect(installedOf(manager, "ai-scripts").map((e) => e.type)).toEqual(["protecao"]);

    expect(manager.removeByUser("ai-scripts")).toEqual({ ok: true, changed: true });
    expect(dispatchCommands()).toEqual([]);
    expect(installedOf(manager, "ai-scripts")).toEqual([]);
    // The core's own entries stay.
    expect(JSON.stringify(settings())).toContain("ai-ecosystem falha");
  });

  it("installs only the dispatch entry for AI Git Tools (no merge approval), and keeps it in mode off", async () => {
    const manager = await started();
    registry.add("ai-git-tools");
    manager.handleRegistryChange({ type: "module-registered", moduleId: "ai-git-tools" });
    await manager.whenReady();
    manager.setMode("ai-git-tools", "off");
    expect(await manager.installProtection("ai-git-tools")).toMatchObject({ ok: true });
    const pre = modulePre();
    expect(pre.map((g: { matcher: string }) => g.matcher)).toEqual(["Grep|Glob|Bash|PowerShell|Write"]);
    expect(dispatchCommands()).toEqual([dispatchCommand()]);
    expect(legacyCommands()).toEqual([]);
    expect(JSON.stringify(settings())).not.toContain("git_pr_merge");
    expect(state("config.json").modos["ai-git-tools"]).toBe("off");

    // Reapplying does not duplicate anything.
    expect(await manager.installProtection("ai-git-tools")).toEqual({ ok: true, changed: false });
    expect(dispatchCommands()).toHaveLength(1);
    const row = manager.getStatus().modules.find((m) => m.id === "ai-git-tools")!;
    expect(row.installed.map((e) => e.type).sort()).toEqual(["protecao"]);
    expect(row.mode).toBe("off");

    expect(manager.removeByUser("ai-git-tools")).toEqual({ ok: true, changed: true });
    expect(dispatchCommands()).toEqual([]);
    // The core's own entries stay.
    expect(JSON.stringify(settings())).toContain("ai-ecosystem falha");
  });

  it("writes the default mode avisar of AI Git Tools explicitly, and plans its protection entry", async () => {
    const manager = await started();
    expect(manager.state.getMode("ai-git-tools")).toBe("avisar");
    expect(manager.state.getMode("ai-scripts")).toBe("bloquear");
    expect(state("config.json").modos["ai-git-tools"]).toBeUndefined();

    const plan = await manager.planInstall("ai-git-tools");
    expect(plan.entries.map((e) => [e.matcher, e.command.split(" ").slice(-2).join(" ")])).toEqual([
      ["Grep|Glob|Bash|PowerShell|Write", "ai-ecosystem despacho"],
    ]);

    expect((await manager.installProtection("ai-git-tools")).ok).toBe(true);
    expect(state("config.json").modos).toEqual({ "ai-git-tools": "avisar" });
    // A mode chosen before is never replaced.
    manager.setMode("ai-git-tools", "bloquear");
    await manager.installProtection("ai-git-tools");
    expect(state("config.json").modos["ai-git-tools"]).toBe("bloquear");
    // Other modules keep an implicit "bloquear".
    await manager.installProtection("ai-scripts");
    expect(state("config.json").modos["ai-scripts"]).toBeUndefined();
  });

  it("has no protection hook for modules without a rule (Telegram)", async () => {
    registry.add("telegram-ai-gateway");
    const manager = await started();
    expect(await manager.installProtection("telegram-ai-gateway")).toEqual({ ok: true, changed: false });
    expect(manager.getStatus().modules[0]).toMatchObject({ id: "telegram-ai-gateway", hasProtection: false });
    expect((await manager.planInstall("telegram-ai-gateway")).entries).toEqual([]);
  });

  it("plans exactly what it will write", async () => {
    const manager = await started();
    const plan = await manager.planInstall("environment-variables");
    expect(plan.settingsPath).toBe(path.join(vault, ".claude", "settings.local.json"));
    expect(plan.entries).toEqual([
      {
        event: "PreToolUse",
        matcher: "Grep|Glob|Bash|PowerShell|Write",
        command: dispatchCommand(),
      },
    ]);
    expect(plan.node.available).toBe(true);
  });

  it("surfaces a merger error and writes nothing when the settings are invalid", async () => {
    registry.add("ai-scripts");
    const manager = await started();
    fs.writeFileSync(path.join(vault, ".claude", "settings.local.json"), "{ nope");
    const result = await manager.installProtection("ai-scripts");
    expect(result.ok).toBe(false);
    expect(fs.readFileSync(path.join(vault, ".claude", "settings.local.json"), "utf8")).toBe("{ nope");
    expect(manager.getStatus().lastError).toContain("not valid JSON");
  });

  it("stores the mode of a module in config.json", async () => {
    const manager = await started();
    expect(state("config.json").modos).toEqual({});
    manager.setMode("ai-scripts", "avisar");
    manager.setMode("ai-templates", "off");
    expect(state("config.json").modos).toEqual({ "ai-scripts": "avisar", "ai-templates": "off" });
    registry.add("ai-scripts");
    expect(manager.getStatus().modules.find((m) => m.id === "ai-scripts")?.mode).toBe("avisar");
  });

  it("moves the entries when the settings file changes", async () => {
    registry.add("ai-scripts");
    const manager = await started();
    await manager.installProtection("ai-scripts");
    expect(manager.useSettingsFile("settings.json")).toEqual({ ok: true, changed: true });

    expect(dispatchCommands("settings.json")).toEqual([dispatchCommand()]);
    expect(JSON.stringify(settings("settings.json"))).toContain("ai-ecosystem falha");
    expect(settings("settings.local.json")).toEqual({});
    expect(state("config.json").settingsFile).toBe("settings.json");
    expect(manager.getStatus().settingsFile).toBe("settings.json");
    expect(manager.useSettingsFile("other.json").ok).toBe(false);
  });
});

describe("tools.json", () => {
  it("follows the registry and is only rewritten when it changes", async () => {
    registry.add("ai-scripts", ["run_script"]);
    const manager = await started();
    expect(state("tools.json")).toEqual({ run_script: "ai-scripts" });

    registry.add("ai-templates", ["create_note"]);
    manager.handleRegistryChange({ type: "module-registered", moduleId: "ai-templates" });
    expect(state("tools.json")).toEqual({ run_script: "ai-scripts", create_note: "ai-templates" });

    registry.tools.push({ moduleId: "ai-templates", tool: tool("list_templates") });
    manager.handleRegistryChange({ type: "tools-changed", moduleId: "ai-templates" });
    expect(state("tools.json").list_templates).toBe("ai-templates");

    const file = path.join(vault, ".claude", "ai-ecosystem", "tools.json");
    fs.writeFileSync(file, "marker");
    manager.handleRegistryChange({ type: "prompts-changed", moduleId: "ai-templates" });
    expect(fs.readFileSync(file, "utf8")).toBe("marker");
    registry.remove("ai-templates");
    manager.handleRegistryChange({ type: "module-unregistered", moduleId: "ai-templates" });
    expect(state("tools.json")).toEqual({ run_script: "ai-scripts" });
  });
});

describe("tool visibility and failure markers", () => {
  it("hides the tools of a pending module from Claude Code only", async () => {
    registry.add("ai-templates", ["create_note", "list_secrets_like"]);
    registry.tools.push({ moduleId: "ai-templates", tool: tool("setup_helper", { availableDuringSetup: true }) });
    registry.add("ai-ecosystem", ["ecosystem_status"]);
    const manager = await started();
    fs.writeFileSync(
      path.join(vault, ".claude", "ai-ecosystem", "modules", "ai-templates.json"),
      JSON.stringify({ estado: "pendente_configuracao", origem: "catalogo", atualizadoEm: new Date().toISOString(), respostas: {} }),
    );
    const again = create();
    again.start();

    const find = (name: string) => registry.tools.find((t) => t.tool.name === name)!;
    expect(again.isToolHidden(find("create_note"), "claude-code")).toBe(true);
    expect(again.isToolHidden(find("create_note"), "antigravity")).toBe(false);
    expect(again.isToolHidden(find("create_note"), "other")).toBe(false);
    expect(again.isToolHidden(find("setup_helper"), "claude-code")).toBe(false);
    expect(again.isToolHidden(find("ecosystem_status"), "claude-code")).toBe(false);
    expect(manager.isToolHidden(find("create_note"), "claude-code")).toBe(false);
  });

  it("sets the marker on a failure and clears it on a success", async () => {
    const manager = await started();
    manager.recordToolResult("ai-scripts", true);
    manager.recordToolResult("ai-templates", true);
    expect(Object.keys(state("falhas.json")).sort()).toEqual(["ai-scripts", "ai-templates"]);
    manager.recordToolResult("ai-scripts", false);
    expect(Object.keys(state("falhas.json"))).toEqual(["ai-templates"]);
    manager.recordToolResult("ai-scripts", false);
    manager.dispose();
    manager.recordToolResult("ai-scripts", true);
    expect(Object.keys(state("falhas.json"))).toEqual(["ai-templates"]);
  });
});

describe("hooks service", () => {
  it("merges the rule data of every module into hosts.json and pastas.json, debounced", async () => {
    const manager = await started();
    const { service } = manager;
    service.setRuleData("environment-variables", { hosts: ["Acme.Atlassian.net", "https://api.github.com/repos/acme/"], toolNoteFolders: ["MCP"] });
    service.setRuleData("ai-scripts", { scriptFolders: ["scripts", "Scripts/AI/"] });
    service.setRuleData("ai-templates", { templateTargets: ["Knowledge/Logs/*.md"] });
    service.setRuleData("ai-vault-search", { excludedFolders: ["Anexos", "Arquivo"], toolNoteFolders: ["MCP"] });

    expect(state("hosts.json")).toEqual({ hosts: [] });
    await sleep(80);
    expect(state("hosts.json")).toEqual({ hosts: ["acme.atlassian.net", "api.github.com/repos/acme"] });
    expect(state("pastas.json")).toEqual({
      scripts: ["scripts", "Scripts/AI"],
      templates: ["Knowledge/Logs/*.md"],
      foraDoIndice: ["Anexos", "Arquivo"],
      notasDeTools: ["MCP"],
    });
  });

  it("replaces the data of a module and forgets it when the module goes away", async () => {
    const manager = await started();
    const { service } = manager;
    service.setRuleData("environment-variables", { hosts: ["a.example.com"] });
    service.setRuleData("environment-variables", { hosts: ["b.example.com"] });
    service.setRuleData("ai-scripts", { scriptFolders: ["scripts"] });
    service.flush();
    expect(state("hosts.json").hosts).toEqual(["b.example.com"]);

    manager.handleRegistryChange({ type: "module-unregistered", moduleId: "environment-variables" });
    service.flush();
    expect(state("hosts.json").hosts).toEqual([]);
    expect(state("pastas.json").scripts).toEqual(["scripts"]);
  });

  it("drops what is unsafe or malformed: absolute paths, '..', empty and non-string values", async () => {
    const manager = await started();
    manager.service.setRuleData("ai-scripts", { scriptFolders: ["../outside", "C:/abs", "ok/dir", "  ", 5 as never, "a\\b"] });
    manager.service.setRuleData("environment-variables", { hosts: ["with space", "", "good.example.com", {} as never] });
    manager.service.flush();
    expect(state("pastas.json").scripts).toEqual(["ok/dir", "a/b"]);
    expect(state("hosts.json").hosts).toEqual(["good.example.com"]);
  });

  it("keeps the setup handlers and returns an unregister function", async () => {
    const { service } = await started();
    const handler = { validate: async () => ({ ok: true }) };
    const other = { validate: async () => ({ ok: false }) };
    const off = service.registerSetupHandler("ai-templates", handler);
    expect(service.getSetupHandler("ai-templates")).toBe(handler);
    service.registerSetupHandler("ai-templates", other);
    off();
    expect(service.getSetupHandler("ai-templates")).toBe(other);
    expect(service.getSetupHandler("nobody")).toBeUndefined();
  });
});

describe("temporary setup hook and listener", () => {
  it("writes and removes the setup entry of a module, leaving its protection entry", async () => {
    registry.add("ai-templates");
    const manager = await started();
    expect((await manager.installProtection("ai-templates")).ok).toBe(true);
    expect((await manager.installSetupHook("ai-templates")).ok).toBe(true);

    for (const event of ["SessionStart", "UserPromptSubmit"]) {
      const groups = settings().hooks[event] as any[];
      // SessionStart also carries the core's resumo entry, in a group of its own.
      expect(groups).toHaveLength(event === "SessionStart" ? 2 : 1);
      const setup = groups.find((g) => g.hooks[0].command.includes("ai-templates setup"));
      expect(setup.matcher).toBeUndefined();
      expect(setup.hooks[0].timeout).toBe(10);
    }
    expect(manager.getStatus().modules.find((m) => m.id === "ai-templates")).toMatchObject({ setupHook: true });

    const removed = manager.removeSetupHook("ai-templates");
    expect(removed).toEqual({ ok: true, changed: true });
    // Only the core's resumo entry is left on SessionStart.
    expect(JSON.stringify(settings().hooks.SessionStart)).not.toContain("ai-templates setup");
    expect(JSON.stringify(settings().hooks.SessionStart)).toContain("ai-ecosystem resumo");
    expect(settings().hooks.UserPromptSubmit).toBeUndefined();
    expect(dispatchCommands()).toHaveLength(1);
    expect(manager.removeSetupHook("ai-templates")).toEqual({ ok: true, changed: false });
  });

  it("keeps other hooks on both events and adds only the missing setup entry", async () => {
    registry.add("ai-templates");
    const mine = { hooks: [{ type: "command", command: "echo mine" }] };
    fs.mkdirSync(path.join(vault, ".claude"), { recursive: true });
    fs.writeFileSync(path.join(vault, ".claude", "settings.local.json"), JSON.stringify({ hooks: { SessionStart: [mine], UserPromptSubmit: [mine] } }));
    const manager = await started();
    // A vault from before: only the SessionStart entry exists.
    const { setupSpecs } = await import("../../src/hooks/hook-specs");
    const { SettingsMerger } = await import("../../src/hooks/settings-merger");
    const claude = path.join(vault, ".claude");
    new SettingsMerger(claude, path.join(claude, "ai-ecosystem", "backups"), () => vault).install("settings.local.json", [setupSpecs("ai-templates")[0]!]);
    expect(settings().hooks.UserPromptSubmit).toHaveLength(1);

    expect((await manager.installSetupHook("ai-templates")).ok).toBe(true);
    expect(settings().hooks.UserPromptSubmit).toHaveLength(2);
    // The user's group, the core's resumo group and the setup group.
    expect(settings().hooks.SessionStart).toHaveLength(3);

    manager.removeSetupHook("ai-templates");
    // The user's group and the core's resumo group stay on SessionStart.
    expect(settings().hooks.SessionStart).toHaveLength(2);
    expect(settings().hooks.SessionStart).toContainEqual(mine);
    expect(JSON.stringify(settings().hooks.SessionStart)).toContain("ai-ecosystem resumo");
    expect(settings().hooks.UserPromptSubmit).toEqual([mine]);
  });

  it("writes no setup entry without Node.js", async () => {
    registry.add("ai-templates");
    const manager = await started({ nodeChecker: nodeMissing() });
    expect(await manager.installSetupHook("ai-templates")).toEqual({ ok: false, error: NODE_MISSING });
    expect(JSON.stringify(settings() ?? {})).not.toContain("setup");
  });

  it("tells the listener about registered and disabled modules", async () => {
    registry.add("ai-scripts");
    enabled.add("ai-scripts");
    const events: string[] = [];
    const manager = create();
    manager.setListener({ onModuleRegistered: (id) => events.push(`registered ${id}`), onModuleDisabled: (id) => events.push(`disabled ${id}`) });
    manager.start();
    await manager.whenReady();
    expect(events).toEqual(["registered ai-scripts"]);

    enabled.delete("ai-scripts");
    registry.remove("ai-scripts");
    manager.handleRegistryChange({ type: "module-unregistered", moduleId: "ai-scripts" });
    await sleep(80);
    expect(events).toEqual(["registered ai-scripts", "disabled ai-scripts"]);
  });

  it("puts a disabled catalog module that never finished its setup back to pending", async () => {
    registry.add("ai-scripts");
    const first = await started();
    first.dispose();
    first.removeModule("ai-scripts");
    const file = path.join(vault, ".claude", "ai-ecosystem", "modules", "ai-scripts.json");
    fs.writeFileSync(file, JSON.stringify({ estado: "desativado", origem: "catalogo", atualizadoEm: "2026-10-21T00:00:00.000Z", respostas: {} }));

    const second = await started();
    expect(second.service.getModuleState("ai-scripts")).toBe("pendente_configuracao");
    // Nothing needs the dispatch entry any more: it goes at the start.
    expect(dispatchCommands()).toEqual([]);
    expect(legacyCommands()).toEqual([]);
  });

  it("brings a configured catalog module back to configured, not pending, when its marker exists", async () => {
    registry.add("ai-scripts");
    const first = await started();
    first.dispose();
    const dir = path.join(vault, ".claude", "ai-ecosystem", "modules");
    fs.writeFileSync(path.join(dir, "ai-scripts.json"), JSON.stringify({ estado: "desativado", origem: "catalogo", atualizadoEm: "2026-10-21T00:00:00.000Z", respostas: {} }));
    fs.writeFileSync(path.join(dir, "ai-scripts.configurado.json"), JSON.stringify({ concluidoEm: "2026-10-21T00:00:00.000Z" }));

    const second = await started();
    expect(second.service.getModuleState("ai-scripts")).toBe("configurado");
  });
});

describe("dispatch entry", () => {
  it("replaces the old per-module protection entries with the dispatch entry, and keeps the user's entries", async () => {
    await oldVault();
    const second = await started();
    expect(dispatchCommands()).toEqual([dispatchCommand()]);
    expect(legacyCommands()).toEqual([]);
    // The user's group stays, next to the one dispatch group.
    expect(settings().hooks.PreToolUse).toContainEqual({ hooks: [mineHook] });
    expect(settings().hooks.PreToolUse).toHaveLength(2);
    // A setup entry is not a protection entry: it stays.
    expect(JSON.stringify(settings().hooks.SessionStart)).toContain("ai-scripts setup");
    expect(installedOf(second, "ai-git-tools").map((e) => e.type)).toEqual(["protecao"]);
    expect(installedOf(second, "ai-scripts").map((e) => e.type).sort()).toEqual(["protecao", "setup"]);
  });

  it("runs the migration once: starting again changes nothing in the settings file", async () => {
    const file = await oldVault();
    const first = await started();
    first.dispose();
    const afterFirst = fs.readFileSync(file, "utf8");
    expect(dispatchCommands()).toHaveLength(1);

    await started();
    expect(fs.readFileSync(file, "utf8")).toBe(afterFirst);
    expect(dispatchCommands()).toHaveLength(1);
    expect(legacyCommands()).toEqual([]);
  });

  it("leaves the old entries alone without Node.js, and writes nothing", async () => {
    const file = await oldVault();
    const before = fs.readFileSync(file, "utf8");
    await started({ nodeChecker: nodeMissing() });
    expect(fs.readFileSync(file, "utf8")).toBe(before);
  });

  it("does not show a module whose hooks were removed as installed, and the last removal takes the dispatch entry with it", async () => {
    registry.add("ai-scripts");
    registry.add("ai-templates");
    const manager = await started();
    expect(dispatchCommands()).toHaveLength(1);

    expect(manager.removeByUser("ai-templates")).toEqual({ ok: true, changed: false });
    expect(state("modules/ai-templates.json").hooksRemovidos).toBe(true);
    expect(installedOf(manager, "ai-templates")).toEqual([]);
    expect(installedOf(manager, "ai-scripts").map((e) => e.type)).toEqual(["protecao"]);
    expect(dispatchCommands()).toHaveLength(1);

    expect(manager.removeByUser("ai-scripts")).toEqual({ ok: true, changed: true });
    expect(installedOf(manager, "ai-scripts")).toEqual([]);
    expect(dispatchCommands()).toEqual([]);
    expect(JSON.stringify(settings())).toContain("ai-ecosystem falha");
  });

  it("a disabled module stops counting: the dispatch entry goes with the last one", async () => {
    registry.add("ai-scripts");
    registry.add("ai-templates");
    enabled.add("ai-scripts");
    enabled.add("ai-templates");
    const manager = await started();
    expect(dispatchCommands()).toHaveLength(1);

    enabled.delete("ai-scripts");
    registry.remove("ai-scripts");
    manager.handleRegistryChange({ type: "module-unregistered", moduleId: "ai-scripts" });
    await sleep(80);
    expect(state("modules/ai-scripts.json").estado).toBe("desativado");
    expect(installedOf(manager, "ai-scripts")).toEqual([]);
    expect(dispatchCommands()).toHaveLength(1);

    enabled.delete("ai-templates");
    registry.remove("ai-templates");
    manager.handleRegistryChange({ type: "module-unregistered", moduleId: "ai-templates" });
    await sleep(80);
    expect(state("modules/ai-templates.json").estado).toBe("desativado");
    expect(dispatchCommands()).toEqual([]);
  });

  it("the last removal takes the dispatch entry out of both settings files", async () => {
    registry.add("ai-scripts");
    const manager = await started();
    // An entry left in the other settings file (for instance by an older move).
    fs.writeFileSync(
      path.join(vault, ".claude", "settings.json"),
      JSON.stringify({ hooks: { PreToolUse: [{ matcher: "Grep|Glob|Bash|PowerShell|Write", hooks: [{ type: "command", command: dispatchCommand(), timeout: 10 }] }] } }),
    );
    expect(dispatchCommands("settings.json")).toHaveLength(1);

    expect(manager.removeByUser("ai-scripts")).toEqual({ ok: true, changed: true });
    expect(dispatchCommands()).toEqual([]);
    expect(dispatchCommands("settings.json")).toEqual([]);
  });
});
