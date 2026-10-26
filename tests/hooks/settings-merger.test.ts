import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { APPROVAL_SPEC, CORE_FAILURE_SPEC, approvalSpecs, buildCommand, moduleHookSpecs, parseCommand, protectionSpec, setupSpecs } from "../../src/hooks/hook-specs";
import { SettingsMerger } from "../../src/hooks/settings-merger";
import { makeVault, removeVault } from "../runner/helpers";

let vault: string;
let claudeDir: string;
let backups: string;
let vaultPath: string;
let merger: SettingsMerger;

const LOCAL = "settings.local.json";
const SHARED = "settings.json";
const SCRIPTS = protectionSpec("ai-scripts")!;
const SEARCH = protectionSpec("ai-vault-search")!;
const TEMPLATES = protectionSpec("ai-templates")!;

const USER_HOOK = { matcher: "", hooks: [{ type: "command", command: "echo session started" }] };

beforeEach(() => {
  vault = makeVault();
  claudeDir = path.join(vault, ".claude");
  backups = path.join(claudeDir, "ai-ecosystem", "backups");
  vaultPath = vault.replace(/\\/g, "/");
  fs.mkdirSync(claudeDir, { recursive: true });
  merger = new SettingsMerger(claudeDir, backups, () => vaultPath);
});
afterEach(() => removeVault(vault));

function file(name = LOCAL): string {
  return path.join(claudeDir, name);
}

function writeSettings(value: unknown, name = LOCAL): string {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  fs.writeFileSync(file(name), text);
  return text;
}

function readSettings(name = LOCAL): any {
  return JSON.parse(fs.readFileSync(file(name), "utf8"));
}

function backupFiles(): string[] {
  try {
    return fs.readdirSync(backups).sort();
  } catch {
    return [];
  }
}

describe("hook commands", () => {
  it("builds the command with forward slashes and quotes", () => {
    expect(buildCommand("C:\\Users\\x\\Cofre\\", "ai-scripts", "protecao")).toBe(
      'node "C:/Users/x/Cofre/.claude/ai-ecosystem/hooks/ai-ecosystem-hook.mjs" ai-scripts protecao',
    );
  });

  it("recognizes only the plugin's commands", () => {
    expect(parseCommand(buildCommand("/v", "ai-templates", "protecao"))).toEqual({ module: "ai-templates", type: "protecao" });
    expect(parseCommand(buildCommand("/v", "ai-ecosystem", "falha"))).toEqual({ module: "ai-ecosystem", type: "falha" });
    expect(parseCommand("node other.mjs ai-scripts protecao")).toBeUndefined();
    expect(parseCommand("node ai-ecosystem-hook.mjs ai-scripts nonsense")).toBeUndefined();
    expect(parseCommand(undefined)).toBeUndefined();
  });

  it("has the matchers of the contract", () => {
    expect(SEARCH).toMatchObject({ event: "PreToolUse", matcher: "Grep|Glob|Bash|PowerShell" });
    expect(protectionSpec("environment-variables")).toMatchObject({ event: "PreToolUse", matcher: "Bash|PowerShell" });
    expect(SCRIPTS).toMatchObject({ event: "PreToolUse", matcher: "Bash|PowerShell" });
    expect(TEMPLATES).toMatchObject({ event: "PreToolUse", matcher: "Write" });
    expect(CORE_FAILURE_SPEC).toMatchObject({ event: "PostToolUseFailure", matcher: "mcp__.*", type: "falha" });
    expect(setupSpecs("ai-templates")).toEqual([
      { module: "ai-templates", type: "setup", event: "SessionStart" },
      { module: "ai-templates", type: "setup", event: "UserPromptSubmit" },
    ]);
    expect(protectionSpec("telegram-ai-gateway")).toBeUndefined();
  });
});

