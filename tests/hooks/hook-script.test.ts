import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HookWorld, runWithOpenStdin } from "./helpers";

let world: HookWorld;
beforeEach(() => {
  world = new HookWorld();
});
afterEach(() => world.cleanup());

const SEARCH = "ai-vault-search";
const ENV_KEYS = "environment-variables";
const SCRIPTS = "ai-scripts";
const TEMPLATES = "ai-templates";

describe("hook script: ai-vault-search (Grep and Glob)", () => {
  beforeEach(() => world.module(SEARCH));

  it("blocks a Grep inside the vault and points to search_notes", () => {
    const run = world.tool(SEARCH, "Grep", { pattern: "acesso", path: world.abs("Knowledge") });
    expect(run.status).toBe(0);
    expect(run.decision).toBe("deny");
    expect(run.reason).toContain("search_notes");
    expect(run.json?.hookSpecificOutput.hookEventName).toBe("PreToolUse");
  });

  it("blocks a Grep without path when the working directory is the vault", () => {
    expect(world.tool(SEARCH, "Grep", { pattern: "x" }).decision).toBe("deny");
  });

  it("resolves a relative path against the working directory", () => {
    expect(world.tool(SEARCH, "Grep", { pattern: "x", path: "Knowledge" }).decision).toBe("deny");
  });

  it("blocks a Glob whose absolute pattern starts in the vault", () => {
    const outside = path.join(os.tmpdir(), "elsewhere");
    const run = world.tool(SEARCH, "Glob", { pattern: `${world.abs("Notas").replace(/\\/g, "/")}/**/*.md` }, { cwd: outside });
    expect(run.decision).toBe("deny");
  });

  it("allows a Grep outside the vault", () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "aie-outside-"));
    try {
      const run = world.tool(SEARCH, "Grep", { pattern: "x", path: outside });
      expect(run.status).toBe(0);
      expect(run.stdout).toBe("");
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it("allows a Grep in a folder outside the index, in the tool notes, .claude and the config folder", () => {
    world.pastas({ foraDoIndice: ["Anexos"], notasDeTools: ["MCP"] });
    for (const dir of ["Anexos", "Anexos/sub", "MCP/Jira", ".claude/skills", ".obsidian/plugins"]) {
      expect(world.tool(SEARCH, "Grep", { pattern: "x", path: world.abs(...dir.split("/")) }).stdout, dir).toBe("");
    }
  });

  it("leaves a custom config folder alone", () => {
    world.config({ configDir: ".config-obsidian" });
    expect(world.tool(SEARCH, "Grep", { pattern: "x", path: world.abs(".config-obsidian", "plugins") }).stdout).toBe("");
    expect(world.tool(SEARCH, "Grep", { pattern: "x", path: world.abs(".obsidian") }).decision).toBe("deny");
  });

  it("accepts input with a BOM (Windows PowerShell 5.1 pipes)", () => {
    const input = "﻿" + JSON.stringify({ cwd: world.vault, tool_name: "Grep", tool_input: { pattern: "x" } });
    const result = spawnSync(process.execPath, [world.script, SEARCH, "protecao"], { input, encoding: "utf8", timeout: 15000 });
    expect(result.stdout).toContain('"permissionDecision":"deny"');
  });

  it("ignores other tools", () => {
    expect(world.tool(SEARCH, "Read", { file_path: world.abs("a.md") }).stdout).toBe("");
  });

  it.runIf(process.platform === "win32")("compares paths without case and with either slash on Windows", () => {
    const mixed = world.abs("Knowledge").replace(/^(.)/, (c) => c.toUpperCase()).toUpperCase();
    expect(world.tool(SEARCH, "Grep", { pattern: "x", path: mixed }).decision).toBe("deny");
    expect(world.tool(SEARCH, "Grep", { pattern: "x", path: world.abs("Knowledge").replace(/\\/g, "/") }).decision).toBe("deny");
  });
});

