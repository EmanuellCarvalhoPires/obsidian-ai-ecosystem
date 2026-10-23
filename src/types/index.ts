// Public contracts of the AI Ecosystem plugin.
//
// Everything a module (Environment Keys, AI Templates, Telegram AI Gateway...) needs to
// register itself lives here, plus the internal contracts shared by the server, the
// registry, the script engine and the inspector. Files in src/server, src/registry,
// src/runner and src/inspector/live-logger.ts must not import "obsidian": they are plain
// Node code, so they can be tested without Obsidian.

// ---------------------------------------------------------------------------
// Provider API version and lifecycle events
// ---------------------------------------------------------------------------

/** Provider API version implemented by this build. */
export const AI_ECOSYSTEM_API_VERSION = 1;

/**
 * Minor revision of the Provider API. Only grows with additive, backwards-compatible changes
 * (1.1: optional HubTool index metadata, api.toolIndex.sync, indexed discovery with tools_find,
 * tools_describe and tools_run, and the optional "tool-runner:<id>" service). Modules need not check it.
 */
export const AI_ECOSYSTEM_API_MINOR_VERSION = 1;

/** Provider API versions this build accepts from modules. */
export const SUPPORTED_API_VERSIONS: readonly number[] = [1];

/** Plugin id of the AI Ecosystem (also the module id of its built-in routes and tools). */
export const ECOSYSTEM_ID = "ai-ecosystem";

/**
 * Workspace events (app.workspace.trigger / app.workspace.on).
 * - ready: the Provider API accepts registrations. Payload: AIEcosystemAPI. Fired on every
 *   load of the AI Ecosystem, so modules register again after a reload. The HTTP server
 *   may still be starting (see getServerStatus()).
 * - unloading: the AI Ecosystem is being disabled or reloaded. No payload. Modules mark
 *   themselves as disconnected and wait for the next "ready".
 * - module-registered / module-unregistered: payload is the module id.
 * - service-changed: payload is (serviceName, available).
 * - server-status: payload is ServerStatus.
 */
export const ECOSYSTEM_EVENTS = {
  ready: "ai-ecosystem:ready",
  unloading: "ai-ecosystem:unloading",
  moduleRegistered: "ai-ecosystem:module-registered",
  moduleUnregistered: "ai-ecosystem:module-unregistered",
  serviceChanged: "ai-ecosystem:service-changed",
  serverStatus: "ai-ecosystem:server-status",
} as const;

// ---------------------------------------------------------------------------
// Clients (who called)
// ---------------------------------------------------------------------------

/** The authenticated caller of an HTTP route, MCP tool or prompt. */
export interface ClientContext {
  /** Stable client id (kept when clients are imported from Environment Keys 1.x). */
  id: string;
  /** Display name, e.g. "Claude Code". */
  name: string;
}

/** A client as stored in data.json. Only a SHA-256 hash of the token is stored. */
export interface ClientRecord {
  id: string;
  name: string;
  /** Lowercase hex SHA-256 of the token. */
  tokenHash: string;
  /** First characters of the token, to help the user recognize it. */
  hint: string;
  createdAt: string;
  lastUsedAt?: string;
  /** Module id this client was imported from (e.g. "environment-variables"), if any. */
  importedFrom?: string;
}

// ---------------------------------------------------------------------------
// HTTP routes
// ---------------------------------------------------------------------------

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface HubRequest {
  method: HttpMethod;
  /**
   * Path relative to the module prefix, starting with "/" (for /api/v1/my-module/items/1
   * it is "/items/1"). For legacy aliases it is the full path (e.g. "/v1/request").
   */
  path: string;
  /** Full request path, without the query string. */
  fullPath: string;
  /** Values of ":name" segments of the route pattern. */
  params: Record<string, string>;
  /** Query string values (last value wins). */
  query: Record<string, string>;
  /** Request headers with lowercase names. The Authorization header is removed. */
  headers: Record<string, string>;
  /** Parsed JSON body when Content-Type is JSON, otherwise the raw text ("" when empty). */
  body: unknown;
  rawBody: string;
  client: ClientContext;
}

export interface HubResponse {
  status: number;
  headers?: Record<string, string>;
  /** Objects and arrays are sent as JSON; strings as text/plain unless a Content-Type is set. */
  body?: unknown;
}

