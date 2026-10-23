import * as http from "node:http";
import { setTimeout } from "node:timers";
import { ECOSYSTEM_ID } from "../types";
import type { ActivitySink, ClientContext, PortConflict, RegistryLookup, ServerStatus } from "../types";
import { errorBody, flattenHeaders, parseQuery, readBody, sendError, sendJson, splitUrl, withoutAuthorization } from "./http-utils";
import { McpHost } from "./mcp-host";
import type { McpHostOptions } from "./mcp-host";
import { probePortOwner } from "./port-owner";
import { handleRestRequest, sendOutcome } from "./router";

/** The server only ever listens on the loopback interface. */
export const LISTEN_HOST = "127.0.0.1";

const DEFAULT_MAX_BODY_BYTES = 10 * 1024 * 1024;
const DEFAULT_TRANSITION_WAIT_MS = 10_000;
const RETRY_WAITS_MS = [250, 500, 1000, 2000, 3000];
const MAX_PORT = 65535;

/** How many ports are tried after the main one (the alternative port first, then the next ones one by one). */
export const PORT_SCAN_ATTEMPTS = 20;

export interface ServerHostOptions {
  port: number;
  alternativePort: number;
  /** Port this vault actually used last time. Tried first, so MCP clients keep working. */
  lastPort?: number;
  registry: RegistryLookup;
  auth: { authenticate(authorizationHeader: string | undefined): ClientContext | undefined };
  activity: ActivitySink;
  version: string;
  apiVersion: number;
  vaultName?: string;
  /** Base text of the MCP instructions (module instructions are appended). */
  getMcpInstructions: () => string;
  /** Hides tools from some clients (see McpHostOptions). */
  isToolHidden?: McpHostOptions["isToolHidden"];
  /** Told about every MCP tool call result (see McpHostOptions). */
  onToolResult?: McpHostOptions["onToolResult"];
  /** tools/list exposure per kind of client (see McpHostOptions). */
  getToolExposure?: McpHostOptions["getToolExposure"];
  isListedWhenIndexed?: McpHostOptions["isListedWhenIndexed"];
  getIndexedInstructions?: McpHostOptions["getIndexedInstructions"];
  onStatusChange?: (status: ServerStatus) => void;
  /** Default 10 MB. */
  maxBodyBytes?: number;
  /** How long to keep retrying the main port while Environment Keys 2.x (transition mode) frees it. Default 10000. */
  transitionWaitMs?: number;
  /** Who holds a busy port. Default probePortOwner; injectable for tests. */
  probe?: (port: number) => Promise<PortConflict>;
}

/** The ports tried after the main one: the alternative port, then the next ones, never the main port or above 65535. */
export function scanPorts(mainPort: number, alternativePort: number): number[] {
  // Port 0 asks the system for a free port: there is no range to walk.
  if (alternativePort === 0) return [0];
  const ports: number[] = [];
  for (let port = alternativePort; port <= MAX_PORT && ports.length < PORT_SCAN_ATTEMPTS; port++) {
    if (port !== mainPort) ports.push(port);
  }
  return ports;
}

/** Busy (EADDRINUSE) or refused (EACCES, e.g. a reserved range on Windows): try another port. */
function isPortTaken(error: NodeJS.ErrnoException): boolean {
  return error.code === "EADDRINUSE" || error.code === "EACCES";
}

type ListenResult = { ok: true; server: http.Server; port: number } | { ok: false; error: NodeJS.ErrnoException };

/**
 * Local HTTP server (REST + MCP). Options are given as an object or as a getter; a getter is
 * called again on every start() / restart(), so a port changed in the settings applies on
 * restart. Everything else in the options is read once per start.
 */
export class ServerHost {
  private opts: ServerHostOptions;
  private server: http.Server | undefined;
  private mcp: McpHost | undefined;
  private boundPort = 0;
  private status: ServerStatus;
  private starting: Promise<ServerStatus> | undefined;

  private readonly getOptions: () => ServerHostOptions;

  constructor(options: ServerHostOptions | (() => ServerHostOptions)) {
    this.getOptions = typeof options === "function" ? options : () => options;
    this.opts = this.getOptions();
    this.status = this.idleStatus();
  }

  getStatus(): ServerStatus {
    return { ...this.status };
  }

  notifyListChanged(kind: "tools" | "prompts"): void {
    this.mcp?.notifyListChanged(kind);
  }

  start(): Promise<ServerStatus> {
    if (this.server) return Promise.resolve(this.getStatus());
    this.starting ??= this.doStart().finally(() => {
      this.starting = undefined;
    });
    return this.starting;
  }

