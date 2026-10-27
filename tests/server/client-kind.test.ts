import { afterEach, describe, expect, it } from "vitest";
import { detectClientKind } from "../../src/server/client-detector";
import type { ClientKind, HubCallContext, HubTool } from "../../src/types";
import { rpc, startRig } from "./helpers";
import type { TestRig } from "./helpers";

describe("detectClientKind", () => {
  it("uses the clientInfo name first", () => {
    expect(detectClientKind("claude-code", "Some token")).toBe("claude-code");
    expect(detectClientKind("Claude Code", undefined)).toBe("claude-code");
    expect(detectClientKind("antigravity-client", "Claude Code")).toBe("antigravity");
    expect(detectClientKind("gemini-cli", undefined)).toBe("antigravity");
    expect(detectClientKind("mcp-inspector", "Claude Code")).toBe("other");
  });

  it("falls back to the token name when the client sent no name", () => {
    expect(detectClientKind(undefined, "Claude Code (work)")).toBe("claude-code");
    expect(detectClientKind("", "Antigravity")).toBe("antigravity");
    expect(detectClientKind(undefined, "Gemini")).toBe("antigravity");
    expect(detectClientKind(undefined, "My script")).toBe("other");
    expect(detectClientKind(undefined, undefined)).toBe("other");
  });
});

const seen: Array<{ tool: string; kind: ClientKind | undefined; hasSignal: boolean }> = [];
const results: Array<{ moduleId: string; failed: boolean }> = [];

function record(name: string, extra: Partial<HubTool> = {}): HubTool {
  return {
    name,
    description: name,
    inputSchema: { type: "object" },
    handler: async (_args: Record<string, unknown>, ctx: HubCallContext) => {
      seen.push({ tool: name, kind: ctx.clientKind, hasSignal: ctx.signal instanceof AbortSignal });
      return { content: [{ type: "text", text: "ok" }] };
    },
    ...extra,
  };
}

let rig: TestRig;

async function setup(opts: { failing?: boolean } = {}) {
  seen.length = 0;
  results.length = 0;
  rig = await startRig(
    (registry) => {
      registry.add({ id: "ai-ecosystem", tools: [record("ecosystem_status")] });
      registry.add({
        id: "pending-mod",
        tools: [
          record("pending_tool"),
          record("setup_helper", { availableDuringSetup: true }),
          {
            name: "pending_fails",
            description: "fails",
            inputSchema: { type: "object" },
            handler: async () => ({ content: [{ type: "text", text: "nope" }], isError: true }),
          },
          {
            name: "pending_throws",
            description: "throws",
            inputSchema: { type: "object" },
            handler: async () => {
              throw new Error("boom");
            },
          },
        ],
      });
      registry.add({ id: "ready-mod", tools: [record("ready_tool")] });
    },
    {
      isToolHidden: (registered, kind) =>
        kind === "claude-code" && registered.moduleId === "pending-mod" && !registered.tool.availableDuringSetup,
      onToolResult: (moduleId, failed) => {
        results.push({ moduleId, failed });
        if (opts.failing) throw new Error("marker store is broken");
      },
    },
  );
}

afterEach(async () => {
  await rig?.host.stop();
});

async function initialize(clientName: string | undefined): Promise<Record<string, string>> {
  const params: Record<string, unknown> = { protocolVersion: "2025-06-18", capabilities: {} };
  if (clientName !== undefined) params.clientInfo = { name: clientName, version: "1" };
  const res = await rpc(rig, { jsonrpc: "2.0", id: 1, method: "initialize", params });
  return { "Mcp-Session-Id": res.headers.get("mcp-session-id") ?? "" };
}

async function listNames(headers: Record<string, string>): Promise<string[]> {
  const res = await rpc(rig, { jsonrpc: "2.0", id: 2, method: "tools/list" }, headers);
  return ((await res.json()) as any).result.tools.map((t: { name: string }) => t.name);
}

async function call(headers: Record<string, string>, name: string, id = 3): Promise<any> {
  const res = await rpc(rig, { jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: {} } }, headers);
  return res.json();
}

