import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDiscoveryTools, findLine, slimSchema, toolSignature } from "../../src/tool-index/discovery-tools";
import type { DiscoveryToolsDeps } from "../../src/tool-index/discovery-tools";
import { MAX_ATTACHED_PER_CONNECTION, ToolFederation, ftsExpression } from "../../src/tool-index/federation";
import { TOOL_INDEX_SCHEMA_VERSION } from "../../src/tool-index/schema";
import { ToolIndexWriter, toolIndexPath } from "../../src/tool-index/tool-index-writer";
import { toolRunnerServiceName } from "../../src/types";
import type { HubCallContext, HubTool, HubToolResult, IndexedToolRunner, RegisteredTool, ToolIndexEntry } from "../../src/types";

let dir: string;
let modules: string[];
let tools: RegisteredTool[];
let federations: ToolFederation[];

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "federation-"));
  modules = [];
  tools = [];
  federations = [];
});
afterEach(() => {
  for (const f of federations) f.close();
  rmSync(dir, { recursive: true, force: true });
});

const file = (moduleId: string) => toolIndexPath(dir, ".obsidian", moduleId);

function index(moduleId: string, entries: ToolIndexEntry[]): void {
  if (!modules.includes(moduleId)) modules.push(moduleId);
  new ToolIndexWriter(file(moduleId)).sync(moduleId, entries);
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

function register(moduleId: string, ...list: HubTool[]): void {
  if (!modules.includes(moduleId)) modules.push(moduleId);
  for (const t of list) tools.push({ moduleId, tool: t });
}

function federation(): ToolFederation {
  const f = new ToolFederation({ listModuleIds: () => modules, listTools: () => tools, indexPath: file, idleCloseMs: 50 });
  federations.push(f);
  return f;
}

const GIT: ToolIndexEntry[] = [
  {
    name: "git_commit",
    description: "Records the staged changes",
    resumo: "Grava as alterações locais num commit",
    categoria: "git/escrita",
    tags: ["git", "commit"],
    efeito: "externo",
    inputSchema: { type: "object", properties: { mensagem: { type: "string" }, arquivos: { type: "array", default: [] } }, required: ["mensagem"] },
  },
  { name: "git_status", description: "Working tree status", resumo: "Estado da árvore de trabalho", categoria: "git/leitura", tags: ["git"], efeito: "leitura" },
];

describe("ToolFederation", () => {
  it("attaches the tools.db of every registered module and searches them with BM25", () => {
    index("ai-git-tools", GIT);
    index("environment-variables", [
      { name: "jira_get_changelogs", kind: "api", description: "Issue changelog", resumo: "Histórico de alterações de tickets", categoria: "Jira Cloud", tags: ["jira"], efeito: "leitura" },
      { name: "jira_create_issue", kind: "api", description: "Create an issue", resumo: "Cria um ticket", categoria: "Jira Cloud", tags: ["jira"], efeito: "externo" },
    ]);
    const f = federation();

    expect(f.find({ q: "jira changelog" }).tools.map((t) => t.name)).toEqual(["jira_get_changelogs"]);
    expect(f.find({ q: "alteracoes" }).tools.map((t) => t.name).sort()).toEqual(["git_commit", "jira_get_changelogs"]);
    // No word matches all: any word is enough.
    expect(f.find({ q: "commit ticket" }).tools.map((t) => t.name).sort()).toEqual(["git_commit", "jira_create_issue", "jira_get_changelogs"]);
    expect(f.find({ q: "nada-parecido" }).tools).toEqual([]);
  });

  it("filters by tag, category (with parents), module, kind and effect", () => {
    index("ai-git-tools", GIT);
    index("environment-variables", [{ name: "jira_x", kind: "api", description: "x", categoria: "Jira Cloud", efeito: "leitura" }]);
    const f = federation();
    const names = (q: Parameters<ToolFederation["find"]>[0]) => f.find(q).tools.map((t) => t.name).sort();
    expect(names({ tag: "COMMIT" })).toEqual(["git_commit"]);
    expect(names({ categoria: "git" })).toEqual(["git_commit", "git_status"]);
    expect(names({ categoria: "git/leitura" })).toEqual(["git_status"]);
    expect(names({ categoria: "gi" })).toEqual([]);
    expect(names({ modulo: "environment-variables" })).toEqual(["jira_x"]);
    expect(names({ kind: "api" })).toEqual(["jira_x"]);
    expect(names({ efeito: "leitura" })).toEqual(["git_status", "jira_x"]);
    expect(names({ q: "git", efeito: "externo" })).toEqual(["git_commit"]);
  });

  it("finds registered tools of modules without a tools.db, and a module's own index wins", () => {
    register("ai-vault-search", tool("search_notes", { resumo: "Busca notas no cofre", tags: ["busca"] }), tool("list_files"));
    index("ai-git-tools", GIT);
    register("ai-git-tools", tool("git_commit", { description: "live description" }));
    const f = federation();
    const found = f.find({ q: "busca notas" }).tools;
    expect(found.map((t) => [t.name, t.source, t.moduleId])).toEqual([["search_notes", "registry", "ai-vault-search"]]);
    const commit = f.get(["git_commit"]).get("git_commit");
    expect(commit).toMatchObject({ source: "index", resumo: "Grava as alterações locais num commit", efeito: "externo" });
  });

  it("puts an exact tool name first, limits the results and says when there are more", () => {
    index("mod", Array.from({ length: 15 }, (_, i) => ({ name: `tool_${i}`, description: `generic tool ${i}` })));
    index("other", [{ name: "special", description: "generic special tool" }]);
    const f = federation();
    const result = f.find({ q: "special" });
    expect(result.tools[0]?.name).toBe("special");
    const page = f.find({ q: "generic", limit: 5 });
    expect(page.tools).toHaveLength(5);
    expect(page.more).toBe(true);
    expect(f.find({}).tools).toHaveLength(10);
    expect(f.find({ limit: 100 }).tools).toHaveLength(16);
  });

  it("drops a module that leaves the registry and picks up a new index file", () => {
    index("ai-git-tools", GIT);
    const f = federation();
    expect(f.find({ q: "status" }).tools).toHaveLength(1);
    modules = [];
    f.handleRegistryChange({ type: "module-unregistered", moduleId: "ai-git-tools" });
    expect(f.find({ q: "status" }).tools).toHaveLength(0);
    index("ai-templates", [{ name: "create_note_from_template", kind: "tool", description: "Creates a note from a template", efeito: "cofre" }]);
    f.invalidate();
    expect(f.find({ q: "template" }).tools.map((t) => t.name)).toEqual(["create_note_from_template"]);
  });

  it("spreads more modules than one connection can attach", () => {
    const count = MAX_ATTACHED_PER_CONNECTION * 2 + 3;
    for (let i = 0; i < count; i++) index(`mod-${i}`, [{ name: `tool_of_${i}`, description: `shared word ${i}` }]);
    const f = federation();
    expect(f.find({ q: "shared", limit: 50 }).tools).toHaveLength(count);
    expect(f.get([`tool_of_${count - 1}`, "tool_of_0"]).size).toBe(2);
  });

  it("never lists the discovery tools themselves", () => {
    register("ai-ecosystem", tool("tools_find"), tool("tools_run"), tool("ecosystem_status"));
    const f = federation();
    expect(f.find({ limit: 50 }).tools.map((t) => t.name)).toEqual(["ecosystem_status"]);
  });

  it("migrates a version 1 file in place (kind and exemplo_json)", () => {
    const target = file("old");
    new ToolIndexWriter(target).sync("old", [{ name: "x", description: "old tool" }]);
    const db = new DatabaseSync(target);
    db.exec("ALTER TABLE tools DROP COLUMN kind; ALTER TABLE tools DROP COLUMN exemplo_json; UPDATE meta SET value = '1' WHERE key = 'schema_version';");
    db.close();
    modules.push("old");
    const f = federation();
    expect(f.find({ q: "old" }).tools[0]).toMatchObject({ name: "x", kind: "tool" });
    f.close();
    const check = new DatabaseSync(target);
    expect(check.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get()).toEqual({ value: String(TOOL_INDEX_SCHEMA_VERSION) });
    check.close();
  });

  it("builds a safe FTS expression", () => {
    expect(ftsExpression('jira "OR changelog*', "AND")).toBe('"jira"* AND "OR"* AND "changelog"*');
    expect(ftsExpression("!!!", "AND")).toBeUndefined();
  });
});

describe("discovery tools", () => {
  const ctx: HubCallContext = { client: { id: "c", name: "Claude Code" }, moduleId: "ai-ecosystem", clientKind: "claude-code" };
  let results: Array<[string, boolean]>;
  let services: Map<string, unknown>;
  let hiddenModules: Set<string>;

  beforeEach(() => {
    results = [];
    services = new Map();
    hiddenModules = new Set();
  });

  function discovery(): Record<string, HubTool> {
    const deps: DiscoveryToolsDeps = {
      federation: federation(),
      findTool: (name) => tools.find((t) => t.tool.name === name),
      getService: <T>(name: string) => services.get(name) as T | undefined,
      isHidden: (moduleId) => hiddenModules.has(moduleId),
      onToolResult: (moduleId, failed) => results.push([moduleId, failed]),
    };
    return Object.fromEntries(createDiscoveryTools(deps).map((t) => [t.name, t]));
  }

  const textOf = (r: HubToolResult) => (r.content[0] as { text: string }).text;

  it("formats the signature and the find lines", () => {
    expect(toolSignature("git_commit", GIT[0]!.inputSchema)).toBe("git_commit(mensagem*, arquivos=[])");
    expect(toolSignature("x", undefined)).toBe("x()");
    expect(findLine({ name: "a", inputSchema: { type: "object", properties: { b: {} } }, resumo: "um | dois\ntres", efeito: "leitura" })).toBe("a(b?) | um / dois tres | leitura");
  });

  it("tools_find answers compact lines", async () => {
    index("ai-git-tools", GIT);
    const { tools_find } = discovery();
    const out = textOf(await tools_find!.handler({ q: "commit" }, ctx));
    expect(out).toBe("git_commit(mensagem*, arquivos=[]) | Grava as alterações locais num commit | externo");
    expect(textOf(await tools_find!.handler({ q: "zzz" }, ctx))).toContain("No tool found");
    expect((await tools_find!.handler({ limit: "x" }, ctx)).isError).toBe(true);
    hiddenModules.add("ai-git-tools");
    register("ai-git-tools", tool("git_commit"));
    expect(textOf(await tools_find!.handler({ q: "commit" }, ctx))).toContain("No tool found");
  });

  it("tools_describe gives one schema or several, trimmed unless full", async () => {
    const long = "d".repeat(200);
    index("ai-git-tools", [
      { ...GIT[0]!, exemplo: { mensagem: "feat: x" }, inputSchema: { type: "object", title: "T", properties: { mensagem: { type: "string", description: long }, title: { type: "string" } }, required: ["mensagem"], additionalProperties: false } },
      GIT[1]!,
    ]);
    const { tools_describe } = discovery();
    const one = JSON.parse(textOf(await tools_describe!.handler({ id: "git_commit" }, ctx)));
    expect(one).toMatchObject({ id: "git_commit", modulo: "ai-git-tools", kind: "tool", efeito: "externo", assinatura: "git_commit(mensagem*, title?)", exemplo: { mensagem: "feat: x" } });
    expect(one.schema).toEqual({ type: "object", properties: { mensagem: { type: "string", description: `${"d".repeat(79)}…` }, title: { type: "string" } }, required: ["mensagem"] });
    const full = JSON.parse(textOf(await tools_describe!.handler({ id: "git_commit", full: true }, ctx)));
    expect(full.schema.properties.mensagem.description).toBe(long);
    expect(full.schema.additionalProperties).toBe(false);
    const many = JSON.parse(textOf(await tools_describe!.handler({ ids: ["git_status", "nope"] }, ctx)));
    expect(many.map((d: { id: string }) => d.id)).toEqual(["git_status", "nope"]);
    expect(many[1].erro).toContain("not found");
    expect((await tools_describe!.handler({}, ctx)).isError).toBe(true);
  });

  it("slims a schema without touching property names", () => {
    expect(slimSchema({ $schema: "x", properties: { title: { title: "x", type: "string" } }, additionalProperties: { type: "string" } })).toEqual({
      properties: { title: { type: "string" } },
      additionalProperties: { type: "string" },
    });
  });

  it("tools_run runs the registered handler and returns its answer unchanged", async () => {
    const answer: HubToolResult = { content: [{ type: "text", text: "ok" }], structuredContent: { a: 1 } };
    let seen: { args?: unknown; moduleId?: string } = {};
    register("ai-git-tools", tool("git_status", { handler: async (args, c) => ((seen = { args, moduleId: c.moduleId }), answer) }));
    const { tools_run } = discovery();
    const result = await tools_run!.handler({ id: "git_status", args: { repo: "x" } }, ctx);
    expect(result).toBe(answer);
    expect(seen).toEqual({ args: { repo: "x" }, moduleId: "ai-git-tools" });
    expect(results).toEqual([["ai-git-tools", false]]);
    expect(await tools_run!.handler({ id: "git_status", args: '{"repo":"y"}' }, ctx)).toBe(answer);
  });

  it("tools_run turns a throwing handler into an error result for the owner", async () => {
    register("ai-git-tools", tool("git_push", { handler: async () => Promise.reject(new Error("boom")) }));
    const { tools_run } = discovery();
    const result = await tools_run!.handler({ id: "git_push" }, ctx);
    expect(result).toEqual({ content: [{ type: "text", text: "Error: boom" }], isError: true });
    expect(results).toEqual([["ai-git-tools", true]]);
  });

  it("tools_run does not count an answer with isError as a failure of the module", async () => {
    const answer: HubToolResult = { content: [{ type: "text", text: "Invalid arguments: mensagem is required." }], isError: true };
    register("ai-git-tools", tool("git_commit", { handler: async () => answer }));
    const { tools_run } = discovery();
    const result = await tools_run!.handler({ id: "git_commit", args: {} }, ctx);
    expect(result).toBe(answer);
    expect(results).toEqual([["ai-git-tools", false]]);
  });

  it("tools_run marks the module as failed when it has no runner for an index-only tool", async () => {
    index("environment-variables", [{ name: "jira_get_changelogs", kind: "api", description: "x", efeito: "leitura" }]);
    const { tools_run } = discovery();
    const result = await tools_run!.handler({ id: "jira_get_changelogs", args: {} }, ctx);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("not running it now");
    expect(results).toEqual([["environment-variables", true]]);
  });

  it("tools_run hands index-only entries to the module's runner service", async () => {
    index("environment-variables", [{ name: "jira_get_changelogs", kind: "api", description: "x", efeito: "leitura" }]);
    const calls: Array<[string, unknown, string]> = [];
    const runner: IndexedToolRunner = {
      run: async (id, args, c) => {
        calls.push([id, args, c.moduleId]);
        return { content: [{ type: "text", text: "changelog" }] };
      },
    };
    const { tools_run } = discovery();
    expect(textOf(await tools_run!.handler({ id: "jira_get_changelogs", args: { issue: "A-1" } }, ctx))).toContain("not running it now");
    services.set(toolRunnerServiceName("environment-variables"), runner);
    expect(textOf(await tools_run!.handler({ id: "jira_get_changelogs", args: { issue: "A-1" } }, ctx))).toBe("changelog");
    expect(calls).toEqual([["jira_get_changelogs", { issue: "A-1" }, "environment-variables"]]);
  });

  it("tools_run refuses unknown ids, bad arguments, itself and modules still waiting for setup", async () => {
    register("ai-git-tools", tool("git_status"));
    const { tools_run } = discovery();
    expect(textOf(await tools_run!.handler({ id: "nope" }, ctx))).toContain("Unknown tool: nope");
    expect((await tools_run!.handler({}, ctx)).isError).toBe(true);
    expect((await tools_run!.handler({ id: "git_status", args: [1] }, ctx)).isError).toBe(true);
    expect((await tools_run!.handler({ id: "tools_run" }, ctx)).isError).toBe(true);
    hiddenModules.add("ai-git-tools");
    expect(textOf(await tools_run!.handler({ id: "git_status" }, ctx))).toContain("configurar-ai-git-tools");
  });

  it("tools_run runs a batch one after the other and summarizes each answer", async () => {
    register("ai-git-tools", tool("git_status"), tool("git_commit"));
    const { tools_run } = discovery();
    const result = await tools_run!.handler({ calls: [{ id: "git_status" }, { id: "git_commit", args: { mensagem: "x" } }] }, ctx);
    expect(result.isError).toBeUndefined();
    expect(textOf(result)).toBe('[1/2] git_status -> ok\ngit_status:{}\n\n[2/2] git_commit -> ok\ngit_commit:{"mensagem":"x"}');
    expect(results).toEqual([["ai-git-tools", false], ["ai-git-tools", false]]);
  });

  it("tools_run keeps running the batch after an item throws, and the batch is not an error", async () => {
    register("ai-git-tools", tool("git_push", { handler: async () => Promise.reject(new Error("boom")) }));
    register("ai-vault-search", tool("list_files"));
    const { tools_run } = discovery();
    const result = await tools_run!.handler({ calls: [{ id: "git_push" }, { id: "list_files" }] }, ctx);
    expect(result.isError).toBeUndefined();
    expect(textOf(result)).toContain("[1/2] git_push -> error\nError: boom");
    expect(textOf(result)).toContain("[2/2] list_files -> ok");
    expect(results).toEqual([["ai-git-tools", true], ["ai-vault-search", false]]);
  });

  it("tools_run marks the batch as an error only when every item fails", async () => {
    register("ai-git-tools", tool("git_push", { handler: async () => Promise.reject(new Error("boom")) }));
    const { tools_run } = discovery();
    const result = await tools_run!.handler({ calls: [{ id: "git_push" }, { id: "nope" }] }, ctx);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("[2/2] nope -> error\nUnknown tool: nope");
  });

  it("tools_run cuts a long answer inside a batch and says how much was left out", async () => {
    register("ai-git-tools", tool("git_status", { handler: async () => ({ content: [{ type: "text", text: "x".repeat(3000) }] }) }));
    const { tools_run } = discovery();
    const out = textOf(await tools_run!.handler({ calls: [{ id: "git_status" }] }, ctx));
    expect(out).toContain("x".repeat(1500));
    expect(out).not.toContain("x".repeat(1501));
    expect(out).toContain("[... 1500 characters omitted; call the tool alone for the full answer ...]");
  });

  it("tools_run refuses calls together with id", async () => {
    register("ai-git-tools", tool("git_status"));
    const { tools_run } = discovery();
    const result = await tools_run!.handler({ id: "git_status", calls: [{ id: "git_status" }] }, ctx);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("not both");
  });

  it("tools_run refuses batches of more than 10 items or none", async () => {
    register("ai-git-tools", tool("git_status"));
    const { tools_run } = discovery();
    const eleven = await tools_run!.handler({ calls: Array.from({ length: 11 }, () => ({ id: "git_status" })) }, ctx);
    expect(eleven.isError).toBe(true);
    expect(textOf(eleven)).toContain("calls must be a list of 1 to 10 items");
    const empty = await tools_run!.handler({ calls: [] }, ctx);
    expect(empty.isError).toBe(true);
    expect(textOf(empty)).toContain("calls must be a list of 1 to 10 items");
  });

  it("tools_run applies the single-call rules to each batch item", async () => {
    register("ai-git-tools", tool("git_status"));
    register("ai-hidden", tool("hidden_tool"));
    hiddenModules.add("ai-hidden");
    const { tools_run } = discovery();
    const result = await tools_run!.handler({ calls: [{ id: "tools_run" }, { id: "hidden_tool" }, { args: {} }, { id: "git_status" }] }, ctx);
    expect(result.isError).toBeUndefined();
    expect(textOf(result)).toContain("[1/4] tools_run -> error\ntools_run cannot run itself");
    expect(textOf(result)).toContain("[2/4] hidden_tool -> error\nThe module \"ai-hidden\" has not been set up yet");
    expect(textOf(result)).toContain("[3/4] (no id) -> error\nInvalid arguments: item needs an id.");
    expect(textOf(result)).toContain("[4/4] git_status -> ok");
  });
});
