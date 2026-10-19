// The Provider API that modules call. Pure Node (no "obsidian" import).

import {
  AI_ECOSYSTEM_API_VERSION,
  ECOSYSTEM_ID,
  type AIEcosystemAPI,
  type ActivitySink,
  type ClientRecord,
  type HubModuleRegistration,
  type HubPrompt,
  type HubScriptOptions,
  type HubTool,
  type RegisterResult,
  type ScriptCaller,
  type ScriptExecutionResult,
  type ServerStatus,
  type ServiceChangeListener,
} from "../types";
import type { ModuleRegistry } from "../registry/module-registry";
import type { ServiceBus } from "../registry/service-bus";
import type { EcosystemLifecycle } from "./lifecycle";

export interface ProviderApiDeps {
  registry: ModuleRegistry;
  bus: ServiceBus;
  lifecycle: EcosystemLifecycle;
  runScript: (options: HubScriptOptions, caller: ScriptCaller) => Promise<ScriptExecutionResult>;
  activity: ActivitySink;
  importClients: (clients: ClientRecord[], sourceModuleId: string) => Promise<number>;
  getServerStatus: () => ServerStatus;
}

type ActivityEntryInput = Parameters<AIEcosystemAPI["logActivity"]>[0];

export class ProviderApi implements AIEcosystemAPI {
  readonly apiVersion = AI_ECOSYSTEM_API_VERSION;
  private readonly unsubscribeBus: () => void;

  constructor(private readonly deps: ProviderApiDeps) {
    this.unsubscribeBus = deps.bus.onChange((name, available) => deps.lifecycle.serviceChanged(name, available));
  }

  /** Stops forwarding Service Bus changes to the lifecycle events. */
  dispose(): void {
    this.unsubscribeBus();
  }

  isReady(): boolean {
    return this.deps.lifecycle.isReady();
  }

  registerModule(module: HubModuleRegistration): RegisterResult {
    try {
      const result = this.deps.registry.register(module);
      if (result.ok) this.deps.lifecycle.moduleRegistered(module.id);
      return result;
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : String(err) };
    }
  }

  unregisterModule(moduleId: string): boolean {
    this.deps.bus.removeOwnedBy(moduleId);
    const removed = this.deps.registry.unregister(moduleId);
    if (removed) this.deps.lifecycle.moduleUnregistered(moduleId);
    return removed;
  }

  updateTools(moduleId: string, tools: HubTool[]): void {
    this.deps.registry.updateTools(moduleId, tools);
  }

  updatePrompts(moduleId: string, prompts: HubPrompt[]): void {
    this.deps.registry.updatePrompts(moduleId, prompts);
  }

  registerService<T>(serviceName: string, ownerModuleId: string, instance: T): void {
    if (ownerModuleId !== ECOSYSTEM_ID && !this.deps.registry.has(ownerModuleId)) {
      throw new Error(`Register the module ${ownerModuleId} before its services`);
    }
    this.deps.bus.register(serviceName, ownerModuleId, instance);
  }

  unregisterService(serviceName: string): void {
    this.deps.bus.unregister(serviceName);
  }

  getService<T>(serviceName: string): T | undefined {
    return this.deps.bus.get<T>(serviceName);
  }

  onServiceChange(cb: ServiceChangeListener): () => void {
    return this.deps.bus.onChange(cb);
  }

  importClients(clients: ClientRecord[], sourceModuleId: string): Promise<number> {
    if (!this.deps.registry.has(sourceModuleId)) {
      return Promise.reject(new Error("Only registered modules can import clients"));
    }
    return this.deps.importClients(clients, sourceModuleId);
  }

  runScript(options: HubScriptOptions, callerModuleId: string): Promise<ScriptExecutionResult> {
    if (callerModuleId !== ECOSYSTEM_ID && !this.deps.registry.has(callerModuleId)) {
      return Promise.reject(new Error("Only registered modules can run scripts"));
    }
    return this.deps.runScript(options, { moduleId: callerModuleId });
  }

  logActivity(entry: ActivityEntryInput): void {
    try {
      this.deps.activity.log({
        kind: "module",
        method: entry.type,
        target: entry.target,
        moduleId: entry.moduleId,
        client: entry.client ?? `module:${entry.moduleId}`,
        status: entry.status,
        durationMs: entry.durationMs,
        payload: entry.payload,
        response: entry.response,
      });
    } catch (err) {
      console.warn("[AI Ecosystem] Could not log module activity", err);
    }
  }

  getServerStatus(): { running: boolean; port: number; activeModules: string[] } {
    const status = this.deps.getServerStatus();
    return {
      running: status.running,
      port: status.port,
      activeModules: this.deps.registry.listModules().map((m) => m.id),
    };
  }
}

/** The object handed to modules: only the interface methods, frozen, no access to internals. */
export function createPublicApi(impl: AIEcosystemAPI): AIEcosystemAPI {
  return Object.freeze({
    apiVersion: AI_ECOSYSTEM_API_VERSION,
    isReady: () => impl.isReady(),
    registerModule: (module: HubModuleRegistration) => impl.registerModule(module),
    unregisterModule: (moduleId: string) => impl.unregisterModule(moduleId),
    updateTools: (moduleId: string, tools: HubTool[]) => impl.updateTools(moduleId, tools),
    updatePrompts: (moduleId: string, prompts: HubPrompt[]) => impl.updatePrompts(moduleId, prompts),
    registerService<T>(serviceName: string, ownerModuleId: string, instance: T): void {
      impl.registerService(serviceName, ownerModuleId, instance);
    },
    unregisterService: (serviceName: string) => impl.unregisterService(serviceName),
    getService<T>(serviceName: string): T | undefined {
      return impl.getService<T>(serviceName);
    },
    onServiceChange: (cb: ServiceChangeListener) => impl.onServiceChange(cb),
    importClients: (clients: ClientRecord[], sourceModuleId: string) => impl.importClients(clients, sourceModuleId),
    runScript: (options: HubScriptOptions, callerModuleId: string) => impl.runScript(options, callerModuleId),
    logActivity: (entry: ActivityEntryInput) => impl.logActivity(entry),
    getServerStatus: () => impl.getServerStatus(),
  });
}