  async stop(): Promise<void> {
    if (this.starting) await this.starting.catch(() => undefined);
    const server = this.server;
    this.server = undefined;
    this.mcp?.closeAll();
    this.mcp = undefined;
    if (!server) return;
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
    this.boundPort = 0;
    this.setStatus(this.idleStatus());
  }

  async restart(): Promise<ServerStatus> {
    await this.stop();
    return this.start();
  }

  // -------------------------------------------------------------------------
  // Start-up and port handling
  // -------------------------------------------------------------------------

  private idleStatus(): ServerStatus {
    return { running: false, port: this.opts.port, usingAlternativePort: false };
  }

  private setStatus(status: ServerStatus): void {
    this.status = status;
    try {
      this.opts.onStatusChange?.(this.getStatus());
    } catch (err) {
      console.warn("AI Ecosystem: status listener failed", err);
    }
  }

  private async doStart(): Promise<ServerStatus> {
    this.opts = this.getOptions();
    const opts = this.opts;
    this.setStatus(this.idleStatus());

    // The port this vault used last time comes first, so its MCP clients keep working.
    const lastPort = opts.lastPort !== undefined && opts.lastPort !== opts.port ? opts.lastPort : undefined;
    if (lastPort !== undefined) {
      const remembered = await this.listen(lastPort);
      if (remembered.ok) return this.running(remembered, undefined);
    }

    const main = await this.listen(opts.port);
    if (main.ok) return this.running(main, undefined);

    if (!isPortTaken(main.error)) {
      return this.failed(opts.port, `Could not listen on port ${opts.port}: ${main.error.message}`);
    }

    const probe = opts.probe ?? probePortOwner;
    let conflict: PortConflict;
    try {
      conflict = await probe(opts.port);
    } catch {
      conflict = { port: opts.port, owner: "unknown" };
    }

    if (conflict.owner === "environment-keys-transition") {
      this.setStatus({ running: false, port: opts.port, usingAlternativePort: false, conflict });
      const retried = await this.retryMainPort(opts.port, opts.transitionWaitMs ?? DEFAULT_TRANSITION_WAIT_MS);
      if (retried?.ok) return this.running(retried, undefined);
    }

    // Busy or refused ports are skipped; the first free one wins. Only the main port is probed (fast start-up).
    const candidates = scanPorts(opts.port, opts.alternativePort);
    for (const port of candidates) {
      if (port === lastPort) continue; // already tried
      const result = await this.listen(port);
      if (result.ok) return this.running(result, conflict);
      if (!isPortTaken(result.error)) {
        return this.failed(opts.port, `Could not listen on port ${port}: ${result.error.message}`, conflict);
      }
    }

    const range = candidates.length > 0 ? `${candidates[0]}-${candidates[candidates.length - 1]}` : "none";
    return this.failed(
      opts.port,
      candidates.length > 0
        ? `Port ${opts.port} is in use and no free port was found in ${range}. Free a port or change the port in the settings.`
        : `Port ${opts.port} is in use and there is no other port to try. Change the port in the settings.`,
      conflict,
    );
  }