describe("AI Git Tools entries", () => {
  const GIT = protectionSpec("ai-git-tools")!;

  it("has the protection and approval specs of the contract", () => {
    expect(GIT).toEqual({ module: "ai-git-tools", type: "protecao", event: "PreToolUse", matcher: "Bash|PowerShell" });
    expect(APPROVAL_SPEC).toEqual({ module: "ai-git-tools", type: "aprovacao", event: "PreToolUse", matcher: "mcp__.*__git_pr_merge" });
    expect(approvalSpecs("ai-git-tools")).toEqual([APPROVAL_SPEC]);
    expect(approvalSpecs("ai-scripts")).toEqual([]);
    expect(moduleHookSpecs("ai-git-tools")).toEqual([GIT, APPROVAL_SPEC]);
    expect(moduleHookSpecs("ai-scripts")).toEqual([SCRIPTS]);
    expect(moduleHookSpecs("telegram-ai-gateway")).toEqual([]);
    expect(parseCommand(buildCommand("/v", "ai-git-tools", "aprovacao"))).toEqual({ module: "ai-git-tools", type: "aprovacao" });
  });

  it("installs both entries idempotently, next to the user's own PreToolUse hooks", () => {
    const user = { matcher: "Bash", hooks: [{ type: "command", command: "my-linter.sh", timeout: 5 }] };
    writeSettings({ hooks: { PreToolUse: [user] } });
    expect(merger.install(LOCAL, [GIT, APPROVAL_SPEC])).toEqual({ ok: true, changed: true });
    const first = fs.readFileSync(file(), "utf8");
    expect(merger.install(LOCAL, [GIT, APPROVAL_SPEC])).toEqual({ ok: true, changed: false });
    expect(fs.readFileSync(file(), "utf8")).toBe(first);

    const pre = readSettings().hooks.PreToolUse;
    expect(pre).toEqual([
      user,
      { matcher: "Bash|PowerShell", hooks: [{ type: "command", command: buildCommand(vaultPath, "ai-git-tools", "protecao"), timeout: 10 }] },
      { matcher: "mcp__.*__git_pr_merge", hooks: [{ type: "command", command: buildCommand(vaultPath, "ai-git-tools", "aprovacao"), timeout: 10 }] },
    ]);
    const listed = merger.list(LOCAL);
    expect(listed.ok && listed.entries.map((e) => e.type)).toEqual(["protecao", "aprovacao"]);
  });

  it("removes both with the module and keeps the user's entries", () => {
    const user = { matcher: "Bash", hooks: [{ type: "command", command: "my-linter.sh" }] };
    writeSettings({ hooks: { PreToolUse: [user] } });
    merger.install(LOCAL, [GIT, APPROVAL_SPEC]);
    expect(merger.remove(LOCAL, { module: "ai-git-tools" })).toEqual({ ok: true, changed: true });
    expect(readSettings().hooks.PreToolUse).toEqual([user]);
  });

  it("moves the approval entry with the others", () => {
    merger.install(LOCAL, [GIT, APPROVAL_SPEC]);
    expect(merger.move(LOCAL, SHARED).ok).toBe(true);
    const moved = merger.list(SHARED);
    expect(moved.ok && moved.entries.map((e) => `${e.type}:${e.matcher}`)).toEqual(["protecao:Bash|PowerShell", "aprovacao:mcp__.*__git_pr_merge"]);
  });
});