describe("hook script: environment-variables (curl and friends)", () => {
  beforeEach(() => {
    world.module(ENV_KEYS);
    world.hosts(["acme.atlassian.net", "*.example.com", "api.github.com/repos/acme"]);
  });

  it("blocks curl to a host that has a secret and points to the vault tools", () => {
    const run = world.tool(ENV_KEYS, "Bash", { command: 'curl -s -H "Authorization: Bearer x" https://acme.atlassian.net/rest/api/3/myself' });
    expect(run.decision).toBe("deny");
    expect(run.reason).toContain("search_vault_tools");
  });

  it("allows curl to a host that is not listed", () => {
    expect(world.tool(ENV_KEYS, "Bash", { command: "curl https://example.org/data" }).stdout).toBe("");
    expect(world.tool(ENV_KEYS, "Bash", { command: "curl https://other.atlassian.net/x" }).stdout).toBe("");
  });

  it("matches wildcard subdomains but not the bare domain", () => {
    expect(world.tool(ENV_KEYS, "Bash", { command: "wget https://api.example.com/x" }).decision).toBe("deny");
    expect(world.tool(ENV_KEYS, "Bash", { command: "wget https://example.com/x" }).stdout).toBe("");
  });

  it("honors the path prefix of a pattern", () => {
    expect(world.tool(ENV_KEYS, "Bash", { command: "curl https://api.github.com/repos/acme/app" }).decision).toBe("deny");
    expect(world.tool(ENV_KEYS, "Bash", { command: "curl https://api.github.com/user" }).stdout).toBe("");
    expect(world.tool(ENV_KEYS, "Bash", { command: "curl https://api.github.com/repos/acmeinc/app" }).stdout).toBe("");
  });

  it("blocks PowerShell web cmdlets", () => {
    for (const command of [
      "Invoke-RestMethod -Uri https://acme.atlassian.net/x",
      "$r = iwr https://acme.atlassian.net/x",
      "Invoke-WebRequest https://acme.atlassian.net/x | Select-Object Content",
    ]) {
      expect(world.tool(ENV_KEYS, "PowerShell", { command }).decision, command).toBe("deny");
    }
  });

  it("allows a command that only mentions the URL", () => {
    expect(world.tool(ENV_KEYS, "Bash", { command: "echo https://acme.atlassian.net/browse/X-1" }).stdout).toBe("");
  });

  it("allows everything when no host is registered", () => {
    world.hosts([]);
    expect(world.tool(ENV_KEYS, "Bash", { command: "curl https://acme.atlassian.net/x" }).stdout).toBe("");
  });
});

describe("hook script: ai-scripts (python and friends)", () => {
  beforeEach(() => {
    world.module(SCRIPTS);
    world.pastas({ scripts: ["scripts"] });
  });

  it("blocks a script in an allowed folder and points to ecosystem_run_script", () => {
    const run = world.tool(SCRIPTS, "Bash", { command: "python scripts/x.py --flag" });
    expect(run.decision).toBe("deny");
    expect(run.reason).toContain("ecosystem_run_script");
  });

  it("blocks the other interpreters, flags before the file and chained commands", () => {
    for (const command of ["python3 -u scripts/x.py", "node scripts/x.js", "bash scripts/run.sh", "py scripts/x.py", "echo hi; python scripts/x.py", "FOO=1 python scripts/x.py"]) {
      expect(world.tool(SCRIPTS, "Bash", { command }).decision, command).toBe("deny");
    }
    expect(world.tool(SCRIPTS, "PowerShell", { command: "powershell -File scripts/x.ps1" }).decision).toBe("deny");
  });

  it("follows cd and absolute paths", () => {
    expect(world.tool(SCRIPTS, "Bash", { command: "cd scripts && python x.py" }).decision).toBe("deny");
    expect(world.tool(SCRIPTS, "Bash", { command: `python "${world.abs("scripts", "x.py")}"` }).decision).toBe("deny");
  });

  it("allows python elsewhere and commands that do not run a file", () => {
    for (const command of ["python other/x.py", "python -m pytest scripts", "python -c \"print(1)\"", "ls scripts", "cat scripts/x.py"]) {
      expect(world.tool(SCRIPTS, "Bash", { command }).stdout, command).toBe("");
    }
  });

  it("allows a script outside the vault", () => {
    const outside = path.join(os.tmpdir(), "scripts", "x.py");
    expect(world.tool(SCRIPTS, "Bash", { command: `python ${outside.replace(/\\/g, "/")}` }).stdout).toBe("");
  });
});

