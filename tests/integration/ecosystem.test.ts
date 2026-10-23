// Wires the real pieces (no Obsidian): registry, service bus, lifecycle, Provider API, logger and
// redactor, Script Engine, client auth, HTTP/MCP server and the built-in module.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Ecosystem } from "../../src/core/ecosystem";
import { createClient } from "../../src/server/auth";
import { normalizeSettings } from "../../src/settings/settings-store";
import { ECOSYSTEM_EVENTS } from "../../src/types";
import type { AIEcosystemSettings, ClientRecord, HubModuleRegistration, SecretVaultService } from "../../src/types";
import { makeVault, nodeDetector, removeVault, writeFile } from "../runner/helpers";

interface Rig {
  eco: Ecosystem;
  settings: AIEcosystemSettings;
  vault: string;
  base: string;
  token: string;
  events: Array<[string, ...unknown[]]>;
  imported: Array<{ source: string; clients: ClientRecord[] }>;
}

let rig: Rig | undefined;

async function start(): Promise<Rig> {
  const vault = makeVault();
  const { record, token } = createClient("Claude Code");
  const settings = normalizeSettings({ scripts: { allowedFolders: ["Scripts"] } });
  settings.port = 0;
  settings.alternativePort = 0;
  settings.clients = [record];
  const events: Rig["events"] = [];
  const imported: Rig["imported"] = [];
  const eco = new Ecosystem({
    vaultBasePath: vault,
    vaultName: "TestVault",
    version: "1.0.0",
    getSettings: () => settings,
    trigger: (name, ...data) => {
      events.push([name, ...data]);
    },
    getDeclaredScripts: () => [],
    importClients: async (clients, source) => {
      imported.push({ source, clients });
      return clients.length;
    },
    detector: nodeDetector(),
  });
  const status = await eco.start();
  if (!status.running) throw new Error(`server did not start: ${status.error ?? "?"}`);
  rig = { eco, settings, vault, base: `http://127.0.0.1:${status.port}`, token, events, imported };
  return rig;
}

afterEach(async () => {
  if (rig) {
    await rig.eco.unload();
    removeVault(rig.vault);
    rig = undefined;
  }
});

function headers(r: Rig, extra: Record<string, string> = {}): Record<string, string> {
  return { Authorization: `Bearer ${r.token}`, ...extra };
}

let rpcId = 0;
async function rpc(r: Rig, method: string, params?: unknown): Promise<any> {
  const res = await fetch(`${r.base}/mcp`, {
    method: "POST",
    headers: headers(r, { "Content-Type": "application/json", Accept: "application/json, text/event-stream" }),
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
  });
  expect(res.status).toBe(200);
  return res.json();
}

async function toolNames(r: Rig): Promise<string[]> {
  const list = await rpc(r, "tools/list");
  return (list.result.tools as Array<{ name: string }>).map((t) => t.name);
}

function testModule(overrides: Partial<HubModuleRegistration> = {}): HubModuleRegistration {
  return {
    id: "test-module",
    name: "Test module",
    version: "0.1.0",
    apiVersion: 1,
    tools: [
      {
        name: "test_echo",
        description: "Echoes the text.",
        inputSchema: { type: "object", properties: { text: { type: "string" } } },
        handler: async (args, ctx) => ({ content: [{ type: "text", text: `echo:${String(args.text)}:${ctx.client.name}` }] }),
      },
    ],
    routes: [{ method: "POST", path: "/items/:id", handler: (req) => ({ status: 200, body: { id: req.params.id, got: req.body, client: req.client.name } }) }],
    legacyAliases: [{ method: "GET", path: "/v1/test-ping", handler: () => ({ status: 200, body: { pong: true } }) }],
    ...overrides,
  };
}

