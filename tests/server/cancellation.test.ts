import { afterEach, describe, expect, it } from "vitest";
import type { HubCallContext } from "../../src/types";
import { rpc, startRig } from "./helpers";
import type { TestRig } from "./helpers";

interface Waiting {
  signal: AbortSignal;
  ctx: HubCallContext;
  release: () => void;
}

let rig: TestRig;
let waiting: Waiting[];

async function setup() {
  waiting = [];
  rig = await startRig((registry) => {
    registry.add({
      id: "screens",
      tools: [
        {
          name: "wait_tool",
          description: "waits until aborted or released",
          inputSchema: { type: "object" },
          handler: async (_args, ctx) => {
            const signal = ctx.signal as AbortSignal;
            await new Promise<void>((resolve) => {
              waiting.push({ signal, ctx, release: resolve });
              signal.addEventListener("abort", () => resolve(), { once: true });
            });
            return { content: [{ type: "text", text: signal.aborted ? "aborted" : "released" }] };
          },
        },
      ],
    });
  });
}

afterEach(async () => {
  for (const w of waiting ?? []) w.release();
  await rig?.host.stop();
});

async function waitFor(cond: () => boolean, ms = 3000): Promise<void> {
  const until = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > until) throw new Error("timed out");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function session(): Promise<Record<string, string>> {
  const res = await rpc(rig, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } });
  return { "Mcp-Session-Id": res.headers.get("mcp-session-id") ?? "" };
}

function startCall(headers: Record<string, string>, id: number | string, extra: RequestInit = {}): Promise<Response> {
  return fetch(`${rig.base}/mcp`, {
    method: "POST",
    headers: rig.auth({ "Content-Type": "application/json", Accept: "application/json", ...headers }),
    body: JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name: "wait_tool", arguments: {} } }),
    ...extra,
  });
}

describe("tools/call cancellation", () => {
  it("gives the tool a signal that is not aborted while the call runs", async () => {
    await setup();
    const headers = await session();
    const pending = startCall(headers, 10);
    await waitFor(() => waiting.length === 1);
    expect(waiting[0]!.signal.aborted).toBe(false);
    waiting[0]!.release();
    const json = (await (await pending).json()) as any;
    expect(json.result.content[0].text).toBe("released");
  });

  it("aborts the signal on notifications/cancelled with the matching requestId", async () => {
    await setup();
    const headers = await session();
    const pending = startCall(headers, 11);
    await waitFor(() => waiting.length === 1);

    const note = await rpc(rig, { jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 11, reason: "user" } }, headers);
    expect(note.status).toBe(202);
    await waitFor(() => waiting[0]!.signal.aborted);
    const json = (await (await pending).json()) as any;
    expect(json.result.content[0].text).toBe("aborted");
  });

  it("ignores a cancel for another request id, another session or a malformed one", async () => {
    await setup();
    const headers = await session();
    const other = await session();
    const pending = startCall(headers, "abc");
    await waitFor(() => waiting.length === 1);

    await rpc(rig, { jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: "zzz" } }, headers);
    await rpc(rig, { jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: "abc" } }, other);
    await rpc(rig, { jsonrpc: "2.0", method: "notifications/cancelled", params: {} }, headers);
    await rpc(rig, { jsonrpc: "2.0", method: "notifications/cancelled" }, headers);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(waiting[0]!.signal.aborted).toBe(false);

    await rpc(rig, { jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: "abc" } }, headers);
    await waitFor(() => waiting[0]!.signal.aborted);
    await pending;
  });

  it("aborts only the cancelled call when two run at once", async () => {
    await setup();
    const headers = await session();
    const first = startCall(headers, 1);
    const second = startCall(headers, 2);
    await waitFor(() => waiting.length === 2);

    await rpc(rig, { jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 2 } }, headers);
    await waitFor(() => waiting.some((w) => w.signal.aborted));
    expect(waiting.filter((w) => w.signal.aborted)).toHaveLength(1);
    waiting.find((w) => !w.signal.aborted)!.release();
    await Promise.all([first, second]);
  });

  it("aborts the signal when the client closes the connection before the answer", async () => {
    await setup();
    const headers = await session();
    const controller = new AbortController();
    const pending = startCall(headers, 12, { signal: controller.signal }).catch(() => undefined);
    await waitFor(() => waiting.length === 1);

    controller.abort();
    await waitFor(() => waiting[0]!.signal.aborted);
    await pending;
  });

  it("aborts running calls when the server stops", async () => {
    await setup();
    const headers = await session();
    const pending = startCall(headers, 13).catch(() => undefined);
    await waitFor(() => waiting.length === 1);
    await rig.host.stop();
    expect(waiting[0]!.signal.aborted).toBe(true);
    await pending;
  });
});
