import { describe, expect, it, vi } from "vitest";
import { EcosystemLifecycle } from "../../src/api/lifecycle";
import { ProviderApi, createPublicApi } from "../../src/api/provider-api";
import { ModuleRegistry } from "../../src/registry/module-registry";
import { ServiceBus } from "../../src/registry/service-bus";
import {
  AI_ECOSYSTEM_API_VERSION,
  ECOSYSTEM_EVENTS,
  ECOSYSTEM_ID,
  SUPPORTED_API_VERSIONS,
  type AIEcosystemAPI,
  type ActivityInput,
  type ActivitySink,
  type HubModuleRegistration,
  type HubScriptOptions,
  type ServerStatus,
} from "../../src/types";

const STATUS: ServerStatus = { running: true, port: 27150, usingAlternativePort: false };

function mod(id: string, extra: Partial<HubModuleRegistration> = {}): HubModuleRegistration {
  return { id, name: `Module ${id}`, version: "1.0.0", apiVersion: 1, ...extra };
}

function build() {
  const events: Array<[string, unknown[]]> = [];
  const lifecycle = new EcosystemLifecycle((name, ...data) => {
    events.push([name, data]);
  });
  const registry = new ModuleRegistry({ supportedApiVersions: SUPPORTED_API_VERSIONS });
  const bus = new ServiceBus();
  const logged: ActivityInput[] = [];
  const activity: ActivitySink = {
    log: (e) => logged.push(e),
    begin: () => {
      throw new Error("unused");
    },
  };
  const runScript = vi.fn(async () => ({ exitCode: 0, stdout: "", stderr: "", durationMs: 1, killed: false }));
  const importClients = vi.fn(async () => 2);
  const api = new ProviderApi({
    registry,
    bus,
    lifecycle,
    runScript,
    activity,
    importClients,
    getServerStatus: () => STATUS,
  });
  return { api, registry, bus, lifecycle, events, logged, runScript, importClients };
}