export interface HubRoute {
  method: HttpMethod;
  /**
   * Module route: path relative to /api/v1/<module-id>, e.g. "/request" or "/items/:id".
   * Legacy alias: absolute path at the root, e.g. "/v1/request". Aliases can never take
   * the reserved paths /health, /mcp and /api/*.
   */
  path: string;
  description?: string;
  handler: (req: HubRequest) => Promise<HubResponse> | HubResponse;
}

// ---------------------------------------------------------------------------
// MCP tools and prompts
// ---------------------------------------------------------------------------

export type HubToolContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

export interface HubToolResult {
  content: HubToolContent[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

/** Which kind of AI client made a call, from the MCP clientInfo (or the client token name). */
export type ClientKind = "claude-code" | "antigravity" | "other";

export interface HubCallContext {
  client: ClientContext;
  /** Module that owns the tool or prompt. */
  moduleId: string;
  clientKind?: ClientKind;
  /**
   * Aborted when the client sends notifications/cancelled for this call or closes the HTTP
   * connection before the answer. Long-running tools (e.g. screens) should stop when it fires.
   */
  signal?: AbortSignal;
}

export interface HubTool {
  /** Unique across all modules. Not prefixed, so existing client configs keep their tool names. */
  name: string;
  title?: string;
  description: string;
  /** JSON Schema of the arguments (type "object"). */
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  annotations?: {
    title?: string;
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
  /**
   * The tool stays visible to Claude Code while its module is still waiting for the first
   * setup (e.g. a tool the setup skill itself uses). Other tools of that module are hidden.
   */
  availableDuringSetup?: boolean;
  /** Index metadata (API 1.1). All optional; defaults are inferred from description and annotations. */
  categoria?: string;
  tags?: string[];
  /** One line, recommended <= 100 characters. */
  resumo?: string;
  efeito?: ToolEffect;
  exposicao?: ToolExposure;
  /**
   * Approval policy read by the tools_run hook: a question template with {arg} placeholders
   * (e.g. "Posso fazer o merge do PR #{numero} para a branch {destino}?"), "obrigatoria" (always
   * ask) or "dispensada" (never ask, even with efeito "externo"). Without it, "externo" asks.
   */
  aprovacao?: string;
  /** Example arguments shown by tools_describe. */
  exemplo?: Record<string, unknown>;
  handler: (args: Record<string, unknown>, ctx: HubCallContext) => Promise<HubToolResult>;
}

export type ToolEffect = "leitura" | "cofre" | "externo";
export type ToolExposure = "fixa" | "indice";
/** What an index entry stands for: a tool, a script, a template or an API call of a vault tool note. */
export type ToolKind = "tool" | "script" | "template" | "api";

/** aprovacao values with a fixed meaning (anything else is a question template). */
export const APPROVAL_REQUIRED = "obrigatoria";
export const APPROVAL_WAIVED = "dispensada";

/** What a module writes into its tools.db through api.toolIndex.sync. */
export interface ToolIndexEntry {
  name: string;
  title?: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  annotations?: HubTool["annotations"];
  /** Default "tool". */
  kind?: ToolKind;
  categoria?: string;
  tags?: string[];
  resumo?: string;
  efeito?: ToolEffect;
  exposicao?: ToolExposure;
  aprovacao?: string;
  exemplo?: Record<string, unknown>;
}

/**
 * Service a module registers (name: toolRunnerServiceName(moduleId)) to run index entries that
 * are not registered MCP tools (e.g. the API tools of vault notes). tools_run calls it when the
 * id is in the module's tools.db but not in the registry. The result goes back as is.
 */
export interface IndexedToolRunner {
  run(id: string, args: Record<string, unknown>, ctx: HubCallContext): Promise<HubToolResult>;
}

export const TOOL_RUNNER_SERVICE_PREFIX = "tool-runner:";

export function toolRunnerServiceName(moduleId: string): string {
  return `${TOOL_RUNNER_SERVICE_PREFIX}${moduleId}`;
}

/** The three tools of indexed discovery (always listed). */
export const DISCOVERY_TOOL_NAMES: readonly string[] = ["tools_find", "tools_describe", "tools_run"];

/** How tools/list looks for a kind of client: every tool, or only the fixed ones plus discovery. */
export type ToolExposureMode = "completo" | "indexado";

export interface ToolExposureSettings {
  modes: Record<ClientKind, ToolExposureMode>;
  /** Tool names that stay in tools/list in indexado mode (besides discovery and exposicao "fixa"). */
  fixedTools: string[];
}

export interface ToolIndexApi {
  /** Incrementally syncs the module's .obsidian/plugins/<id>/tools.db (unchanged tools are skipped by hash). */
  sync(moduleId: string, entries: ToolIndexEntry[]): Promise<void>;
}

export interface HubPromptMessage {
  role: "user" | "assistant";
  content: { type: "text"; text: string };
}

export interface HubPrompt {
  /** Unique across all modules (e.g. "configure_vault_tools"). */
  name: string;
  title?: string;
  description?: string;
  arguments?: Array<{ name: string; description?: string; required?: boolean }>;
  handler: (
    args: Record<string, string>,
    ctx: HubCallContext,
  ) => Promise<{ description?: string; messages: HubPromptMessage[] }>;
}

// ---------------------------------------------------------------------------
// Modules
// ---------------------------------------------------------------------------

export interface HubModuleRegistration {
  /** Plugin id of the module, e.g. "environment-variables". Lowercase letters, digits and "-". */
  id: string;
  name: string;
  version: string;
  /** Provider API version the module was written for. */
  apiVersion: number;
  routes?: HubRoute[];
  /** Routes at the root, for backward compatibility (e.g. POST /v1/request). */
  legacyAliases?: HubRoute[];
  tools?: HubTool[];
  prompts?: HubPrompt[];
  /**
   * Text appended to the MCP server instructions sent on "initialize" (e.g. how agents must
   * use secret placeholders). Plain text, a few sentences.
   */
  instructions?: string;
  /** Called when the AI Ecosystem drops the module (unregister or AI Ecosystem unload). */
  onUnload?: () => void;
}

export type RegisterResult = { ok: true; warnings?: string[] } | { ok: false; reason: string };

/** What the registry tells about a registered module. */
export interface ModuleInfo {
  id: string;
  name: string;
  version: string;
  apiVersion: number;
  registeredAt: number;
  routeCount: number;
  legacyAliasPaths: string[];
  toolNames: string[];
  promptNames: string[];
  /** Tools, prompts or aliases skipped because another module already had them. */
  warnings: string[];
}

export interface RegisteredTool {
  moduleId: string;
  tool: HubTool;
}

export interface RegisteredPrompt {
  moduleId: string;
  prompt: HubPrompt;
}

export interface RouteMatch {
  moduleId: string;
  route: HubRoute;
  /** Path given to the handler (HubRequest.path). */
  path: string;
  params: Record<string, string>;
  legacy: boolean;
}

export type RegistryChange =
  | { type: "module-registered"; moduleId: string }
  | { type: "module-unregistered"; moduleId: string }
  | { type: "tools-changed"; moduleId: string }
  | { type: "prompts-changed"; moduleId: string };

/** Read side of the module registry, used by the HTTP and MCP servers. */
export interface RegistryLookup {
  listModules(): ModuleInfo[];
  listTools(): RegisteredTool[];
  findTool(name: string): RegisteredTool | undefined;
  listPrompts(): RegisteredPrompt[];
  findPrompt(name: string): RegisteredPrompt | undefined;
  /**
   * Finds the route for a request path (without query string):
   * "/api/v1/<module-id>/<rest>" matches the module's routes against "/<rest>";
   * any other path is matched against legacy aliases.
   * Returns undefined when nothing matches.
   */
  findRoute(method: HttpMethod, path: string): RouteMatch | undefined;
  /** Methods registered for a path (any method), so the server can answer 405 instead of 404. */
  allowedMethods(path: string): HttpMethod[];
  /** Instructions of the registered modules, in registration order. */
  listInstructions(): Array<{ moduleId: string; text: string }>;
}

// ---------------------------------------------------------------------------
// Service Bus
// ---------------------------------------------------------------------------

export type ServiceChangeListener = (name: string, available: boolean) => void;

export interface ServiceInfo {
  name: string;
  ownerModuleId: string;
  registeredAt: number;
}

/** Name of the service Environment Keys registers (see SecretVaultService). */
export const SECRETS_SERVICE = "secrets";

/**
 * The part of the Environment Keys "secrets" service the AI Ecosystem uses.
 * No method returns the value of a secret.
 */
export interface SecretVaultService {
  isLocked(): boolean;
  /** Replaces the values of known secrets with a mask. Used by the Inspector and the Script Engine. */
  redact(text: string): string;
  /**
   * Resolves {{secret:NAME}} placeholders in `env` and calls spawnFn with the resolved env.
   * The resolved env is never returned to the caller. Rejects when the vault is locked, a
   * secret is unknown or the caller may not use it.
   */
  spawnWithSecrets(
    env: Record<string, string>,
    spawnFn: (resolvedEnv: Record<string, string>) => void,
    callerModuleId: string,
  ): Promise<void>;
  /** Like spawnWithSecrets, but also resolves placeholders in args. Optional: older Environment Keys lack it. */
  spawnWithSecretsAndArgs?(
    input: { env: Record<string, string>; args: string[] },
    spawnFn: (resolved: { env: Record<string, string>; args: string[] }) => void | Promise<void>,
    callerModuleId: string,
  ): Promise<void>;
  /** True when a secret OR a value already uses this name. Optional: older Environment Keys lack it. */
  nameExists?(name: string): boolean;
  /**
   * Creates an entry in the "Values" section of Environment Keys. Never overwrites and never
   * returns the value. Optional: older Environment Keys lack it.
   */
  createValue?(input: {
    name: string;
    kind: ValueKind;
    value: string;
    description?: string;
    createdBy: string;
  }): Promise<{ ok: true } | { ok: false; reason: "exists" | "locked" | "invalid_name" | "empty" }>;
}

/** Kinds of entry in the Environment Keys "Values" section. */
export type ValueKind = "texto" | "numero" | "url" | "email" | "json" | "senha";

// ---------------------------------------------------------------------------
// Hooks service (Claude Code hooks, module setup state)
// ---------------------------------------------------------------------------

/** Name of the service the AI Ecosystem registers for the modules (see HooksService). */
export const HOOKS_SERVICE = "hooks";

/** Data a module gives the core so the Claude Code protection hooks know what to guard. */
export interface HookRuleData {
  /** environment-variables: allowed host patterns of secrets WITHOUT full access / any host. */
  hosts?: string[];
  /** ai-scripts: vault-relative folders whose scripts must run through the plugin. */
  scriptFolders?: string[];
  /** ai-templates: vault-relative target path patterns of the templates ({{...}} becomes *). */
  templateTargets?: string[];
  /** environment-variables: vault-relative folders of tool notes (Grep stays allowed there). */
  toolNoteFolders?: string[];
  /** ai-vault-search: vault-relative folders outside the index (Grep stays allowed there). Becomes pastas.json "foraDoIndice". */
  excludedFolders?: string[];
}

export interface SetupHandler {
  /** Facts the module detects by itself (never secret values). */
  detect?(): Promise<Record<string, unknown>>;
  /** Applies one answer. Returns an error message to refuse it. */
  save?(key: string, value: unknown): Promise<string | void>;
  /** Called by ecosystem_setup_complete. ok:false blocks completion and lists what is missing. */
  validate?(): Promise<{ ok: boolean; missing?: string[] }>;
}

export type ModuleSetupState = "pendente_configuracao" | "configurado" | "desativado";

/** The "hooks" service. Modules never touch .claude/: they feed the core through it. */
export interface HooksService {
  /** Replaces the data of that module; the core rewrites hosts.json and pastas.json (debounced). */
  setRuleData(moduleId: string, data: HookRuleData): void;
  /** Returns an unregister function. */
  registerSetupHandler(moduleId: string, handler: SetupHandler): () => void;
  getModuleState(moduleId: string): ModuleSetupState | undefined;
}

// ---------------------------------------------------------------------------
// Script Engine
// ---------------------------------------------------------------------------

export type ScriptLanguage = "python" | "node" | "bash" | "powershell";

export const SCRIPT_LANGUAGES: readonly ScriptLanguage[] = ["python", "node", "bash", "powershell"];

export interface HubScriptOptions {
  language: ScriptLanguage;
  /** Path relative to the vault root. With restrictions on, only allowed folders or #mcp/script notes. */
  scriptPath: string;
  /** Accepted only with the restrictions turned off. When set, scriptPath is ignored. */
  inlineCode?: string;
  args?: string[];
  /** Working directory relative to the vault root (default: the vault root). */
  cwd?: string;
  timeoutSeconds?: number;
  /** May contain {{secret:NAME}}: resolved by Environment Keys directly into the child env. */
  env?: Record<string, string>;
  /** Content written to the subprocess stdin and then closed. */
  stdin?: string;
  /** Cancellation signal to immediately terminate the running process. */
  signal?: AbortSignal;
  /** When true, the Script Engine skips logging an activity entry (e.g. caller logs it). */
  skipActivityLog?: boolean;
  onStdout?: (data: string) => void;
  onStderr?: (data: string) => void;
}

export interface ScriptExecutionResult {
  exitCode: number;
  /** Already redacted. */
  stdout: string;
  /** Already redacted. */
  stderr: string;
  durationMs: number;
  /** True when the process was killed (timeout or cancel). */
  killed: boolean;
}

/** Who asked for a script run. */
export interface ScriptCaller {
  moduleId: string;
  /** Set when the run came from an HTTP or MCP client (through the built-in run_script tool). */
  client?: ClientContext;
}

// ---------------------------------------------------------------------------
// Activity (Live Request Inspector)
// ---------------------------------------------------------------------------

export type ActivityKind = "http" | "mcp" | "script" | "module";

export interface ActivityInput {
  kind: ActivityKind;
  /** "GET", "POST"..., "MCP Tool Call", "MCP Prompt", "MCP", "Script" or a module-defined type. */
  method: string;
  /** Path, tool name, prompt name, MCP method or script path. */
  target: string;
  /** Module that handled it ("" when no module matched). */
  moduleId: string;
  /** Client display name, or "module:<id>" for calls made by a module. */
  client?: string;
  status: number;
  durationMs: number;
  requestHeaders?: Record<string, string>;
  payload?: unknown;
  response?: unknown;
  /** Process output, stdout/stderr, or custom module text. */
  output?: string;
  /** Shows an alert badge (e.g. script run with the restrictions off). */
  alert?: boolean;
  time?: number;
}

export interface ActivityBeginInput {
  moduleId: string;
  client?: string;
  type: string;
  target: string;
  payload?: unknown;
  alert?: boolean;
}

export interface ActivityEntry {
  id: string;
  time: number;
  kind: ActivityKind;
  method: string;
  target: string;
  moduleId: string;
  client: string;
  /** 0 while still running. */
  status: number;
  durationMs: number;
  /** Redacted headers. */
  requestHeaders: Record<string, string>;
  /** Redacted, pretty-printed and size-limited. */
  payload: string;
  /** Redacted, pretty-printed and size-limited. */
  response: string;
  /** Streamed output of scripts (redacted). */
  output: string;
  alert: boolean;
  running: boolean;
  tokens?: { input: number; output: number; total: number };
}

/** Handle of an activity that is still running (scripts). */
export interface ActivityHandle {
  readonly id: string;
  appendOutput(stream: "stdout" | "stderr", chunk: string): void;
  end(update: { status: number; durationMs: number; response?: unknown }): void;
}

/** Where the server, MCP host, script engine and modules report activity. */
export interface ActivitySink {
  log(entry: ActivityInput): void;
  begin(entry: Omit<ActivityInput, "status" | "durationMs">): ActivityHandle;
}

// ---------------------------------------------------------------------------
// Server status
// ---------------------------------------------------------------------------

/** Who holds a port, from its /health (or /v1/health) answer. */
export type PortOwnerKind =
  | "ai-ecosystem"
  | "environment-keys-1"
  | "environment-keys-transition"
  | "other"
  | "unknown";

export interface PortConflict {
  port: number;
  owner: PortOwnerKind;
  /** Version reported by the owner, when it answered /health. */
  ownerVersion?: string;
  /** Vault name reported by the owner (another vault's AI Ecosystem or Environment Keys). */
  ownerVault?: string;
  /** Process name, when it could be found (netstat/lsof). */
  processName?: string;
}

export interface ServerStatus {
  running: boolean;
  /** Port in use (or the configured port when not running). */
  port: number;
  /** True whenever the bound port differs from the configured one (it was busy, or this vault kept the port it used last time). */
  usingAlternativePort: boolean;
  /** The configured port, set when usingAlternativePort is true. */
  configuredPort?: number;
  /** The port this vault used last time, when it differs from the one in use now (MCP client configs may need the new URL). */
  previousPort?: number;
  conflict?: PortConflict;
  /** Last start error, e.g. "Port 27160 is also in use". */
  error?: string;
}

// ---------------------------------------------------------------------------
// Provider API (what modules call)
// ---------------------------------------------------------------------------

export interface AIEcosystemAPI {
  readonly apiVersion: number;
  isReady(): boolean;

  registerModule(module: HubModuleRegistration): RegisterResult;
  unregisterModule(moduleId: string): boolean;
  /** Replaces the tools of a registered module (dynamic tools, e.g. #mcp/tool notes). */
  updateTools(moduleId: string, tools: HubTool[]): void;
  /** Replaces the prompts of a registered module. */
  updatePrompts(moduleId: string, prompts: HubPrompt[]): void;

  /** Throws when the owner is not registered or another module owns the name. */
  registerService<T>(serviceName: string, ownerModuleId: string, instance: T): void;
  unregisterService(serviceName: string): void;
  getService<T>(serviceName: string): T | undefined;
  /** Returns an unsubscribe function. */
  onServiceChange(cb: ServiceChangeListener): () => void;

  /** Imports clients (token hashes only) from a module, e.g. Environment Keys 1.x clients. Returns how many were added. */
  importClients(clients: ClientRecord[], sourceModuleId: string): Promise<number>;

  runScript(options: HubScriptOptions, callerModuleId: string): Promise<ScriptExecutionResult>;

  logActivity(entry: {
    moduleId: string;
    client?: string;
    type: string;
    target: string;
    status: number;
    durationMs: number;
    payload?: unknown;
    response?: unknown;
    output?: string;
    alert?: boolean;
  }): void;

  beginActivity?(entry: ActivityBeginInput): ActivityHandle;

  getServerStatus(): { running: boolean; port: number; activeModules: string[] };

  /** API 1.1. Absent on older Ecosystem builds: modules should check before use. */
  readonly toolIndex?: ToolIndexApi;
}

// ---------------------------------------------------------------------------
// Settings (data.json)
// ---------------------------------------------------------------------------

export interface ScriptSettings {
  /** Vault-relative folders whose scripts may run with the restrictions on. */
  allowedFolders: string[];
  /** "Remove Script Engine restrictions". Off by default. */
  restrictionsDisabled: boolean;
  /** Upper bound for timeoutSeconds (default 300). */
  maxTimeoutSeconds: number;
  /** Optional interpreter paths; empty means auto-detect. */
  interpreterPaths: Partial<Record<ScriptLanguage, string>>;
}

export interface AIEcosystemSettings {
  port: number;
  alternativePort: number;
  /** Port the server actually used last time. Tried first on start, so MCP clients keep their URL. Cleared when a port setting changes. */
  lastPort?: number;
  clients: ClientRecord[];
  /** Module ids whose clients were already imported (import happens once). */
  importedClientsFrom: string[];
  scripts: ScriptSettings;
  inspector: { maxEntries: number };
  /** Screens the agent can create (tela_criar). */
  screens: { maxScreens: number };
  /** tools/list exposure per kind of client (indexed discovery). */
  toolExposure: ToolExposureSettings;
}

export const DEFAULT_FIXED_TOOLS: readonly string[] = ["search_notes", "get_section"];

export const DEFAULT_SETTINGS: AIEcosystemSettings = {
  port: 27150,
  alternativePort: 27160,
  clients: [],
  importedClientsFrom: [],
  scripts: {
    allowedFolders: [],
    restrictionsDisabled: false,
    maxTimeoutSeconds: 300,
    interpreterPaths: {},
  },
  inspector: { maxEntries: 500 },
  screens: { maxScreens: 30 },
  toolExposure: {
    modes: { "claude-code": "completo", antigravity: "completo", other: "completo" },
    fixedTools: [...DEFAULT_FIXED_TOOLS],
  },
};

// ---------------------------------------------------------------------------
// Module catalog
// ---------------------------------------------------------------------------

export interface CatalogEntry {
  /** Plugin id, e.g. "environment-variables". */
  id: string;
  /** GitHub "owner/name". Only EmanuellCarvalhoPires repositories are accepted. */
  repo: string;
  name: string;
  description: { en: string; pt: string };
  /** Lucide icon id, e.g. "key-round". */
  icon: string;
  /** Minimum AI Ecosystem version the module needs. */
  minEcosystemVersion: string;
}

export interface Catalog {
  version: number;
  modules: CatalogEntry[];
}

export type ModuleInstallState =
  | { kind: "not-installed"; latestVersion?: string }
  | { kind: "installing" }
  | { kind: "installed-disabled"; installedVersion: string; latestVersion?: string }
  | { kind: "active"; installedVersion: string; latestVersion?: string; registered: boolean }
  | { kind: "update-available"; installedVersion: string; latestVersion: string; enabled: boolean }
  | { kind: "unavailable"; reason: string };
