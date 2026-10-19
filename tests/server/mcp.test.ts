import { afterEach, describe, expect, it } from "vitest";
import type { HubTool } from "../../src/types";
import { startRig, rpc, type TestRig } from "./helpers";

const echoTool: HubTool = {
  name: "echo",
  title: "Echo",
  description: "Echoes text.",
  inputSchema: { type: "object", properties: { text: { type: "string" } } },
  annotations: { readOnlyHint: true },
  handler: async (args, ctx) => ({
    content: [{ type: "text", text: `${String(args.text)} from ${ctx.client.name} via ${ctx.moduleId}` }],
  }),
};

const failingTool: HubTool = {
  name: "explode",
  description: "Always throws.",
  inputSchema: { type: "object" },
  handler: async () => {
    throw new Error("it broke");
  },
};

let rig: TestRig;

async function setup() {
  rig = await startRig((registry) => {
    registry.add({
      id: "mod-a",
      instructions: "Module A instructions.",
      tools: [echoTool, failingTool],
      prompts: [
        {
          name: "greet",
          title: "Greet",
          description: "Say hello",
          arguments: [{ name: "who", required: true }],
          handler: async (args) => ({ messages: [{ role: "user", content: { type: "text", text: `Hello ${args.who}` } }] }),
        },
      ],
    });
    registry.add({ id: "mod-b", instructions: "", tools: [] });
  });
}

afterEach(async () => {
  await rig?.host.stop();
});

