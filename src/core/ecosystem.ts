// Wires the pure-Node parts of the AI Ecosystem together (registry, service bus, lifecycle,
// Provider API, Script Engine, inspector logger, server). No "obsidian" import: main.ts adds
// the Obsidian side (views, settings, notices) and the integration tests use this class as is.
import * as nodePath from "node:path";
import { EcosystemLifecycle } from "../api/lifecycle";
import { ProviderApi, createPublicApi } from "../api/provider-api";
import { HookManager } from "../hooks/hook-manager";
import type { HookManagerDeps } from "../hooks/hook-manager";
import { ActivityDatabase } from "../inspector/activity-db";
import { LiveLogger } from "../inspector/live-logger";
import { createRedactor } from "../inspector/redaction";
import type { Redactor } from "../inspector/redaction";
import { ModuleRegistry } from "../registry/module-registry";
import { ServiceBus } from "../registry/service-bus";
import { BinaryDetector } from "../runner/binary-detector";
import { ScriptEngine } from "../runner/script-engine";
import type { ScreenHost } from "../screens/host";
import { ScreenService } from "../screens/service";
import { ScreenStore, screensDir } from "../screens/store";
import { SetupManager } from "../setup/setup-manager";
import type { Lang } from "../i18n";
import { ClientAuth } from "../server/auth";
import { ServerHost } from "../server/server-host";
import type { ServerHostOptions } from "../server/server-host";
import { AI_ECOSYSTEM_API_VERSION, ECOSYSTEM_ID, HOOKS_SERVICE, SECRETS_SERVICE, SUPPORTED_API_VERSIONS } from "../types";
import type {
  AIEcosystemAPI,
  AIEcosystemSettings,
  ClientRecord,
  RegistryChange,
  SecretVaultService,
  ServerStatus,
} from "../types";
import { BASE_MCP_INSTRUCTIONS, createBuiltinModule, createBuiltinTools } from "./builtin-module";
import type { BuiltinModuleDeps } from "./builtin-module";

export interface EcosystemDeps {
  vaultBasePath: string;
  vaultName: string;
  /** Version of the AI Ecosystem plugin. */
  version: string;
  getSettings: () => AIEcosystemSettings;
  /** Workspace event trigger (app.workspace.trigger). */
  trigger: (name: string, ...data: unknown[]) => void;
  /** Vault-relative paths of #mcp/script notes. */
  getDeclaredScripts: () => string[];
  /** A client token was just used. */
  onClientUsed?: (clientId: string) => void;
  importClients: (clients: ClientRecord[], sourceModuleId: string) => Promise<number>;
  /** Called after the lifecycle event, on every server status change. */
  onStatusChange?: (status: ServerStatus) => void;
  /** Called on every registry change (the MCP list_changed notifications are already sent). */
  onRegistryChange?: (change: RegistryChange) => void;
  /** Extra server options (tests: probe, transitionWaitMs). */
  serverOptions?: Partial<ServerHostOptions>;
  detector?: BinaryDetector;
  /** app.vault.configDir. */
  configDir?: string;
  /** Language of the setup skills and of the usage guide blocks (the Obsidian language). Default: English. */
  language?: () => Lang;
  /** Script folders were added to the allowed list by the guided setup (Obsidian shows a notice). */
  onScriptFoldersAdded?: (folders: string[]) => void;
  /** Tests: how long a module's setup handler may take (default 5000). */
  setupHandlerTimeoutMs?: number;
  /** Saves data.json (the guided setup changes the allowed script folders). */
  saveSettings?: () => Promise<void>;
  /** Whether the Obsidian plugin of a module is still enabled (Claude Code hooks mark disabled modules). */
  isPluginEnabled?: (moduleId: string) => boolean;
  /** The Claude Code hooks need an absolute vault folder; "disabled" turns them off (tests). */
  hooks?: { disabled?: boolean } & Partial<Pick<HookManagerDeps, "nodeChecker" | "disableCheckDelayMs" | "heartbeatIntervalMs" | "ruleDebounceMs">>;
  /** Something about the Claude Code hooks changed (the settings tab refreshes). */
  onHooksChange?: () => void;
  /** Opens the screen windows. Without it the screen tools (tela_*) are not offered. */
  screenHost?: ScreenHost;
  /** Folder of the saved screens. Default: <vault>/<configDir>/plugins/ai-ecosystem/telas (needs configDir). */
  screensDir?: string;
}

