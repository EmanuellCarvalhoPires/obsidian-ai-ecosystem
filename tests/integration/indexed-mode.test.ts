// Indexed exposure end to end: tools/list per client kind, the core's tools.db, tools_find,
// tools_describe and tools_run through MCP, and tools/call by name still accepted.
import * as fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { Ecosystem } from "../../src/core/ecosystem";
import { NodeChecker } from "../../src/hooks/node-check";
import { createClient } from "../../src/server/auth";
import { normalizeSettings } from "../../src/settings/settings-store";
import { toolIndexPath } from "../../src/tool-index/tool-index-writer";
import { toolRunnerServiceName } from "../../src/types";
import type { AIEcosystemSettings, HubModuleRegistration, HubTool, IndexedToolRunner } from "../../src/types";
import { makeVault, nodeDetector, removeVault } from "../runner/helpers";

interface Rig {
  eco: Ecosystem;
  settings: AIEcosystemSettings;
  vault: string;
  base: string;
  tokens: Record<string, string>;
}

let rig: Rig | undefined;

async function start(options: { hooks?: boolean } = {}): Promise<Rig> {
  const vault = makeVault();
  const claude = createClient("Claude Code");
  const other = createClient("Script");
  const settings = normalizeSettings({ toolExposure: { modes: { "claude-code": "indexado" } } });
  settings.port = 0;
  settings.alternativePort = 0;
  settings.clients = [claude.record, other.record];
  const eco = new Ecosystem({
    vaultBasePath: vault,
    vaultName: "TestVault",
    version: "1.0.0",
    configDir: ".obsidian",
    getSettings: () => settings,
    trigger: () => undefined,
    getDeclaredScripts: () => [],
    importClients: async () => 0,
    detector: nodeDetector(),
    hooks: options.hooks
      ? { nodeChecker: new NodeChecker(async () => ({ available: true, version: "v22.0.0" })), heartbeatIntervalMs: 50 }
      : { disabled: true },
  });
  const status = await eco.start();
  if (!status.running) throw new Error(`server did not start: ${status.error ?? "?"}`);
  rig = { eco, settings, vault, base: `http://127.0.0.1:${status.port}`, tokens: { claude: claude.token, other: other.token } };
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
async function rpc(r: Rig, method: string, params?: unknown, who: "claude" | "other" = "claude"): Promise<any> {
  const res = await fetch(`${r.base}/mcp`, {
    method: "POST",
    headers: { Authorization: `Bearer ${r.tokens[who]}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
  });
  expect(res.status).toBe(200);
  return res.json();
}

async function listed(r: Rig, who: "claude" | "other" = "claude"): Promise<string[]> {
  return ((await rpc(r, "tools/list", undefined, who)).result.tools as Array<{ name: string }>).map((t) => t.name);
}

async function call(r: Rig, name: string, args: Record<string, unknown>): Promise<any> {
  return (await rpc(r, "tools/call", { name, arguments: args })).result;
}

function tool(name: string, extra: Partial<HubTool> = {}): HubTool {
  return {
    name,
    description: `${name} description`,
    inputSchema: { type: "object", properties: {} },
    handler: async (args) => ({ content: [{ type: "text", text: `${name}:${JSON.stringify(args)}` }] }),
    ...extra,
  };
}

function modules(r: Rig): void {
  const search: HubModuleRegistration = {
    id: "ai-vault-search",
    name: "AI Vault Search",
    version: "1.0.0",
    apiVersion: 1,
    tools: [tool("search_notes", { exposicao: "fixa" }), tool("get_section"), tool("list_files", { resumo: "Lista arquivos de uma pasta do cofre" })],
  };
  const git: HubModuleRegistration = {
    id: "ai-git-tools",
    name: "AI Git Tools",
    version: "1.0.0",
    apiVersion: 1,
    tools: [
      tool("git_status", { annotations: { readOnlyHint: true }, categoria: "git/leitura" }),
      tool("git_commit", { categoria: "git/escrita", inputSchema: { type: "object", properties: { mensagem: { type: "string" } }, required: ["mensagem"] } }),
    ],
  };
  const env: HubModuleRegistration = { id: "environment-variables", name: "Environment Keys", version: "2.0.0", apiVersion: 1, tools: [tool("http_request")] };
  for (const m of [search, git, env]) expect(r.eco.api.registerModule(m).ok).toBe(true);
}

describe("indexed exposure", () => {
  it("lists only the fixed and discovery tools to an indexed client and every tool to the others", async () => {
    const r = await start();
    modules(r);
    expect((await listed(r)).sort()).toEqual(["get_section", "search_notes", "tools_describe", "tools_find", "tools_run"]);
    const full = await listed(r, "other");
    expect(full).toContain("git_commit");
    expect(full).toContain("ecosystem_status");
    expect(full).toContain("tools_find");

    const init = await rpc(r, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "claude-code", version: "1" } });
    expect(init.result.instructions).toContain("tools_find");
    const plain = await rpc(r, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "script", version: "1" } }, "other");
    expect(plain.result.instructions).not.toContain("tools_run {");
  });

  it("keeps tools/call by name working in indexed mode", async () => {
    const r = await start();
    modules(r);
    expect((await call(r, "git_commit", { mensagem: "x" })).content[0].text).toBe('git_commit:{"mensagem":"x"}');
  });

  it("finds any tool, describes it and runs it through the owner module", async () => {
    const r = await start();
    modules(r);
    const found = (await call(r, "tools_find", { q: "commit" })).content[0].text as string;
    expect(found.split("\n")[0]).toBe("git_commit(mensagem*) | git_commit description | externo");
    expect((await call(r, "tools_find", { categoria: "git" })).content[0].text.split("\n")).toHaveLength(2);
    // The core's own tools are indexed with their metadata.
    expect((await call(r, "tools_find", { q: "scripts", modulo: "ai-ecosystem" })).content[0].text).toContain("ecosystem_run_script(");
    expect((await call(r, "tools_find", { q: "list_files" })).content[0].text).toContain("Lista arquivos de uma pasta do cofre | externo");

    const described = JSON.parse((await call(r, "tools_describe", { id: "git_status" })).content[0].text);
    expect(described).toMatchObject({ id: "git_status", modulo: "ai-git-tools", efeito: "leitura", categoria: "git/leitura" });

    const ran = await call(r, "tools_run", { id: "git_commit", args: { mensagem: "y" } });
    expect(ran).toEqual({ content: [{ type: "text", text: 'git_commit:{"mensagem":"y"}' }] });
  });

  it("finds tools a module wrote only to its tools.db and runs them through its runner service", async () => {
    const r = await start();
    modules(r);
    await r.eco.api.toolIndex!.sync("environment-variables", [
      { name: "jira_get_changelogs", kind: "api", description: "Changelog of an issue", resumo: "Histórico de alterações de tickets", categoria: "Jira Cloud", efeito: "leitura" },
    ]);
    const runner: IndexedToolRunner = { run: async (id, args) => ({ content: [{ type: "text", text: `${id}:${JSON.stringify(args)}` }] }) };
    r.eco.api.registerService(toolRunnerServiceName("environment-variables"), "environment-variables", runner);
    expect((await call(r, "tools_find", { q: "jira changelog" })).content[0].text).toBe("jira_get_changelogs() | Histórico de alterações de tickets | leitura");
    expect((await call(r, "tools_find", { kind: "api" })).content[0].text).toContain("jira_get_changelogs");
    expect((await call(r, "tools_run", { id: "jira_get_changelogs", args: { issue: "A-1" } })).content[0].text).toBe('jira_get_changelogs:{"issue":"A-1"}');
    // A module that leaves the registry leaves the search.
    r.eco.api.unregisterModule("environment-variables");
    expect((await call(r, "tools_find", { q: "jira changelog" })).content[0].text).toContain("No tool found");
  });

  it("writes the core's tools.db with the metadata of its tools", async () => {
    const r = await start({ hooks: true });
    const file = toolIndexPath(r.vault, ".obsidian", "ai-ecosystem");
    expect(fs.existsSync(file)).toBe(true);
    const db = new DatabaseSync(file);
    try {
      const rows = db.prepare("SELECT name, categoria, efeito, aprovacao FROM tools ORDER BY name").all() as Array<Record<string, string | null>>;
      expect(rows.map((row) => row.name)).toEqual([
        "ecosystem_list_scripts",
        "ecosystem_run_script",
        "ecosystem_setup_complete",
        "ecosystem_setup_save",
        "ecosystem_setup_status",
        "ecosystem_status",
      ]);
      expect(rows.find((row) => row.name === "ecosystem_run_script")).toEqual({
        name: "ecosystem_run_script",
        categoria: "scripts",
        efeito: "externo",
        aprovacao: "Posso executar o script {path}?",
      });
      expect(rows.every((row) => row.categoria !== "")).toBe(true);
    } finally {
      db.close();
    }
  });

  it("keeps the setup tools listed while a module waits for its setup", async () => {
    const r = await start({ hooks: true });
    // The core waits for its own first setup in a new vault.
    expect(r.eco.hooks?.states.estado("ai-ecosystem")).toBe("pendente_configuracao");
    expect((await listed(r)).sort()).toEqual(["ecosystem_setup_complete", "ecosystem_setup_save", "ecosystem_setup_status", "tools_describe", "tools_find", "tools_run"]);
    r.eco.hooks!.states.setEstado("ai-ecosystem", "configurado");
    expect((await listed(r)).sort()).toEqual(["tools_describe", "tools_find", "tools_run"]);
  });

  it("follows the fixed tools of the settings", async () => {
    const r = await start();
    modules(r);
    r.settings.toolExposure.fixedTools = ["git_status"];
    expect((await listed(r)).sort()).toEqual(["git_status", "search_notes", "tools_describe", "tools_find", "tools_run"]);
    r.settings.toolExposure.modes["claude-code"] = "completo";
    expect(await listed(r)).toContain("git_commit");
  });
});