describe("MCP Streamable HTTP", () => {
  it("initializes with a session id, the negotiated version and combined instructions", async () => {
    await setup();
    const res = await rpc(rig, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("mcp-session-id")).toMatch(/^[0-9a-f-]{36}$/);
    const json = (await res.json()) as { id: number; result: Record<string, any> };
    expect(json.id).toBe(1);
    expect(json.result.protocolVersion).toBe("2025-06-18");
    expect(json.result.capabilities).toEqual({ tools: { listChanged: true }, prompts: { listChanged: true } });
    expect(json.result.serverInfo).toMatchObject({ name: "ai-ecosystem", version: "9.9.9" });
    expect(json.result.instructions).toBe("Base instructions.\n\nModule A instructions.");
  });

  it("answers the newest version for unknown client versions", async () => {
    await setup();
    const res = await rpc(rig, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "1999-01-01" } });
    expect(((await res.json()) as any).result.protocolVersion).toBe("2025-11-25");
  });

  it("lists tools, runs them with the owner module and logs the activity", async () => {
    await setup();
    const list = (await (await rpc(rig, { jsonrpc: "2.0", id: 2, method: "tools/list" })).json()) as any;
    expect(list.result.tools).toEqual([
      { name: "echo", title: "Echo", description: "Echoes text.", inputSchema: echoTool.inputSchema, annotations: { readOnlyHint: true } },
      { name: "explode", description: "Always throws.", inputSchema: { type: "object" } },
    ]);

    const call = (await (await rpc(rig, { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "echo", arguments: { text: "hi" } } })).json()) as any;
    expect(call.result.content[0].text).toBe("hi from Test Client via mod-a");

    const entry = rig.activity.entries.find((e) => e.method === "MCP Tool Call");
    expect(entry).toMatchObject({ kind: "mcp", target: "echo", moduleId: "mod-a", client: "Test Client", status: 200, payload: { text: "hi" } });
    expect(entry?.durationMs).toBeGreaterThanOrEqual(0);
    expect(entry?.response).toMatchObject({ content: [{ type: "text" }] });
    // tools/list is logged as a plain MCP request.
    expect(rig.activity.entries.find((e) => e.target === "tools/list")).toMatchObject({ method: "MCP", moduleId: "ai-ecosystem", status: 200 });
  });

  it("turns a throwing tool into an isError result with status 500 in the log", async () => {
    await setup();
    const call = (await (await rpc(rig, { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "explode" } })).json()) as any;
    expect(call.result).toEqual({ content: [{ type: "text", text: "Error: it broke" }], isError: true });
    expect(rig.activity.entries.find((e) => e.target === "explode")).toMatchObject({ status: 500, moduleId: "mod-a" });
  });

  it("reports unknown tools and bad params as -32602", async () => {
    await setup();
    const unknown = (await (await rpc(rig, { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "nope" } })).json()) as any;
    expect(unknown.error.code).toBe(-32602);
    const missing = (await (await rpc(rig, { jsonrpc: "2.0", id: 6, method: "tools/call", params: {} })).json()) as any;
    expect(missing.error.code).toBe(-32602);
  });

  it("lists and gets prompts", async () => {
    await setup();
    const list = (await (await rpc(rig, { jsonrpc: "2.0", id: 7, method: "prompts/list" })).json()) as any;
    expect(list.result.prompts).toEqual([
      { name: "greet", title: "Greet", description: "Say hello", arguments: [{ name: "who", required: true }] },
    ]);
    const get = (await (await rpc(rig, { jsonrpc: "2.0", id: 8, method: "prompts/get", params: { name: "greet", arguments: { who: "Ana" } } })).json()) as any;
    expect(get.result.messages[0].content.text).toBe("Hello Ana");
    expect(rig.activity.entries.find((e) => e.method === "MCP Prompt")).toMatchObject({ target: "greet", moduleId: "mod-a", client: "Test Client" });

    const unknown = (await (await rpc(rig, { jsonrpc: "2.0", id: 9, method: "prompts/get", params: { name: "x" } })).json()) as any;
    expect(unknown.error.code).toBe(-32602);
    const noArgs = (await (await rpc(rig, { jsonrpc: "2.0", id: 10, method: "prompts/get", params: { name: "greet" } })).json()) as any;
    expect(noArgs.error.code).toBe(-32602);
  });

  it("handles batches, returning an array of responses without the notifications", async () => {
    await setup();
    const res = await rpc(rig, [
      { jsonrpc: "2.0", id: "a", method: "ping" },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: "b", method: "resources/list" },
    ]);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
      { jsonrpc: "2.0", id: "a", result: {} },
      { jsonrpc: "2.0", id: "b", result: { resources: [] } },
    ]);
  });

  it("answers 202 with no body to notifications and responses only", async () => {
    await setup();
    const note = await rpc(rig, { jsonrpc: "2.0", method: "notifications/initialized" });
    expect(note.status).toBe(202);
    expect(await note.text()).toBe("");
    const batch = await rpc(rig, [{ jsonrpc: "2.0", method: "notifications/cancelled" }, { jsonrpc: "2.0", id: 1, result: {} }]);
    expect(batch.status).toBe(202);
    expect(rig.activity.entries).toHaveLength(0);
  });

  it("answers the simple methods", async () => {
    await setup();
    const calls: Array<[string, unknown]> = [
      ["resources/templates/list", { resourceTemplates: [] }],
      ["logging/setLevel", {}],
      ["completion/complete", { completion: { values: [] } }],
    ];
    for (const [method, result] of calls) {
      const json = (await (await rpc(rig, { jsonrpc: "2.0", id: 1, method, params: {} })).json()) as any;
      expect(json.result).toEqual(result);
    }
  });

  it("returns -32601 for unknown methods, -32700 for bad JSON and -32600 for invalid requests", async () => {
    await setup();
    const unknown = (await (await rpc(rig, { jsonrpc: "2.0", id: 1, method: "bogus/method" })).json()) as any;
    expect(unknown.error.code).toBe(-32601);

    const parse = await fetch(`${rig.base}/mcp`, { method: "POST", headers: rig.auth({ "Content-Type": "application/json" }), body: "{broken" });
    expect(parse.status).toBe(400);
    expect(((await parse.json()) as any).error.code).toBe(-32700);

    const invalid = await rpc(rig, { id: 1, nomethod: true });
    expect(invalid.status).toBe(400);
    expect(((await invalid.json()) as any).error.code).toBe(-32600);

    const empty = await rpc(rig, []);
    expect(empty.status).toBe(400);
  });

  it("accepts unknown or missing session ids and an unsupported protocol header", async () => {
    await setup();
    const res = await rpc(rig, { jsonrpc: "2.0", id: 1, method: "ping" }, { "Mcp-Session-Id": "gone-after-reload", "MCP-Protocol-Version": "1900-01-01" });
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).result).toEqual({});
  });

  it("answers GET without an event-stream Accept with 405 and DELETE with 200", async () => {
    await setup();
    const get = await fetch(`${rig.base}/mcp`, { headers: rig.auth() });
    expect(get.status).toBe(405);
    expect(get.headers.get("allow")).toBe("POST, DELETE");
    const del = await fetch(`${rig.base}/mcp`, { method: "DELETE", headers: rig.auth({ "Mcp-Session-Id": "abc" }) });
    expect(del.status).toBe(200);
  });
});

describe("MCP SSE stream", () => {
  it("receives list_changed notifications and ends on stop()", async () => {
    await setup();
    const controller = new AbortController();
    const res = await fetch(`${rig.base}/mcp`, { headers: rig.auth({ Accept: "text/event-stream" }), signal: controller.signal });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(res.headers.get("cache-control")).toBe("no-store");

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let text = "";
    const readUntil = async (needle: string) => {
      while (!text.includes(needle)) {
        const { value, done } = await reader.read();
        if (done) break;
        text += decoder.decode(value);
      }
    };
    await readUntil(": connected");
    rig.host.notifyListChanged("tools");
    rig.host.notifyListChanged("prompts");
    await readUntil("notifications/prompts/list_changed");
    expect(text).toContain('event: message\ndata: {"jsonrpc":"2.0","method":"notifications/tools/list_changed"}');
    expect(text).toContain('data: {"jsonrpc":"2.0","method":"notifications/prompts/list_changed"}');

    await rig.host.stop();
    const { done } = await reader.read();
    expect(done).toBe(true);
    controller.abort();
  });
});
