// Wires the pure-Node parts of the AI Ecosystem together (registry, service bus, lifecycle,
// Provider API, Script Engine, inspector logger, server). No "obsidian" import: main.ts adds
// the Obsidian side (views, settings, notices) and the integration tests use this class as is.
import { EcosystemLifecycle } from "../api/lifecycle";
import { ProviderApi, createPublicApi } from "../api/provider-api";
import { ActivityDatabase } from "../inspector/activity-db";
import { LiveLogger } from "../inspector/live-logger";
import { createRedactor } from "../inspector/redaction";
import type { Redactor } from "../inspector/redaction";
import { ModuleRegistry } from "../registry/module-registry";
import { ServiceBus } from "../registry/service-bus";
import { BinaryDetector } from "../runner/binary-detector";
import { ScriptEngine } from "../runner/script-engine";
import { ClientAuth } from "../server/auth";
import { ServerHost } from "../server/server-host";
import type { ServerHostOptions } from "../server/server-host";
import { AI_ECOSYSTEM_API_VERSION, SECRETS_SERVICE, SUPPORTED_API_VERSIONS } from "../types";
import type {
  AIEcosystemAPI,
  AIEcosystemSettings,
  ClientRecord,
  RegistryChange,
  SecretVaultService,
  ServerStatus,
} from "../types";
import { BASE_MCP_INSTRUCTIONS, createBuiltinModule } from "./builtin-module";

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
  /** The frozen facade handed to modules. */
  readonly api: AIEcosystemAPI;
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
        deps.onRegistryChange?.(change);
      },
    });

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
        registry: this.registry,
        auth: this.auth,
        activity: this.logger,
        version: deps.version,
        apiVersion: AI_ECOSYSTEM_API_VERSION,
        vaultName: deps.vaultName,
        getMcpInstructions: () => BASE_MCP_INSTRUCTIONS,
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

    // The built-in module is registered directly: modules registered through the Provider API
    // get lifecycle events, this one is part of the AI Ecosystem itself.
    const registered = this.registry.register(
      createBuiltinModule({
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
      }),
    );
    if (!registered.ok) console.error(`[AI Ecosystem] Could not register the built-in module: ${registered.reason}`);
  }

  /**
   * Announces "ready" first, so Environment Keys 2.x in transition mode can release the main
   * port while the server retries it, then starts the server.
   */
  start(): Promise<ServerStatus> {
    this.lifecycle.announceReady(this.api);
    return this.server.start();
  }

  /** Tells the modules, drops them and the services, kills running scripts and stops the server. Never throws. */
  unload(): Promise<void> {
    this.disposed = true;
    try {
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

  private handleStatus(status: ServerStatus): void {
    if (this.disposed) return;
    this.lifecycle.serverStatus(status);
    this.deps.onStatusChange?.(status);
  }
}
