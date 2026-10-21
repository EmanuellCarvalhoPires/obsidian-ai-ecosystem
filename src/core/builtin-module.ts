// The AI Ecosystem's own module: GET /api/v1/ai-ecosystem/status, the ecosystem_status tool
// and the script tools and routes of the Script Engine.
import { AI_ECOSYSTEM_API_VERSION, ECOSYSTEM_ID } from "../types";
import type { HubModuleRegistration, HubRoute, HubTool, ModuleInfo, ServerStatus, ServiceInfo } from "../types";
import { createScriptRoutes, createScriptTools } from "../runner/script-tools";
import type { ScriptToolsDeps } from "../runner/script-tools";
import type { ScreenService } from "../screens/service";
import { createScreenTools } from "../screens/tools";
import type { SetupManager } from "../setup/setup-manager";
import { createSetupTools } from "../setup/setup-tools";

export const BASE_MCP_INSTRUCTIONS =
  "This is the AI Ecosystem server of an Obsidian vault. " +
  "Its tools come from the modules installed in the vault; call ecosystem_status to see which modules and services are active. " +
  "Scripts run only from the folders the user allowed (or from notes tagged #mcp/script): use ecosystem_list_scripts to see them and ecosystem_run_script to run one.";

export interface BuiltinModuleDeps {
  version: string;
  getServerStatus: () => ServerStatus;
  listModules: () => ModuleInfo[];
  listServices: () => ServiceInfo[];
  scripts: ScriptToolsDeps;
  /** The saved screens. Their tools (tela_criar... and tela_<slug>) are part of this module. */
  screens?: ScreenService;
  /** The guided setup. Its tools (ecosystem_setup_*) are part of this module and never hidden. */
  setup?: SetupManager;
}

export interface EcosystemStatus {
  version: string;
  apiVersion: number;
  server: ServerStatus;
  modules: ModuleInfo[];
  services: ServiceInfo[];
}

export function buildStatus(deps: BuiltinModuleDeps): EcosystemStatus {
  return {
    version: deps.version,
    apiVersion: AI_ECOSYSTEM_API_VERSION,
    server: deps.getServerStatus(),
    modules: deps.listModules(),
    services: deps.listServices(),
  };
}

export function formatStatusText(status: EcosystemStatus): string {
  const { server } = status;
  const lines = [
    `AI Ecosystem ${status.version} (Provider API ${status.apiVersion}).`,
    server.running
      ? `Server: running on 127.0.0.1:${server.port}${server.usingAlternativePort ? " (not the configured port)" : ""}.`
      : `Server: stopped${server.error ? ` (${server.error})` : ""}.`,
    "Modules:",
  ];
  for (const m of status.modules) {
    lines.push(`- ${m.id} (${m.name} ${m.version}): ${m.toolNames.length} tools, ${m.promptNames.length} prompts, ${m.routeCount} routes`);
    for (const warning of m.warnings) lines.push(`  warning: ${warning}`);
  }
  lines.push(status.services.length ? "Services:" : "Services: none");
  for (const s of status.services) lines.push(`- ${s.name} (provided by ${s.ownerModuleId})`);
  return lines.join("\n");
}

/**
 * The tools of the module: the static ones plus the screen tools. The screen tools change while
 * the plugin runs, so the registry is given this list again (updateTools) whenever they do.
 */
export function createBuiltinTools(deps: BuiltinModuleDeps): HubTool[] {
  const statusTool: HubTool = {
    name: "ecosystem_status",
    title: "AI Ecosystem status",
    description: "Shows the AI Ecosystem version, the server status, the registered modules (with their tools) and the available services.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { title: "AI Ecosystem status", readOnlyHint: true, openWorldHint: false },
    handler: () => {
      const status = buildStatus(deps);
      return Promise.resolve({
        content: [{ type: "text", text: formatStatusText(status) }],
        structuredContent: { ...status },
      });
    },
  };
  return [
    statusTool,
    ...createScriptTools(deps.scripts),
    ...(deps.setup ? createSetupTools(deps.setup) : []),
    ...(deps.screens ? createScreenTools(deps.screens) : []),
  ];
}

export function createBuiltinModule(deps: BuiltinModuleDeps): HubModuleRegistration {
  const statusRoute: HubRoute = {
    method: "GET",
    path: "/status",
    description: "Version, server status, modules and services.",
    handler: () => ({ status: 200, body: buildStatus(deps) }),
  };

  return {
    id: ECOSYSTEM_ID,
    name: "AI Ecosystem",
    version: deps.version,
    apiVersion: AI_ECOSYSTEM_API_VERSION,
    routes: [statusRoute, ...createScriptRoutes(deps.scripts)],
    tools: createBuiltinTools(deps),
  };
}