describe("SettingsMerger.install", () => {
  it("creates the file when it does not exist", () => {
    expect(merger.install(LOCAL, [SCRIPTS])).toEqual({ ok: true, changed: true });
    expect(readSettings().hooks.PreToolUse).toEqual([
      { matcher: "Bash|PowerShell", hooks: [{ type: "command", command: buildCommand(vaultPath, "ai-scripts", "protecao"), timeout: 10 }] },
    ]);
    expect(backupFiles()).toEqual([]);
  });

  it("treats an empty file as an empty object", () => {
    writeSettings("  \n");
    expect(merger.install(LOCAL, [SCRIPTS]).ok).toBe(true);
    expect(readSettings().hooks.PreToolUse).toHaveLength(1);
  });

  it("keeps the user's own hooks and settings untouched, and writes a backup", () => {
    const original = {
      permissions: { allow: ["Bash(ls:*)"] },
      hooks: {
        SessionStart: [USER_HOOK],
        PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "my-linter.sh", timeout: 5 }] }],
      },
    };
    const text = writeSettings(original);

    expect(merger.install(LOCAL, [SCRIPTS, ...setupSpecs("ai-scripts")]).ok).toBe(true);

    const after = readSettings();
    expect(after.permissions).toEqual(original.permissions);
    expect(after.hooks.SessionStart[0]).toEqual(USER_HOOK);
    expect(after.hooks.PreToolUse[0]).toEqual(original.hooks.PreToolUse[0]);
    expect(after.hooks.PreToolUse).toHaveLength(2);
    expect(after.hooks.SessionStart).toHaveLength(2);
    expect(after.hooks.SessionStart[1].matcher).toBeUndefined();

    const saved = backupFiles();
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatch(/^settings\.local\.json\.\d{17}-\d{3}\.bak$/);
    expect(fs.readFileSync(path.join(backups, saved[0]!), "utf8")).toBe(text);
  });

  it("keeps the indentation of the file", () => {
    writeSettings(JSON.stringify({ model: "x" }, null, "\t"));
    merger.install(LOCAL, [SCRIPTS]);
    expect(fs.readFileSync(file(), "utf8")).toMatch(/^\{\n\t"model"/);
  });

  it("is idempotent", () => {
    merger.install(LOCAL, [SCRIPTS, SEARCH]);
    const first = fs.readFileSync(file(), "utf8");
    expect(merger.install(LOCAL, [SCRIPTS, SEARCH])).toEqual({ ok: true, changed: false });
    expect(fs.readFileSync(file(), "utf8")).toBe(first);
    expect(readSettings().hooks.PreToolUse).toHaveLength(2);
    expect(backupFiles()).toHaveLength(0);
  });

  it("lists what it installed", () => {
    merger.install(LOCAL, [SCRIPTS, ...setupSpecs("ai-templates"), CORE_FAILURE_SPEC]);
    const listed = merger.list(LOCAL);
    expect(listed.ok && listed.entries.map((e) => `${e.module}:${e.type}:${e.event}:${e.matcher ?? "-"}`).sort()).toEqual([
      "ai-ecosystem:falha:PostToolUseFailure:mcp__.*",
      "ai-scripts:protecao:PreToolUse:Bash|PowerShell",
      "ai-templates:setup:SessionStart:-",
      "ai-templates:setup:UserPromptSubmit:-",
    ]);
  });

  it("rewrites the absolute path when the vault moved", () => {
    merger.install(LOCAL, [SCRIPTS]);
    vaultPath = "D:/Novo/Cofre";
    expect(merger.install(LOCAL, [SCRIPTS])).toEqual({ ok: true, changed: true });
    const hooks = readSettings().hooks.PreToolUse;
    expect(hooks).toHaveLength(1);
    expect(hooks[0].hooks[0].command).toBe('node "D:/Novo/Cofre/.claude/ai-ecosystem/hooks/ai-ecosystem-hook.mjs" ai-scripts protecao');
  });

  it("syncPaths rewrites every plugin entry and nothing else", () => {
    writeSettings({ hooks: { SessionStart: [USER_HOOK] } });
    merger.install(LOCAL, [SCRIPTS, CORE_FAILURE_SPEC]);
    vaultPath = "E:/Outro";
    expect(merger.syncPaths(LOCAL)).toEqual({ ok: true, changed: true });
    const settings = readSettings();
    expect(settings.hooks.SessionStart).toEqual([USER_HOOK]);
    expect(JSON.stringify(settings)).not.toContain(vault.replace(/\\/g, "\\\\"));
    expect(JSON.stringify(settings)).toContain("E:/Outro/.claude/ai-ecosystem/hooks/ai-ecosystem-hook.mjs");
    expect(merger.syncPaths(LOCAL)).toEqual({ ok: true, changed: false });
  });

  it("does not create a file for syncPaths or remove when there is none", () => {
    expect(merger.syncPaths(LOCAL)).toEqual({ ok: true, changed: false });
    expect(merger.remove(LOCAL, { module: "ai-scripts" })).toEqual({ ok: true, changed: false });
    expect(fs.existsSync(file())).toBe(false);
  });

  it("keeps only the last 5 backups", () => {
    writeSettings({ a: 1 });
    for (let i = 0; i < 8; i++) {
      merger.install(LOCAL, [SCRIPTS]);
      merger.remove(LOCAL, { module: "ai-scripts" });
    }
    expect(backupFiles()).toHaveLength(5);
  });
});