describe("hook script: ai-templates (Write)", () => {
  beforeEach(() => {
    world.module(TEMPLATES);
    world.pastas({ templates: ["Knowledge/Logs/*.md", "Projetos/*/Branches/**"] });
  });

  it("blocks a new file that matches a template target", () => {
    const run = world.tool(TEMPLATES, "Write", { file_path: world.abs("Knowledge", "Logs", "Novo log.md"), content: "x" });
    expect(run.decision).toBe("deny");
    expect(run.reason).toContain("create_note_from_template");
  });

  it("matches ** and * segments", () => {
    expect(world.tool(TEMPLATES, "Write", { file_path: world.abs("Projetos", "Clonador", "Branches", "a", "b.md"), content: "x" }).decision).toBe("deny");
    expect(world.tool(TEMPLATES, "Write", { file_path: world.abs("Knowledge", "Logs", "sub", "x.md"), content: "x" }).stdout).toBe("");
  });

  it("allows overwriting a file that already exists", () => {
    const file = world.abs("Knowledge", "Logs", "Existente.md");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "old");
    expect(world.tool(TEMPLATES, "Write", { file_path: file, content: "new" }).stdout).toBe("");
  });

  it("allows a new file outside the template targets and outside the vault", () => {
    expect(world.tool(TEMPLATES, "Write", { file_path: world.abs("Notas", "livre.md"), content: "x" }).stdout).toBe("");
    expect(world.tool(TEMPLATES, "Write", { file_path: path.join(os.tmpdir(), "Knowledge", "Logs", "a.md"), content: "x" }).stdout).toBe("");
  });

  it("never checks Edit", () => {
    expect(world.tool(TEMPLATES, "Edit", { file_path: world.abs("Knowledge", "Logs", "Novo.md") }).stdout).toBe("");
  });
});