describe("ProviderApi", () => {
  it("exposes the API version and readiness from the lifecycle", () => {
    const { api, lifecycle } = build();
    expect(api.apiVersion).toBe(AI_ECOSYSTEM_API_VERSION);
    expect(api.isReady()).toBe(false);
    lifecycle.announceReady(api);
    expect(api.isReady()).toBe(true);
    lifecycle.announceUnloading();
    expect(api.isReady()).toBe(false);
  });

  it("registerModule never throws and emits module-registered", () => {
    const { api, events } = build();
    expect(api.registerModule(mod("a")).ok).toBe(true);
    expect(events).toEqual([[ECOSYSTEM_EVENTS.moduleRegistered, ["a"]]]);
    expect(api.registerModule(mod("a", { apiVersion: 9 })).ok).toBe(false);
    expect(api.registerModule(null as unknown as HubModuleRegistration)).toMatchObject({ ok: false });
    expect(events).toHaveLength(1);
  });

  it("registerService before the module throws", () => {
    const { api } = build();
    expect(() => api.registerService("secrets", "env", {})).toThrow("Register the module env before its services");
  });

  it("lets AI Ecosystem itself own services", () => {
    const { api } = build();
    api.registerService("core", ECOSYSTEM_ID, 1);
    expect(api.getService("core")).toBe(1);
  });

  it("removes services on unregister but keeps them on re-register", () => {
    const { api, events } = build();
    api.registerModule(mod("env"));
    api.registerService("secrets", "env", { v: 1 });
    api.registerModule(mod("env", { version: "2.0.0" }));
    expect(api.getService("secrets")).toEqual({ v: 1 });
    expect(api.unregisterModule("env")).toBe(true);
    expect(api.getService("secrets")).toBeUndefined();
    expect(api.unregisterModule("env")).toBe(false);
    const names = events.map((e) => e[0]);
    expect(names).toContain(ECOSYSTEM_EVENTS.moduleUnregistered);
    expect(events.filter((e) => e[0] === ECOSYSTEM_EVENTS.serviceChanged)).toEqual([
      [ECOSYSTEM_EVENTS.serviceChanged, ["secrets", true]],
      [ECOSYSTEM_EVENTS.serviceChanged, ["secrets", false]],
    ]);
  });

  it("onServiceChange and unregisterService go through the bus", () => {
    const { api } = build();
    const cb = vi.fn();
    const off = api.onServiceChange(cb);
    api.registerModule(mod("m"));
    api.registerService("s", "m", 1);
    api.unregisterService("s");
    off();
    api.registerService("s", "m", 1);
    expect(cb.mock.calls).toEqual([
      ["s", true],
      ["s", false],
    ]);
  });

  it("updateTools and updatePrompts reach the registry", () => {
    const { api, registry } = build();
    api.registerModule(mod("m"));
    api.updateTools("m", [
      { name: "t", description: "d", inputSchema: { type: "object" }, handler: async () => ({ content: [] }) },
    ]);
    api.updatePrompts("m", [{ name: "p", handler: async () => ({ messages: [] }) }]);
    expect(registry.getModule("m")).toMatchObject({ toolNames: ["t"], promptNames: ["p"] });
    expect(() => api.updateTools("zzz", [])).toThrow();
  });

  it("runScript rejects unregistered callers and delegates for registered ones", async () => {
    const { api, runScript } = build();
    const options: HubScriptOptions = { language: "node", scriptPath: "a.js" };
    await expect(api.runScript(options, "ghost")).rejects.toThrow("Only registered modules can run scripts");
    expect(runScript).not.toHaveBeenCalled();
    api.registerModule(mod("m"));
    await api.runScript(options, "m");
    expect(runScript).toHaveBeenCalledWith(options, { moduleId: "m" });
    await api.runScript(options, ECOSYSTEM_ID);
    expect(runScript).toHaveBeenCalledTimes(2);
  });

  it("importClients requires a registered source module", async () => {
    const { api, importClients } = build();
    await expect(api.importClients([], "ghost")).rejects.toThrow();
    api.registerModule(mod("env"));
    await expect(api.importClients([], "env")).resolves.toBe(2);
    expect(importClients).toHaveBeenCalledWith([], "env");
  });

  it("logActivity maps the entry to an activity of kind module", () => {
    const { api, logged } = build();
    api.logActivity({ moduleId: "m", type: "Telegram", target: "send", status: 200, durationMs: 5, payload: { a: 1 }, response: "ok" });
    api.logActivity({ moduleId: "m", client: "Bot", type: "X", target: "y", status: 500, durationMs: 1 });
    expect(logged[0]).toEqual({
      kind: "module",
      method: "Telegram",
      target: "send",
      moduleId: "m",
      client: "module:m",
      status: 200,
      durationMs: 5,
      payload: { a: 1 },
      response: "ok",
    });
    expect(logged[1]?.client).toBe("Bot");
  });

  it("getServerStatus reports the registered module ids", () => {
    const { api } = build();
    api.registerModule(mod("a"));
    api.registerModule(mod("b"));
    expect(api.getServerStatus()).toEqual({ running: true, port: 27150, activeModules: ["a", "b"] });
  });
});

describe("createPublicApi", () => {
  it("is frozen and exposes only the interface keys", () => {
    const { api } = build();
    const pub = createPublicApi(api);
    expect(Object.isFrozen(pub)).toBe(true);
    expect(Object.keys(pub).sort()).toEqual(
      [
        "apiVersion",
        "beginActivity",
        "getServerStatus",
        "getService",
        "importClients",
        "isReady",
        "logActivity",
        "onServiceChange",
        "registerModule",
        "registerService",
        "runScript",
        "toolIndex",
        "unregisterModule",
        "unregisterService",
        "updatePrompts",
        "updateTools",
      ].sort(),
    );
    expect((pub as unknown as Record<string, unknown>).deps).toBeUndefined();
    expect(pub.apiVersion).toBe(AI_ECOSYSTEM_API_VERSION);
  });

  it("works through the bound methods", () => {
    const { api } = build();
    const pub: AIEcosystemAPI = createPublicApi(api);
    expect(pub.registerModule(mod("m")).ok).toBe(true);
    pub.registerService("s", "m", 7);
    expect(pub.getService("s")).toBe(7);
    expect(pub.getServerStatus().activeModules).toEqual(["m"]);
  });
});