describe("SettingsMerger with an invalid file", () => {
  it("refuses to write, reports the problem and leaves the file and backups alone", () => {
    const broken = writeSettings('{ "hooks": { "SessionStart": [ ');
    const result = merger.install(LOCAL, [SCRIPTS]);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain("not valid JSON");
    expect(fs.readFileSync(file(), "utf8")).toBe(broken);
    expect(backupFiles()).toEqual([]);
    expect(merger.remove(LOCAL, { module: "ai-scripts" }).ok).toBe(false);
    expect(merger.list(LOCAL).ok).toBe(false);
    expect(merger.syncPaths(LOCAL).ok).toBe(false);
  });

  it("refuses a file that is not an object or has a wrong hooks shape", () => {
    writeSettings("[1, 2]");
    expect(merger.install(LOCAL, [SCRIPTS]).ok).toBe(false);
    const odd = writeSettings({ hooks: "nope" });
    expect(merger.install(LOCAL, [SCRIPTS]).ok).toBe(false);
    expect(fs.readFileSync(file(), "utf8")).toBe(odd);
    const noList = writeSettings({ hooks: { PreToolUse: {} } });
    expect(merger.install(LOCAL, [SCRIPTS]).ok).toBe(false);
    expect(fs.readFileSync(file(), "utf8")).toBe(noList);
  });
});

describe("SettingsMerger.remove", () => {
  it("removes only the entries of one module and keeps the user's", () => {
    writeSettings({
      hooks: {
        SessionStart: [USER_HOOK],
        PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "my-linter.sh" }] }],
      },
    });
    merger.install(LOCAL, [SCRIPTS, SEARCH, TEMPLATES, CORE_FAILURE_SPEC]);

    expect(merger.remove(LOCAL, { module: "ai-scripts" })).toEqual({ ok: true, changed: true });

    const settings = readSettings();
    const commands = JSON.stringify(settings);
    expect(commands).not.toContain("ai-scripts protecao");
    expect(commands).toContain("ai-vault-search protecao");
    expect(commands).toContain("ai-templates protecao");
    expect(commands).toContain("ai-ecosystem falha");
    expect(commands).toContain("my-linter.sh");
    expect(settings.hooks.SessionStart).toEqual([USER_HOOK]);
    expect(settings.hooks.PreToolUse).toHaveLength(3);
  });

  it("can remove one type of a module", () => {
    merger.install(LOCAL, [SCRIPTS, ...setupSpecs("ai-scripts")]);
    merger.remove(LOCAL, { module: "ai-scripts", type: "setup" });
    const listed = merger.list(LOCAL);
    expect(listed.ok && listed.entries.map((e) => e.type)).toEqual(["protecao"]);
    expect(readSettings().hooks.SessionStart).toBeUndefined();
  });

  it("drops the groups, events and hooks key it empties, but not a user's entry inside a shared group", () => {
    merger.install(LOCAL, [SCRIPTS]);
    merger.remove(LOCAL, { module: "ai-scripts" });
    expect(readSettings()).toEqual({});

    const shared = {
      hooks: {
        PreToolUse: [
          {
            matcher: "Bash|PowerShell",
            hooks: [
              { type: "command", command: "mine.sh" },
              { type: "command", command: buildCommand(vaultPath, "ai-scripts", "protecao"), timeout: 10 },
            ],
          },
        ],
      },
    };
    writeSettings(shared);
    merger.remove(LOCAL, { module: "ai-scripts" });
    expect(readSettings()).toEqual({ hooks: { PreToolUse: [{ matcher: "Bash|PowerShell", hooks: [{ type: "command", command: "mine.sh" }] }] } });
  });

  it("leaves a user's empty group alone", () => {
    writeSettings({ hooks: { PreToolUse: [{ matcher: "Read", hooks: [] }] } });
    merger.install(LOCAL, [SCRIPTS]);
    merger.remove(LOCAL, { module: "ai-scripts" });
    expect(readSettings()).toEqual({ hooks: { PreToolUse: [{ matcher: "Read", hooks: [] }] } });
  });

  it("does nothing when the module has no entries", () => {
    writeSettings({ hooks: { SessionStart: [USER_HOOK] } });
    expect(merger.remove(LOCAL, { module: "ai-scripts" })).toEqual({ ok: true, changed: false });
    expect(backupFiles()).toEqual([]);
  });
});

