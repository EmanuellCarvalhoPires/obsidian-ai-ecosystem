// Registry of the modules plugged into the AI Ecosystem: routes, tools, prompts and
// instructions. Pure Node (no "obsidian" import).

import { checkApiVersion } from "../api/api-version";
import type {
  HttpMethod,
  HubModuleRegistration,
  HubPrompt,
  HubRoute,
  HubTool,
  ModuleInfo,
  RegisteredPrompt,
  RegisteredTool,
  RegistryChange,
  RegistryLookup,
  RegisterResult,
  RouteMatch,
} from "../types";

const HTTP_METHODS: readonly HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];
const MODULE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const TOOL_NAME = /^[A-Za-z0-9_.-]{1,128}$/;
const PARAM_SEGMENT = /^:[A-Za-z_][A-Za-z0-9_]*$/;
const API_PREFIX = "/api/v1/";

export interface ModuleRegistryOptions {
  supportedApiVersions: readonly number[];
  onChange?: (change: RegistryChange) => void;
}

interface CompiledRoute {
  route: HubRoute;
  /** Pattern segments; ":name" segments are params. */
  segments: string[];
  /** Method and pattern with param names removed, to compare two routes. */
  key: string;
}

interface ModuleEntry {
  id: string;
  name: string;
  version: string;
  apiVersion: number;
  registeredAt: number;
  routes: CompiledRoute[];
  aliases: CompiledRoute[];
  tools: HubTool[];
  prompts: HubPrompt[];
  instructions: string;
  onUnload?: () => void;
  baseWarnings: string[];
  toolWarnings: string[];
  promptWarnings: string[];
}

/** Returns an error text, or undefined when the route path is acceptable. */
function validateRoutePath(path: unknown): string | undefined {
  if (typeof path !== "string" || !path.startsWith("/")) return 'the path must start with "/"';
  if (path === "/") return undefined;
  const parts = path.split("/").slice(1);
  if (parts.length > 1 && parts[parts.length - 1] === "") parts.pop();
  for (const part of parts) {
    if (part === "") return "the path has an empty segment";
    if (part === "." || part === "..") return 'the path must not contain "." or ".."';
    if (part.startsWith(":") && !PARAM_SEGMENT.test(part)) return `invalid parameter "${part}"`;
  }
  return undefined;
}

