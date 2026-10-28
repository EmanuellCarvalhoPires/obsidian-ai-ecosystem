// The MCP packages inside the core: their tools are indexed in the core's tools.db, found by
// tools_find and run through Environment Keys (tool-runner:environment-variables).
import { afterEach, describe, expect, it } from "vitest";
import { Ecosystem } from "../../src/core/ecosystem";
import { createClient } from "../../src/server/auth";
import { normalizeSettings } from "../../src/settings/settings-store";
import { ECOSYSTEM_ID, MCP_PACKAGES_SERVICE, toolRunnerServiceName } from "../../src/types";
import type { AIEcosystemSettings, HubToolResult, IndexedToolRunner, McpPackagesHost, ToolIndexEntry } from "../../src/types";
import { makeVault, nodeDetector, removeVault } from "../runner/helpers";

interface Rig {
  eco: Ecosystem;
  settings: AIEcosystemSettings;
  vault: string;
  base: string;
  token: string;
}

let rig: Rig | undefined;

/** A fake of the McpPackageService of the core: its entries can change, and listeners are told. */
function fakePackages(initial: ToolIndexEntry[]): { host: McpPackagesHost; set(next: ToolIndexEntry[]): void } {
  let entries = initial;
  const listeners = new Set<() => void>();
  const host: McpPackagesHost = {
    list: () => [],
    onChange: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    indexEntries: () => entries,
  };
  return {
    host,
    set(next) {
      entries = next;
      for (const listener of listeners) listener();
    },
  };
}

function apiEntry(name: string): ToolIndexEntry {
  return { name, kind: "api", description: `${name} description`, resumo: `${name} summary` };
}

async function start(mcpPackages?: McpPackagesHost): Promise<Rig> {
  const vault = makeVault();
  const { record, token } = createClient("Claude Code");
  const settings = normalizeSettings({});
  settings.port = 0;
  settings.alternativePort = 0;
  settings.clients = [record];
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
    hooks: { disabled: true },
    mcpPackages,
  });
  const status = await eco.start();
  if (!status.running) throw new Error(`server did not start: ${status.error ?? "?"}`);
  rig = { eco, settings, vault, base: `http://127.0.0.1:${status.port}`, token };
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
async function callTool(r: Rig, name: string, args: Record<string, unknown>): Promise<any> {
  const res = await fetch(`${r.base}/mcp`, {
    method: "POST",
    headers: { Authorization: `Bearer ${r.token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method: "tools/call", params: { name, arguments: args } }),
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { result: unknown }).result;
}

const coreRunner = (eco: Ecosystem): IndexedToolRunner => {
  const runner = eco.bus.get<IndexedToolRunner>(toolRunnerServiceName(ECOSYSTEM_ID));
  if (!runner) throw new Error("no core tool runner");
  return runner;
};

describe("MCP packages in the core index", () => {
  it("indexes the package tools with the native ones, under the core's module id", async () => {
    const pkgs = fakePackages([apiEntry("jira-issue-get"), apiEntry("confluence-page-read")]);
    const r = await start(pkgs.host);
    expect(r.eco.bus.get(MCP_PACKAGES_SERVICE)).toBeDefined();

    const jira = r.eco.toolIndex.find({ q: "jira-issue-get" });
    const hit = jira.tools.find((t) => t.name === "jira-issue-get");
    expect(hit).toMatchObject({ moduleId: ECOSYSTEM_ID, kind: "api" });

    const native = r.eco.toolIndex.find({ q: "ecosystem_status" });
    expect(native.tools.some((t) => t.name === "ecosystem_status" && t.moduleId === ECOSYSTEM_ID)).toBe(true);
  });

  it("removes only the entry that left the package list on change", async () => {
    const pkgs = fakePackages([apiEntry("jira-issue-get"), apiEntry("confluence-page-read")]);
    const r = await start(pkgs.host);

    pkgs.set([apiEntry("jira-issue-get")]);

    expect(r.eco.toolIndex.find({ q: "jira-issue-get" }).tools.some((t) => t.name === "jira-issue-get")).toBe(true);
    expect(r.eco.toolIndex.find({ q: "confluence-page-read" }).tools.some((t) => t.name === "confluence-page-read")).toBe(false);
    expect(r.eco.toolIndex.find({ q: "ecosystem_status" }).tools.some((t) => t.name === "ecosystem_status")).toBe(true);
  });

  it("answers with an error when Environment Keys is not active", async () => {
    const pkgs = fakePackages([apiEntry("jira-issue-get")]);
    const r = await start(pkgs.host);

    const result = await coreRunner(r.eco).run("jira-issue-get", { key: "PROJ-1" }, { client: { id: "c", name: "Claude Code" }, moduleId: ECOSYSTEM_ID });

    expect(result).toEqual({
      content: [{ type: "text", text: "This tool needs the Environment Keys plugin, which is not active. Enable it and try again." }],
      isError: true,
    });
  });

  it("runs the call through Environment Keys with its own module id and returns its answer as is", async () => {
    const pkgs = fakePackages([apiEntry("jira-issue-get")]);
    const r = await start(pkgs.host);
    const calls: Array<{ id: string; args: Record<string, unknown>; moduleId: string }> = [];
    const answer: HubToolResult = { content: [{ type: "text", text: "issue PROJ-1" }], structuredContent: { key: "PROJ-1" } };
    const envKeys: IndexedToolRunner = {
      run: async (id, args, ctx) => {
        calls.push({ id, args, moduleId: ctx.moduleId });
        return answer;
      },
    };
    r.eco.bus.register("tool-runner:environment-variables", "environment-variables", envKeys);

    const ctx = { client: { id: "c", name: "Claude Code" }, moduleId: ECOSYSTEM_ID };
    const result = await coreRunner(r.eco).run("jira-issue-get", { key: "PROJ-1" }, ctx);

    expect(calls).toEqual([{ id: "jira-issue-get", args: { key: "PROJ-1" }, moduleId: "environment-variables" }]);
    expect(result).toEqual(answer);
  });

  it("reaches Environment Keys through tools_run", async () => {
    const pkgs = fakePackages([apiEntry("jira-issue-get")]);
    const r = await start(pkgs.host);
    const envKeys: IndexedToolRunner = {
      run: async (id) => ({ content: [{ type: "text", text: `ran ${id}` }] }),
    };
    r.eco.bus.register("tool-runner:environment-variables", "environment-variables", envKeys);

    const result = await callTool(r, "tools_run", { id: "jira-issue-get", args: { key: "PROJ-1" } });

    expect(result.isError).not.toBe(true);
    expect(JSON.stringify(result)).toContain("ran jira-issue-get");
  });

  it("does nothing new without mcpPackages", async () => {
    const r = await start(undefined);
    expect(r.eco.bus.get(MCP_PACKAGES_SERVICE)).toBeUndefined();
    expect(r.eco.bus.get(toolRunnerServiceName(ECOSYSTEM_ID))).toBeUndefined();
    expect(r.eco.toolIndex.find({ q: "ecosystem_status" }).tools.some((t) => t.name === "ecosystem_status")).toBe(true);
    expect(r.eco.toolIndex.find({ q: "jira" }).tools).toEqual([]);
  });
});