describe("SettingsMerger.move", () => {
  it("moves every plugin entry to the other file and leaves the user's entries where they are", () => {
    writeSettings({ hooks: { SessionStart: [USER_HOOK] } }, LOCAL);
    merger.install(LOCAL, [SCRIPTS, ...setupSpecs("ai-scripts"), CORE_FAILURE_SPEC]);
    writeSettings({ model: "opus" }, SHARED);

    expect(merger.move(LOCAL, SHARED)).toEqual({ ok: true, changed: true });

    const local = readSettings(LOCAL);
    expect(JSON.stringify(local)).not.toContain("ai-ecosystem-hook");
    expect(local.hooks.SessionStart).toEqual([USER_HOOK]);
    const shared = readSettings(SHARED);
    expect(shared.model).toBe("opus");
    const listed = merger.list(SHARED);
    expect(listed.ok && listed.entries.map((e) => `${e.module}:${e.type}:${e.matcher ?? "-"}`).sort()).toEqual([
      "ai-ecosystem:falha:mcp__.*",
      "ai-scripts:protecao:Bash|PowerShell",
      "ai-scripts:setup:-",
      "ai-scripts:setup:-",
    ]);
  });

  it("moves back again without duplicates", () => {
    merger.install(LOCAL, [SCRIPTS]);
    merger.move(LOCAL, SHARED);
    merger.move(SHARED, LOCAL);
    merger.move(LOCAL, SHARED);
    const listed = merger.list(SHARED);
    expect(listed.ok && listed.entries).toHaveLength(1);
    const local = merger.list(LOCAL);
    expect(local.ok && local.entries).toHaveLength(0);
  });

  it("does nothing between a file and itself or when there is nothing to move", () => {
    expect(merger.move(LOCAL, LOCAL)).toEqual({ ok: true, changed: false });
    expect(merger.move(LOCAL, SHARED)).toEqual({ ok: true, changed: false });
    expect(fs.existsSync(file(SHARED))).toBe(false);
  });

  it("writes nothing when the target file is invalid", () => {
    merger.install(LOCAL, [SCRIPTS]);
    const broken = writeSettings("{oops", SHARED);
    expect(merger.move(LOCAL, SHARED).ok).toBe(false);
    expect(fs.readFileSync(file(SHARED), "utf8")).toBe(broken);
    const local = merger.list(LOCAL);
    expect(local.ok && local.entries).toHaveLength(1);
  });
});
