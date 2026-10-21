import { randomUUID } from "node:crypto";
import type * as http from "node:http";
import { clearInterval, setInterval } from "node:timers";
import { ECOSYSTEM_ID } from "../types";
import type {
  ActivityInput,
  ActivitySink,
  ClientContext,
  ClientKind,
  HubCallContext,
  HubToolResult,
  RegisteredTool,
  RegistryLookup,
} from "../types";
import { detectClientKind } from "./client-detector";
import { sendJson } from "./http-utils";

export const MCP_PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"] as const;
export const MCP_SESSION_HEADER = "Mcp-Session-Id";

const HEARTBEAT_MS = 25_000;
const MAX_SESSIONS = 1000;

type JsonRpcId = string | number | null;
type RpcResponse =
  | { jsonrpc: "2.0"; id: JsonRpcId; result: unknown }
  | { jsonrpc: "2.0"; id: JsonRpcId; error: { code: number; message: string } };

class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
  }
}

/** What running one JSON-RPC request produced, including what to log. */
interface Outcome {
  result?: unknown;
  error?: RpcError;
  log: Pick<ActivityInput, "method" | "target" | "moduleId" | "status"> & { payload?: unknown; response?: unknown };
}

export interface McpHostOptions {
  registry: RegistryLookup;
  activity: ActivitySink;
  serverInfo: { name: string; title: string; version: string };
  /** Base text of the MCP instructions; the modules' instructions are appended on initialize. */
  getBaseInstructions: () => string;
  /** True to hide a tool from tools/list (and refuse tools/call) for that kind of client. */
  isToolHidden?: (tool: RegisteredTool, clientKind: ClientKind) => boolean;
  /** Called after every tools/call. Errors thrown here never affect the request. */
  onToolResult?: (moduleId: string, isError: boolean) => void;
}

/** What one POST carries between the steps of its processing. */
interface RequestState {
  /** Session of the Mcp-Session-Id header. */
  sessionId?: string;
  newSessionId?: string;
  /** Controllers of the tool calls of this POST, aborted if the connection closes early. */
  aborts: Set<AbortController>;
}

interface Session {
  clientInfoName?: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rpcError(id: JsonRpcId, code: number, message: string): RpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

/** MCP over Streamable HTTP at /mcp: JSON responses plus an optional GET stream for list_changed. */
export class McpHost {
  private readonly sessions = new Map<string, Session>();
  /** Tool calls still running, by session and JSON-RPC id, so notifications/cancelled can abort them. */
  private readonly inFlight = new Map<string, AbortController>();
  private readonly streams = new Map<http.ServerResponse, string | undefined>();
  private heartbeat: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly opts: McpHostOptions) {}

  async handle(req: http.IncomingMessage, res: http.ServerResponse, client: ClientContext, rawBody: string): Promise<void> {
    const sessionId = headerValue(req.headers["mcp-session-id"]);
    switch (req.method) {
      case "POST":
        return this.handlePost(res, client, rawBody, sessionId);
      case "GET": {
        if (String(req.headers.accept ?? "").includes("text/event-stream")) {
          this.openStream(req, res, sessionId);
          return;
        }
        return sendJson(
          res,
          405,
          { error: { code: "method_not_allowed", message: "Use POST, or GET with Accept: text/event-stream." } },
          { Allow: "POST, DELETE" },
        );
      }
      case "DELETE":
        if (sessionId) this.dropSession(sessionId);
        res.writeHead(200, { "Cache-Control": "no-store", "Content-Length": 0 });
        res.end();
        return;
      default:
        return sendJson(
          res,
          405,
          { error: { code: "method_not_allowed", message: "Use POST, GET or DELETE on /mcp." } },
          { Allow: "POST, GET, DELETE" },
        );
    }
  }

  /** Sends notifications/<kind>/list_changed to every open stream. */
  notifyListChanged(kind: "tools" | "prompts"): void {
    const message = JSON.stringify({ jsonrpc: "2.0", method: `notifications/${kind}/list_changed` });
    for (const res of this.streams.keys()) {
      try {
        res.write(`event: message\ndata: ${message}\n\n`);
      } catch {
        // A dead stream is removed by its close handler.
      }
    }
  }

