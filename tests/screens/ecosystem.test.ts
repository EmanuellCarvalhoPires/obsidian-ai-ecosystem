// The screens wired into the real Ecosystem (registry, MCP server, Inspector), with the windows faked.
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Ecosystem } from "../../src/core/ecosystem";
import { createClient } from "../../src/server/auth";
import { normalizeSettings } from "../../src/settings/settings-store";
import { nodeDetector } from "../runner/helpers";
import { FakeHost, fakeSecrets, passwordDefinition, removeDir, sampleDefinition, tempDir } from "./helpers";
import type { FakeSecrets } from "./helpers";

interface Rig {
  eco: Ecosystem;
  host: FakeHost;
  base: string;
  token: string;
  secrets: FakeSecrets;
}

const dirs: string[] = [];
const running: Ecosystem[] = [];

async function start(dir: string, secrets: FakeSecrets = fakeSecrets()): Promise<Rig> {
  const { record, token } = createClient("Claude Code");
  const settings = normalizeSettings({});
  settings.port = 0;
  settings.alternativePort = 0;
  settings.clients = [record];
  const host = new FakeHost();
  const eco = new Ecosystem({
    vaultBasePath: dir,
    vaultName: "TestVault",
    version: "1.0.0",
    getSettings: () => settings,
    trigger: () => undefined,
    getDeclaredScripts: () => [],
    importClients: async () => 0,
    detector: nodeDetector(),
    hooks: { disabled: true },
    screenHost: host,
    screensDir: path.join(dir, "telas"),
  });
  running.push(eco);
  const status = await eco.start();
  if (!status.running) throw new Error(`server did not start: ${status.error ?? "?"}`);
  // Environment Keys offers the secrets service.
  eco.bus.register("secrets", "ai-ecosystem", secrets);
  return { eco, host, base: `http://127.0.0.1:${status.port}`, token, secrets };
}

afterEach(async () => {
  for (const eco of running.splice(0)) await eco.unload();
  for (const dir of dirs.splice(0)) removeDir(dir);
});

function newDir(): string {
  const dir = tempDir();
  dirs.push(dir);
  return dir;
}