describe("lifecycle events", () => {
  it("fires ready, unloading, server-status with the right payloads", () => {
    const { api, lifecycle, events } = build();
    lifecycle.announceReady(api);
    lifecycle.serverStatus(STATUS);
    lifecycle.announceUnloading();
    expect(events).toEqual([
      [ECOSYSTEM_EVENTS.ready, [api]],
      [ECOSYSTEM_EVENTS.serverStatus, [STATUS]],
      [ECOSYSTEM_EVENTS.unloading, []],
    ]);
  });

  it("survives a throwing trigger", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const lifecycle = new EcosystemLifecycle(() => {
      throw new Error("listener");
    });
    expect(() => lifecycle.moduleRegistered("a")).not.toThrow();
    expect(() => lifecycle.announceUnloading()).not.toThrow();
    warn.mockRestore();
  });

  it("load order: module registers, the AI Ecosystem reloads, the module registers again on ready", () => {
    // A tiny workspace: trigger() calls the listeners of that event name.
    const listeners = new Map<string, Array<(...a: unknown[]) => void>>();
    const trigger = (name: string, ...data: unknown[]) => {
      for (const cb of listeners.get(name) ?? []) cb(...data);
    };
    const on = (name: string, cb: (...a: unknown[]) => void) => {
      listeners.set(name, [...(listeners.get(name) ?? []), cb]);
    };

    let status = "waiting";
    const register = (api: AIEcosystemAPI) => {
      const res = api.registerModule(mod("env", { tools: [] }));
      if (res.ok) {
        api.registerService("secrets", "env", { locked: false });
        status = "connected";
      }
    };
    on(ECOSYSTEM_EVENTS.ready, (api) => register(api as AIEcosystemAPI));
    on(ECOSYSTEM_EVENTS.unloading, () => {
      status = "disconnected";
    });

    // First load: module listens before the AI Ecosystem is ready.
    const first = build();
    const firstLifecycle = new EcosystemLifecycle(trigger);
    expect(first.api.isReady()).toBe(false);
    const apiOne = new ProviderApi({
      registry: first.registry,
      bus: first.bus,
      lifecycle: firstLifecycle,
      runScript: first.runScript,
      activity: { log: () => undefined, begin: () => { throw new Error("unused"); } },
      importClients: first.importClients,
      getServerStatus: () => STATUS,
    });
    firstLifecycle.announceReady(createPublicApi(apiOne));
    expect(status).toBe("connected");
    expect(first.registry.has("env")).toBe(true);
    expect(apiOne.getService("secrets")).toEqual({ locked: false });

    // The AI Ecosystem unloads, then loads again with an empty registry and bus.
    firstLifecycle.announceUnloading();
    expect(status).toBe("disconnected");
    first.registry.clear();
    first.bus.clear();
    apiOne.dispose();

    const registry = new ModuleRegistry({ supportedApiVersions: SUPPORTED_API_VERSIONS });
    const bus = new ServiceBus();
    const lifecycle = new EcosystemLifecycle(trigger);
    const apiTwo = new ProviderApi({
      registry,
      bus,
      lifecycle,
      runScript: first.runScript,
      activity: { log: () => undefined, begin: () => { throw new Error("unused"); } },
      importClients: first.importClients,
      getServerStatus: () => STATUS,
    });
    expect(registry.has("env")).toBe(false);
    lifecycle.announceReady(createPublicApi(apiTwo));
    expect(status).toBe("connected");
    expect(registry.has("env")).toBe(true);
    expect(apiTwo.getService("secrets")).toEqual({ locked: false });
  });
});
