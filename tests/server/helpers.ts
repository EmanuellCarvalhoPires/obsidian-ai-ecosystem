import * as http from "node:http";
import type { AddressInfo } from "node:net";
import { ClientAuth, createClient } from "../../src/server/auth";
import { ServerHost, type ServerHostOptions } from "../../src/server/server-host";
import type {
  ActivityHandle,
  ActivityInput,
  ActivitySink,
  HttpMethod,
  HubModuleRegistration,
  HubPrompt,
  HubRoute,
  HubTool,
  ModuleInfo,
  RegisteredPrompt,
  RegisteredTool,
  RegistryLookup,
  RouteMatch,
} from "../../src/types";

/** Registry stub: modules registered as-is, routes matched like the real registry does. */
export class FakeRegistry implements RegistryLookup {
  private modules: HubModuleRegistration[] = [];

  add(module: Partial<HubModuleRegistration> & { id: string }): this {
    this.modules.push({ name: module.id, version: "1.0.0", apiVersion: 1, ...module });
    return this;
  }

  listModules(): ModuleInfo[] {
    return this.modules.map((m) => ({
      id: m.id,
      name: m.name,
      version: m.version,
      apiVersion: m.apiVersion,
      registeredAt: 0,
      routeCount: m.routes?.length ?? 0,
      legacyAliasPaths: (m.legacyAliases ?? []).map((r) => r.path),
      toolNames: (m.tools ?? []).map((t) => t.name),
      promptNames: (m.prompts ?? []).map((p) => p.name),
      warnings: [],
    }));
  }
  listTools(): RegisteredTool[] {
    return this.modules.flatMap((m) => (m.tools ?? []).map((tool: HubTool) => ({ moduleId: m.id, tool })));
  }
  findTool(name: string): RegisteredTool | undefined {
    return this.listTools().find((t) => t.tool.name === name);
  }
  listPrompts(): RegisteredPrompt[] {
    return this.modules.flatMap((m) => (m.prompts ?? []).map((prompt: HubPrompt) => ({ moduleId: m.id, prompt })));
  }
  findPrompt(name: string): RegisteredPrompt | undefined {
    return this.listPrompts().find((p) => p.prompt.name === name);
  }
  findRoute(method: HttpMethod, path: string): RouteMatch | undefined {
    for (const hit of this.candidates(path)) if (hit.route.method === method) return hit;
    return undefined;
  }
  allowedMethods(path: string): HttpMethod[] {
    return [...new Set(this.candidates(path).map((h) => h.route.method))];
  }
  listInstructions(): Array<{ moduleId: string; text: string }> {
    return this.modules.filter((m) => m.instructions !== undefined).map((m) => ({ moduleId: m.id, text: m.instructions as string }));
  }

  private candidates(path: string): RouteMatch[] {
    const out: RouteMatch[] = [];
    for (const m of this.modules) {
      const prefix = `/api/v1/${m.id}`;
      if (path === prefix || path.startsWith(`${prefix}/`)) {
        const rest = path.slice(prefix.length) || "/";
        for (const route of m.routes ?? []) {
          const params = matchPattern(route.path, rest);
          if (params) out.push({ moduleId: m.id, route, path: rest, params, legacy: false });
        }
      }
      for (const route of m.legacyAliases ?? []) {
        const params = matchPattern(route.path, path);
        if (params) out.push({ moduleId: m.id, route: route as HubRoute, path, params, legacy: true });
      }
    }
    return out;
  }
}

function matchPattern(pattern: string, path: string): Record<string, string> | undefined {
  const a = pattern.split("/");
  const b = path.split("/");
  if (a.length !== b.length) return undefined;
  const params: Record<string, string> = {};
  for (let i = 0; i < a.length; i++) {
    const seg = a[i] as string;
    const val = b[i] as string;
    if (seg.startsWith(":")) params[seg.slice(1)] = decodeURIComponent(val);
    else if (seg !== val) return undefined;
  }
  return params;
}

export class FakeActivity implements ActivitySink {
  readonly entries: ActivityInput[] = [];
  log(entry: ActivityInput): void {
    this.entries.push(entry);
  }
  begin(entry: Omit<ActivityInput, "status" | "durationMs">): ActivityHandle {
    this.entries.push({ ...entry, status: 0, durationMs: 0 });
    return { id: "x", appendOutput: () => undefined, end: () => undefined };
  }
}

export interface TestRig {
  host: ServerHost;
  registry: FakeRegistry;
  activity: FakeActivity;
  token: string;
  /** http://127.0.0.1:<port> of the running host. */
  base: string;
  port: number;
  auth: (extra?: Record<string, string>) => Record<string, string>;
}

export async function startRig(
  setup: (registry: FakeRegistry) => void,
  overrides: Partial<ServerHostOptions> = {},
): Promise<TestRig> {
  const registry = new FakeRegistry();
  setup(registry);
  const activity = new FakeActivity();
  const { record, token } = createClient("Test Client");
  const host = new ServerHost({
    port: 0,
    alternativePort: 0,
    registry,
    auth: new ClientAuth(() => [record]),
    activity,
    version: "9.9.9",
    apiVersion: 1,
    vaultName: "TestVault",
    getMcpInstructions: () => "Base instructions.",
    ...overrides,
  });
  const status = await host.start();
  if (!status.running) throw new Error(`rig failed to start: ${status.error ?? "?"}`);
  return {
    host,
    registry,
    activity,
    token,
    base: `http://127.0.0.1:${status.port}`,
    port: status.port,
    auth: (extra = {}) => ({ Authorization: `Bearer ${token}`, ...extra }),
  };
}

/** Posts one JSON-RPC body (object or array) to /mcp. */
export async function rpc(rig: TestRig, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${rig.base}/mcp`, {
    method: "POST",
    headers: rig.auth({ "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...headers }),
    body: JSON.stringify(body),
  });
}

/** Starts a dummy HTTP server on a random port. */
export async function dummyServer(handler: http.RequestListener): Promise<{ server: http.Server; port: number; close: () => Promise<void> }> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    server,
    port,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}

/** Raw request with a custom Host header (fetch cannot set it). */
export function rawRequest(
  port: number,
  options: { path?: string; method?: string; host?: string; headers?: Record<string, string> },
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: options.path ?? "/health",
        method: options.method ?? "GET",
        agent: false,
        headers: { ...(options.host ? { Host: options.host } : {}), ...options.headers },
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (c: string) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}
