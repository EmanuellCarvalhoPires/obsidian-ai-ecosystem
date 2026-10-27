// The retired execucao type (old settings entries stay harmless) and the ready calls of the protection hooks.
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CORE_SPECS, buildCommand, parseCommand } from "../../src/hooks/hook-specs";
import { HookWorld, runWithOpenStdin } from "./helpers";

let world: HookWorld;
beforeEach(() => {
  world = new HookWorld();
});
afterEach(() => world.cleanup());

const RUN = "mcp__ai-ecosystem__tools_run";

describe("hook specs: execucao", () => {
  it("is no longer installed, and its command still parses back so older entries can be removed", () => {
    expect(CORE_SPECS.map((s) => s.type)).toEqual(["falha", "resumo"]);
    expect(parseCommand(buildCommand("/v", "ai-ecosystem", "execucao"))).toEqual({ module: "ai-ecosystem", type: "execucao" });
  });
});

describe("hook script: execucao (retired)", () => {
  function expectSilent(out: ReturnType<HookWorld["run"]>, label = ""): void {
    expect(out.status, label).toBe(0);
    expect(out.stdout, label).toBe("");
    expect(out.decision, label).toBeFalsy();
  }

  it("exits 0 with no output for a tools_run call", () => {
    const out = world.run("ai-ecosystem", "execucao", { hook_event_name: "PreToolUse", tool_name: RUN, tool_input: { id: "git_commit" } });
    expectSilent(out);
  });

  it("exits 0 with no output when the input is not JSON", () => {
    const result = spawnSync(process.execPath, [world.script, "ai-ecosystem", "execucao"], { input: "not json", encoding: "utf8", timeout: 15000 });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
  });

  it("exits 0 with no output while stdin stays open", async () => {
    const open = await runWithOpenStdin(world, "ai-ecosystem", "execucao");
    expect(open.code).toBe(0);
    expect(open.stdout).toBe("");
  });

  it("exits 0 with no output with the hooks turned off and without the heartbeat", () => {
    world.heartbeat(null);
    const out = world.run("ai-ecosystem", "execucao", { tool_name: RUN, tool_input: { id: "git_commit" } }, { AI_ECOSYSTEM_HOOKS: "off" });
    expectSilent(out);
  });
});

describe("hook script: falha through tools_run", () => {
  it("marks the module of the tool tools_run ran", () => {
    world.json("tools.json", { tools_run: "ai-ecosystem", git_push: "ai-git-tools" });
    world.run("ai-ecosystem", "falha", { tool_name: RUN, tool_input: { id: "git_push", args: {} } });
    expect(Object.keys(world.readJson<Record<string, number>>("falhas.json") ?? {})).toEqual(["ai-git-tools"]);
  });

  it("does not mark the module for an argument error answered by tools_run", () => {
    world.json("tools.json", { tools_run: "ai-ecosystem", git_push: "ai-git-tools" });
    const out = world.run("ai-ecosystem", "falha", { tool_name: RUN, tool_input: { id: "git_push" }, error: "Invalid arguments: id is required." });
    expect(out.status).toBe(0);
    expect(out.stdout).toBe("");
    expect(world.readJson("falhas.json")).toBeUndefined();
  });

  it("does not mark the module for an unknown id answered by tools_run", () => {
    world.json("tools.json", { tools_run: "ai-ecosystem", git_push: "ai-git-tools" });
    world.run("ai-ecosystem", "falha", { tool_name: RUN, tool_input: { id: "git_push" }, error: "Unknown tool: x. Find the right id with tools_find." });
    expect(world.readJson("falhas.json")).toBeUndefined();
  });

  it("does not mark any module for a batch of calls", () => {
    world.json("tools.json", { tools_run: "ai-ecosystem", git_push: "ai-git-tools" });
    world.run("ai-ecosystem", "falha", { tool_name: RUN, tool_input: { calls: [{ id: "git_push" }] }, error: "Error: boom" });
    expect(world.readJson("falhas.json")).toBeUndefined();
  });

  it("still marks the module for an ordinary error inside tools_run", () => {
    world.json("tools.json", { tools_run: "ai-ecosystem", git_push: "ai-git-tools" });
    world.run("ai-ecosystem", "falha", { tool_name: RUN, tool_input: { id: "git_push" }, error: "Error: boom" });
    expect(Object.keys(world.readJson<Record<string, number>>("falhas.json") ?? {})).toEqual(["ai-git-tools"]);
  });

  it("does not mark the module of a direct tool that answered with an argument error", () => {
    world.json("tools.json", { git_push: "ai-git-tools" });
    world.run("ai-git-tools", "falha", { tool_name: "mcp__ai-ecosystem__git_push", tool_input: {}, error: "Invalid arguments: x" });
    expect(world.readJson("falhas.json")).toBeUndefined();
  });
});

describe("hook script: ready calls in the protection messages", () => {
  it("gives search_notes with the words of a Grep and list_files through tools_run for a Glob", () => {
    world.module("ai-vault-search");
    const grep = world.tool("ai-vault-search", "Grep", { pattern: "acesso\\s+alfa", path: world.abs("Knowledge") });
    expect(grep.reason).toContain('search {"termos":["acesso","alfa"]}');
    const glob = world.tool("ai-vault-search", "Glob", { pattern: "**/*.md", path: world.abs("Knowledge", "Logs") });
    expect(glob.reason).toContain('tools_run {"id":"list_files","args":{"pasta":"Knowledge/Logs","recursivo":true}}');
  });

  it("gives ecosystem_run_script through tools_run with the path (own letter case) and the arguments", () => {
    world.module("ai-scripts");
    world.pastas({ scripts: ["scripts"] });
    const out = world.tool("ai-scripts", "Bash", { command: "python scripts/Contexto.py --instancia CSP ATL-1" });
    expect(out.decision).toBe("deny");
    expect(out.reason).toContain('tools_run {"id":"ecosystem_run_script","args":{"path":"scripts/Contexto.py","args":["--instancia","CSP","ATL-1"]}}');
  });

  it("gives the AI Git Tools tool of the git command", () => {
    world.module("ai-git-tools");
    expect(world.tool("ai-git-tools", "Bash", { command: "git status" }).context).toContain('tools_run {"id":"git_status","args":{}}');
    expect(world.tool("ai-git-tools", "Bash", { command: "git -C repo commit -m x" }).context).toContain('tools_run {"id":"git_commit"');
    expect(world.tool("ai-git-tools", "Bash", { command: "gh pr create --title x" }).context).toContain('"id":"git_pr_criar"');
    expect(world.tool("ai-git-tools", "Bash", { command: "git bisect start" }).context).toContain('tools_find {"modulo":"ai-git-tools"}');
  });

  it("gives create_note_from_template with the target path", () => {
    world.module("ai-templates");
    world.pastas({ templates: ["Knowledge/Logs/*.md"] });
    const out = world.tool("ai-templates", "Write", { file_path: world.abs("Knowledge", "Logs", "Novo.md"), content: "x" });
    expect(out.reason).toContain('"target_path":"Knowledge/Logs/Novo.md"');
    expect(out.reason).toContain('tools_find {"kind":"template"}');
  });

  it("gives tools_find and http_request for a host with a secret", () => {
    world.module("environment-variables");
    world.hosts(["acme.atlassian.net"]);
    const out = world.tool("environment-variables", "Bash", { command: "curl -X POST https://acme.atlassian.net/rest/api/3/search" });
    expect(out.decision).toBe("deny");
    expect(out.reason).toContain('"id":"http_request"');
    expect(out.reason).toContain('"method":"POST"');
    expect(out.reason).toContain("tools_find");
  });
});