export class Ecosystem {
  readonly bus = new ServiceBus();
  readonly redactor: Redactor;
  readonly database?: ActivityDatabase;
  readonly logger: LiveLogger;
  readonly lifecycle: EcosystemLifecycle;
  readonly registry: ModuleRegistry;
  readonly detector: BinaryDetector;
  readonly engine: ScriptEngine;
  readonly auth: ClientAuth;
  readonly server: ServerHost;
  readonly providerApi: ProviderApi;
  /** Claude Code hooks, setup state and the "hooks" service. Undefined without a vault folder. */
  readonly hooks: HookManager | undefined;
  /** Guided setup of the modules (skills, setup hooks, GEMINI.md). Undefined together with the hooks. */
  readonly setup: SetupManager | undefined;
  /** Saved screens and the tela_* tools. Undefined without a screen host or a place to save them. */
  readonly screens: ScreenService | undefined;
  /** The frozen facade handed to modules. */
  readonly api: AIEcosystemAPI;
  private readonly builtin: BuiltinModuleDeps;
  private disposed = false;

  constructor(private readonly deps: EcosystemDeps) {
    const getSecrets = (): SecretVaultService | undefined => this.bus.get<SecretVaultService>(SECRETS_SERVICE);
    this.redactor = createRedactor(getSecrets);
    if (deps.vaultBasePath) {
      try {
        const dbPath = `${deps.vaultBasePath}/.obsidian/plugins/ai-ecosystem/activity.sqlite`;
        this.database = new ActivityDatabase({ filePath: dbPath });
      } catch (err) {
        console.warn("[AI Ecosystem] Could not initialize ActivityDatabase, falling back to memory", err);
      }
    }
    this.logger = new LiveLogger({
      redactor: this.redactor,
      maxEntries: () => deps.getSettings().inspector.maxEntries,
      database: this.database,
    });
    this.lifecycle = new EcosystemLifecycle(deps.trigger);

    this.registry = new ModuleRegistry({
      supportedApiVersions: SUPPORTED_API_VERSIONS,
      // Only reacts to changes. ProviderApi already emits the lifecycle events of modules.
      onChange: (change) => {
        if (change.type !== "prompts-changed") this.server.notifyListChanged("tools");
        if (change.type !== "tools-changed") this.server.notifyListChanged("prompts");
        this.hooks?.handleRegistryChange(change);
        deps.onRegistryChange?.(change);
      },
    });

    if (nodePath.isAbsolute(deps.vaultBasePath) && !deps.hooks?.disabled) {
      this.hooks = new HookManager({
        vaultBasePath: deps.vaultBasePath,
        configDir: deps.configDir,
        listModules: () => this.registry.listModules(),
        listTools: () => this.registry.listTools(),
        isPluginEnabled: deps.isPluginEnabled,
        onChange: deps.onHooksChange,
        ...deps.hooks,
      });
      this.bus.register(HOOKS_SERVICE, ECOSYSTEM_ID, this.hooks.service);
      this.setup = new SetupManager({
        hooks: this.hooks,
        vaultBasePath: deps.vaultBasePath,
        configDir: deps.configDir,
        language: deps.language ?? (() => "en"),
        listModules: () => this.registry.listModules(),
        listTools: () => this.registry.listTools(),
        getSettings: deps.getSettings,
        saveSettings: deps.saveSettings,
        handlerTimeoutMs: deps.setupHandlerTimeoutMs,
        activity: this.logger,
        onScriptFoldersAdded: deps.onScriptFoldersAdded,
        notifyToolsChanged: () => this.server.notifyListChanged("tools"),
      });
      this.hooks.setListener(this.setup);
    }

    this.detector = deps.detector ?? new BinaryDetector();
    this.engine = new ScriptEngine({
      vaultBasePath: deps.vaultBasePath,
      getSettings: () => deps.getSettings().scripts,
      getDeclaredScripts: deps.getDeclaredScripts,
      getSecrets,
      redact: (text) => this.redactor.text(text),
      activity: this.logger,
      isRegisteredModule: (id) => this.registry.has(id),
      detector: this.detector,
    });

    this.auth = new ClientAuth(() => deps.getSettings().clients, deps.onClientUsed);

    this.server = new ServerHost(() => {
      const settings = deps.getSettings();
      return {
        port: settings.port,
        alternativePort: settings.alternativePort,
        lastPort: settings.lastPort,
        registry: this.registry,
        auth: this.auth,
        activity: this.logger,
        version: deps.version,
        apiVersion: AI_ECOSYSTEM_API_VERSION,
        vaultName: deps.vaultName,
        getMcpInstructions: () => BASE_MCP_INSTRUCTIONS,
        isToolHidden: (registered, kind) => this.hooks?.isToolHidden(registered, kind) ?? false,
        onToolResult: (moduleId, isError) => this.hooks?.recordToolResult(moduleId, isError),
        ...deps.serverOptions,
        onStatusChange: (status) => this.handleStatus(status),
      };
    });

    this.providerApi = new ProviderApi({
      registry: this.registry,
      bus: this.bus,
      lifecycle: this.lifecycle,
      runScript: (options, caller) => this.engine.run(options, caller),
      activity: this.logger,
      importClients: deps.importClients,
      getServerStatus: () => this.server.getStatus(),
    });
    this.api = createPublicApi(this.providerApi);

    const folder = deps.screensDir ?? (deps.vaultBasePath && deps.configDir ? screensDir(deps.vaultBasePath, deps.configDir) : undefined);
    if (deps.screenHost && folder) {
      this.screens = new ScreenService({
        store: new ScreenStore(folder),
        host: deps.screenHost,
        getLimit: () => deps.getSettings().screens.maxScreens,
        getSecrets,
        // A screen was created, changed or removed: the registry notifies the clients of the new tool list.
        onChange: () => this.refreshBuiltinTools(),
      });
      for (const problem of this.screens.load()) console.warn(`[AI Ecosystem] Screen not loaded: ${problem}`);
    }

    // The built-in module is registered directly: modules registered through the Provider API
    // get lifecycle events, this one is part of the AI Ecosystem itself.
    this.builtin = {
      version: deps.version,
      getServerStatus: () => this.server.getStatus(),
      listModules: () => this.registry.listModules(),
      listServices: () => this.bus.list(),
      scripts: {
        engine: this.engine,
        vaultBasePath: deps.vaultBasePath,
        getSettings: () => deps.getSettings().scripts,
        getDeclaredScripts: deps.getDeclaredScripts,
      },
      screens: this.screens,
      setup: this.setup,
    };
    const registered = this.registry.register(createBuiltinModule(this.builtin));
    if (!registered.ok) console.error(`[AI Ecosystem] Could not register the built-in module: ${registered.reason}`);
  }

