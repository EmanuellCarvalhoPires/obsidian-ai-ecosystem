// Runs the Claude Code hooks side of the core: the state folder, the hook script, the heartbeat,
// the entries in the Claude Code settings and the setup state of the modules. Pure Node (no
// "obsidian" import); main.ts and the settings tab reach it through the Ecosystem.
import { clearTimeout, setTimeout } from "node:timers";
import { ECOSYSTEM_ID } from "../types";
import type { ClientKind, ModuleInfo, ModuleSetupState, RegisteredTool, RegistryChange } from "../types";
import { Heartbeat } from "./heartbeat";
import { HOOK_SCRIPT_SOURCE } from "./hook-script";
import { CORE_SPECS, DISPATCH_SPEC, HOOK_SCRIPT_NAME, buildCommand, moduleHookSpecs, protectionModuleIds, protectionSpec, setupSpecs } from "./hook-specs";
import type { HookEvent } from "./hook-specs";
import { HooksServiceImpl } from "./hooks-service";
import { ModuleStateStore } from "./module-states";
import { NodeChecker } from "./node-check";
import type { NodeStatus } from "./node-check";
import { SettingsMerger } from "./settings-merger";
import type { InstalledEntry } from "./settings-merger";
import { SETTINGS_FILES, StateDir, defaultMode } from "./state-dir";
import type { HookMode, ModuleOrigin } from "./state-dir";

/** Seconds-level delay before a module that left the registry is checked for "disabled by the user". */
export const DISABLE_CHECK_DELAY_MS = 1000;

/** Error code of an install refused because Node.js is not on the PATH. */
export const NODE_MISSING = "node-missing";

export interface HookManagerDeps {
  vaultBasePath: string;
  /** app.vault.configDir. */
  configDir?: string;
  /** Current MCP server name (it can change while the plugin runs). */
  getServerName?: () => string;
  listModules: () => ModuleInfo[];
  listTools: () => RegisteredTool[];
  nodeChecker?: NodeChecker;
  /** Whether the Obsidian plugin of a module is still enabled. Unknown means "yes". */
  isPluginEnabled?: (moduleId: string) => boolean;
  disableCheckDelayMs?: number;
  heartbeatIntervalMs?: number;
  ruleDebounceMs?: number;
  /** Something the settings tab shows changed. */
  onChange?: () => void;
}

export type HookActionResult = { ok: true; changed: boolean } | { ok: false; error: string };

/** What the setup side of the core wants to know about the modules. Every method is optional. */
export interface HookManagerListener {
  /** A module registered (or the core started with it already registered) and its state is settled. */
  onModuleRegistered?(moduleId: string): void;
  /** A module was found turned off (or uninstalled) and its hooks were removed. */
  onModuleDisabled?(moduleId: string): void;
}

export interface HookModuleRow {
  id: string;
  name: string;
  registered: boolean;
  estado?: ModuleSetupState;
  origem?: ModuleOrigin;
  mode: HookMode;
  /** The module has a protection hook at all (Telegram has none). */
  hasProtection: boolean;
  /** Entries of the module found in the Claude Code settings. */
  installed: InstalledEntry[];
  /** The temporary setup entries (SessionStart, UserPromptSubmit) of the module are in the settings. */
  setupHook: boolean;
}

export interface HooksStatus {
  node: NodeStatus & { checked: boolean };
  settingsFile: string;
  settingsPath: string;
  /** Last problem writing the Claude Code settings. */
  lastError?: string;
  /** The core's own failure hook is in the settings. */
  coreInstalled: boolean;
  /** Setup state of the core itself. */
  coreEstado?: ModuleSetupState;
  modules: HookModuleRow[];
}

/** What "Install hooks" is about to write, for the confirmation modal. */
export interface HookInstallPlan {
  settingsPath: string;
  /** Protection entries. Written at once by "Install hooks"; after the setup for a module from the catalog. */
  entries: Array<{ event: HookEvent; matcher?: string; command: string }>;
  node: NodeStatus;
  /** Present for a module from the catalog: what else the install writes. */
  catalog?: {
    /** Vault-relative path of the setup skill. */
    skillPath: string;
    /** The temporary entries (SessionStart and UserPromptSubmit) that send the agent to the skill. */
    setupEntries: Array<{ event: HookEvent; command: string }>;
    /** Vault-relative path of the file that gets the usage block for clients without hooks. */
    geminiPath: string;
    /** Vault-relative path of the /kit welcome skill, when the install is about to write it. */
    kitSkillPath?: string;
  };
}