  closeAll(): void {
    for (const res of [...this.streams.keys()]) {
      try {
        res.end();
      } catch {
        // Already closed.
      }
    }
    this.streams.clear();
    this.sessions.clear();
    for (const controller of this.inFlight.values()) controller.abort();
    this.inFlight.clear();
    this.stopHeartbeat();
  }

  // -------------------------------------------------------------------------
  // POST
  // -------------------------------------------------------------------------

  private async handlePost(res: http.ServerResponse, client: ClientContext, rawBody: string, sessionId: string | undefined): Promise<void> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      return sendJson(res, 400, rpcError(null, -32700, "Parse error"));
    }

    const state: RequestState = { sessionId, aborts: new Set() };
    // The client gave up (closed the connection) before the answer: stop the tools still running.
    res.once("close", () => {
      if (res.writableFinished) return;
      for (const controller of state.aborts) controller.abort();
    });
    const respond = (status: number, body: unknown) => {
      const headers: Record<string, string> = state.newSessionId ? { [MCP_SESSION_HEADER]: state.newSessionId } : {};
      sendJson(res, status, body, headers);
    };

    if (Array.isArray(parsed)) {
      if (parsed.length === 0) return respond(400, rpcError(null, -32600, "Invalid Request"));
      const responses: RpcResponse[] = [];
      for (const entry of parsed) {
        const response = await this.processEntry(entry, client, state);
        if (response) responses.push(response);
      }
      if (responses.length === 0) return this.accepted(res);
      return respond(200, responses);
    }

    const response = await this.processEntry(parsed, client, state);
    if (!response) return this.accepted(res);
    const invalid = "error" in response && response.error.code === -32600;
    return respond(invalid ? 400 : 200, response);
  }

  private accepted(res: http.ServerResponse): void {
    res.writeHead(202, { "Cache-Control": "no-store", "Content-Length": 0 });
    res.end();
  }

  /** Handles one JSON-RPC message. Returns undefined for notifications and responses. */
  private async processEntry(entry: unknown, client: ClientContext, state: RequestState): Promise<RpcResponse | undefined> {
    if (!isObject(entry)) return rpcError(null, -32600, "Invalid Request");

    const hasMethod = typeof entry.method === "string";
    if (!hasMethod) {
      // A response to a server request (we send none) is accepted and ignored.
      if ("result" in entry || "error" in entry) return undefined;
      return rpcError(validId(entry.id) ? (entry.id as JsonRpcId) : null, -32600, "Invalid Request");
    }
    if (entry.jsonrpc !== "2.0") {
      return rpcError(validId(entry.id) ? (entry.id as JsonRpcId) : null, -32600, "Invalid Request");
    }
    if (!("id" in entry) || entry.id === undefined) {
      if (entry.method === "notifications/cancelled") this.cancel(entry.params, state);
      return undefined; // notification
    }
    if (!validId(entry.id)) return rpcError(null, -32600, "Invalid Request");

    const id = entry.id as JsonRpcId;
    const method = entry.method as string;
    const params = isObject(entry.params) ? entry.params : {};

    const started = Date.now();
    let outcome: Outcome;
    try {
      outcome = await this.execute(method, params, client, state, id);
    } catch (err) {
      const e = err instanceof RpcError ? err : new RpcError(-32603, err instanceof Error ? err.message : "Internal error");
      outcome = { error: e, log: { method: "MCP", target: method, moduleId: ECOSYSTEM_ID, status: e.code === -32603 ? 500 : 400, response: { error: e.message } } };
    }
    this.logActivity(client, started, outcome);

    if (outcome.error) return rpcError(id, outcome.error.code, outcome.error.message);
    return { jsonrpc: "2.0", id, result: outcome.result };
  }

  private logActivity(client: ClientContext, started: number, outcome: Outcome): void {
    try {
      this.opts.activity.log({
        kind: "mcp",
        method: outcome.log.method,
        target: outcome.log.target,
        moduleId: outcome.log.moduleId,
        client: client.name,
        status: outcome.log.status,
        durationMs: Date.now() - started,
        payload: outcome.log.payload,
        response: outcome.log.response,
      });
    } catch {
      // The inspector must never break a request.
    }
  }

  private async execute(method: string, params: Record<string, unknown>, client: ClientContext, state: RequestState, id: JsonRpcId): Promise<Outcome> {
    const plain = (result: unknown, response: unknown = result, payload?: unknown): Outcome => ({
      result,
      log: { method: "MCP", target: method, moduleId: ECOSYSTEM_ID, status: 200, payload, response },
    });

    switch (method) {
      case "initialize": {
        const asked = params.protocolVersion;
        const supported = typeof asked === "string" && (MCP_PROTOCOL_VERSIONS as readonly string[]).includes(asked);
        const protocolVersion = supported ? asked : MCP_PROTOCOL_VERSIONS[0];
        const clientInfo = params.clientInfo;
        const clientName = isObject(clientInfo) && typeof clientInfo.name === "string" ? clientInfo.name : undefined;
        state.newSessionId = this.createSession(clientName);
        return plain(
          {
            protocolVersion,
            capabilities: { tools: { listChanged: true }, prompts: { listChanged: true } },
            serverInfo: this.opts.serverInfo,
            instructions: this.buildInstructions(),
          },
          { protocolVersion, serverInfo: this.opts.serverInfo },
          params,
        );
      }
      case "ping":
      case "logging/setLevel":
        return plain({});
      case "tools/list": {
        const kind = this.clientKind(client, state);
        const visible = this.opts.registry.listTools().filter((registered) => !this.isHidden(registered, kind));
        const tools = visible.map(({ tool }) => {
          const out: Record<string, unknown> = { name: tool.name };
          if (tool.title !== undefined) out.title = tool.title;
          out.description = tool.description;
          out.inputSchema = tool.inputSchema;
          if (tool.outputSchema !== undefined) out.outputSchema = tool.outputSchema;
          if (tool.annotations !== undefined) out.annotations = tool.annotations;
          return out;
        });
        return plain({ tools }, { tools: tools.length });
      }
      case "tools/call":
        return this.callTool(params, client, state, id);
      case "prompts/list": {
        const prompts = this.opts.registry.listPrompts().map(({ prompt }) => {
          const out: Record<string, unknown> = { name: prompt.name };
          if (prompt.title !== undefined) out.title = prompt.title;
          if (prompt.description !== undefined) out.description = prompt.description;
          if (prompt.arguments !== undefined) out.arguments = prompt.arguments;
          return out;
        });
        return plain({ prompts }, { prompts: prompts.length });
      }
      case "prompts/get":
        return this.getPrompt(params, client, state);
      case "resources/list":
        return plain({ resources: [] });
      case "resources/templates/list":
        return plain({ resourceTemplates: [] });
      case "completion/complete":
        return plain({ completion: { values: [] } });
      default:
        if (method.startsWith("notifications/")) return plain({});
        throw new RpcError(-32601, `Method not found: ${method}`);
    }
  }

  private async callTool(params: Record<string, unknown>, client: ClientContext, state: RequestState, id: JsonRpcId): Promise<Outcome> {
    const name = params.name;
    if (typeof name !== "string" || name === "") throw new RpcError(-32602, "Invalid params: name is required");
    const rawArgs = params.arguments ?? {};
    if (!isObject(rawArgs)) throw new RpcError(-32602, "Invalid params: arguments must be an object");

    const found = this.opts.registry.findTool(name);
    if (!found) {
      throw new RpcError(-32602, `Unknown tool: ${name}`);
    }

    const kind = this.clientKind(client, state);
    if (this.isHidden(found, kind)) {
      const text =
        `The module "${found.moduleId}" has not been set up yet, so its tools are not available. ` +
        `Run the skill configurar-${found.moduleId} first.`;
      const refused: HubToolResult = { content: [{ type: "text", text }], isError: true };
      return { result: refused, log: { method: "MCP Tool Call", target: name, moduleId: found.moduleId, status: 403, payload: rawArgs, response: refused } };
    }

    const controller = new AbortController();
    const key = this.callKey(state.sessionId, id);
    this.inFlight.set(key, controller);
    state.aborts.add(controller);
    const ctx: HubCallContext = { client, moduleId: found.moduleId, clientKind: kind, signal: controller.signal };
    let result: HubToolResult;
    try {
      result = await found.tool.handler(rawArgs, ctx);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result = { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
    } finally {
      if (this.inFlight.get(key) === controller) this.inFlight.delete(key);
      state.aborts.delete(controller);
    }
    try {
      this.opts.onToolResult?.(found.moduleId, result.isError === true);
    } catch {
      // The failure marker must never break a request.
    }
    return {
      result,
      log: {
        method: "MCP Tool Call",
        target: name,
        moduleId: found.moduleId,
        status: result.isError ? 500 : 200,
        payload: rawArgs,
        response: result,
      },
    };
  }

  private async getPrompt(params: Record<string, unknown>, client: ClientContext, state: RequestState): Promise<Outcome> {
    const name = params.name;
    if (typeof name !== "string" || name === "") throw new RpcError(-32602, "Invalid params: name is required");
    const found = this.opts.registry.findPrompt(name);
    if (!found) throw new RpcError(-32602, `Unknown prompt: ${name}`);

    const rawArgs = params.arguments ?? {};
    if (!isObject(rawArgs)) throw new RpcError(-32602, "Invalid params: arguments must be an object");
    const args: Record<string, string> = {};
    for (const [key, value] of Object.entries(rawArgs)) args[key] = typeof value === "string" ? value : JSON.stringify(value);
    for (const declared of found.prompt.arguments ?? []) {
      if (declared.required && args[declared.name] === undefined) {
        throw new RpcError(-32602, `Missing required argument: ${declared.name}`);
      }
    }

    const log = { method: "MCP Prompt", target: name, moduleId: found.moduleId, payload: args };
    try {
      const result = await found.prompt.handler(args, { client, moduleId: found.moduleId, clientKind: this.clientKind(client, state) });
      return { result, log: { ...log, status: 200, response: result } };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { error: new RpcError(-32603, `Prompt failed: ${message}`), log: { ...log, status: 500, response: { error: message } } };
    }
  }

  private buildInstructions(): string {
    const parts = [this.opts.getBaseInstructions(), ...this.opts.registry.listInstructions().map((i) => i.text)];
    return parts.filter((p) => typeof p === "string" && p.trim() !== "").join("\n\n");
  }

  // -------------------------------------------------------------------------
  // Sessions and streams
  // -------------------------------------------------------------------------

  private createSession(clientInfoName: string | undefined): string {
    const id = randomUUID();
    this.sessions.set(id, { clientInfoName });
    if (this.sessions.size > MAX_SESSIONS) {
      const oldest = this.sessions.keys().next().value;
      if (oldest !== undefined) this.sessions.delete(oldest);
    }
    return id;
  }

  /** The client's own name (clientInfo of its session) wins; the token name is the fallback. */
  private clientKind(client: ClientContext, state: RequestState): ClientKind {
    const session = state.sessionId ? this.sessions.get(state.sessionId) : undefined;
    return detectClientKind(session?.clientInfoName, client.name);
  }

  private isHidden(registered: RegisteredTool, kind: ClientKind): boolean {
    try {
      return this.opts.isToolHidden?.(registered, kind) === true;
    } catch {
      return false;
    }
  }

  private callKey(sessionId: string | undefined, id: JsonRpcId): string {
    return `${sessionId ?? "-"}|${typeof id}:${String(id)}`;
  }

  /** notifications/cancelled: aborts the call of that request id, if it is still running. */
  private cancel(params: unknown, state: RequestState): void {
    if (!isObject(params)) return;
    const requestId = params.requestId;
    if (typeof requestId !== "string" && typeof requestId !== "number") return;
    this.inFlight.get(this.callKey(state.sessionId, requestId))?.abort();
  }

  private dropSession(sessionId: string): void {
    this.sessions.delete(sessionId);
    for (const [res, id] of [...this.streams]) {
      if (id === sessionId) {
        res.end();
        this.streams.delete(res);
      }
    }
    if (this.streams.size === 0) this.stopHeartbeat();
  }

  private openStream(req: http.IncomingMessage, res: http.ServerResponse, sessionId: string | undefined): void {
    req.socket.setTimeout(0);
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
    });
    res.write(": connected\n\n");
    this.streams.set(res, sessionId);
    res.on("close", () => {
      this.streams.delete(res);
      if (this.streams.size === 0) this.stopHeartbeat();
    });
    if (!this.heartbeat) {
      this.heartbeat = setInterval(() => {
        for (const stream of this.streams.keys()) {
          try {
            stream.write(": ping\n\n");
          } catch {
            // Removed by its close handler.
          }
        }
      }, HEARTBEAT_MS);
      this.heartbeat.unref();
    }
  }

  private stopHeartbeat(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = undefined;
  }
}

function validId(id: unknown): boolean {
  return typeof id === "string" || typeof id === "number" || id === null;
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