function splitSegments(path: string): string[] {
  const clean = path.split(/[?#]/, 1)[0] ?? "";
  return clean.split("/").filter((s) => s !== "");
}

function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function compileRoute(route: HubRoute): CompiledRoute {
  const segments = splitSegments(route.path);
  return {
    route,
    segments,
    key: `${route.method} /${segments.map((s) => (s.startsWith(":") ? ":" : s)).join("/")}`,
  };
}

function matchSegments(compiled: CompiledRoute, parts: string[]): Record<string, string> | undefined {
  if (compiled.segments.length !== parts.length) return undefined;
  const params: Record<string, string> = {};
  for (let i = 0; i < parts.length; i++) {
    const seg = compiled.segments[i];
    const part = parts[i];
    if (seg.startsWith(":")) params[seg.slice(1)] = decode(part);
    else if (seg !== part) return undefined;
  }
  return params;
}

/** True when `a` has a literal where `b` has a param at the first position they differ. */
function moreSpecific(a: CompiledRoute, b: CompiledRoute): boolean {
  for (let i = 0; i < a.segments.length; i++) {
    const pa = (a.segments[i]).startsWith(":");
    const pb = (b.segments[i]).startsWith(":");
    if (pa !== pb) return !pa;
  }
  return false;
}

function isReservedAlias(segments: string[]): boolean {
  const joined = segments.join("/").toLowerCase();
  const first = (segments[0] ?? "").toLowerCase();
  return joined === "health" || joined === "v1/health" || first === "mcp" || first === "api";
}

function describeRoute(route: unknown): string {
  const r = route as Partial<HubRoute> | undefined;
  return `${String(r?.method)} ${String(r?.path)}`;
}

export class ModuleRegistry implements RegistryLookup {
  private readonly modules = new Map<string, ModuleEntry>();
  private readonly supported: readonly number[];
  private readonly onChange?: (change: RegistryChange) => void;

  constructor(opts: ModuleRegistryOptions) {
    this.supported = opts.supportedApiVersions;
    this.onChange = opts.onChange;
  }

  // ---- registration -------------------------------------------------------

  register(reg: HubModuleRegistration): RegisterResult {
    if (!reg || typeof reg !== "object") return { ok: false, reason: "The module registration is missing." };
    if (typeof reg.id !== "string" || !MODULE_ID.test(reg.id)) {
      return {
        ok: false,
        reason: `Invalid module id "${String(reg.id)}". Use lowercase letters, digits and "-".`,
      };
    }
    if (typeof reg.name !== "string" || !reg.name.trim()) {
      return { ok: false, reason: `Module ${reg.id} has no name.` };
    }
    if (typeof reg.version !== "string" || !reg.version.trim()) {
      return { ok: false, reason: `${reg.name} has no version.` };
    }
    const check = checkApiVersion(reg.name, reg.apiVersion, this.supported);
    if (!check.ok) return { ok: false, reason: check.reason };

    const warnings: string[] = [];
    const routes = this.compileRoutes(reg.id, reg.routes, warnings);
    const aliases = this.compileAliases(reg.id, reg.legacyAliases, warnings);
    const toolWarnings: string[] = [];
    const promptWarnings: string[] = [];
    const tools = this.filterTools(reg.id, reg.tools, toolWarnings);
    const prompts = this.filterPrompts(reg.id, reg.prompts, promptWarnings);

    const entry: ModuleEntry = {
      id: reg.id,
      name: reg.name,
      version: reg.version,
      apiVersion: check.version,
      registeredAt: Date.now(),
      routes,
      aliases,
      tools,
      prompts,
      instructions: typeof reg.instructions === "string" ? reg.instructions.trim() : "",
      onUnload: typeof reg.onUnload === "function" ? reg.onUnload : undefined,
      baseWarnings: warnings,
      toolWarnings,
      promptWarnings,
    };
    // Re-registering replaces the module (and moves it to the end of the order).
    this.modules.delete(reg.id);
    this.modules.set(reg.id, entry);
    this.emit({ type: "module-registered", moduleId: reg.id });
    return { ok: true, warnings: [...warnings, ...toolWarnings, ...promptWarnings] };
  }

  unregister(id: string): boolean {
    const entry = this.modules.get(id);
    if (!entry) return false;
    this.modules.delete(id);
    try {
      entry.onUnload?.();
    } catch (err) {
      console.warn(`[AI Ecosystem] onUnload of ${id} failed`, err);
    }
    this.emit({ type: "module-unregistered", moduleId: id });
    return true;
  }

  updateTools(id: string, tools: HubTool[]): string[] {
    const entry = this.requireModule(id);
    const warnings: string[] = [];
    entry.tools = this.filterTools(id, tools, warnings);
    entry.toolWarnings = warnings;
    this.emit({ type: "tools-changed", moduleId: id });
    return [...warnings];
  }

  updatePrompts(id: string, prompts: HubPrompt[]): string[] {
    const entry = this.requireModule(id);
    const warnings: string[] = [];
    entry.prompts = this.filterPrompts(id, prompts, warnings);
    entry.promptWarnings = warnings;
    this.emit({ type: "prompts-changed", moduleId: id });
    return [...warnings];
  }

  clear(): void {
    for (const id of [...this.modules.keys()]) this.unregister(id);
  }

  has(id: string): boolean {
    return this.modules.has(id);
  }

  getModule(id: string): ModuleInfo | undefined {
    const entry = this.modules.get(id);
    return entry ? this.toInfo(entry) : undefined;
  }

  // ---- RegistryLookup -----------------------------------------------------

  listModules(): ModuleInfo[] {
    return [...this.modules.values()].map((m) => this.toInfo(m));
  }

  listTools(): RegisteredTool[] {
    const out: RegisteredTool[] = [];
    for (const m of this.modules.values()) for (const tool of m.tools) out.push({ moduleId: m.id, tool });
    return out;
  }

  findTool(name: string): RegisteredTool | undefined {
    for (const m of this.modules.values()) {
      const tool = m.tools.find((t) => t.name === name);
      if (tool) return { moduleId: m.id, tool };
    }
    return undefined;
  }

  listPrompts(): RegisteredPrompt[] {
    const out: RegisteredPrompt[] = [];
    for (const m of this.modules.values()) for (const prompt of m.prompts) out.push({ moduleId: m.id, prompt });
    return out;
  }

  findPrompt(name: string): RegisteredPrompt | undefined {
    for (const m of this.modules.values()) {
      const prompt = m.prompts.find((p) => p.name === name);
      if (prompt) return { moduleId: m.id, prompt };
    }
    return undefined;
  }

  listInstructions(): Array<{ moduleId: string; text: string }> {
    const out: Array<{ moduleId: string; text: string }> = [];
    for (const m of this.modules.values()) if (m.instructions) out.push({ moduleId: m.id, text: m.instructions });
    return out;
  }

  findRoute(method: HttpMethod, path: string): RouteMatch | undefined {
    const scope = this.scope(path);
    let best: { c: CompiledRoute; moduleId: string; params: Record<string, string> } | undefined;
    for (const cand of scope.routes) {
      if (cand.c.route.method !== method) continue;
      const params = matchSegments(cand.c, scope.parts);
      if (!params) continue;
      if (!best || moreSpecific(cand.c, best.c)) best = { c: cand.c, moduleId: cand.moduleId, params };
    }
    if (!best) return undefined;
    return {
      moduleId: best.moduleId,
      route: best.c.route,
      path: scope.matchPath,
      params: best.params,
      legacy: scope.legacy,
    };
  }

  allowedMethods(path: string): HttpMethod[] {
    const scope = this.scope(path);
    const methods: HttpMethod[] = [];
    for (const cand of scope.routes) {
      if (matchSegments(cand.c, scope.parts) && !methods.includes(cand.c.route.method)) {
        methods.push(cand.c.route.method);
      }
    }
    return methods;
  }

  // ---- internals ----------------------------------------------------------

  /** The routes a request path is matched against, and the path segments to match. */
  private scope(path: string): {
    routes: Array<{ c: CompiledRoute; moduleId: string }>;
    parts: string[];
    matchPath: string;
    legacy: boolean;
  } {
    const parts = splitSegments(path);
    const clean = path.split(/[?#]/, 1)[0] ?? "";
    if ((clean.endsWith("/") ? clean : `${clean}/`).startsWith(API_PREFIX)) {
      const id = parts[2];
      const entry = id ? this.modules.get(id) : undefined;
      const rest = parts.slice(3);
      return {
        routes: entry ? entry.routes.map((c) => ({ c, moduleId: entry.id })) : [],
        parts: rest,
        matchPath: `/${rest.join("/")}`,
        legacy: false,
      };
    }
    const routes: Array<{ c: CompiledRoute; moduleId: string }> = [];
    for (const m of this.modules.values()) for (const c of m.aliases) routes.push({ c, moduleId: m.id });
    return { routes, parts, matchPath: `/${parts.join("/")}`, legacy: true };
  }

  private requireModule(id: string): ModuleEntry {
    const entry = this.modules.get(id);
    if (!entry) throw new Error(`Module ${id} is not registered`);
    return entry;
  }

  private toInfo(m: ModuleEntry): ModuleInfo {
    return {
      id: m.id,
      name: m.name,
      version: m.version,
      apiVersion: m.apiVersion,
      registeredAt: m.registeredAt,
      routeCount: m.routes.length,
      legacyAliasPaths: m.aliases.map((a) => a.route.path),
      toolNames: m.tools.map((t) => t.name),
      promptNames: m.prompts.map((p) => p.name),
      warnings: [...m.baseWarnings, ...m.toolWarnings, ...m.promptWarnings],
    };
  }

  private emit(change: RegistryChange): void {
    if (!this.onChange) return;
    try {
      this.onChange(change);
    } catch (err) {
      console.warn("[AI Ecosystem] A registry listener failed", err);
    }
  }

  private compileRoutes(moduleId: string, routes: HubRoute[] | undefined, warnings: string[]): CompiledRoute[] {
    const out: CompiledRoute[] = [];
    for (const route of Array.isArray(routes) ? routes : []) {
      const problem = this.routeProblem(route);
      if (problem) {
        warnings.push(`Skipped route ${describeRoute(route)} of ${moduleId}: ${problem}.`);
        continue;
      }
      out.push(compileRoute(route));
    }
    return out;
  }

  private compileAliases(moduleId: string, aliases: HubRoute[] | undefined, warnings: string[]): CompiledRoute[] {
    const out: CompiledRoute[] = [];
    for (const route of Array.isArray(aliases) ? aliases : []) {
      const label = `legacy alias ${describeRoute(route)} of ${moduleId}`;
      const problem = this.routeProblem(route);
      if (problem) {
        warnings.push(`Skipped ${label}: ${problem}.`);
        continue;
      }
      const compiled = compileRoute(route);
      if (isReservedAlias(compiled.segments)) {
        warnings.push(`Skipped ${label}: the path is reserved.`);
        continue;
      }
      const owner = this.otherOwner(moduleId, (m) => m.aliases.some((a) => a.key === compiled.key));
      if (owner) {
        warnings.push(`Skipped ${label}: already provided by ${owner}.`);
        continue;
      }
      out.push(compiled);
    }
    return out;
  }

  private routeProblem(route: HubRoute | undefined): string | undefined {
    if (!route || typeof route !== "object") return "it is not a route";
    if (!HTTP_METHODS.includes(route.method)) return "unknown HTTP method";
    if (typeof route.handler !== "function") return "it has no handler";
    return validateRoutePath(route.path);
  }

  private filterTools(moduleId: string, tools: HubTool[] | undefined, warnings: string[]): HubTool[] {
    const out: HubTool[] = [];
    for (const tool of Array.isArray(tools) ? tools : []) {
      const name = (tool as Partial<HubTool> | undefined)?.name;
      if (
        !tool ||
        typeof name !== "string" ||
        !TOOL_NAME.test(name) ||
        typeof tool.description !== "string" ||
        !tool.inputSchema ||
        typeof tool.inputSchema !== "object" ||
        typeof tool.handler !== "function"
      ) {
        warnings.push(`Skipped tool ${String(name)} of ${moduleId}: it is not a valid tool.`);
        continue;
      }
      const owner = this.otherOwner(moduleId, (m) => m.tools.some((t) => t.name === name));
      if (owner || out.some((t) => t.name === name)) {
        warnings.push(`Skipped tool ${name} of ${moduleId}: the name is already used${owner ? ` by ${owner}` : ""}.`);
        continue;
      }
      out.push(tool);
    }
    return out;
  }

  private filterPrompts(moduleId: string, prompts: HubPrompt[] | undefined, warnings: string[]): HubPrompt[] {
    const out: HubPrompt[] = [];
    for (const prompt of Array.isArray(prompts) ? prompts : []) {
      const name = (prompt as Partial<HubPrompt> | undefined)?.name;
      if (!prompt || typeof name !== "string" || !TOOL_NAME.test(name) || typeof prompt.handler !== "function") {
        warnings.push(`Skipped prompt ${String(name)} of ${moduleId}: it is not a valid prompt.`);
        continue;
      }
      const owner = this.otherOwner(moduleId, (m) => m.prompts.some((p) => p.name === name));
      if (owner || out.some((p) => p.name === name)) {
        warnings.push(`Skipped prompt ${name} of ${moduleId}: the name is already used${owner ? ` by ${owner}` : ""}.`);
        continue;
      }
      out.push(prompt);
    }
    return out;
  }

  private otherOwner(moduleId: string, has: (m: ModuleEntry) => boolean): string | undefined {
    for (const m of this.modules.values()) if (m.id !== moduleId && has(m)) return m.id;
    return undefined;
  }
}