export class HookManager {
  readonly state: StateDir;
  readonly states: ModuleStateStore;
  readonly service: HooksServiceImpl;
  private readonly merger: SettingsMerger;
  private readonly heartbeat: Heartbeat;
  private readonly node: NodeChecker;
  /** True when this is the first time this version of the core runs in this vault. */
  private readonly firstRun: boolean;
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private lastTools: string | undefined;
  private lastError: string | undefined;
  private disposed = false;
  private ready: Promise<void> = Promise.resolve();
  private listener: HookManagerListener = {};
  /** Automatic installs of protection hooks (legacy and manual modules) still running. */
  private readonly pending = new Set<Promise<unknown>>();

  constructor(private readonly deps: HookManagerDeps) {
    this.state = new StateDir(deps.vaultBasePath);
    this.firstRun = !this.state.exists("config.json");
    this.states = new ModuleStateStore(this.state);
    this.service = new HooksServiceImpl({ state: this.state, states: this.states, debounceMs: deps.ruleDebounceMs });
    this.merger = new SettingsMerger(this.state.claudeDir, this.state.backupsDir, () => this.state.vaultPath);
    this.heartbeat = new Heartbeat(this.state, deps.heartbeatIntervalMs);
    this.node = deps.nodeChecker ?? new NodeChecker();
  }

  /**
   * Writes the script and the config, registers the modules already in the registry and starts
   * the heartbeat. The core entry in the Claude Code settings follows once Node is checked
   * (see whenReady()). Never throws.
   */
  start(): void {
    try {
      this.state.ensure();
      if (this.state.readText(`hooks/${HOOK_SCRIPT_NAME}`) !== HOOK_SCRIPT_SOURCE) {
        this.state.writeText(`hooks/${HOOK_SCRIPT_NAME}`, HOOK_SCRIPT_SOURCE);
      }
      this.state.writeConfig(this.configPatch());
      // The rules treat a missing data file as "nothing to guard", so these exist from the start.
      if (!this.state.exists("hosts.json")) this.state.writeHosts([]);
      if (!this.state.exists("pastas.json")) this.state.writePastas({ scripts: [], templates: [], foraDoIndice: [], notasDeTools: [] });
      for (const module of this.deps.listModules()) this.registered(module.id, module.name);
      this.syncTools();
      this.heartbeat.start();
    } catch (err) {
      console.warn("[AI Ecosystem] Could not set up the Claude Code hooks folder", err);
      this.fail(err);
    }
    this.ready = this.installCore().then(() => this.settled());
  }

  private async settled(): Promise<void> {
    while (this.pending.size > 0) await Promise.all([...this.pending]);
  }

  /** The fields of config.json that come from the plugin (config folder and MCP server name). */
  private configPatch(): { configDir?: string; serverName?: string } {
    const patch: { configDir?: string; serverName?: string } = {};
    if (this.deps.configDir) patch.configDir = this.deps.configDir;
    let serverName: string | undefined;
    try {
      serverName = this.deps.getServerName?.().trim();
    } catch {
      serverName = undefined;
    }
    if (serverName) patch.serverName = serverName;
    return patch;
  }

  /** Rewrites config.json when the MCP server name changed. Never throws. */
  syncServerName(): void {
    if (this.disposed) return;
    try {
      const { serverName } = this.configPatch();
      if (serverName && serverName !== this.state.readConfig()?.serverName) this.state.writeConfig({ serverName });
    } catch (err) {
      this.fail(err);
    }
  }

  /** The setup side of the core subscribes here (before start()). */
  setListener(listener: HookManagerListener): void {
    this.listener = listener;
  }

  /** Resolves when the asynchronous part of start() (Node check, core entry) is done. */
  whenReady(): Promise<void> {
    return this.ready;
  }

