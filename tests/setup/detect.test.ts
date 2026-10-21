import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cloudProvidersOf, detectGit, obsidianSyncEnabled, scanScriptFolders } from "../../src/setup/detect";
import { makeVault, removeVault, writeFile } from "../runner/helpers";

const vaults: string[] = [];
function vault(): string {
  const dir = makeVault();
  vaults.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of vaults.splice(0)) removeVault(dir);
});

describe("cloudProvidersOf", () => {
  it("recognizes the sync providers by the vault path", () => {
    expect(cloudProvidersOf("C:\\Users\\me\\OneDrive\\Cofre")).toEqual(["OneDrive"]);
    expect(cloudProvidersOf("C:/Users/me/Dropbox/notes")).toEqual(["Dropbox"]);
    expect(cloudProvidersOf("G:\\My Drive\\Cofre")).toEqual(["Google Drive"]);
    expect(cloudProvidersOf("C:\\Users\\me\\Google Drive\\Cofre")).toEqual(["Google Drive"]);
    expect(cloudProvidersOf("/Users/me/Library/Mobile Documents/iCloud~md~obsidian/Documents/Vault")).toEqual(["iCloud"]);
    expect(cloudProvidersOf("C:\\Users\\me\\Documents\\Cofre")).toEqual([]);
  });
});

describe("detectGit", () => {
  it("tells whether the vault is a repository and whether .claude is ignored", () => {
    const dir = vault();
    expect(detectGit(dir)).toEqual({ repositorio: false, claude_ignorado: false });

    fs.mkdirSync(path.join(dir, ".git"));
    expect(detectGit(dir)).toEqual({ repositorio: true, claude_ignorado: false });

    for (const line of [".claude", ".claude/", "/.claude", "/.claude/", ".claude/*"]) {
      writeFile(dir, ".gitignore", `# notes\r\n${line}\r\n`);
      expect(detectGit(dir).claude_ignorado, line).toBe(true);
    }
    writeFile(dir, ".gitignore", ".claude/settings.local.json\n");
    expect(detectGit(dir).claude_ignorado).toBe(false);
    writeFile(dir, ".git/info/exclude", ".claude/\n");
    expect(detectGit(dir).claude_ignorado).toBe(true);
  });

  it("accepts a .git file (worktrees and submodules)", () => {
    const dir = vault();
    writeFile(dir, ".git", "gitdir: ../elsewhere\n");
    expect(detectGit(dir).repositorio).toBe(true);
  });
});

describe("obsidianSyncEnabled", () => {
  it("reads core-plugins.json in both of its shapes", () => {
    const dir = vault();
    expect(obsidianSyncEnabled(dir, ".obsidian")).toBe(false);
    expect(obsidianSyncEnabled(dir, undefined)).toBe(false);

    writeFile(dir, ".obsidian/core-plugins.json", JSON.stringify({ sync: true }));
    expect(obsidianSyncEnabled(dir, ".obsidian")).toBe(true);
    writeFile(dir, ".obsidian/core-plugins.json", JSON.stringify({ sync: false, "file-explorer": true }));
    expect(obsidianSyncEnabled(dir, ".obsidian")).toBe(false);
    writeFile(dir, ".obsidian/core-plugins.json", JSON.stringify(["file-explorer", "sync"]));
    expect(obsidianSyncEnabled(dir, ".obsidian")).toBe(true);
    writeFile(dir, ".obsidian/core-plugins.json", "not json");
    expect(obsidianSyncEnabled(dir, ".obsidian")).toBe(false);
  });
});

describe("scanScriptFolders", () => {
  it("counts script files per folder, by language, and keeps the top five", async () => {
    const dir = vault();
    for (let i = 0; i < 7; i++) writeFile(dir, `f${i}/run.py`, "1");
    writeFile(dir, "f0/extra.py", "1");
    writeFile(dir, "f0/tool.mjs", "1");
    writeFile(dir, "deep/a/b/c/d/e/f/too-deep.py", "1");
    writeFile(dir, "docs/readme.md", "x");
    writeFile(dir, ".claude/hooks/x.js", "1");
    writeFile(dir, "node_modules/p/i.js", "1");

    const found = await scanScriptFolders(dir);
    expect(found).toHaveLength(5);
    expect(found[0]).toEqual({ pasta: "f0", arquivos: 3, linguagens: ["node", "python"] });
    expect(found.map((f) => f.pasta)).toEqual(["f0", "f1", "f2", "f3", "f4"]);
    expect(found.some((f) => f.pasta.includes("node_modules") || f.pasta.includes(".claude") || f.pasta.includes("docs"))).toBe(false);
  });

  it("reports scripts in the vault root as the folder dot, and an empty vault as nothing", async () => {
    const dir = vault();
    expect(await scanScriptFolders(dir)).toEqual([]);
    writeFile(dir, "run.sh", "echo");
    expect(await scanScriptFolders(dir)).toEqual([{ pasta: ".", arquivos: 1, linguagens: ["bash"] }]);
  });
});
