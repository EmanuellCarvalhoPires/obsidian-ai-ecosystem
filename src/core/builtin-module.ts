// The AI Ecosystem's own module: GET /api/v1/ai-ecosystem/status, the ecosystem_status tool
// and the script tools and routes of the Script Engine.
import { AI_ECOSYSTEM_API_VERSION, APPROVAL_WAIVED, ECOSYSTEM_ID } from "../types";
import type { HubModuleRegistration, HubRoute, HubTool, ModuleInfo, ServerStatus, ServiceInfo } from "../types";
import { createScriptRoutes, createScriptTools } from "../runner/script-tools";
import type { ScriptToolsDeps } from "../runner/script-tools";
import type { ScreenService } from "../screens/service";
import { createScreenTools } from "../screens/tools";
import type { SetupManager } from "../setup/setup-manager";
import { createSetupTools } from "../setup/setup-tools";
import { createDiscoveryTools } from "../tool-index/discovery-tools";
import type { DiscoveryToolsDeps } from "../tool-index/discovery-tools";

export const BASE_MCP_INSTRUCTIONS =
  "This is the AI Ecosystem server of an Obsidian vault. " +
  "Its tools come from the modules installed in the vault; call ecosystem_status to see which modules and services are active. " +
  "Scripts run only from the folders the user allowed (or from notes tagged #mcp/script): use ecosystem_list_scripts to see them and ecosystem_run_script to run one.";

/** Appended to the instructions of a client in indexado mode. */
export const INDEXED_MCP_INSTRUCTIONS =
  "Most tools of this server are not in your tool list: find them with tools_find (q, tag, categoria, modulo, kind, efeito). " +
  "Each line is `id(required*, optional?) | summary | effect`, and the signature usually tells you the arguments already. " +
  'Run a tool with tools_run {"id": "<id>", "args": {...}}; its answer comes back unchanged. ' +
  "Call tools_describe (id, or ids for several at once) only when the signature is not enough. " +
  "Once you have a tool's schema in this session, call tools_run directly without describing it again. " +
  "Tools with effect externo ask the user before they run.";

/**
 * Index metadata of the core's own tools (tools.db of the AI Ecosystem). The screen tools
 * tela_<slug> share one entry (SCREEN_TOOL_METADATA).
 */
export const CORE_TOOL_METADATA: Record<string, Pick<HubTool, "categoria" | "tags" | "resumo" | "efeito" | "exposicao" | "aprovacao" | "exemplo">> = {
  ecosystem_status: {
    categoria: "ecosystem",
    tags: ["status", "modulos", "servicos", "diagnostico", "versao", "modules"],
    resumo: "Versão, servidor, módulos registrados (com as tools) e serviços do AI Ecosystem",
    efeito: "leitura",
  },
  ecosystem_list_scripts: {
    categoria: "scripts",
    tags: ["scripts", "listar", "python", "node", "powershell", "bash"],
    resumo: "Lista os scripts do cofre que podem rodar (pastas permitidas e notas #mcp/script)",
    efeito: "leitura",
  },
  ecosystem_run_script: {
    categoria: "scripts",
    tags: ["scripts", "executar", "python", "node", "powershell", "bash", "run"],
    resumo: "Executa um script do cofre e devolve código de saída, stdout e stderr",
    efeito: "externo",
    aprovacao: "Posso executar o script {path}?",
    exemplo: { path: "scripts/contexto_tickets.py", args: ["--instancia", "Acme", "ATL-400"] },
  },
  ecosystem_setup_status: {
    categoria: "setup",
    tags: ["setup", "configuracao", "modulo", "status"],
    resumo: "O que o plugin detectou, as respostas e as perguntas da configuração de um módulo",
    efeito: "leitura",
  },
  ecosystem_setup_save: {
    categoria: "setup",
    tags: ["setup", "configuracao", "resposta", "salvar"],
    resumo: "Grava uma resposta da configuração guiada de um módulo",
    efeito: "cofre",
  },
  ecosystem_setup_complete: {
    categoria: "setup",
    tags: ["setup", "configuracao", "concluir", "hooks"],
    resumo: "Conclui a configuração de um módulo (marcador, hooks de proteção, tools liberadas)",
    efeito: "cofre",
  },
  tela_criar: {
    categoria: "telas",
    tags: ["tela", "formulario", "criar", "screen", "form"],
    resumo: "Cria uma tela (formulário) no Obsidian; salva só depois da aprovação do usuário",
    efeito: "cofre",
  },
  tela_listar: {
    categoria: "telas",
    tags: ["tela", "formulario", "listar", "screen"],
    resumo: "Lista as telas salvas e as tools tela_<slug> que elas criam",
    efeito: "leitura",
  },
  tela_editar: {
    categoria: "telas",
    tags: ["tela", "formulario", "editar", "screen"],
    resumo: "Altera uma tela salva; grava só depois da aprovação do usuário",
    efeito: "cofre",
  },
  tela_remover: {
    categoria: "telas",
    tags: ["tela", "formulario", "remover", "apagar", "screen"],
    resumo: "Remove uma tela salva e a tool tela_<slug> dela",
    efeito: "cofre",
    // The screen itself asks the user in Obsidian before removing.
    aprovacao: APPROVAL_WAIVED,
  },
};

/** Index metadata of every saved screen tool (tela_<slug>): the user fills the form in Obsidian. */
export const SCREEN_TOOL_METADATA: Pick<HubTool, "categoria" | "tags" | "efeito"> = {
  categoria: "telas",
  tags: ["tela", "formulario", "pedir dados", "screen", "form"],
  efeito: "cofre",
};

/** Adds the index metadata to the core tools that have none of their own. */
export function withCoreMetadata(tool: HubTool): HubTool {
  const meta = CORE_TOOL_METADATA[tool.name] ?? (tool.name.startsWith("tela_") ? SCREEN_TOOL_METADATA : undefined);
  if (!meta) return tool;
  const out: HubTool = { ...tool };
  for (const [key, value] of Object.entries(meta) as Array<[keyof typeof meta, unknown]>) {
    if (out[key] === undefined && value !== undefined) (out as unknown as Record<string, unknown>)[key] = value;
  }
  return out;
}

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
  /** Indexed discovery (tools_find, tools_describe, tools_run). */
  discovery?: DiscoveryToolsDeps;
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
    ...(deps.discovery ? createDiscoveryTools(deps.discovery) : []),
    ...(deps.screens ? createScreenTools(deps.screens) : []),
  ].map(withCoreMetadata);
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