describe("tool visibility by client", () => {
  it("hides the tools of a pending module from Claude Code only", async () => {
    await setup();
    const claude = await listNames(await initialize("claude-code"));
    expect(claude).toEqual(["ecosystem_status", "setup_helper", "ready_tool"]);

    const antigravity = await listNames(await initialize("antigravity-client"));
    expect(antigravity).toEqual(["ecosystem_status", "pending_tool", "setup_helper", "pending_fails", "pending_throws", "ready_tool"]);

    const other = await listNames(await initialize("mcp-inspector"));
    expect(other).toContain("pending_tool");
  });

  it("uses the token name when the client sent no name or has no session", async () => {
    await setup();
    expect(await listNames({})).toContain("pending_tool"); // the token is called "Test Client"
    expect(await listNames(await initialize(undefined))).toContain("pending_tool");
    await rig.host.stop();

    rig = await startRig(
      (registry) => registry.add({ id: "pending-mod", tools: [record("pending_tool")] }),
      {
        auth: { authenticate: () => ({ id: "c1", name: "Claude Code (work)" }) },
        isToolHidden: (_registered, kind) => kind === "claude-code",
      },
    );
    expect(await listNames({})).toEqual([]);
    expect(await listNames(await initialize(undefined))).toEqual([]);
    expect(await listNames(await initialize("mcp-inspector"))).toEqual(["pending_tool"]);
  });

  it("refuses a call of a hidden tool with a message that names the setup skill", async () => {
    await setup();
    const headers = await initialize("claude-code");
    const json = await call(headers, "pending_tool");
    expect(json.result.isError).toBe(true);
    expect(json.result.content[0].text).toContain("configurar-pending-mod");
    expect(seen).toEqual([]);
    expect(results).toEqual([]);

    const allowed = await call(headers, "setup_helper", 4);
    expect(allowed.result.isError).toBeUndefined();
    expect(seen).toEqual([{ tool: "setup_helper", kind: "claude-code", hasSignal: true }]);
  });

  it("lets other clients call the tool, with their kind in the context", async () => {
    await setup();
    const json = await call(await initialize("antigravity-client"), "pending_tool");
    expect(json.result.isError).toBeUndefined();
    expect(seen).toEqual([{ tool: "pending_tool", kind: "antigravity", hasSignal: true }]);
  });

  it("gives the kind of the token when the client sent no name", async () => {
    await setup();
    await call({}, "ready_tool");
    expect(seen).toEqual([{ tool: "ready_tool", kind: "other", hasSignal: true }]);
  });
});

describe("tool result callback", () => {
  it("reports successes, error results and thrown errors by module", async () => {
    await setup();
    const headers = await initialize("mcp-inspector");
    await call(headers, "ready_tool");
    await call(headers, "pending_fails", 4);
    const thrown = await call(headers, "pending_throws", 5);
    expect(thrown.result.isError).toBe(true);
    expect(results).toEqual([
      { moduleId: "ready-mod", failed: false },
      { moduleId: "pending-mod", failed: false },
      { moduleId: "pending-mod", failed: true },
    ]);
  });

  it("does not count a tool answer with isError as a failure of the module, but a thrown error is one", async () => {
    await setup();
    const headers = await initialize("mcp-inspector");
    const answered = await call(headers, "pending_fails", 4);
    expect(answered.result.isError).toBe(true);
    expect(results).toEqual([{ moduleId: "pending-mod", failed: false }]);
    await call(headers, "pending_throws", 5);
    expect(results).toEqual([
      { moduleId: "pending-mod", failed: false },
      { moduleId: "pending-mod", failed: true },
    ]);
  });

  it("reports success as not failed", async () => {
    await setup();
    await call(await initialize("mcp-inspector"), "ready_tool");
    expect(results).toEqual([{ moduleId: "ready-mod", failed: false }]);
  });

  it("never breaks the request when the callback throws", async () => {
    await setup({ failing: true });
    const json = await call(await initialize("mcp-inspector"), "ready_tool");
    expect(json.result.content[0].text).toBe("ok");
    expect(results).toHaveLength(1);
  });
});