  /**
   * Announces "ready" first, so Environment Keys 2.x in transition mode can release the main
   * port while the server retries it, then starts the server.
   */
  start(): Promise<ServerStatus> {
    this.hooks?.start();
    this.setup?.start();
    this.lifecycle.announceReady(this.api);
    return this.server.start();
  }

  /** Tells the modules, drops them and the services, kills running scripts and stops the server. Never throws. */
  unload(): Promise<void> {
    this.disposed = true;
    try {
      // Stops the heartbeat; the hook entries in the Claude Code settings stay.
      this.setup?.dispose();
      this.hooks?.dispose();
      this.screens?.dispose();
      this.lifecycle.announceUnloading();
      this.registry.clear();
      this.bus.clear();
      this.providerApi.dispose();
      this.engine.killAll();
      this.database?.close();
    } catch (err) {
      console.warn("[AI Ecosystem] Error while unloading", err);
    }
    return this.server.stop().catch((err: unknown) => {
      console.warn("[AI Ecosystem] Error while stopping the server", err);
    });
  }

  /** Registers the tools of the built-in module again (a screen tool appeared, changed or went away). */
  private refreshBuiltinTools(): void {
    if (this.disposed || !this.registry.has(ECOSYSTEM_ID)) return;
    this.registry.updateTools(ECOSYSTEM_ID, createBuiltinTools(this.builtin));
  }

  private handleStatus(status: ServerStatus): void {
    if (this.disposed) return;
    this.lifecycle.serverStatus(status);
    this.deps.onStatusChange?.(status);
  }
}
