import { describe, expect, it, vi } from "vitest";
import { ModuleRegistry } from "../../src/registry/module-registry";
import type {
  HttpMethod,
  HubModuleRegistration,
  HubPrompt,
  HubRoute,
  HubTool,
  RegistryChange,
} from "../../src/types";

function route(method: HttpMethod, path: string): HubRoute {
  return { method, path, handler: () => ({ status: 200 }) };
}

function tool(name: string): HubTool {
  return {
    name,
    description: "d",
    inputSchema: { type: "object" },
    handler: async () => ({ content: [] }),
  };
}

function prompt(name: string): HubPrompt {
  return { name, handler: async () => ({ messages: [] }) };
}

function mod(id: string, extra: Partial<HubModuleRegistration> = {}): HubModuleRegistration {
  return { id, name: `Module ${id}`, version: "1.0.0", apiVersion: 1, ...extra };
}

function make() {
  const changes: RegistryChange[] = [];
  const registry = new ModuleRegistry({ supportedApiVersions: [1], onChange: (c) => changes.push(c) });
  return { registry, changes };
}

describe("register", () => {
  it("registers a module and emits an event", () => {
    const { registry, changes } = make();
    expect(registry.register(mod("a-1"))).toEqual({ ok: true, warnings: [] });
    expect(registry.has("a-1")).toBe(true);
    expect(registry.getModule("a-1")).toMatchObject({ id: "a-1", name: "Module a-1", apiVersion: 1 });
    expect(changes).toEqual([{ type: "module-registered", moduleId: "a-1" }]);
  });

  it("rejects invalid ids, names and versions", () => {
    const { registry } = make();
    for (const id of ["", "A", "-a", "a b", "a/b", "x".repeat(65)]) {
      expect(registry.register(mod(id)).ok).toBe(false);
    }
    expect(registry.register(mod("a", { name: "" })).ok).toBe(false);
    expect(registry.register(mod("a", { version: " " })).ok).toBe(false);
    expect(registry.listModules()).toEqual([]);
  });

  it("rejects unsupported API versions with the reason", () => {
    const { registry } = make();
    expect(registry.register(mod("a", { apiVersion: 2 }))).toEqual({
      ok: false,
      reason: "Module a needs Provider API v2, but this AI Ecosystem supports v1. Update AI Ecosystem.",
    });
    expect(registry.register(mod("a", { apiVersion: undefined as unknown as number })).ok).toBe(false);
    expect(registry.register(mod("a", { apiVersion: "1" as unknown as number })).ok).toBe(true);
  });

  it("re-registering replaces the module without calling the old onUnload", () => {
    const { registry, changes } = make();
    const first = vi.fn();
    registry.register(mod("a", { onUnload: first, tools: [tool("t1")] }));
    registry.register(mod("a", { tools: [tool("t2")] }));
    expect(first).not.toHaveBeenCalled();
    expect(registry.listTools().map((t) => t.tool.name)).toEqual(["t2"]);
    expect(changes.map((c) => c.type)).toEqual(["module-registered", "module-registered"]);
  });

  it("unregister calls onUnload once, swallows errors and emits", () => {
    const { registry, changes } = make();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const onUnload = vi.fn(() => {
      throw new Error("bad");
    });
    registry.register(mod("a", { onUnload }));
    expect(registry.unregister("a")).toBe(true);
    expect(registry.unregister("a")).toBe(false);
    expect(onUnload).toHaveBeenCalledTimes(1);
    expect(changes.map((c) => c.type)).toEqual(["module-registered", "module-unregistered"]);
    warn.mockRestore();
  });

  it("clear unregisters everything", () => {
    const { registry, changes } = make();
    const u1 = vi.fn();
    const u2 = vi.fn();
    registry.register(mod("a", { onUnload: u1 }));
    registry.register(mod("b", { onUnload: u2 }));
    registry.clear();
    expect(u1).toHaveBeenCalledTimes(1);
    expect(u2).toHaveBeenCalledTimes(1);
    expect(registry.listModules()).toEqual([]);
    expect(changes.filter((c) => c.type === "module-unregistered")).toHaveLength(2);
  });

  it("keeps a registry listener error from breaking registration", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const registry = new ModuleRegistry({
      supportedApiVersions: [1],
      onChange: () => {
        throw new Error("x");
      },
    });
    expect(registry.register(mod("a")).ok).toBe(true);
    warn.mockRestore();
  });
});