describe("hook script: when it steps aside", () => {
  const blocked = () => world.tool(SEARCH, "Grep", { pattern: "x", path: world.abs("Knowledge") });

  beforeEach(() => world.module(SEARCH));

  it("blocks with a fresh heartbeat (control)", () => {
    expect(blocked().decision).toBe("deny");
  });

  it("allows when the heartbeat is older than 45 seconds", () => {
    world.heartbeat(60_000);
    expect(blocked().stdout).toBe("");
  });

  it("allows when the heartbeat is missing", () => {
    world.heartbeat(null);
    expect(blocked().stdout).toBe("");
  });

  it("allows when the module is not set up", () => {
    world.module(SEARCH, "pendente_configuracao");
    expect(blocked().stdout).toBe("");
    world.module(SEARCH, "desativado");
    expect(blocked().stdout).toBe("");
  });

  it("allows when the module has no state file", () => {
    fs.rmSync(path.join(world.stateDir, "modules", `${SEARCH}.json`));
    expect(blocked().stdout).toBe("");
  });

  it("allows for 10 minutes after a failure of the module", () => {
    world.json("falhas.json", { [SEARCH]: Date.now() - 60_000 });
    expect(blocked().stdout).toBe("");
    world.json("falhas.json", { [SEARCH]: Date.now() - 11 * 60_000 });
    expect(blocked().decision).toBe("deny");
    world.json("falhas.json", { "other-module": Date.now() });
    expect(blocked().decision).toBe("deny");
  });

  it("allows on a corrupted state file", () => {
    for (const rel of ["config.json", "pastas.json", "falhas.json", `modules/${SEARCH}.json`, "bloqueios.json"]) {
      world.json(rel, "{ not json");
      const run = blocked();
      expect(run.status, rel).toBe(0);
      expect(run.stdout, rel).toBe("");
      // restore for the next round
      world.config({});
      world.module(SEARCH);
      world.pastas({});
      world.json("falhas.json", {});
      world.json("bloqueios.json", {});
    }
  });

  it("allows when the data file of the rule is missing", () => {
    fs.rmSync(path.join(world.stateDir, "pastas.json"));
    expect(blocked().stdout).toBe("");
  });

  it("allows on input that is not JSON", () => {
    const result = spawnSync(process.execPath, [world.script, SEARCH, "protecao"], { input: "garbage", encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
  });

  it("ends by itself after 2 seconds when its input never closes", async () => {
    const result = await runWithOpenStdin(world, SEARCH, "protecao");
    expect(result.code).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.ms).toBeLessThan(6000);
  });
});

describe("hook script: modes and the AI_ECOSYSTEM_HOOKS override", () => {
  const call = (env: Record<string, string> = {}) => world.tool(SEARCH, "Grep", { pattern: "x", path: world.abs("Knowledge") }, {}, env);

  beforeEach(() => world.module(SEARCH));

  it("avisar only adds a context for the model, with no permission decision", () => {
    world.config({ modos: { [SEARCH]: "avisar" } });
    const run = call();
    expect(run.json?.hookSpecificOutput).toEqual({ hookEventName: "PreToolUse", additionalContext: expect.stringContaining("search_notes") });
    expect(run.decision).toBeUndefined();
    expect(run.stdout).not.toContain("permissionDecision");
  });

  it("off prints nothing", () => {
    world.config({ modos: { [SEARCH]: "off" } });
    expect(call().stdout).toBe("");
  });

  it("a mode of another module does not apply", () => {
    world.config({ modos: { "ai-scripts": "off" } });
    expect(call().decision).toBe("deny");
  });

  it("the environment variable wins over the config", () => {
    world.config({ modos: { [SEARCH]: "bloquear" } });
    expect(call({ AI_ECOSYSTEM_HOOKS: "off" }).stdout).toBe("");
    const warned = call({ AI_ECOSYSTEM_HOOKS: "avisar" });
    expect(warned.decision).toBeUndefined();
    expect(warned.context).toContain("search_notes");
    world.config({ modos: { [SEARCH]: "off" } });
    expect(call({ AI_ECOSYSTEM_HOOKS: "bloquear" }).decision).toBe("deny");
    expect(call({ AI_ECOSYSTEM_HOOKS: "nonsense" }).stdout).toBe("");
  });
});

describe("hook script: repetition lock", () => {
  beforeEach(() => world.module(SEARCH));

  it("lets the 3rd identical attempt through with a context, then starts over", () => {
    const call = (pattern = "x") => world.tool(SEARCH, "Grep", { pattern, path: world.abs("Knowledge") });
    expect(call().decision).toBe("deny");
    expect(call().decision).toBe("deny");
    const third = call();
    expect(third.decision).toBeUndefined();
    expect(third.stdout).not.toContain("permissionDecision");
    expect(third.context).toContain("trava de repetição");
    expect(third.context).toContain("search_notes");
    expect(call().decision).toBe("deny");
  });

  it("counts only identical attempts (keys sorted, spaces of command collapsed)", () => {
    world.module(SCRIPTS);
    world.pastas({ scripts: ["scripts"] });
    const bash = (command: string) => world.tool(SCRIPTS, "Bash", { command, description: "d" });
    expect(bash("python  scripts/x.py").decision).toBe("deny");
    expect(bash("python scripts/y.py").decision).toBe("deny");
    expect(bash("python scripts/x.py").decision).toBe("deny");
    const third = bash("python  scripts/x.py   ");
    expect(third.decision).toBeUndefined();
    expect(third.context).toContain("trava de repetição");
  });

  it("forgets attempts older than 10 minutes", () => {
    const call = () => world.tool(SEARCH, "Grep", { pattern: "x", path: world.abs("Knowledge") });
    call();
    call();
    const locks = world.readJson<Record<string, { n: number; t: number }>>("bloqueios.json") ?? {};
    for (const entry of Object.values(locks)) entry.t -= 11 * 60_000;
    world.json("bloqueios.json", locks);
    expect(call().decision).toBe("deny");
  });
});

describe("hook script: setup (SessionStart)", () => {
  const session = () => world.run("ai-templates", "setup", { hook_event_name: "SessionStart", source: "startup" });

  it("orders the setup skill while the module is pending and has no marker", () => {
    world.module("ai-templates", "pendente_configuracao");
    const run = session();
    expect(run.json?.hookSpecificOutput.hookEventName).toBe("SessionStart");
    expect(run.context).toContain("ai-templates");
    expect(run.context).toContain("configurar-ai-templates");
    expect(run.context).toContain("ainda não foi configurado");
  });

  it("prints nothing once the marker exists, the module is configured or the core is not alive", () => {
    world.module("ai-templates", "pendente_configuracao");
    world.json("modules/ai-templates.configurado.json", { concluidoEm: new Date().toISOString() });
    expect(session().stdout).toBe("");

    fs.rmSync(path.join(world.stateDir, "modules", "ai-templates.configurado.json"));
    world.module("ai-templates", "configurado");
    expect(session().stdout).toBe("");

    world.module("ai-templates", "pendente_configuracao");
    world.heartbeat(null);
    expect(session().stdout).toBe("");
  });
});

describe("hook script: setup (UserPromptSubmit)", () => {
  const prompt = () => world.run("ai-templates", "setup", { hook_event_name: "UserPromptSubmit", prompt: "oi" });

  it("orders the setup skill on any message while pending and without marker", () => {
    world.module("ai-templates", "pendente_configuracao");
    const run = prompt();
    expect(run.json?.hookSpecificOutput.hookEventName).toBe("UserPromptSubmit");
    expect(run.context).toContain("Antes de responder à mensagem do usuário");
    expect(run.context).toContain("configurar-ai-templates");
  });

  it("prints nothing with the marker, when configured or when the core is not alive", () => {
    world.module("ai-templates", "pendente_configuracao");
    world.json("modules/ai-templates.configurado.json", { concluidoEm: new Date().toISOString() });
    expect(prompt().stdout).toBe("");
    fs.rmSync(path.join(world.stateDir, "modules", "ai-templates.configurado.json"));
    world.module("ai-templates", "configurado");
    expect(prompt().stdout).toBe("");
    world.module("ai-templates", "pendente_configuracao");
    world.heartbeat(null);
    expect(prompt().stdout).toBe("");
  });
});

describe("hook script: falha (PostToolUseFailure)", () => {
  it("marks the module that owns a failed MCP tool", () => {
    world.json("tools.json", { list_secrets: ENV_KEYS, http_request: ENV_KEYS, search_notes: SEARCH });
    const before = Date.now();
    const run = world.run("ai-ecosystem", "falha", { hook_event_name: "PostToolUseFailure", tool_name: "mcp__environment-variables__http_request", error: "boom" });
    expect(run.status).toBe(0);
    expect(run.stdout).toBe("");
    const marks = world.readJson<Record<string, number>>("falhas.json") ?? {};
    expect(marks[ENV_KEYS]).toBeGreaterThanOrEqual(before);
    expect(marks[SEARCH]).toBeUndefined();
  });

  it("keeps the marks of other modules and ignores unknown or non-MCP tools", () => {
    world.json("tools.json", { search_notes: SEARCH });
    world.json("falhas.json", { "ai-scripts": 123 });
    world.run("ai-ecosystem", "falha", { tool_name: "mcp__x__unknown_tool" });
    world.run("ai-ecosystem", "falha", { tool_name: "Bash" });
    expect(world.readJson("falhas.json")).toEqual({ "ai-scripts": 123 });
    world.run("ai-ecosystem", "falha", { tool_name: "mcp__vault__search_notes" });
    const marks = world.readJson<Record<string, number>>("falhas.json") ?? {};
    expect(marks["ai-scripts"]).toBe(123);
    expect(marks[SEARCH]).toBeGreaterThan(0);
  });

  it("relaxes the protection of that module afterwards", () => {
    world.module(SEARCH);
    world.json("tools.json", { search_notes: SEARCH });
    expect(world.tool(SEARCH, "Grep", { pattern: "x", path: world.abs("a") }).decision).toBe("deny");
    world.run("ai-ecosystem", "falha", { tool_name: "mcp__vault__search_notes" });
    expect(world.tool(SEARCH, "Grep", { pattern: "y", path: world.abs("a") }).stdout).toBe("");
  });
});

describe("hook script: ai-git-tools (git, gh and the GitHub and Bitbucket APIs)", () => {
  const GIT = "ai-git-tools";
  beforeEach(() => world.module(GIT));

  it("warns by default (mode avisar): the call goes on with the reminder in the context", () => {
    for (const [tool, command] of [
      ["Bash", "git commit -m x"],
      ["Bash", "curl https://api.bitbucket.org/2.0/repositories/ws/repo/pullrequests"],
      ["Bash", "gh pr create --title x --base develop"],
      ["Bash", "cd x && git push"],
      ["PowerShell", "Set-Location C:/repo; git.exe status"],
      ["PowerShell", "Invoke-RestMethod -Uri https://api.github.com/repos/o/r/pulls"],
      ["Bash", 'GIT_TRACE=1 "/c/Program Files/Git/bin/git.exe" log'],
    ] as const) {
      const run = world.tool(GIT, tool, { command });
      expect(run.decision, command).toBeUndefined();
      expect(run.stdout, command).not.toContain("permissionDecision");
      expect(run.context, command).toContain("git_commit");
      expect(run.context, command).toContain("AI Git Tools");
    }
  });

  it("leaves help commands, other hosts and the word github without curl alone", () => {
    for (const command of [
      "git --version",
      "git help commit",
      "git -h",
      "git --help",
      "git commit --help",
      "gh --version",
      "echo github",
      "echo git is great",
      "curl https://example.com/github.com",
      "curl https://raw.githubusercontent.com/o/r/main/x",
      "ls -la",
      "digit status",
    ]) {
      expect(world.tool(GIT, "Bash", { command }).stdout, command).toBe("");
    }
  });

  it("ignores other tools", () => {
    expect(world.tool(GIT, "Write", { file_path: world.abs("a.md"), content: "git commit" }).stdout).toBe("");
  });

  it("denies in mode bloquear and does nothing in mode off", () => {
    world.config({ modos: { [GIT]: "bloquear" } });
    const blocked = world.tool(GIT, "Bash", { command: "git commit -m x" });
    expect(blocked.decision).toBe("deny");
    expect(blocked.reason).toContain("git_status");

    world.config({ modos: { [GIT]: "off" } });
    expect(world.tool(GIT, "Bash", { command: "git commit -m x" }).stdout).toBe("");
  });

  it("keeps the other modules on bloquear by default", () => {
    world.module(TEMPLATES);
    world.pastas({ templates: ["Notas/**"] });
    expect(world.tool(TEMPLATES, "Write", { file_path: world.abs("Notas", "nova.md"), content: "x" }).decision).toBe("deny");
  });
});

describe("hook script: aprovacao (git_pr_merge)", () => {
  const GIT = "ai-git-tools";
  const MERGE = "mcp__environment-variables__git_pr_merge";

  function approve(input: Record<string, unknown>) {
    return world.run(GIT, "aprovacao", { hook_event_name: "PreToolUse", tool_name: MERGE, ...input });
  }

  it("asks with the PR number and the target branch", () => {
    world.module(GIT);
    const run = approve({ tool_input: { repo: "Projeto", numero: 12, destino: "develop", titulo: "x" } });
    expect(run.status).toBe(0);
    expect(run.json?.hookSpecificOutput).toEqual({
      hookEventName: "PreToolUse",
      permissionDecision: "ask",
      permissionDecisionReason: "Posso fazer o merge do PR #12 para a branch develop?",
    });
    expect(approve({ tool_input: { numero: "7", destino: "main" } }).reason).toBe("Posso fazer o merge do PR #7 para a branch main?");
  });

  it("asks with a generic text when numero or destino is missing or invalid", () => {
    world.module(GIT);
    for (const toolInput of [{}, { numero: 12 }, { destino: "develop" }, { numero: "abc", destino: "develop" }, { numero: 12, destino: "  " }, { numero: -1, destino: "x" }]) {
      const run = approve({ tool_input: toolInput });
      expect(run.decision, JSON.stringify(toolInput)).toBe("ask");
      expect(run.reason).toBe("Posso fazer o merge deste PR?");
    }
    expect(approve({}).decision).toBe("ask");
  });

  it("asks even when the input cannot be read (it never fails open)", () => {
    for (const input of ["not json", "", "[1,2]"]) {
      const result = spawnSync(process.execPath, [world.script, GIT, "aprovacao"], { input, encoding: "utf8", timeout: 15000 });
      expect(result.status, input).toBe(0);
      const out = JSON.parse(result.stdout) as { hookSpecificOutput: Record<string, unknown> };
      expect(out.hookSpecificOutput).toMatchObject({ permissionDecision: "ask", permissionDecisionReason: "Posso fazer o merge deste PR?" });
    }
  });

  it("asks when its input never closes (the guard asks instead of allowing)", async () => {
    const run = await runWithOpenStdin(world, GIT, "aprovacao");
    expect(run.code).toBe(0);
    expect(run.stdout).toContain('"permissionDecision":"ask"');
  });

  it("ignores the mode, the heartbeat and the setup state of the module", () => {
    world.config({ modos: { [GIT]: "off" } });
    world.heartbeat(null);
    const input = { tool_input: { numero: 12, destino: "develop" } };
    expect(approve(input).reason).toBe("Posso fazer o merge do PR #12 para a branch develop?");
    expect(world.run(GIT, "aprovacao", { tool_name: MERGE, ...input }, { AI_ECOSYSTEM_HOOKS: "off" }).decision).toBe("ask");
    world.module(GIT, "pendente_configuracao");
    expect(approve(input).decision).toBe("ask");
  });

  it("never answers allow", () => {
    world.module(GIT);
    for (const toolInput of [{ numero: 1, destino: "develop" }, {}, { numero: 1, destino: "a\nb" }]) {
      expect(approve({ tool_input: toolInput }).decision).not.toBe("allow");
    }
  });
});