  private async retryMainPort(port: number, totalMs: number): Promise<ListenResult | undefined> {
    const deadline = Date.now() + totalMs;
    for (let i = 0; ; i++) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) return undefined;
      const wait = Math.min(RETRY_WAITS_MS[Math.min(i, RETRY_WAITS_MS.length - 1)] ?? 3000, remaining);
      await new Promise((resolve) => setTimeout(resolve, wait));
      const result = await this.listen(port);
      if (result.ok) return result;
      if (result.error.code !== "EADDRINUSE") return undefined;
    }
  }

  private running(result: Extract<ListenResult, { ok: true }>, conflict: PortConflict | undefined): ServerStatus {
    this.server = result.server;
    this.boundPort = result.port;
    const opts = this.opts;
    this.mcp = new McpHost({
      registry: opts.registry,
      activity: opts.activity,
      serverInfo: { name: ECOSYSTEM_ID, title: "AI Ecosystem (Obsidian)", version: opts.version },
      getBaseInstructions: opts.getMcpInstructions,
      isToolHidden: opts.isToolHidden,
      onToolResult: opts.onToolResult,
      getToolExposure: opts.getToolExposure,
      isListedWhenIndexed: opts.isListedWhenIndexed,
      getIndexedInstructions: opts.getIndexedInstructions,
    });
    // An ephemeral configured port (0) has no "other" port to compare with.
    const alternative = opts.port !== 0 && result.port !== opts.port;
    const status: ServerStatus = { running: true, port: result.port, usingAlternativePort: alternative };
    if (alternative) status.configuredPort = opts.port;
    if (opts.lastPort !== undefined && opts.lastPort !== result.port) status.previousPort = opts.lastPort;
    if (conflict) status.conflict = conflict;
    this.setStatus(status);
    return this.getStatus();
  }

  private failed(port: number, error: string, conflict?: PortConflict): ServerStatus {
    const status: ServerStatus = { running: false, port, usingAlternativePort: false, error };
    if (conflict) status.conflict = conflict;
    this.setStatus(status);
    return this.getStatus();
  }

  private listen(port: number): Promise<ListenResult> {
    return new Promise((resolve) => {
      const server = http.createServer((req, res) => {
        this.handle(req, res).catch((err: unknown) => {
          console.error("AI Ecosystem: request failed", err);
          sendError(res, 500, "internal_error", "Internal server error.");
        });
      });
      const onError = (error: NodeJS.ErrnoException) => resolve({ ok: false, error });
      server.once("error", onError);
      server.listen(port, LISTEN_HOST, () => {
        server.off("error", onError);
        server.on("error", (err) => console.warn("AI Ecosystem: server error", err));
        const address = server.address();
        resolve({ ok: true, server, port: typeof address === "object" && address ? address.port : port });
      });
    });
  }

  // -------------------------------------------------------------------------
  // Request pipeline
  // -------------------------------------------------------------------------

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const started = Date.now();
    const opts = this.opts;
    const method = (req.method ?? "GET").toUpperCase();

    // 1. DNS rebinding protection: only our own host names and the real port.
    const host = (req.headers.host ?? "").toLowerCase();
    if (host !== `127.0.0.1:${this.boundPort}` && host !== `localhost:${this.boundPort}`) {
      return sendError(res, 421, "bad_host", "Invalid Host header.");
    }
    // 2. Browsers always send Origin on cross-site requests; AI clients and scripts do not.
    if (req.headers.origin !== undefined) {
      return sendError(res, 403, "forbidden_origin", "Browser requests are not allowed.");
    }
    const url = splitUrl(req.url);
    if (!url) return sendError(res, 400, "bad_request", "Invalid request target.");
    const path = url.pathname;

    // 3. Public health check: no client or secret data.
    if (method === "GET" && (path === "/health" || path === "/v1/health")) {
      return sendJson(res, 200, {
        ok: true,
        app: ECOSYSTEM_ID,
        name: ECOSYSTEM_ID,
        version: opts.version,
        apiVersion: opts.apiVersion,
        modules: opts.registry.listModules().map((m) => m.id),
        vault: opts.vaultName,
      });
    }

    const headers = withoutAuthorization(flattenHeaders(req.headers));

    // 4. Authentication.
    const client = opts.auth.authenticate(req.headers.authorization);
    if (!client) {
      this.log({ method, target: path, moduleId: "", client: "", status: 401, started, requestHeaders: headers });
      return sendJson(
        res,
        401,
        errorBody("unauthorized", "Missing or invalid client token. Create one in Obsidian: AI Ecosystem settings, Clients."),
        { "WWW-Authenticate": 'Bearer realm="ai-ecosystem"' },
      );
    }

    // 5. Body.
    const body = await readBody(req, opts.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES);
    if (body.kind === "aborted") return;
    if (body.kind === "too-large") {
      return sendError(res, 413, "payload_too_large", "The request body is too large.", { Connection: "close" });
    }

    // 6. MCP.
    if (path === "/mcp") {
      if (!this.mcp) return sendError(res, 503, "unavailable", "The server is stopping.");
      return this.mcp.handle(req, res, client, body.body);
    }

    // 7. REST routes of the modules.
    const outcome = await handleRestRequest(opts.registry, {
      method,
      path,
      query: parseQuery(url.search),
      headers,
      rawBody: body.body,
      client,
    });
    sendOutcome(res, outcome);
    this.log({
      method,
      target: path,
      moduleId: outcome.moduleId,
      client: client.name,
      status: outcome.status,
      started,
      requestHeaders: headers,
      payload: outcome.requestBody ?? (body.body === "" ? undefined : body.body),
      response: outcome.responseBody,
    });
  }

  private log(entry: {
    method: string;
    target: string;
    moduleId: string;
    client: string;
    status: number;
    started: number;
    requestHeaders: Record<string, string>;
    payload?: unknown;
    response?: unknown;
  }): void {
    try {
      this.opts.activity.log({
        kind: "http",
        method: entry.method,
        target: entry.target,
        moduleId: entry.moduleId,
        client: entry.client,
        status: entry.status,
        durationMs: Date.now() - entry.started,
        requestHeaders: entry.requestHeaders,
        payload: entry.payload,
        response: entry.response,
      });
    } catch {
      // The inspector must never break a request.
    }
  }
}