describe("routes", () => {
  it("matches module routes under /api/v1/<id>", () => {
    const { registry } = make();
    registry.register(mod("m", { routes: [route("GET", "/items/:id"), route("POST", "/")] }));
    const m = registry.findRoute("GET", "/api/v1/m/items/42");
    expect(m).toMatchObject({ moduleId: "m", path: "/items/42", params: { id: "42" }, legacy: false });
    expect(registry.findRoute("POST", "/api/v1/m")?.path).toBe("/");
    expect(registry.findRoute("POST", "/api/v1/m/")?.path).toBe("/");
    expect(registry.findRoute("GET", "/api/v1/other/items/1")).toBeUndefined();
    expect(registry.findRoute("DELETE", "/api/v1/m/items/1")).toBeUndefined();
    expect(registry.findRoute("GET", "/items/1")).toBeUndefined();
  });

  it("decodes params, ignores trailing slash and the query string", () => {
    const { registry } = make();
    registry.register(mod("m", { routes: [route("GET", "/items/:name")] }));
    expect(registry.findRoute("GET", "/api/v1/m/items/a%20b/")?.params).toEqual({ name: "a b" });
    expect(registry.findRoute("GET", "/api/v1/m/items/x?y=1")?.params).toEqual({ name: "x" });
    expect(registry.findRoute("GET", "/api/v1/m/items/%E0%A4%A")?.params).toEqual({ name: "%E0%A4%A" });
  });

  it("prefers literal segments over params", () => {
    const { registry } = make();
    const literal = route("GET", "/items/special");
    const param = route("GET", "/items/:id");
    registry.register(mod("m", { routes: [param, literal] }));
    expect(registry.findRoute("GET", "/api/v1/m/items/special")?.route).toBe(literal);
    expect(registry.findRoute("GET", "/api/v1/m/items/other")?.route).toBe(param);
  });

  it("skips invalid routes with a warning", () => {
    const { registry } = make();
    const result = registry.register(
      mod("m", {
        routes: [
          route("GET", "items"),
          route("GET", "/a/../b"),
          route("GET", "/a//b"),
          route("GET", "/:"),
          route("TRACE" as HttpMethod, "/x"),
          { method: "GET", path: "/nohandler" } as unknown as HubRoute,
          route("GET", "/ok"),
        ],
      }),
    );
    expect(result.ok && result.warnings).toHaveLength(6);
    expect(registry.getModule("m")?.routeCount).toBe(1);
    expect(registry.getModule("m")?.warnings).toHaveLength(6);
  });

  it("allowedMethods lists the methods that match a path", () => {
    const { registry } = make();
    registry.register(
      mod("m", {
        routes: [route("GET", "/x/:id"), route("DELETE", "/x/1"), route("POST", "/y")],
        legacyAliases: [route("GET", "/v1/request"), route("POST", "/v1/request")],
      }),
    );
    expect(registry.allowedMethods("/api/v1/m/x/1").sort()).toEqual(["DELETE", "GET"]);
    expect(registry.allowedMethods("/api/v1/m/y")).toEqual(["POST"]);
    expect(registry.allowedMethods("/api/v1/m/none")).toEqual([]);
    expect(registry.allowedMethods("/v1/request")).toEqual(["GET", "POST"]);
  });
});

describe("legacy aliases", () => {
  it("matches at the root with the full path and the legacy flag", () => {
    const { registry } = make();
    registry.register(mod("m", { legacyAliases: [route("POST", "/v1/request")] }));
    expect(registry.findRoute("POST", "/v1/request")).toMatchObject({
      moduleId: "m",
      path: "/v1/request",
      legacy: true,
    });
    expect(registry.getModule("m")?.legacyAliasPaths).toEqual(["/v1/request"]);
  });

  it("skips reserved paths", () => {
    const { registry } = make();
    const result = registry.register(
      mod("m", {
        legacyAliases: [
          route("GET", "/health"),
          route("GET", "/v1/health"),
          route("POST", "/mcp"),
          route("POST", "/mcp/x"),
          route("GET", "/api"),
          route("GET", "/api/v1/x"),
          route("GET", "/v1/other"),
        ],
      }),
    );
    expect(result.ok && result.warnings).toHaveLength(6);
    expect(registry.getModule("m")?.legacyAliasPaths).toEqual(["/v1/other"]);
  });

  it("skips aliases owned by another module, even with other param names", () => {
    const { registry } = make();
    registry.register(mod("a", { legacyAliases: [route("GET", "/v1/x/:id")] }));
    const result = registry.register(
      mod("b", { legacyAliases: [route("GET", "/v1/x/:other"), route("POST", "/v1/x/:id")] }),
    );
    expect(result.ok && result.warnings).toHaveLength(1);
    expect(registry.findRoute("GET", "/v1/x/1")?.moduleId).toBe("a");
    expect(registry.findRoute("POST", "/v1/x/1")?.moduleId).toBe("b");
  });

  it("lets a module re-register its own aliases", () => {
    const { registry } = make();
    registry.register(mod("a", { legacyAliases: [route("GET", "/v1/x")] }));
    const result = registry.register(mod("a", { legacyAliases: [route("GET", "/v1/x")] }));
    expect(result).toEqual({ ok: true, warnings: [] });
  });
});

