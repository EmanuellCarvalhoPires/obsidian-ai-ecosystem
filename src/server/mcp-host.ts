import { randomUUID } from "node:crypto";
import type * as http from "node:http";
import { clearInterval, setInterval } from "node:timers";
import { ECOSYSTEM_ID } from "../types";
import type { ActivityInput, ActivitySink, ClientContext, HubCallContext, HubToolResult, RegistryLookup } from "../types";
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
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rpcError(id: JsonRpcId, code: number, message: string): RpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

/** MCP over Streamable HTTP at /mcp: JSON responses plus an optional GET stream for list_changed. */
export class McpHost {
  private readonly sessions = new Set<string>();
  private readonly streams = new Map<http.ServerResponse, string | undefined>();
  private heartbeat: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly opts: McpHostOptions) {}

  async handle(req: http.IncomingMessage, res: http.ServerResponse, client: ClientContext, rawBody: string): Promise<void> {
    const sessionId = headerValue(req.headers["mcp-session-id"]);
    switch (req.method) {
      case "POST":
        return this.handlePost(res, client, rawBody);
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
    this.stopHeartbeat();
  }

  // -------------------------------------------------------------------------
  // POST
  // -------------------------------------------------------------------------

  private async handlePost(res: http.ServerResponse, client: ClientContext, rawBody: string): Promise<void> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      return sendJson(res, 400, rpcError(null, -32700, "Parse error"));
    }

    const state: { newSessionId?: string } = {};
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
  private async processEntry(entry: unknown, client: ClientContext, state: { newSessionId?: string }): Promise<RpcResponse | undefined> {
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
    if (!("id" in entry) || entry.id === undefined) return undefined; // notification
    if (!validId(entry.id)) return rpcError(null, -32600, "Invalid Request");

    const id = entry.id as JsonRpcId;
    const method = entry.method as string;
    const params = isObject(entry.params) ? entry.params : {};

    const started = Date.now();
    let outcome: Outcome;
    try {
      outcome = await this.execute(method, params, client, state);
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

  private async execute(method: string, params: Record<string, unknown>, client: ClientContext, state: { newSessionId?: string }): Promise<Outcome> {
    const plain = (result: unknown, response: unknown = result, payload?: unknown): Outcome => ({
      result,
      log: { method: "MCP", target: method, moduleId: ECOSYSTEM_ID, status: 200, payload, response },
    });

    switch (method) {
      case "initialize": {
        const asked = params.protocolVersion;
        const supported = typeof asked === "string" && (MCP_PROTOCOL_VERSIONS as readonly string[]).includes(asked);
        const protocolVersion = supported ? asked : MCP_PROTOCOL_VERSIONS[0];
        state.newSessionId = this.createSession();
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
        const tools = this.opts.registry.listTools().map(({ tool }) => {
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
        return this.callTool(params, client);
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
        return this.getPrompt(params, client);
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

  private async callTool(params: Record<string, unknown>, client: ClientContext): Promise<Outcome> {
    const name = params.name;
    if (typeof name !== "string" || name === "") throw new RpcError(-32602, "Invalid params: name is required");
    const rawArgs = params.arguments ?? {};
    if (!isObject(rawArgs)) throw new RpcError(-32602, "Invalid params: arguments must be an object");

    const found = this.opts.registry.findTool(name);
    if (!found) {
      throw new RpcError(-32602, `Unknown tool: ${name}`);
    }

    const ctx: HubCallContext = { client, moduleId: found.moduleId };
    let result: HubToolResult;
    try {
      result = await found.tool.handler(rawArgs, ctx);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result = { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
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

  private async getPrompt(params: Record<string, unknown>, client: ClientContext): Promise<Outcome> {
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
      const result = await found.prompt.handler(args, { client, moduleId: found.moduleId });
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

  private createSession(): string {
    const id = randomUUID();
    this.sessions.add(id);
    if (this.sessions.size > MAX_SESSIONS) {
      const oldest = this.sessions.values().next().value;
      if (oldest !== undefined) this.sessions.delete(oldest);
    }
    return id;
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