describe("AI Ecosystem wiring", () => {
  beforeEach(() => {
    rig = undefined;
  });

  it("serves a public /health, refuses other requests without a token, and announces ready", async () => {
    const r = await start();
    const health = await fetch(`${r.base}/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ ok: true, app: "ai-ecosystem", version: "1.0.0", modules: ["ai-ecosystem"], vault: "TestVault" });

    expect((await fetch(`${r.base}/api/v1/ai-ecosystem/status`)).status).toBe(401);
    expect((await fetch(`${r.base}/mcp`, { method: "POST", body: "{}" })).status).toBe(401);
    expect((await fetch(`${r.base}/api/v1/ai-ecosystem/status`, { headers: { Authorization: "Bearer aie_wrong" } })).status).toBe(401);
    expect((await fetch(`${r.base}/health`, { headers: { Origin: "http://evil.example" } })).status).toBe(403);

    expect(r.eco.api.isReady()).toBe(true);
    expect(r.events.find(([name]) => name === ECOSYSTEM_EVENTS.ready)?.[1]).toBe(r.eco.api);
    expect(r.events.some(([name]) => name === ECOSYSTEM_EVENTS.serverStatus)).toBe(true);
  });

  it("initializes MCP and lists the built-in tools and instructions", async () => {
    const r = await start();
    const init = await rpc(r, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } });
    expect(init.result.serverInfo).toMatchObject({ name: "ai-ecosystem", version: "1.0.0" });
    expect(init.result.instructions).toContain("ecosystem_status");
    expect(await toolNames(r)).toEqual([
      "ecosystem_status",
      "ecosystem_list_scripts",
      "ecosystem_run_script",
      "ecosystem_setup_status",
      "ecosystem_setup_save",
      "ecosystem_setup_complete",
      "tools_find",
      "tools_describe",
      "tools_run",
    ]);
  });

  it("registers a module through the public API: tools, list_changed, REST, legacy alias, status", async () => {
    const r = await start();

    const controller = new AbortController();
    const stream = await fetch(`${r.base}/mcp`, { headers: headers(r, { Accept: "text/event-stream" }), signal: controller.signal });
    expect(stream.status).toBe(200);
    const reader = stream.body!.getReader();
    const decoder = new TextDecoder();
    let text = "";
    const readUntil = async (needle: string): Promise<void> => {
      while (!text.includes(needle)) {
        const { value, done } = await reader.read();
        if (done) break;
        text += decoder.decode(value);
      }
    };
    await readUntil(": connected");

    const result = r.eco.api.registerModule(testModule());
    expect(result).toEqual({ ok: true, warnings: [] });
    await readUntil("notifications/tools/list_changed");
    expect(text).toContain("notifications/tools/list_changed");
    controller.abort();

    expect(r.events.filter(([name]) => name === ECOSYSTEM_EVENTS.moduleRegistered).map((e) => e[1])).toEqual(["test-module"]);

    expect(await toolNames(r)).toContain("test_echo");
    const call = await rpc(r, "tools/call", { name: "test_echo", arguments: { text: "hi" } });
    expect(call.result.content[0].text).toBe("echo:hi:Claude Code");

    const rest = await fetch(`${r.base}/api/v1/test-module/items/42`, {
      method: "POST",
      headers: headers(r, { "Content-Type": "application/json" }),
      body: JSON.stringify({ a: 1 }),
    });
    expect(rest.status).toBe(200);
    expect(await rest.json()).toEqual({ id: "42", got: { a: 1 }, client: "Claude Code" });

    const legacy = await fetch(`${r.base}/v1/test-ping`, { headers: headers(r) });
    expect(await legacy.json()).toEqual({ pong: true });

    const status = (await (await fetch(`${r.base}/api/v1/ai-ecosystem/status`, { headers: headers(r) })).json()) as {
      modules: Array<{ id: string; toolNames: string[] }>;
      server: { running: boolean };
    };
    expect(status.server.running).toBe(true);
    expect(status.modules.map((m) => m.id)).toEqual(["ai-ecosystem", "test-module"]);
    expect(status.modules.find((m) => m.id === "test-module")?.toolNames).toEqual(["test_echo"]);

    const statusTool = await rpc(r, "tools/call", { name: "ecosystem_status", arguments: {} });
    expect(statusTool.result.content[0].text).toContain("test-module (Test module 0.1.0): 1 tools");

    // The same activity shows up in the inspector.
    const entries = r.eco.logger.entries();
    expect(entries.some((e) => e.kind === "mcp" && e.target === "test_echo" && e.moduleId === "test-module" && e.client === "Claude Code")).toBe(true);
    expect(entries.some((e) => e.kind === "http" && e.target === "/api/v1/test-module/items/42" && e.status === 200)).toBe(true);
    expect(entries.some((e) => e.kind === "http" && e.target === "/v1/test-ping")).toBe(true);
  });

  it("refuses an unsupported apiVersion with a reason", async () => {
    const r = await start();
    const result = r.eco.api.registerModule(testModule({ apiVersion: 99 }));
    expect(result.ok).toBe(false);
    expect(await toolNames(r)).not.toContain("test_echo");
  });

  it("updates dynamic tools and prompts", async () => {
    const r = await start();
    r.eco.api.registerModule(testModule());
    r.eco.api.updateTools("test-module", []);
    expect(await toolNames(r)).not.toContain("test_echo");
    r.eco.api.updatePrompts("test-module", [
      { name: "test_prompt", handler: async () => ({ messages: [{ role: "user", content: { type: "text", text: "hello" } }] }) },
    ]);
    const prompts = await rpc(r, "prompts/list");
    expect(prompts.result.prompts.map((p: { name: string }) => p.name)).toEqual(["test_prompt"]);
  });

  it("never lets a secret reach the inspector once the secrets service is registered", async () => {
    const r = await start();
    r.eco.api.registerModule(
      testModule({
        tools: [
          {
            name: "leaky",
            description: "Returns what it gets.",
            inputSchema: { type: "object" },
            handler: async (args) => ({ content: [{ type: "text", text: `value=${String(args.value)}` }] }),
          },
        ],
        routes: [{ method: "POST", path: "/leaky", handler: (req) => ({ status: 200, body: { echoed: req.body } }) }],
      }),
    );
    expect(r.eco.redactor.isLimited()).toBe(true);

    const secrets: SecretVaultService = {
      isLocked: () => false,
      redact: (text) => text.split("S3CR3T").join("[MASKED]"),
      spawnWithSecrets: async () => undefined,
    };
    r.eco.api.registerService("secrets", "test-module", secrets);
    expect(r.eco.redactor.isLimited()).toBe(false);

    const call = await rpc(r, "tools/call", { name: "leaky", arguments: { value: "S3CR3T" } });
    expect(call.result.content[0].text).toBe("value=S3CR3T");
    await fetch(`${r.base}/api/v1/test-module/leaky`, {
      method: "POST",
      headers: headers(r, { "Content-Type": "application/json", "X-Custom": "S3CR3T" }),
      body: JSON.stringify({ secret: "S3CR3T" }),
    });

    const entries = r.eco.logger.entries().filter((e) => e.target === "leaky" || e.target.endsWith("/leaky"));
    expect(entries).toHaveLength(2);
    for (const entry of entries) {
      const dump = JSON.stringify(entry);
      expect(dump).not.toContain("S3CR3T");
      expect(dump).toContain("[MASKED]");
    }
  });

  it("removes the tools and services of an unregistered module and tells the listeners", async () => {
    const r = await start();
    let unloaded = false;
    r.eco.api.registerModule(testModule({ onUnload: () => (unloaded = true) }));
    r.eco.api.registerService("test-service", "test-module", { ok: true });
    expect(r.eco.api.getService("test-service")).toEqual({ ok: true });
    const serviceEvents: Array<[string, boolean]> = [];
    r.eco.api.onServiceChange((name, available) => serviceEvents.push([name, available]));

    expect(r.eco.api.unregisterModule("test-module")).toBe(true);
    expect(unloaded).toBe(true);
    expect(await toolNames(r)).not.toContain("test_echo");
    expect(r.eco.api.getService("test-service")).toBeUndefined();
    expect(serviceEvents).toEqual([["test-service", false]]);
    expect(r.events.filter(([name]) => name === ECOSYSTEM_EVENTS.moduleUnregistered).map((e) => e[1])).toEqual(["test-module"]);
    expect(r.events.filter(([name]) => name === ECOSYSTEM_EVENTS.serviceChanged).map((e) => e.slice(1))).toContainEqual(["test-service", false]);
    expect((await fetch(`${r.base}/api/v1/test-module/items/1`, { method: "POST", headers: headers(r) })).status).toBe(404);
  });

  it("imports clients only for registered modules", async () => {
    const r = await start();
    const incoming = [createClient("Imported").record];
    await expect(r.eco.api.importClients(incoming, "ghost")).rejects.toThrow(/registered/);
    r.eco.api.registerModule(testModule());
    await expect(r.eco.api.importClients(incoming, "test-module")).resolves.toBe(1);
    expect(r.imported).toEqual([{ source: "test-module", clients: incoming }]);
  });

  describe("Script Engine through ecosystem_run_script", () => {
    it("runs a node script from an allowed folder and logs it", async () => {
      const r = await start();
      writeFile(r.vault, "Scripts/hello.js", 'console.log("hello " + process.argv.slice(2).join(" "));');

      const listed = await rpc(r, "tools/call", { name: "ecosystem_list_scripts", arguments: {} });
      expect(listed.result.structuredContent.scripts).toEqual([{ path: "Scripts/hello.js", language: "node" }]);

      const run = await rpc(r, "tools/call", { name: "ecosystem_run_script", arguments: { path: "Scripts/hello.js", args: ["world"] } });
      expect(run.result.isError).toBeFalsy();
      expect(run.result.structuredContent).toMatchObject({ exitCode: 0 });
      expect(run.result.structuredContent.stdout).toContain("hello world");

      const entry = r.eco.logger.entries().find((e) => e.kind === "script");
      expect(entry).toMatchObject({ target: "Scripts/hello.js", status: 200, client: "Claude Code", alert: false });
      expect(entry?.output).toContain("hello world");
    });

    it("refuses inline code and folders outside the allowed list while the restrictions are on", async () => {
      const r = await start();
      writeFile(r.vault, "Other/x.js", 'console.log("x");');

      const inline = await rpc(r, "tools/call", { name: "ecosystem_run_script", arguments: { language: "node", code: 'console.log("pwned")' } });
      expect(inline.result.isError).toBe(true);
      expect(inline.result.content[0].text).toContain("Script refused");

      const outside = await rpc(r, "tools/call", { name: "ecosystem_run_script", arguments: { path: "Other/x.js" } });
      expect(outside.result.isError).toBe(true);
      expect(outside.result.content[0].text).toContain("Script refused");

      const refusals = r.eco.logger.entries().filter((e) => e.kind === "script");
      expect(refusals).toHaveLength(2);
      expect(refusals.every((e) => e.status === 403)).toBe(true);
    });

    it("accepts inline code with the restrictions off and flags the run with an alert", async () => {
      const r = await start();
      r.settings.scripts.restrictionsDisabled = true;
      const run = await rpc(r, "tools/call", { name: "ecosystem_run_script", arguments: { language: "node", code: "console.log(6 * 7)" } });
      expect(run.result.isError).toBeFalsy();
      expect(run.result.structuredContent.stdout).toContain("42");
      const entry = r.eco.logger.entries().find((e) => e.kind === "script");
      expect(entry?.alert).toBe(true);
    });

    it("runs scripts for registered modules through the Provider API and refuses unknown callers", async () => {
      const r = await start();
      writeFile(r.vault, "Scripts/hello.js", 'console.log("from module");');
      r.eco.api.registerModule(testModule());
      const result = await r.eco.api.runScript({ language: "node", scriptPath: "Scripts/hello.js" }, "test-module");
      expect(result).toMatchObject({ exitCode: 0, killed: false });
      expect(result.stdout).toContain("from module");
      await expect(r.eco.api.runScript({ language: "node", scriptPath: "Scripts/hello.js" }, "ghost")).rejects.toThrow(/registered/);
    });
  });

  it("drops everything on unload and stops the server", async () => {
    const r = await start();
    let unloaded = false;
    r.eco.api.registerModule(testModule({ onUnload: () => (unloaded = true) }));
    await r.eco.unload();
    expect(unloaded).toBe(true);
    expect(r.eco.api.isReady()).toBe(false);
    expect(r.events.some(([name]) => name === ECOSYSTEM_EVENTS.unloading)).toBe(true);
    expect(r.eco.registry.listModules()).toEqual([]);
    await expect(fetch(`${r.base}/health`)).rejects.toThrow();
    // A second unload must not throw.
    await expect(r.eco.unload()).resolves.toBeUndefined();
  });
});
