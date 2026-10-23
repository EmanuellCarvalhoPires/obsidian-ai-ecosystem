// The three tools of indexed discovery: tools_find, tools_describe and tools_run. Pure Node.
import { toolRunnerServiceName } from "../types";
import type { ClientKind, HubCallContext, HubTool, HubToolResult, IndexedToolRunner, RegisteredTool } from "../types";
import { DEFAULT_FIND_LIMIT, MAX_FIND_LIMIT } from "./federation";
import type { FindQuery, IndexedTool, ToolFederation } from "./federation";

export const MAX_DESCRIBE_IDS = 20;
const MAX_SIGNATURE_PARAMS = 8;
const MAX_DEFAULT_LENGTH = 20;
const SLIM_DESCRIPTION = 300;
const SLIM_PROPERTY_DESCRIPTION = 80;

export interface DiscoveryToolsDeps {
  federation: ToolFederation;
  /** The live registry: tools_run always runs what is registered now, never a stale index row. */
  findTool: (name: string) => RegisteredTool | undefined;
  getService: <T>(name: string) => T | undefined;
  /** Same rule as tools/list (e.g. a module still waiting for its setup is hidden from Claude Code). */
  isHidden?: (moduleId: string, tool: HubTool | undefined, kind: ClientKind | undefined) => boolean;
  /** Told about the result of the tool tools_run ran, under the module that owns it. */
  onToolResult?: (moduleId: string, isError: boolean) => void;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: string, isError = false): HubToolResult {
  const result: HubToolResult = { content: [{ type: "text", text: value }] };
  if (isError) result.isError = true;
  return result;
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`;
}

function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

/** `name(required*, optional?, withDefault=[])`: the parameters of a JSON Schema, required first. */
export function toolSignature(name: string, schema: Record<string, unknown> | undefined): string {
  const properties = isObject(schema?.properties) ? schema.properties : {};
  const required = new Set(Array.isArray(schema?.required) ? schema.required.filter((r): r is string => typeof r === "string") : []);
  const keys = Object.keys(properties);
  const ordered = [...keys.filter((k) => required.has(k)), ...keys.filter((k) => !required.has(k))];
  const parts = ordered.slice(0, MAX_SIGNATURE_PARAMS).map((key) => {
    if (required.has(key)) return `${key}*`;
    const prop = properties[key];
    if (isObject(prop) && "default" in prop) {
      const json = JSON.stringify(prop.default);
      if (json !== undefined && json.length <= MAX_DEFAULT_LENGTH) return `${key}=${json}`;
    }
    return `${key}?`;
  });
  if (ordered.length > MAX_SIGNATURE_PARAMS) parts.push("…");
  return `${name}(${parts.join(", ")})`;
}

/** One line of tools_find: `signature | summary | effect`. */
export function findLine(tool: Pick<IndexedTool, "name" | "inputSchema" | "resumo" | "efeito">): string {
  const resumo = (tool.resumo || "-").replace(/[\r\n]+/g, " ").replace(/\|/g, "/");
  return `${toolSignature(tool.name, tool.inputSchema)} | ${resumo} | ${tool.efeito}`;
}

const DROPPED_SCHEMA_KEYS = new Set(["$schema", "$id", "$comment", "title", "examples"]);

/** The JSON Schema without decoration: titles, examples and boolean additionalProperties go, descriptions are cut. */
export function slimSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(slimSchema);
  if (!isObject(node)) return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (DROPPED_SCHEMA_KEYS.has(key)) continue;
    if (key === "additionalProperties" && typeof value === "boolean") continue;
    if (key === "description" && typeof value === "string") {
      out[key] = truncate(value, SLIM_PROPERTY_DESCRIPTION);
    } else if (key === "properties" && isObject(value)) {
      const props: Record<string, unknown> = {};
      for (const [name, prop] of Object.entries(value)) props[name] = slimSchema(prop);
      out[key] = props;
    } else {
      out[key] = slimSchema(value);
    }
  }
  return out;
}

/** The index entry, completed with the live definition when the tool is registered (the index may lag). */
function current(entry: IndexedTool, registered: RegisteredTool | undefined): IndexedTool {
  if (!registered) return entry;
  return { ...entry, description: registered.tool.description, inputSchema: registered.tool.inputSchema, title: registered.tool.title ?? entry.title };
}

function describeOne(entry: IndexedTool, full: boolean): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: entry.name,
    modulo: entry.moduleId,
    kind: entry.kind,
    efeito: entry.efeito,
  };
  if (entry.aprovacao) out.aprovacao = entry.aprovacao;
  if (entry.categoria) out.categoria = entry.categoria;
  if (entry.tags.length) out.tags = entry.tags;
  out.resumo = entry.resumo;
  out.assinatura = toolSignature(entry.name, entry.inputSchema);
  if (full) {
    if (entry.title) out.titulo = entry.title;
    out.descricao = entry.description;
    out.schema = entry.inputSchema ?? { type: "object" };
  } else {
    if (entry.description && entry.description !== entry.resumo) out.descricao = truncate(entry.description, SLIM_DESCRIPTION);
    out.schema = slimSchema(entry.inputSchema ?? { type: "object" });
  }
  if (entry.exemplo) out.exemplo = entry.exemplo;
  out.exposicao = entry.exposicao;
  return out;
}

function hiddenText(moduleId: string): string {
  return `The module "${moduleId}" has not been set up yet, so its tools are not available. Run the skill configurar-${moduleId} first.`;
}

export function createDiscoveryTools(deps: DiscoveryToolsDeps): HubTool[] {
  const hidden = (moduleId: string, tool: HubTool | undefined, ctx: HubCallContext): boolean => {
    try {
      return deps.isHidden?.(moduleId, tool, ctx.clientKind) === true;
    } catch {
      return false;
    }
  };

  const find: HubTool = {
    name: "tools_find",
    title: "Find tools",
    description:
      "Finds the tools of every module of this vault (most of them are not in the tool list): free text (q) and/or filters. " +
      "Each line is `id(required*, optional?, withDefault=value) | summary | effect` (leitura, cofre or externo). " +
      "Run one with tools_run; call tools_describe only when the signature is not enough.",
    inputSchema: {
      type: "object",
      properties: {
        q: { type: "string", description: "Words to search in the name, summary, category, tags and description (BM25)." },
        tag: { type: "string" },
        categoria: { type: "string", description: "Category, e.g. \"git\" or \"git/leitura\"." },
        modulo: { type: "string", description: "Module id, e.g. \"ai-git-tools\"." },
        kind: { type: "string", enum: ["tool", "script", "template", "api"] },
        efeito: { type: "string", enum: ["leitura", "cofre", "externo"] },
        limit: { type: "integer", minimum: 1, maximum: MAX_FIND_LIMIT, default: DEFAULT_FIND_LIMIT },
      },
      additionalProperties: false,
    },
    annotations: { title: "Find tools", readOnlyHint: true, openWorldHint: false },
    categoria: "descoberta",
    tags: ["buscar", "tools", "indice", "search", "find"],
    resumo: "Busca tools de todos os módulos por texto, tag, categoria, módulo, tipo ou efeito",
    efeito: "leitura",
    exposicao: "fixa",
    handler: (args, ctx) => {
      const query: FindQuery = {};
      for (const key of ["q", "tag", "categoria", "modulo", "kind", "efeito"] as const) {
        const value = optionalString(args, key);
        if (value !== undefined) query[key] = value;
      }
      if (args.limit !== undefined) {
        if (typeof args.limit !== "number" || !Number.isFinite(args.limit)) return Promise.resolve(text("Invalid arguments: limit must be a number.", true));
        query.limit = args.limit;
      }
      const result = deps.federation.find(query);
      const visible = result.tools.filter((t) => !hidden(t.moduleId, deps.findTool(t.name)?.tool, ctx));
      if (visible.length === 0) return Promise.resolve(text("No tool found. Try other words, fewer filters or a parent category."));
      const lines = visible.map(findLine);
      if (result.more) lines.push("(more results: refine the search or raise limit)");
      return Promise.resolve(text(lines.join("\n")));
    },
  };

  const describe: HubTool = {
    name: "tools_describe",
    title: "Describe tools",
    description:
      "Schema, effect, approval and example of one tool (id) or of several at once (ids). " +
      "full: false (default) trims long descriptions; full: true returns the whole schema. " +
      "Once you have a tool's schema in this session, call tools_run directly without describing it again.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        ids: { type: "array", items: { type: "string" }, maxItems: MAX_DESCRIBE_IDS },
        full: { type: "boolean", default: false },
      },
      additionalProperties: false,
    },
    annotations: { title: "Describe tools", readOnlyHint: true, openWorldHint: false },
    categoria: "descoberta",
    tags: ["schema", "descrever", "describe", "parametros"],
    resumo: "Schema, efeito, aprovação e exemplo de uma ou várias tools",
    efeito: "leitura",
    exposicao: "fixa",
    handler: (args, ctx) => {
      const single = optionalString(args, "id");
      const many = Array.isArray(args.ids) ? args.ids.filter((v): v is string => typeof v === "string" && v.trim() !== "").map((v) => v.trim()) : [];
      if (args.ids !== undefined && !Array.isArray(args.ids)) return Promise.resolve(text("Invalid arguments: ids must be a list of tool ids.", true));
      const ids = [...new Set([...(single ? [single] : []), ...many])];
      if (ids.length === 0) return Promise.resolve(text("Invalid arguments: give id or ids.", true));
      if (ids.length > MAX_DESCRIBE_IDS) return Promise.resolve(text(`Invalid arguments: at most ${MAX_DESCRIBE_IDS} ids per call.`, true));
      const full = args.full === true;
      const found = deps.federation.get(ids);
      const described = ids.map((id) => {
        const entry = found.get(id);
        const registered = deps.findTool(id);
        if (!entry || hidden(entry.moduleId, registered?.tool, ctx)) return { id, erro: "not found (search with tools_find)" };
        return describeOne(current(entry, registered), full);
      });
      const payload = single && many.length === 0 ? described[0] : described;
      return Promise.resolve(text(JSON.stringify(payload)));
    },
  };

  const run: HubTool = {
    name: "tools_run",
    title: "Run a tool",
    description:
      "Runs any tool of this vault by its id (from tools_find), with its arguments in args. " +
      "The answer is the tool's own answer, unchanged. Tools with effect externo ask the user first.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Tool id, e.g. \"git_status\"." },
        args: { type: "object", description: "Arguments of the tool (see its signature in tools_find)." },
      },
      required: ["id"],
      additionalProperties: false,
    },
    annotations: { title: "Run a tool", readOnlyHint: false, openWorldHint: true },
    categoria: "descoberta",
    tags: ["executar", "run", "tools"],
    resumo: "Executa uma tool pelo id, repassando os argumentos ao módulo dono",
    efeito: "externo",
    exposicao: "fixa",
    handler: async (args, ctx) => {
      const id = optionalString(args, "id");
      if (!id) return text("Invalid arguments: id is required.", true);
      if (id === "tools_run") return text("tools_run cannot run itself. Give the id of the tool to run.", true);
      let toolArgs: unknown = args.args ?? {};
      if (typeof toolArgs === "string") {
        try {
          toolArgs = JSON.parse(toolArgs);
        } catch {
          return text("Invalid arguments: args must be an object.", true);
        }
      }
      if (!isObject(toolArgs)) return text("Invalid arguments: args must be an object.", true);
      const callArgs: Record<string, unknown> = toolArgs;

      const registered = deps.findTool(id);
      if (registered) {
        if (hidden(registered.moduleId, registered.tool, ctx)) return text(hiddenText(registered.moduleId), true);
        return report(registered.moduleId, () => registered.tool.handler(callArgs, { ...ctx, moduleId: registered.moduleId }));
      }

      const entry = deps.federation.get([id]).get(id);
      if (!entry) return text(`Unknown tool: ${id}. Find the right id with tools_find.`, true);
      if (hidden(entry.moduleId, undefined, ctx)) return text(hiddenText(entry.moduleId), true);
      const runner = deps.getService<IndexedToolRunner>(toolRunnerServiceName(entry.moduleId));
      if (!runner || typeof runner.run !== "function") {
        return text(`The tool ${id} is in the index of the module "${entry.moduleId}", but that module is not running it now (inactive or outdated).`, true);
      }
      return report(entry.moduleId, () => runner.run(id, callArgs, { ...ctx, moduleId: entry.moduleId }));
    },
  };

  /** Runs the call; exceptions become an error result, like a direct tools/call. */
  async function safe(call: () => Promise<HubToolResult>): Promise<HubToolResult> {
    try {
      return await call();
    } catch (err) {
      return text(`Error: ${err instanceof Error ? err.message : String(err)}`, true);
    }
  }

  async function report(moduleId: string, call: () => Promise<HubToolResult>): Promise<HubToolResult> {
    const result = await safe(call);
    try {
      deps.onToolResult?.(moduleId, result.isError === true);
    } catch {
      // The failure marker must never break a call.
    }
    return result;
  }

  return [find, describe, run];
}
