// The hooks wired into the real Ecosystem (no Obsidian): state folder, service, failure markers,
// tool visibility and the heartbeat on unload.
import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Ecosystem } from "../../src/core/ecosystem";
import { NodeChecker } from "../../src/hooks/node-check";
import { createClient } from "../../src/server/auth";
import { normalizeSettings } from "../../src/settings/settings-store";
import { HOOKS_SERVICE } from "../../src/types";
import type { HooksService, HubModuleRegistration } from "../../src/types";
import { makeVault, nodeDetector, removeVault } from "../runner/helpers";

interface Rig {
  eco: Ecosystem;
  vault: string;
  base: string;
  token: string;
}

let rig: Rig | undefined;

async function start(vaultBasePath?: string): Promise<Rig> {
  const vault = vaultBasePath ?? makeVault();
  const { record, token } = createClient("Test Client");
  const settings = normalizeSettings({});
  settings.port = 0;
  settings.alternativePort = 0;
  settings.clients = [record];
  const eco = new Ecosystem({
    vaultBasePath: vault,
    vaultName: "TestVault",
    version: "1.0.0",
    getSettings: () => settings,
    trigger: () => undefined,
    getDeclaredScripts: () => [],
    importClients: async () => 0,
    detector: nodeDetector(),
    configDir: ".obsidian",
    hooks: { nodeChecker: new NodeChecker(async () => ({ available: true, version: "v22.0.0" })), heartbeatIntervalMs: 50 },
  });
  const status = await eco.start();
  if (!status.running) throw new Error("server did not start");
  await eco.hooks?.whenReady();
  rig = { eco, vault, base: `http://127.0.0.1:${status.port}`, token };
  return rig;
}

afterEach(async () => {
  if (rig) {
    await rig.eco.unload();
    removeVault(rig.vault);
    rig = undefined;
  }
});

let rpcId = 0;
async function rpc(r: Rig, method: string, params?: unknown, headers: Record<string, string> = {}): Promise<{ json: any; headers: Headers }> {
  const res = await fetch(`${r.base}/mcp`, {
    method: "POST",
    headers: { Authorization: `Bearer ${r.token}`, "Content-Type": "application/json", Accept: "application/json", ...headers },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
  });
  return { json: await res.json(), headers: res.headers };
}

async function claudeSession(r: Rig): Promise<Record<string, string>> {
  const init = await rpc(r, "initialize", { protocolVersion: "2025-06-18", clientInfo: { name: "claude-code", version: "2" } });
  return { "Mcp-Session-Id": init.headers.get("mcp-session-id") ?? "" };
}

function stateFile(r: Rig, rel: string): any {
  try {
    return JSON.parse(fs.readFileSync(path.join(r.vault, ".claude", "ai-ecosystem", ...rel.split("/")), "utf8"));
  } catch {
    return undefined;
  }
}

function module(id: string, extra: Partial<HubModuleRegistration> = {}): HubModuleRegistration {
  const prefix = id.replace(/-/g, "_");
  return {
    id,
    name: id,
    version: "1.0.0",
    apiVersion: 1,
    tools: [
      { name: `${prefix}_ok`, description: "ok", inputSchema: { type: "object" }, handler: async () => ({ content: [{ type: "text", text: "ok" }] }) },
      { name: `${prefix}_fail`, description: "fails", inputSchema: { type: "object" }, handler: async () => ({ content: [{ type: "text", text: "no" }], isError: true }) },
    ],
    ...extra,
  };
}

