// The tools_run approval of the core (type execucao) and the ready calls of the protection hooks.
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CORE_RUN_SPEC, CORE_SPECS, buildCommand, parseCommand } from "../../src/hooks/hook-specs";
import { ToolIndexWriter } from "../../src/tool-index/tool-index-writer";
import type { ToolIndexEntry } from "../../src/types";
import { HookWorld, runWithOpenStdin } from "./helpers";

let world: HookWorld;
beforeEach(() => {
  world = new HookWorld();
});
afterEach(() => world.cleanup());

const RUN = "mcp__ai-ecosystem__tools_run";

function index(moduleId: string, entries: ToolIndexEntry[]): void {
  new ToolIndexWriter(world.abs(".obsidian", "plugins", moduleId, "tools.db")).sync(moduleId, entries);
}

function run(toolInput: Record<string, unknown>) {
  return world.run("ai-ecosystem", "execucao", { hook_event_name: "PreToolUse", tool_name: RUN, tool_input: toolInput });
}

describe("hook specs: execucao", () => {
  it("is a core entry on PreToolUse of tools_run and its command parses back", () => {
    expect(CORE_RUN_SPEC).toEqual({ module: "ai-ecosystem", type: "execucao", event: "PreToolUse", matcher: "mcp__.*__tools_run" });
    expect(CORE_SPECS.map((s) => s.type)).toEqual(["falha", "execucao"]);
    expect(parseCommand(buildCommand("/v", "ai-ecosystem", "execucao"))).toEqual({ module: "ai-ecosystem", type: "execucao" });
  });
});

describe("hook script: execucao (tools_run)", () => {
  beforeEach(() => {
    index("ai-git-tools", [
      { name: "git_status", description: "Status", efeito: "leitura" },
      { name: "git_push", description: "Push", efeito: "externo", aprovacao: "Posso fazer o push da branch {branch} para {remoto}?" },
      { name: "git_commit", description: "Commit", efeito: "externo" },
      { name: "git_pr_merge", description: "Merge", efeito: "leitura" },
    ]);
    index("ai-templates", [
      { name: "create_note_from_template", description: "Cria", efeito: "cofre" },
      { name: "apaga_molde", description: "Apaga", efeito: "cofre", aprovacao: "obrigatoria" },
    ]);
    index("telegram-ai-gateway", [{ name: "telegram_send_message", description: "Envia", efeito: "externo", aprovacao: "dispensada" }]);
  });

  it("asks for a tool with efeito externo, with the generic question", () => {
    const out = run({ id: "git_commit", args: { mensagem: "x" } });
    expect(out.status).toBe(0);
    expect(out.decision).toBe("ask");
    expect(out.reason).toBe("Posso executar git_commit (módulo ai-git-tools, efeito externo)?");
  });

  it("fills the question template of aprovacao with the arguments, and falls back when one is missing", () => {
    expect(run({ id: "git_push", args: { branch: "feature/x", remoto: "origin" } }).reason).toBe("Posso fazer o push da branch feature/x para origin?");
    expect(run({ id: "git_push", args: JSON.stringify({ branch: "feature/x", remoto: "origin" }) }).reason).toBe("Posso fazer o push da branch feature/x para origin?");
    expect(run({ id: "git_push", args: { branch: "feature/x" } }).reason).toBe("Posso executar git_push (módulo ai-git-tools, efeito externo)?");
    expect(run({ id: "git_push", args: { branch: "a\nb", remoto: "origin" } }).decision).toBe("ask");
  });

  it("makes no decision for leitura and cofre, nor for an approval waived on purpose", () => {
    for (const id of ["git_status", "create_note_from_template", "telegram_send_message"]) {
      const out = run({ id, args: {} });
      expect(out.status, id).toBe(0);
      expect(out.stdout, id).toBe("");
    }
  });

  it("asks when aprovacao is obrigatoria, whatever the effect", () => {
    expect(run({ id: "apaga_molde" }).decision).toBe("ask");
  });

  it("keeps the merge question of AI Git Tools through tools_run, whatever the index says", () => {
    expect(run({ id: "git_pr_merge", args: { numero: 9, destino: "develop" } }).reason).toBe("Posso fazer o merge do PR #9 para a branch develop?");
    expect(run({ id: "git_pr_merge" }).reason).toBe("Posso fazer o merge deste PR?");
  });

  it("asks for an unknown id, an invalid id, bad input and without any index", () => {
    expect(run({ id: "nao_existe" }).reason).toContain("Posso executar nao_existe pelo tools_run?");
    expect(run({ id: "rm -rf /" }).reason).toBe("Posso executar esta tool pelo tools_run?");
    expect(run({}).decision).toBe("ask");
    fs.rmSync(world.abs(".obsidian"), { recursive: true, force: true });
    expect(run({ id: "git_status" }).decision).toBe("ask");
  });

  it("asks when the input is not JSON or never ends", async () => {
    const result = spawnSync(process.execPath, [world.script, "ai-ecosystem", "execucao"], { input: "not json", encoding: "utf8", timeout: 15000 });
    expect(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision).toBe("ask");
    const open = await runWithOpenStdin(world, "ai-ecosystem", "execucao");
    expect(open.code).toBe(0);
    expect(JSON.parse(open.stdout).hookSpecificOutput.permissionDecision).toBe("ask");
  });

  it("asks even with the hooks turned off and without the heartbeat", () => {
    world.heartbeat(null);
    const out = world.run("ai-ecosystem", "execucao", { tool_name: RUN, tool_input: { id: "git_commit" } }, { AI_ECOSYSTEM_HOOKS: "off" });
    expect(out.decision).toBe("ask");
  });

  it("reads the module of tools.json first and follows configDir", () => {
    world.config({ configDir: "cfg" });
    new ToolIndexWriter(world.abs("cfg", "plugins", "mod-a", "tools.db")).sync("mod-a", [{ name: "dup", description: "a", efeito: "leitura" }]);
    new ToolIndexWriter(world.abs("cfg", "plugins", "mod-b", "tools.db")).sync("mod-b", [{ name: "dup", description: "b", efeito: "externo" }]);
    world.json("tools.json", { dup: "mod-b" });
    expect(run({ id: "dup" }).reason).toBe("Posso executar dup (módulo mod-b, efeito externo)?");
    world.json("tools.json", { dup: "mod-a" });
    expect(run({ id: "dup" }).stdout).toBe("");
  });
});

describe("hook script: falha through tools_run", () => {
  it("marks the module of the tool tools_run ran", () => {
    world.json("tools.json", { tools_run: "ai-ecosystem", git_push: "ai-git-tools" });
    world.run("ai-ecosystem", "falha", { tool_name: RUN, tool_input: { id: "git_push", args: {} } });
    expect(Object.keys(world.readJson<Record<string, number>>("falhas.json") ?? {})).toEqual(["ai-git-tools"]);
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
