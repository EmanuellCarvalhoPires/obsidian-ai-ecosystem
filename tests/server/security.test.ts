import { afterEach, describe, expect, it } from "vitest";
import { rawRequest, startRig, type TestRig } from "./helpers";

let rig: TestRig;

async function setup(overrides = {}) {
  rig = await startRig(
    (registry) =>
      registry.add({
        id: "mod",
        routes: [
          { method: "GET", path: "/hello/:name", handler: (req) => ({ status: 200, body: { hello: req.params.name, client: req.client.name, auth: req.headers.authorization ?? null } }) },
          { method: "POST", path: "/echo", handler: (req) => ({ status: 200, body: { got: req.body } }) },
        ],
      }),
    overrides,
  );
}

afterEach(async () => {
  await rig?.host.stop();
});

describe("HTTP security pipeline", () => {
  it("serves /health and /v1/health without authentication and without client data", async () => {
    await setup();
    for (const path of ["/health", "/v1/health"]) {
      const res = await fetch(`${rig.base}${path}`);
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(res.headers.get("access-control-allow-origin")).toBeNull();
      const json = (await res.json()) as Record<string, unknown>;
      expect(json).toEqual({ ok: true, app: "ai-ecosystem", name: "ai-ecosystem", version: "9.9.9", apiVersion: 1, modules: ["mod"], vault: "TestVault" });
      expect(JSON.stringify(json)).not.toContain(rig.token);
    }
  });

  it("rejects requests without a valid token with 401 and logs them", async () => {
    await setup();
    const none = await fetch(`${rig.base}/api/v1/mod/hello/x`);
    expect(none.status).toBe(401);
    expect(none.headers.get("www-authenticate")).toBe('Bearer realm="ai-ecosystem"');
    expect(((await none.json()) as any).error.code).toBe("unauthorized");

    const wrong = await fetch(`${rig.base}/mcp`, { method: "POST", headers: { Authorization: "Bearer aie_wrong" }, body: "{}" });
    expect(wrong.status).toBe(401);

    const entry = rig.activity.entries[0];
    expect(entry).toMatchObject({ kind: "http", method: "GET", target: "/api/v1/mod/hello/x", status: 401, client: "" });
  });

  it("rejects any Origin header with 403, even with a valid token", async () => {
    await setup();
    const res = await fetch(`${rig.base}/api/v1/mod/hello/x`, { headers: rig.auth({ Origin: "http://evil.example" }) });
    expect(res.status).toBe(403);
    expect(((await res.json()) as any).error.code).toBe("forbidden_origin");
    const health = await rawRequest(rig.port, { headers: { Origin: "http://evil.example" } });
    expect(health.status).toBe(403);
  });

  it("rejects an unknown Host header with 421 and accepts localhost", async () => {
    await setup();
    const bad = await rawRequest(rig.port, { host: "evil.example", headers: { Authorization: `Bearer ${rig.token}` } });
    expect(bad.status).toBe(421);
    const wrongPort = await rawRequest(rig.port, { host: "127.0.0.1:1" });
    expect(wrongPort.status).toBe(421);
    const local = await rawRequest(rig.port, { host: `localhost:${rig.port}` });
    expect(local.status).toBe(200);
  });

  it("returns 413 for bodies over the limit", async () => {
    await setup({ maxBodyBytes: 1024 });
    const res = await fetch(`${rig.base}/api/v1/mod/echo`, {
      method: "POST",
      headers: rig.auth({ "Content-Type": "application/json" }),
      body: JSON.stringify({ blob: "x".repeat(5000) }),
    });
    expect(res.status).toBe(413);
    expect(((await res.json()) as any).error.code).toBe("payload_too_large");
    const small = await fetch(`${rig.base}/api/v1/mod/echo`, { method: "POST", headers: rig.auth({ "Content-Type": "application/json" }), body: '{"a":1}' });
    expect(small.status).toBe(200);
  });
});

describe("REST routing through the server", () => {
  it("dispatches to module routes, hides the Authorization header and logs the activity", async () => {
    await setup();
    const res = await fetch(`${rig.base}/api/v1/mod/hello/world?x=1`, { headers: rig.auth() });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ hello: "world", client: "Test Client", auth: null });

    const post = await fetch(`${rig.base}/api/v1/mod/echo`, { method: "POST", headers: rig.auth({ "Content-Type": "application/json" }), body: '{"a":1}' });
    expect(await post.json()).toEqual({ got: { a: 1 } });

    const entries = rig.activity.entries.filter((e) => e.kind === "http");
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ method: "GET", target: "/api/v1/mod/hello/world", moduleId: "mod", client: "Test Client", status: 200 });
    expect(entries[0]?.requestHeaders).toBeDefined();
    expect(Object.keys(entries[0]?.requestHeaders ?? {})).not.toContain("authorization");
    expect(entries[1]).toMatchObject({ payload: { a: 1 }, response: { got: { a: 1 } } });
  });

  it("answers 404 and 405 and 400 for invalid JSON", async () => {
    await setup();
    expect((await fetch(`${rig.base}/api/v1/mod/missing`, { headers: rig.auth() })).status).toBe(404);
    const wrong = await fetch(`${rig.base}/api/v1/mod/echo`, { headers: rig.auth() });
    expect(wrong.status).toBe(405);
    expect(wrong.headers.get("allow")).toBe("POST");
    const bad = await fetch(`${rig.base}/api/v1/mod/echo`, { method: "POST", headers: rig.auth({ "Content-Type": "application/json" }), body: "{x" });
    expect(bad.status).toBe(400);
  });
});

describe("stop()", () => {
  it("releases the port and is safe to call twice", async () => {
    await setup();
    const port = rig.port;
    await rig.host.stop();
    await rig.host.stop();
    expect(rig.host.getStatus().running).toBe(false);
    await expect(fetch(`http://127.0.0.1:${port}/health`)).rejects.toThrow();

    const { ServerHost } = await import("../../src/server/server-host");
    const again = new ServerHost({
      port,
      alternativePort: 0,
      registry: rig.registry,
      auth: { authenticate: () => undefined },
      activity: rig.activity,
      version: "1",
      apiVersion: 1,
      getMcpInstructions: () => "",
    });
    const status = await again.start();
    expect(status).toMatchObject({ running: true, port, usingAlternativePort: false });
    await again.stop();
  });

  it("restart() brings the server back and reports status changes", async () => {
    const changes: boolean[] = [];
    await setup({ onStatusChange: (s: { running: boolean }) => changes.push(s.running) });
    const status = await rig.host.restart();
    expect(status.running).toBe(true);
    const res = await fetch(`http://127.0.0.1:${status.port}/health`);
    expect(res.status).toBe(200);
    expect(changes).toContain(false);
    expect(changes[changes.length - 1]).toBe(true);
  });
});