describe("hooks in the Ecosystem", () => {
  it("sets up the state folder, the core state and the hooks service on start", async () => {
    const r = await start();
    expect(r.eco.hooks).toBeDefined();
    expect(stateFile(r, "config.json")).toMatchObject({ schemaVersion: 1, configDir: ".obsidian" });
    expect(stateFile(r, "modules/ai-ecosystem.json")).toMatchObject({ estado: "pendente_configuracao", origem: "nucleo" });
    expect(stateFile(r, "tools.json")).toMatchObject({ ecosystem_status: "ai-ecosystem" });
    expect(fs.existsSync(path.join(r.vault, ".claude", "ai-ecosystem", "heartbeat"))).toBe(true);

    const service = r.eco.api.getService<HooksService>(HOOKS_SERVICE);
    expect(service).toBeDefined();
    expect(r.eco.bus.list().find((s) => s.name === HOOKS_SERVICE)?.ownerModuleId).toBe("ai-ecosystem");
  });

  it("turns a module's rule data into the files the hook reads, and tracks its tools", async () => {
    const r = await start();
    r.eco.api.registerModule(module("ai-scripts"));
    expect(stateFile(r, "tools.json")).toMatchObject({ ai_scripts_ok: "ai-scripts", ai_scripts_fail: "ai-scripts" });
    expect(stateFile(r, "modules/ai-scripts.json")).toMatchObject({ estado: "configurado", origem: "legado" });

    const service = r.eco.api.getService<HooksService>(HOOKS_SERVICE)!;
    service.setRuleData("ai-scripts", { scriptFolders: ["scripts"] });
    expect(service.getModuleState("ai-scripts")).toBe("configurado");
    (r.eco.hooks!.service as unknown as { flush(): void }).flush();
    expect(stateFile(r, "pastas.json").scripts).toEqual(["scripts"]);

    r.eco.api.unregisterModule("ai-scripts");
    expect(stateFile(r, "tools.json").ai_scripts_ok).toBeUndefined();
  });

  it("marks the module on a failed tool call and clears the mark on its next success", async () => {
    const r = await start();
    r.eco.api.registerModule(module("probe"));

    await rpc(r, "tools/call", { name: "probe_ok", arguments: {} });
    expect(stateFile(r, "falhas.json")).toBeUndefined();

    await rpc(r, "tools/call", { name: "probe_fail", arguments: {} });
    const marks = stateFile(r, "falhas.json");
    expect(Object.keys(marks)).toEqual(["probe"]);
    expect(Math.abs(Date.now() - marks.probe)).toBeLessThan(5000);

    await rpc(r, "tools/call", { name: "ecosystem_status", arguments: {} });
    expect(Object.keys(stateFile(r, "falhas.json"))).toEqual(["probe"]);

    await rpc(r, "tools/call", { name: "probe_ok", arguments: {} });
    expect(stateFile(r, "falhas.json")).toEqual({});
  });

  it("hides the tools of a pending module from Claude Code and keeps the core's tools", async () => {
    const first = await start();
    const vault = first.vault;
    first.eco.api.registerModule(module("ai-templates"));
    fs.writeFileSync(
      path.join(vault, ".claude", "ai-ecosystem", "modules", "ai-templates.json"),
      JSON.stringify({ estado: "pendente_configuracao", origem: "catalogo", atualizadoEm: new Date().toISOString(), respostas: {} }),
    );
    await first.eco.unload();

    // A new run reads the pending state from disk, like Obsidian restarting.
    rig = undefined;
    const r = await start(vault);
    r.eco.api.registerModule(module("ai-templates"));

    const claude = await claudeSession(r);
    const listed = await rpc(r, "tools/list", undefined, claude);
    const names = (listed.json.result.tools as Array<{ name: string }>).map((t) => t.name);
    expect(names).toContain("ecosystem_status");
    expect(names).not.toContain("ai_templates_ok");

    const refused = await rpc(r, "tools/call", { name: "ai_templates_ok", arguments: {} }, claude);
    expect(refused.json.result.isError).toBe(true);
    expect(refused.json.result.content[0].text).toContain("configurar-ai-templates");
    expect(stateFile(r, "falhas.json")).toBeUndefined();

    const inspector = await rpc(r, "tools/list");
    expect((inspector.json.result.tools as Array<{ name: string }>).map((t) => t.name)).toContain("ai_templates_ok");
  });

  it("stops the heartbeat on unload but leaves the hook entries in place", async () => {
    const r = await start();
    const settingsPath = path.join(r.vault, ".claude", "settings.local.json");
    expect(JSON.parse(fs.readFileSync(settingsPath, "utf8")).hooks.PostToolUseFailure).toHaveLength(1);

    await r.eco.unload();
    expect(fs.existsSync(path.join(r.vault, ".claude", "ai-ecosystem", "heartbeat"))).toBe(false);
    expect(JSON.parse(fs.readFileSync(settingsPath, "utf8")).hooks.PostToolUseFailure).toHaveLength(1);
    // Nothing recreates the heartbeat afterwards.
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(fs.existsSync(path.join(r.vault, ".claude", "ai-ecosystem", "heartbeat"))).toBe(false);
  });

  it("has no hooks without an absolute vault folder", async () => {
    const { record, token } = createClient("T");
    const settings = normalizeSettings({});
    settings.port = 0;
    settings.alternativePort = 0;
    settings.clients = [record];
    const eco = new Ecosystem({
      vaultBasePath: ".",
      vaultName: "Relative",
      version: "1.0.0",
      getSettings: () => settings,
      trigger: () => undefined,
      getDeclaredScripts: () => [],
      importClients: async () => 0,
      detector: nodeDetector(),
    });
    expect(token).toBeTruthy();
    expect(eco.hooks).toBeUndefined();
    expect(eco.bus.get(HOOKS_SERVICE)).toBeUndefined();
    await eco.unload();
  });
});
