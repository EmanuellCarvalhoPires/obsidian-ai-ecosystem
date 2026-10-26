import { describe, expect, it } from "vitest";
import {
  BASE_MCP_INSTRUCTIONS,
  CORE_TOOL_METADATA,
  INDEXED_MCP_INSTRUCTIONS,
  buildStatus,
  createBuiltinModule,
  formatStatusText,
  withCoreMetadata,
} from "../../src/core/builtin-module";
import type { BuiltinModuleDeps } from "../../src/core/builtin-module";
import type { HubRequest, ModuleInfo, ServerStatus, ServiceInfo } from "../../src/types";

const modules: ModuleInfo[] = [
  {
    id: "environment-variables",
    name: "Environment Keys",
    version: "2.0.0",
    apiVersion: 1,
    registeredAt: 1,
    routeCount: 1,
    legacyAliasPaths: ["/v1/request"],
    toolNames: ["http_request", "list_secrets"],
    promptNames: [],
    warnings: ["Skipped tool x"],
  },
];
const services: ServiceInfo[] = [{ name: "secrets", ownerModuleId: "environment-variables", registeredAt: 1 }];
const server: ServerStatus = { running: true, port: 27150, usingAlternativePort: false };

function deps(overrides: Partial<BuiltinModuleDeps> = {}): BuiltinModuleDeps {
  return {
    version: "1.0.0",
    getServerStatus: () => server,
    listModules: () => modules,
    listServices: () => services,
    scripts: {
      engine: {} as never,
      vaultBasePath: "/vault",
      getSettings: () => ({ allowedFolders: [], restrictionsDisabled: false, maxTimeoutSeconds: 300, interpreterPaths: {} }),
      getDeclaredScripts: () => [],
    },
    ...overrides,
  };
}

const request: HubRequest = {
  method: "GET",
  path: "/status",
  fullPath: "/api/v1/ai-ecosystem/status",
  params: {},
  query: {},
  headers: {},
  body: "",
  rawBody: "",
  client: { id: "c", name: "Test" },
};

describe("built-in module", () => {
  it("has the expected identity, tools and routes", () => {
    const module = createBuiltinModule(deps());
    expect(module).toMatchObject({ id: "ai-ecosystem", name: "AI Ecosystem", version: "1.0.0", apiVersion: 1 });
    expect(module.tools?.map((t) => t.name)).toEqual(["ecosystem_status", "ecosystem_diagnostico", "ecosystem_list_scripts", "ecosystem_run_script"]);
    expect(module.routes?.map((r) => `${r.method} ${r.path}`)).toEqual(["GET /status", "GET /scripts", "POST /scripts/run"]);
  });

  it("ecosystem_status is read-only and returns text and structured content", async () => {
    const tool = createBuiltinModule(deps()).tools?.find((t) => t.name === "ecosystem_status");
    expect(tool?.annotations?.readOnlyHint).toBe(true);
    const result = await tool!.handler({}, { client: request.client, moduleId: "ai-ecosystem" });
    expect(result.isError).toBeUndefined();
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("AI Ecosystem 1.0.0");
    expect(text).toContain("running on 127.0.0.1:27150");
    expect(text).toContain("environment-variables (Environment Keys 2.0.0): 2 tools");
    expect(text).toContain("warning: Skipped tool x");
    expect(text).toContain("secrets (provided by environment-variables)");
    expect(result.structuredContent).toMatchObject({ version: "1.0.0", apiVersion: 1, server, services });
    expect((result.structuredContent as { modules: ModuleInfo[] }).modules[0]?.toolNames).toEqual(["http_request", "list_secrets"]);
  });

  it("GET /status returns the same data as JSON without handlers", async () => {
    const route = createBuiltinModule(deps()).routes?.find((r) => r.path === "/status");
    const res = await route!.handler(request);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(buildStatus(deps()));
    expect(JSON.parse(JSON.stringify(res.body))).toEqual(res.body);
  });

  it("describes a stopped server and no services", () => {
    const text = formatStatusText(
      buildStatus(deps({ getServerStatus: () => ({ running: false, port: 27150, usingAlternativePort: false, error: "boom" }), listServices: () => [] })),
    );
    expect(text).toContain("Server: stopped (boom).");
    expect(text).toContain("Services: none");
  });

  it("ships short MCP instructions that mention the scripts and ecosystem_status", () => {
    expect(BASE_MCP_INSTRUCTIONS).toContain("ecosystem_status");
    expect(BASE_MCP_INSTRUCTIONS).toContain("ecosystem_run_script");
    expect(BASE_MCP_INSTRUCTIONS.split(". ").length).toBeLessThanOrEqual(5);
  });
});

describe("index metadata of the core tools", () => {
  it("covers the 11 core tools with a category, a short summary and an effect", () => {
    expect(Object.keys(CORE_TOOL_METADATA).sort()).toEqual([
      "ecosystem_diagnostico",
      "ecosystem_list_scripts",
      "ecosystem_run_script",
      "ecosystem_setup_complete",
      "ecosystem_setup_save",
      "ecosystem_setup_status",
      "ecosystem_status",
      "tela_criar",
      "tela_editar",
      "tela_listar",
      "tela_remover",
    ]);
    for (const [name, meta] of Object.entries(CORE_TOOL_METADATA)) {
      expect(meta.categoria, name).toBeTruthy();
      expect(meta.efeito, name).toMatch(/^(leitura|cofre|externo)$/);
      expect((meta.resumo ?? "").length, name).toBeLessThanOrEqual(100);
      expect(meta.tags?.length, name).toBeGreaterThan(0);
    }
  });

  it("adds the metadata to the built-in tools, screen tools included, without replacing a tool's own", () => {
    const tools = createBuiltinModule(deps()).tools ?? [];
    expect(tools.find((t) => t.name === "ecosystem_run_script")).toMatchObject({ categoria: "scripts", efeito: "externo" });
    const screen = withCoreMetadata({ name: "tela_cadastro", description: "x", inputSchema: {}, handler: async () => ({ content: [] }) });
    expect(screen).toMatchObject({ categoria: "telas", efeito: "cofre" });
    const own = withCoreMetadata({ name: "ecosystem_status", description: "x", inputSchema: {}, efeito: "cofre", handler: async () => ({ content: [] }) });
    expect(own.efeito).toBe("cofre");
    expect(INDEXED_MCP_INSTRUCTIONS).toContain("tools_find");
  });
});
