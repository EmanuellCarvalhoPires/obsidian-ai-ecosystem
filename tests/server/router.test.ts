import { describe, expect, it } from "vitest";
import { handleRestRequest, type RestInput } from "../../src/server/router";
import type { HubRequest, HubResponse } from "../../src/types";
import { FakeRegistry } from "./helpers";

const client = { id: "c1", name: "Tester" };

function input(overrides: Partial<RestInput> = {}): RestInput {
  return { method: "GET", path: "/api/v1/mod/items/7", query: {}, headers: {}, rawBody: "", client, ...overrides };
}

function registryWith(handler: (req: HubRequest) => HubResponse | Promise<HubResponse>, method: "GET" | "POST" = "GET", path = "/items/:id") {
  return new FakeRegistry().add({ id: "mod", routes: [{ method, path, handler }] });
}

describe("handleRestRequest", () => {
  it("passes params, query, relative path and client to the handler", async () => {
    let seen: HubRequest | undefined;
    const registry = registryWith((req) => {
      seen = req;
      return { status: 200, body: { id: req.params.id } };
    });
    const out = await handleRestRequest(registry, input({ query: { a: "1" }, headers: { "x-test": "yes", authorization: "Bearer secret" } }));
    expect(out.status).toBe(200);
    expect(out.moduleId).toBe("mod");
    expect(JSON.parse(String(out.payload))).toEqual({ id: "7" });
    expect(seen?.params).toEqual({ id: "7" });
    expect(seen?.path).toBe("/items/7");
    expect(seen?.fullPath).toBe("/api/v1/mod/items/7");
    expect(seen?.query).toEqual({ a: "1" });
    expect(seen?.client).toEqual(client);
    expect(seen?.method).toBe("GET");
    expect(seen?.headers).toEqual({ "x-test": "yes" });
  });

  it("returns 404 when no route matches and 405 with Allow when the path exists for other methods", async () => {
    const registry = registryWith(() => ({ status: 200 }));
    const missing = await handleRestRequest(registry, input({ path: "/api/v1/mod/nothing/here/at/all" }));
    expect(missing.status).toBe(404);
    expect(JSON.parse(String(missing.payload)).error.code).toBe("not_found");

    const wrongMethod = await handleRestRequest(registry, input({ method: "POST" }));
    expect(wrongMethod.status).toBe(405);
    expect(wrongMethod.headers.Allow).toBe("GET");
    expect(JSON.parse(String(wrongMethod.payload)).error.code).toBe("method_not_allowed");

    const unsupported = await handleRestRequest(registry, input({ method: "OPTIONS" }));
    expect(unsupported.status).toBe(405);
  });

  it("parses JSON bodies and returns 400 for invalid JSON", async () => {
    let body: unknown;
    const registry = registryWith((req) => {
      body = req.body;
      return { status: 201, body: { ok: true } };
    }, "POST", "/items/:id");
    const ok = await handleRestRequest(
      registry,
      input({ method: "POST", headers: { "content-type": "application/json; charset=utf-8" }, rawBody: '{"x":[1,2]}' }),
    );
    expect(ok.status).toBe(201);
    expect(body).toEqual({ x: [1, 2] });
    expect(ok.requestBody).toEqual({ x: [1, 2] });

    const bad = await handleRestRequest(registry, input({ method: "POST", headers: { "content-type": "application/json" }, rawBody: "{nope" }));
    expect(bad.status).toBe(400);
    expect(JSON.parse(String(bad.payload)).error.code).toBe("invalid_json");
    expect(bad.moduleId).toBe("mod");
  });

  it("keeps the raw text for other content types and an empty string for empty bodies", async () => {
    const bodies: unknown[] = [];
    const registry = registryWith((req) => {
      bodies.push(req.body);
      return { status: 204 };
    }, "POST");
    await handleRestRequest(registry, input({ method: "POST", headers: { "content-type": "text/plain" }, rawBody: "hello" }));
    await handleRestRequest(registry, input({ method: "POST", headers: { "content-type": "application/json" }, rawBody: "" }));
    expect(bodies).toEqual(["hello", ""]);
  });

  it("turns a thrown error into 500 handler_error", async () => {
    const registry = registryWith(() => {
      throw new Error("kaput");
    });
    const out = await handleRestRequest(registry, input());
    expect(out.status).toBe(500);
    expect(JSON.parse(String(out.payload))).toEqual({ error: { code: "handler_error", message: "kaput" } });
  });

  it("also handles async rejections and invalid statuses", async () => {
    const rejecting = registryWith(async () => {
      throw new Error("async kaput");
    });
    expect((await handleRestRequest(rejecting, input())).status).toBe(500);
    const invalid = registryWith(() => ({ status: 42 }));
    expect((await handleRestRequest(invalid, input())).status).toBe(500);
  });

  it("serializes objects, arrays, strings, empty bodies and custom headers", async () => {
    const cases: Array<[HubResponse, number, string | undefined, string]> = [
      [{ status: 200, body: { a: 1 } }, 200, "application/json; charset=utf-8", '{"a":1}'],
      [{ status: 200, body: [1, 2] }, 200, "application/json; charset=utf-8", "[1,2]"],
      [{ status: 200, body: "plain" }, 200, "text/plain; charset=utf-8", "plain"],
      [{ status: 200, body: "# md", headers: { "content-type": "text/markdown" } }, 200, "text/markdown", "# md"],
      [{ status: 204 }, 204, undefined, ""],
    ];
    for (const [response, status, contentType, payload] of cases) {
      const out = await handleRestRequest(registryWith(() => response), input());
      expect(out.status).toBe(status);
      const type = Object.entries(out.headers).find(([k]) => k.toLowerCase() === "content-type")?.[1];
      expect(type).toBe(contentType);
      expect(String(out.payload)).toBe(payload);
      expect(out.headers["Cache-Control"]).toBe("no-store");
    }
  });

  it("forces no-store even when the handler sets Cache-Control", async () => {
    const registry = registryWith(() => ({ status: 200, body: {}, headers: { "cache-control": "max-age=60", "X-Custom": "1" } }));
    const out = await handleRestRequest(registry, input());
    expect(out.headers["Cache-Control"]).toBe("no-store");
    expect(out.headers["cache-control"]).toBeUndefined();
    expect(out.headers["X-Custom"]).toBe("1");
  });

  it("routes legacy aliases by their absolute path", async () => {
    const registry = new FakeRegistry().add({
      id: "env",
      legacyAliases: [{ method: "POST", path: "/v1/request", handler: (req) => ({ status: 200, body: { path: req.path } }) }],
    });
    const out = await handleRestRequest(registry, input({ method: "POST", path: "/v1/request" }));
    expect(out.status).toBe(200);
    expect(out.moduleId).toBe("env");
    expect(JSON.parse(String(out.payload))).toEqual({ path: "/v1/request" });
  });
});