  /** Stops the heartbeat (and deletes the file) and the timers. The hook entries stay in place. */
  dispose(): void {
    this.disposed = true;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    this.heartbeat.stop();
    this.service.dispose();
  }

  // ---- registry -----------------------------------------------------------

  handleRegistryChange(change: RegistryChange): void {
    if (this.disposed) return;
    try {
      if (change.type === "module-registered") {
        const name = this.deps.listModules().find((m) => m.id === change.moduleId)?.name;
        this.registered(change.moduleId, name);
      } else if (change.type === "module-unregistered") {
        this.unregistered(change.moduleId);
      }
      if (change.type !== "prompts-changed") this.syncTools();
    } catch (err) {
      console.warn("[AI Ecosystem] Could not update the hooks state after a registry change", err);
    }
  }

  /** Writes tools.json (tool name to module id) when it changed. */
  syncTools(): void {
    const tools: Record<string, string> = {};
    for (const { moduleId, tool } of this.deps.listTools()) tools[tool.name] = moduleId;
    const text = JSON.stringify(tools);
    if (text === this.lastTools) return;
    this.state.writeTools(tools);
    this.lastTools = text;
  }

  private registered(moduleId: string, name: string | undefined): void {
    if (moduleId === ECOSYSTEM_ID) {
      // The first time this version of the core runs in a vault it waits for its own setup (decision D4).
      this.states.ensure(moduleId, { origem: "nucleo", estado: "pendente_configuracao", nome: name });
    } else {
      const existing = this.states.get(moduleId);
      if (!existing) {
        this.states.ensure(moduleId, { origem: this.firstRun ? "legado" : "manual", estado: "configurado", nome: name });
        this.autoInstall(moduleId);
      } else if (existing.estado === "configurado") {
        // Vaults that already recorded the module as legacy or manual, with no entries yet.
        this.autoInstall(moduleId);
      } else if (existing.estado === "desativado") {
        if (existing.origem === "catalogo" && !this.state.hasConfiguredMarker(moduleId)) {
          // Installed from the catalog and never configured: the setup starts over.
          this.states.setEstado(moduleId, "pendente_configuracao");
        } else {
          // The user enabled the plugin again. Modules installed from the catalog get their hooks back.
          this.states.setEstado(moduleId, "configurado");
          if (existing.origem === "catalogo") void this.installProtection(moduleId);
          else this.autoInstall(moduleId);
        }
      }
    }
    this.deps.onChange?.();
    this.listener.onModuleRegistered?.(moduleId);
  }