let rpcId = 0;
async function rpc(r: Rig, method: string, params?: unknown, signal?: AbortSignal): Promise<any> {
  const res = await fetch(`${r.base}/mcp`, {
    method: "POST",
    headers: { Authorization: `Bearer ${r.token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
    signal,
  });
  return res.json();
}

async function toolNames(r: Rig): Promise<string[]> {
  const list = await rpc(r, "tools/list");
  return (list.result.tools as Array<{ name: string }>).map((t) => t.name);
}

async function callTool(r: Rig, name: string, args: unknown): Promise<any> {
  return rpc(r, "tools/call", { name, arguments: args });
}

async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((resolve) => setTimeout(resolve, 10));
  expect(check()).toBe(true);
}

describe("screens in the AI Ecosystem", () => {
  it("offers the three infrastructure tools from the core module", async () => {
    const r = await start(newDir());
    expect(await toolNames(r)).toEqual([
      "ecosystem_status",
      "ecosystem_diagnostico",
      "ecosystem_list_scripts",
      "ecosystem_run_script",
      "tools_find",
      "tools_describe",
      "tools_run",
      "tela_gerenciar",
      "tela_listar",
      "tela_remover",
    ]);
    expect(r.eco.registry.listTools().every((t) => t.moduleId === "ai-ecosystem")).toBe(true);
  });

  it("tela_gerenciar with acao guia returns the field guide and saves nothing", async () => {
    const r = await start(newDir());
    const guide = await callTool(r, "tela_gerenciar", { acao: "guia" });
    expect(guide.result.isError).toBeUndefined();
    const text = guide.result.content[0].text as string;
    expect(text).toContain("texto_longo");
    expect(text).toContain("destino_nome");
    expect(r.host.screens).toHaveLength(0);
    expect(r.eco.screens?.list()).toEqual([]);
  });

  it("tela_gerenciar answers an unknown acao with an error", async () => {
    const r = await start(newDir());
    const bad = await callTool(r, "tela_gerenciar", { acao: "xyz" });
    expect(bad.result.isError).toBe(true);
    expect(bad.result.content[0].text).toContain("acao must be criar, editar or guia.");
    expect(r.host.screens).toHaveLength(0);
  });

  it("tela_gerenciar with acao criar and no definicao answers the service error", async () => {
    const r = await start(newDir());
    const missing = await callTool(r, "tela_gerenciar", { acao: "criar" });
    expect(missing.result.isError).toBe(true);
    expect(missing.result.content[0].text).toContain("The screen definition is not valid:");
    expect(r.host.screens).toHaveLength(0);
  });

  it("tela_gerenciar with acao editar and an unknown slug answers the service error", async () => {
    const r = await start(newDir());
    const unknown = await callTool(r, "tela_gerenciar", { acao: "editar", slug: "nao_existe", definicao: sampleDefinition({ slug: "nao_existe" }) });
    expect(unknown.result.isError).toBe(true);
    expect(unknown.result.content[0].text).toContain('There is no screen with the slug "nao_existe"');
    expect(r.host.screens).toHaveLength(0);
  });

  it("tela_gerenciar keeps the field guide out of its description", async () => {
    const r = await start(newDir());
    const list = await rpc(r, "tools/list");
    const tool = (list.result.tools as Array<{ name: string; description: string }>).find((t) => t.name === "tela_gerenciar");
    expect(tool).toBeDefined();
    expect(tool!.description.length).toBeLessThan(900);
    expect(tool!.description).not.toContain("texto_longo");
  });

  it("tela_gerenciar edits a saved screen after approval, as criar does", async () => {
    const r = await start(newDir());
    r.host.autoPreview = "aprovado";
    await callTool(r, "tela_gerenciar", { acao: "criar", definicao: sampleDefinition() });
    const edited = await callTool(r, "tela_gerenciar", {
      acao: "editar",
      slug: "cadastro_cliente",
      definicao: sampleDefinition({ titulo: "Cadastro revisado" }),
    });
    expect(edited.result.isError).toBeUndefined();
    expect(edited.result.structuredContent).toMatchObject({ status: "aprovado" });
    expect(r.eco.screens?.list().find((d) => d.slug === "cadastro_cliente")?.titulo).toBe("Cadastro revisado");
  });

  it("creates a screen through MCP after approval and offers its tool at once", async () => {
    const r = await start(newDir());
    r.host.autoPreview = "aprovado";
    const created = await callTool(r, "tela_gerenciar", { acao: "criar", definicao: sampleDefinition() });
    expect(created.result.structuredContent).toEqual({ status: "aprovado", slug: "cadastro_cliente", tool: "tela_cadastro_cliente" });
    expect(await toolNames(r)).toContain("tela_cadastro_cliente");

    const listed = await callTool(r, "tela_listar", {});
    expect(listed.result.structuredContent.telas.map((t: { slug: string }) => t.slug)).toEqual(["cadastro_cliente"]);
  });

  it("does not offer the tool of a screen that was rejected", async () => {
    const r = await start(newDir());
    r.host.autoPreview = "recusado";
    const rejected = await callTool(r, "tela_gerenciar", { acao: "criar", definicao: sampleDefinition() });
    expect(rejected.result.structuredContent.status).toBe("recusado");
    expect(await toolNames(r)).not.toContain("tela_cadastro_cliente");
  });

  it("registers the saved screens again after a restart", async () => {
    const dir = newDir();
    const first = await start(dir);
    first.host.autoPreview = "aprovado";
    await callTool(first, "tela_gerenciar", { acao: "criar", definicao: sampleDefinition({ slug: "a" }) });
    await callTool(first, "tela_gerenciar", { acao: "criar", definicao: sampleDefinition({ slug: "b" }) });
    await first.eco.unload();

    const second = await start(dir);
    const names = await toolNames(second);
    expect(names).toContain("tela_a");
    expect(names).toContain("tela_b");
    expect(second.eco.screens?.list().map((d) => d.slug)).toEqual(["a", "b"]);
  });

  it("runs a saved screen through MCP and logs the call without any password", async () => {
    const r = await start(newDir());
    r.host.autoPreview = "aprovado";
    await callTool(r, "tela_gerenciar", { acao: "criar", definicao: passwordDefinition() });

    const typed = "My-Very-Secret-Token-9731";
    r.host.autoFill = { values: { servico: "github", token: typed } };
    const answer = await callTool(r, "tela_token_api", { contexto: "Need a token", valores_iniciais: { servico: "gh" } });
    expect(answer.result.structuredContent).toEqual({ status: "confirmado", valores: { servico: "github" }, secretos: { token: "preenchido" } });
    expect(JSON.parse(answer.result.content[0].text)).toEqual(answer.result.structuredContent);
    expect(r.secrets.created.map((c) => c.name)).toEqual(["API_TOKEN"]);

    const entry = r.eco.logger.entries().find((e) => e.target === "tela_token_api");
    expect(entry).toBeDefined();
    expect(entry?.status).toBe(200);
    expect(entry?.payload).toContain("Need a token");
    expect(entry?.response).toContain("preenchido");
    expect(JSON.stringify(r.eco.logger.entries())).not.toContain(typed);
    expect(JSON.stringify(answer)).not.toContain(typed);
  });

  it("answers an error for valores_iniciais of a password field", async () => {
    const r = await start(newDir());
    r.host.autoPreview = "aprovado";
    await callTool(r, "tela_gerenciar", { acao: "criar", definicao: passwordDefinition() });
    const answer = await callTool(r, "tela_token_api", { valores_iniciais: { token: "abc" } });
    expect(answer.result.isError).toBe(true);
    expect(answer.result.content[0].text).toContain("cannot be pre-filled");
    expect(r.host.screens).toHaveLength(0);
  });

  it("closes the window when the client gives up on the call", async () => {
    const r = await start(newDir());
    r.host.autoPreview = "aprovado";
    await callTool(r, "tela_gerenciar", { acao: "criar", definicao: sampleDefinition() });

    const controller = new AbortController();
    const pending = rpc(r, "tools/call", { name: "tela_cadastro_cliente", arguments: {} }, controller.signal).catch(() => undefined);
    await until(() => r.host.screens.length === 1);
    expect(r.host.screens[0]?.closed).toBe(false);

    controller.abort();
    await pending;
    await until(() => r.host.screens[0]?.closed === true);
  });

  it("closes the windows when the plugin unloads", async () => {
    const r = await start(newDir());
    r.host.autoPreview = "aprovado";
    await callTool(r, "tela_gerenciar", { acao: "criar", definicao: sampleDefinition() });
    void rpc(r, "tools/call", { name: "tela_cadastro_cliente", arguments: {} }).catch(() => undefined);
    await until(() => r.host.screens.length === 1);
    await r.eco.unload();
    expect(r.host.screens[0]?.closed).toBe(true);
  });
});

describe("without a screen host", () => {
  it("does not offer screen tools", async () => {
    const settings = normalizeSettings({});
    const eco = new Ecosystem({
      vaultBasePath: newDir(),
      vaultName: "V",
      version: "1.0.0",
      getSettings: () => settings,
      trigger: () => undefined,
      getDeclaredScripts: () => [],
      importClients: async () => 0,
      hooks: { disabled: true },
    });
    running.push(eco);
    expect(eco.screens).toBeUndefined();
    expect(eco.registry.listTools().map((t) => t.tool.name)).toEqual([
      "ecosystem_status",
      "ecosystem_diagnostico",
      "ecosystem_list_scripts",
      "ecosystem_run_script",
      "tools_find",
      "tools_describe",
      "tools_run",
    ]);
  });
});