describe("tools, prompts and instructions", () => {
  it("lists tools in registration order and finds them", () => {
    const { registry } = make();
    registry.register(mod("a", { tools: [tool("t1"), tool("t2")] }));
    registry.register(mod("b", { tools: [tool("t3")] }));
    expect(registry.listTools().map((t) => `${t.moduleId}:${t.tool.name}`)).toEqual(["a:t1", "a:t2", "b:t3"]);
    expect(registry.findTool("t3")?.moduleId).toBe("b");
    expect(registry.findTool("zzz")).toBeUndefined();
  });

  it("skips a tool name owned by another module (first wins) and invalid tools", () => {
    const { registry } = make();
    registry.register(mod("a", { tools: [tool("t1")] }));
    const result = registry.register(
      mod("b", {
        tools: [
          tool("t1"),
          tool("bad name"),
          { ...tool("x"), inputSchema: undefined } as unknown as HubTool,
          tool("t2"),
          tool("t2"),
        ],
      }),
    );
    expect(result.ok && result.warnings).toHaveLength(4);
    expect(registry.findTool("t1")?.moduleId).toBe("a");
    expect(registry.getModule("b")?.toolNames).toEqual(["t2"]);
  });

  it("handles prompt conflicts the same way", () => {
    const { registry } = make();
    registry.register(mod("a", { prompts: [prompt("p1")] }));
    const result = registry.register(mod("b", { prompts: [prompt("p1"), prompt("p2")] }));
    expect(result.ok && result.warnings).toHaveLength(1);
    expect(registry.listPrompts().map((p) => `${p.moduleId}:${p.prompt.name}`)).toEqual(["a:p1", "b:p2"]);
    expect(registry.findPrompt("p2")?.moduleId).toBe("b");
  });

  it("updateTools replaces tools, emits and reports warnings", () => {
    const { registry, changes } = make();
    registry.register(mod("a", { tools: [tool("t1")] }));
    registry.register(mod("b", { tools: [tool("mine")] }));
    changes.length = 0;
    const warnings = registry.updateTools("a", [tool("t9"), tool("mine")]);
    expect(warnings).toHaveLength(1);
    expect(registry.getModule("a")?.toolNames).toEqual(["t9"]);
    expect(registry.getModule("a")?.warnings).toEqual(warnings);
    expect(changes).toEqual([{ type: "tools-changed", moduleId: "a" }]);
  });

  it("updatePrompts replaces prompts and emits", () => {
    const { registry, changes } = make();
    registry.register(mod("a"));
    changes.length = 0;
    registry.updatePrompts("a", [prompt("p")]);
    expect(registry.getModule("a")?.promptNames).toEqual(["p"]);
    expect(changes).toEqual([{ type: "prompts-changed", moduleId: "a" }]);
  });

  it("updateTools and updatePrompts throw for an unknown module", () => {
    const { registry } = make();
    expect(() => registry.updateTools("nope", [])).toThrow("Module nope is not registered");
    expect(() => registry.updatePrompts("nope", [])).toThrow("Module nope is not registered");
  });

  it("lists trimmed non-empty instructions in order", () => {
    const { registry } = make();
    registry.register(mod("a", { instructions: "  Use placeholders.  " }));
    registry.register(mod("b"));
    registry.register(mod("c", { instructions: "   " }));
    registry.register(mod("d", { instructions: "Second." }));
    expect(registry.listInstructions()).toEqual([
      { moduleId: "a", text: "Use placeholders." },
      { moduleId: "d", text: "Second." },
    ]);
  });
});

describe("change events", () => {
  it("are emitted in order", () => {
    const { registry, changes } = make();
    registry.register(mod("a"));
    registry.updateTools("a", []);
    registry.updatePrompts("a", []);
    registry.unregister("a");
    expect(changes).toEqual([
      { type: "module-registered", moduleId: "a" },
      { type: "tools-changed", moduleId: "a" },
      { type: "prompts-changed", moduleId: "a" },
      { type: "module-unregistered", moduleId: "a" },
    ]);
  });
});