  private unregistered(moduleId: string): void {
    this.service.dropModule(moduleId);
    if (moduleId === ECOSYSTEM_ID) return;
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      this.markDisabledIfOff(moduleId);
    }, this.deps.disableCheckDelayMs ?? DISABLE_CHECK_DELAY_MS);
    timer.unref();
    this.timers.add(timer);
  }

  /**
   * A module leaving the registry means either the user turned its plugin off or Obsidian is
   * closing (or the core reloads). Only the first one marks it "desativado".
   */
  private markDisabledIfOff(moduleId: string): void {
    if (this.disposed) return;
    if (this.deps.listModules().some((m) => m.id === moduleId)) return;
    if (this.deps.isPluginEnabled?.(moduleId) ?? true) return;
    if (!this.states.get(moduleId) || this.states.estado(moduleId) === "desativado") return;
    try {
      this.states.setEstado(moduleId, "desativado");
      this.removeModule(moduleId);
      this.listener.onModuleDisabled?.(moduleId);
    } catch (err) {
      console.warn(`[AI Ecosystem] Could not mark ${moduleId} as disabled`, err);
    }
    this.deps.onChange?.();
  }

  // ---- tool visibility and failure markers (used by the MCP host) ------------

  /**
   * Claude Code does not see the tools of a module that still waits for its first setup (except
   * the ones marked availableDuringSetup). Other clients and the core's own tools are not affected.
   */
  isToolHidden(registered: RegisteredTool, kind: ClientKind): boolean {
    return this.isModuleHidden(registered.moduleId, kind, registered.tool.availableDuringSetup === true);
  }

  /** The same rule for a tool known only by its module (e.g. an index entry run through tools_run). */
  isModuleHidden(moduleId: string, kind: ClientKind, availableDuringSetup = false): boolean {
    if (kind !== "claude-code" || moduleId === ECOSYSTEM_ID || availableDuringSetup) return false;
    return this.states.estado(moduleId) === "pendente_configuracao";
  }

  /**
   * True while some module (the core included) waits for its first setup. A module installed from
   * the catalog counts from the start of its install, before it registers in the registry.
   */
  isSetupPending(): boolean {
    const ids = new Set([...this.deps.listModules().map((m) => m.id), ...this.states.ids()]);
    return [...ids].some((id) => this.states.estado(id) === "pendente_configuracao");
  }

  /** A tool call ended: a failed call (the handler threw, or the module is not running the tool) sets the module's marker, a success clears it. Never throws. */
  recordToolResult(moduleId: string, failed: boolean): void {
    if (this.disposed) return;
    try {
      if (failed) this.state.setFalha(moduleId, Date.now());
      else this.state.clearFalha(moduleId);
    } catch {
      // The marker is only a hint for the hooks.
    }
  }

  // ---- entries in the Claude Code settings ---------------------------------------

  private async installCore(): Promise<void> {
    const node = await this.node.check();
    this.deps.onChange?.();
    if (this.disposed) return;
    try {
      // Entries written by an older location of the vault follow it.
      for (const file of SETTINGS_FILES) this.merger.syncPaths(file);
      if (!node.available) return;
      const result = this.merger.install(this.state.getSettingsFile(), [...CORE_SPECS]);
      this.record(result);
      // The approval of tools_run is retired: older versions left its entry, so it goes now.
      for (const file of SETTINGS_FILES) {
        const removed = this.merger.remove(file, { module: ECOSYSTEM_ID, type: "execucao" });
        if (!removed.ok) this.record(removed);
      }
      this.migrateLegacyProtection();
    } catch (err) {
      this.fail(err);
    }
    this.deps.onChange?.();
  }

  /**
   * Older versions wrote one protection entry per module. With Node available, each file that holds
   * such entries gets the single dispatch entry and loses them; the user's entries stay. A file whose
   * dispatch entry could not be written keeps its old entries. Never throws.
   */
  private migrateLegacyProtection(): void {
    for (const file of SETTINGS_FILES) {
      const listed = this.merger.list(file);
      if (!listed.ok) continue;
      const legacy = [...new Set(listed.entries.filter((e) => e.type === "protecao" && protectionSpec(e.module) !== undefined).map((e) => e.module))];
      if (legacy.length === 0) continue;
      const installed = this.merger.install(file, [DISPATCH_SPEC]);
      if (!installed.ok) {
        this.record(installed);
        continue;
      }
      for (const module of legacy) {
        const removed = this.merger.remove(file, { module, type: "protecao" });
        if (!removed.ok) this.record(removed);
      }
    }
    this.dropDispatcherIfUnused();
  }

  /** Whether some module is configured and keeps its hooks, so it needs the dispatch entry. */
  private dispatcherNeeded(): boolean {
    return protectionModuleIds().some((id) => {
      const state = this.states.get(id);
      return state?.estado === "configurado" && !state.hooksRemovidos;
    });
  }

  /** Removes the dispatch entry from both settings files when no module needs it. Returns whether an entry went. */
  private dropDispatcherIfUnused(): boolean {
    if (this.dispatcherNeeded()) return false;
    let changed = false;
    for (const file of SETTINGS_FILES) {
      const removed = this.merger.remove(file, { module: ECOSYSTEM_ID, type: "despacho" });
      if (!removed.ok) this.record(removed);
      else changed = changed || removed.changed;
    }
    return changed;
  }

  /** Removes the old per-module protection entries of one module from both settings files. */
  private removeLegacyProtection(moduleId: string): HookActionResult {
    let changed = false;
    for (const file of SETTINGS_FILES) {
      const removed = this.merger.remove(file, { module: moduleId, type: "protecao" });
      if (!removed.ok) return { ok: false, error: removed.error };
      changed = changed || removed.changed;
    }
    return { ok: true, changed };
  }

  /**
   * Modules that were already active (legacy) or registered without state (manual) get their
   * protection entry with no confirmation, unless the user removed it by hand. Without Node
   * nothing is written. Never throws.
   */
  private autoInstall(moduleId: string): void {
    const state = this.states.get(moduleId);
    if (!state || state.estado !== "configurado" || state.hooksRemovidos) return;
    if (state.origem !== "legado" && state.origem !== "manual") return;
    if (moduleHookSpecs(moduleId).length === 0) return;
    const job = this.installProtection(moduleId, true)
      .then((result) => {
        if (!result.ok && result.error !== NODE_MISSING) console.warn(`[AI Ecosystem] Could not install the hooks of ${moduleId}: ${result.error}`);
      })
      .catch(() => undefined)
      .finally(() => this.pending.delete(job));
    this.pending.add(job);
  }

  /** The user pressed "Remove hooks": removes the entries and remembers it, so they stay removed. */
  removeByUser(moduleId: string): HookActionResult {
    const result = this.removeModule(moduleId);
    if (!result.ok) return result;
    try {
      this.states.setHooksRemovidos(moduleId, true);
    } catch (err) {
      return this.fail(err);
    }
    const dropped = this.dropDispatcherIfUnused();
    return { ok: true, changed: result.changed || dropped };
  }

  /**
   * Writes the permanent entries of a module: its protection entry and, for AI Git Tools, the
   * merge approval entry (the user asked for it, or the core does it for a legacy module or at the
   * end of the setup). A module whose default mode is not "bloquear" gets that mode written
   * explicitly in config.modos when none was chosen yet.
   */
  async installProtection(moduleId: string, automatic = false): Promise<HookActionResult> {
    const specs = moduleHookSpecs(moduleId);
    if (specs.length === 0) return { ok: true, changed: false };
    const node = await this.node.check();
    if (!node.available) return { ok: false, error: NODE_MISSING };
    try {
      this.state.ensure();
      this.syncServerName();
      if (!automatic) this.states.setHooksRemovidos(moduleId, false);
      else if (this.states.get(moduleId)?.hooksRemovidos) return { ok: true, changed: false };
      const fallback = defaultMode(moduleId);
      if (fallback !== "bloquear" && !this.state.hasExplicitMode(moduleId)) this.state.setMode(moduleId, fallback);
      const file = this.state.getSettingsFile();
      const dispatcher = this.merger.install(file, [DISPATCH_SPEC]);
      if (!dispatcher.ok) return this.record(dispatcher);
      const legacy = this.removeLegacyProtection(moduleId);
      if (!legacy.ok) return this.record(legacy);
      const result = this.record({ ok: true, changed: dispatcher.changed || legacy.changed });
      this.deps.onChange?.();
      return result;
    } catch (err) {
      return this.fail(err);
    }
  }

  /** Writes the temporary setup entries (SessionStart and UserPromptSubmit, idempotent: adds the missing one) that send the agent to the setup skill of a module. */
  async installSetupHook(moduleId: string): Promise<HookActionResult> {
    const node = await this.node.check();
    if (!node.available) return { ok: false, error: NODE_MISSING };
    try {
      this.state.ensure();
      this.syncServerName();
      const result = this.record(this.merger.install(this.state.getSettingsFile(), setupSpecs(moduleId)));
      this.deps.onChange?.();
      return result;
    } catch (err) {
      return this.fail(err);
    }
  }

  /** Removes the temporary setup entries of a module from both settings files. */
  removeSetupHook(moduleId: string): HookActionResult {
    try {
      let changed = false;
      for (const file of SETTINGS_FILES) {
        const result = this.record(this.merger.remove(file, { module: moduleId, type: "setup" }));
        if (!result.ok) return result;
        changed = changed || result.changed;
      }
      this.deps.onChange?.();
      return { ok: true, changed };
    } catch (err) {
      return this.fail(err);
    }
  }

  /** Whether Node.js is on the PATH (checked once). */
  nodeStatus(): Promise<NodeStatus> {
    return this.node.check();
  }

  /** Removes every entry of a module from both settings files. */
  removeModule(moduleId: string): HookActionResult {
    try {
      let changed = false;
      for (const file of SETTINGS_FILES) {
        const result = this.record(this.merger.remove(file, { module: moduleId }));
        if (!result.ok) return result;
        changed = changed || result.changed;
      }
      changed = this.dropDispatcherIfUnused() || changed;
      this.deps.onChange?.();
      return { ok: true, changed };
    } catch (err) {
      return this.fail(err);
    }
  }

  /** What "Install hooks" would write for a module, with the Node check. */
  async planInstall(moduleId: string): Promise<HookInstallPlan> {
    const node = await this.node.check();
    const settingsFile = this.state.getSettingsFile();
    return {
      settingsPath: this.merger.settingsPath(settingsFile),
      entries: (protectionSpec(moduleId) ? [DISPATCH_SPEC] : []).map((spec) => ({
        event: spec.event,
        matcher: spec.matcher,
        command: buildCommand(this.state.vaultPath, spec.module, spec.type),
      })),
      node,
    };
  }

  setMode(moduleId: string, mode: HookMode): void {
    try {
      this.syncServerName();
      this.state.setMode(moduleId, mode);
    } catch (err) {
      this.fail(err);
    }
    this.deps.onChange?.();
  }

  /** Moves every plugin entry to the other settings file and uses it from now on. */
  useSettingsFile(file: string): HookActionResult {
    if (!(SETTINGS_FILES as readonly string[]).includes(file)) return { ok: false, error: `Unknown settings file ${file}` };
    try {
      const current = this.state.getSettingsFile();
      const result = this.record(this.merger.move(current, file));
      if (result.ok) this.state.writeConfig({ settingsFile: file, ...this.configPatch() });
      this.deps.onChange?.();
      return result;
    } catch (err) {
      return this.fail(err);
    }
  }

  // ---- status for the UI -----------------------------------------------------

  getStatus(): HooksStatus {
    const settingsFile = this.state.getSettingsFile();
    const peeked = this.node.peek();
    const entries: InstalledEntry[] = [];
    let unreadable: string | undefined;
    for (const file of SETTINGS_FILES) {
      const listed = this.merger.list(file);
      if (listed.ok) entries.push(...listed.entries);
      else if (file === settingsFile) unreadable = listed.error;
    }

    const registered = new Map(this.deps.listModules().map((m) => [m.id, m.name]));
    const ids = new Set([...registered.keys(), ...this.states.ids()]);
    ids.delete(ECOSYSTEM_ID);
    const dispatch = entries.find((e) => e.module === ECOSYSTEM_ID && e.type === "despacho");
    const modules: HookModuleRow[] = [...ids].map((id) => {
      const stored = this.states.get(id);
      const installed = entries.filter((e) => e.module === id);
      // The dispatch entry covers a configured module that keeps its hooks: it shows as its protection entry.
      const covered = dispatch !== undefined && protectionSpec(id) !== undefined && stored?.estado === "configurado" && !stored.hooksRemovidos;
      if (dispatch && covered && !installed.some((e) => e.type === "protecao")) {
        installed.push({ module: id, type: "protecao", event: dispatch.event, matcher: dispatch.matcher, command: dispatch.command });
      }
      return {
        id,
        name: registered.get(id) ?? stored?.nome ?? id,
        registered: registered.has(id),
        estado: stored?.estado,
        origem: stored?.origem,
        mode: this.state.getMode(id),
        hasProtection: protectionSpec(id) !== undefined,
        installed,
        setupHook: entries.some((e) => e.module === id && e.type === "setup"),
      };
    });

    return {
      node: peeked ? { ...peeked, checked: true } : { available: false, checked: false },
      settingsFile,
      settingsPath: this.merger.settingsPath(settingsFile),
      lastError: this.lastError ?? unreadable,
      coreInstalled: entries.some((e) => e.module === ECOSYSTEM_ID && e.type === "falha"),
      coreEstado: this.states.estado(ECOSYSTEM_ID),
      modules,
    };
  }

  // ---- errors ----------------------------------------------------------------

  private record(result: HookActionResult): HookActionResult {
    this.lastError = result.ok ? undefined : result.error;
    return result;
  }

  private fail(err: unknown): HookActionResult {
    const error = err instanceof Error ? err.message : String(err);
    this.lastError = error;
    return { ok: false, error };
  }
}
