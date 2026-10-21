// The Install button of the catalog: confirmation before anything is downloaded, what an accept
// writes, a refusal, a failed download and a missing Node.js. The installer is a mock.
import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installFromCatalog } from "../../src/catalog/install-flow";
import type { CatalogSetupHost } from "../../src/catalog/install-flow";
import type { InstallResult } from "../../src/catalog/installer-service";
import type { HookInstallPlan } from "../../src/hooks/hook-manager";
import type { CatalogEntry } from "../../src/types";
import { enableModule, hasHook, hookCommands, readVaultFile, settingsFile, skillText, startRig, stateFile, stopRigs } from "./helpers";
import type { SetupRig } from "./helpers";

afterEach(stopRigs);

const entry: CatalogEntry = {
  id: "ai-scripts",
  repo: "EmanuellCarvalhoPires/obsidian-ai-scripts",
  name: "AI Scripts",
  description: { en: "e", pt: "p" },
  icon: "terminal",
  minEcosystemVersion: "1.0.0",
};

function hostOf(r: SetupRig): CatalogSetupHost {
  const setup = r.eco.setup!;
  return {
    planInstall: (e) => setup.planCatalogInstall(e.id),
    begin: (e) => setup.beginCatalogInstall(e.id, e.name),
    finish: (e, ok) => setup.finishCatalogInstall(e.id, ok),
  };
}

const okResult: InstallResult = { ok: true, method: "internal" };

describe("catalog install with confirmation", () => {
  it("asks before anything is downloaded and lists what will be written", async () => {
    const r = await startRig();
    const install = vi.fn(async () => okResult);
    let shown: HookInstallPlan | undefined;
    let answer!: (accepted: boolean) => void;
    const flow = installFromCatalog({
      entry,
      setup: hostOf(r),
      confirm: (plan) => {
        shown = plan;
        return new Promise<boolean>((resolve) => (answer = resolve));
      },
      install,
    });
    await vi.waitFor(() => expect(shown).toBeDefined());

    // The modal is open and nothing happened yet.
    expect(install).not.toHaveBeenCalled();
    expect(stateFile(r, "modules/ai-scripts.json")).toBeUndefined();
    expect(skillText(r, "ai-scripts")).toBeUndefined();
    expect(hasHook(r, "ai-scripts", "setup")).toBe(false);
    expect(readVaultFile(r, "GEMINI.md")).toBeUndefined();

    expect(shown?.catalog?.skillPath).toBe(".claude/skills/configurar-ai-scripts/SKILL.md");
    expect(shown?.catalog?.setupEntries.map((e) => e.event)).toEqual(["SessionStart", "UserPromptSubmit"]);
    expect(shown?.catalog?.setupEntries[0]?.command).toContain("ai-ecosystem-hook.mjs\" ai-scripts setup");
    expect(shown?.catalog?.geminiPath).toBe("GEMINI.md");
    expect(shown?.entries.map((e) => `${e.event} ${e.matcher}`)).toEqual(["PreToolUse Bash|PowerShell"]);
    expect(shown?.entries[0]?.command).toContain("ai-scripts protecao");
    expect(shown?.settingsPath.replace(/\\/g, "/")).toMatch(/\.claude\/settings\.local\.json$/);
    expect(shown?.node.available).toBe(true);

    answer(false);
    await flow;
  });

  it("lists no protection hook for the Telegram module", async () => {
    const r = await startRig();
    const plan = await r.eco.setup!.planCatalogInstall("telegram-ai-gateway");
    expect(plan.entries).toEqual([]);
    expect(plan.catalog?.skillPath).toBe(".claude/skills/configurar-telegram-ai-gateway/SKILL.md");
  });

  it("cancel installs nothing, writes nothing and reports the refusal", async () => {
    const r = await startRig();
    const install = vi.fn(async () => okResult);
    const before = hookCommands(r);

    const outcome = await installFromCatalog({ entry, setup: hostOf(r), confirm: async () => false, install });

    expect(outcome).toEqual({ status: "cancelled" });
    expect(install).not.toHaveBeenCalled();
    expect(stateFile(r, "modules/ai-scripts.json")).toBeUndefined();
    expect(skillText(r, "ai-scripts")).toBeUndefined();
    expect(hookCommands(r)).toEqual(before);
    expect(readVaultFile(r, "GEMINI.md")).toBeUndefined();
  });

  it("accept downloads, then writes the skill, the temporary hook, the pending state and the GEMINI.md block", async () => {
    const r = await startRig();
    const seen: Array<string | undefined> = [];
    const install = vi.fn(async () => {
      // The module is already pending when the plugin is enabled and registers.
      seen.push(stateFile(r, "modules/ai-scripts.json")?.estado);
      enableModule(r, "ai-scripts", "AI Scripts");
      return okResult;
    });

    const outcome = await installFromCatalog({ entry, setup: hostOf(r), confirm: async () => true, install });
    await r.eco.setup!.whenIdle();

    expect(outcome).toMatchObject({ status: "done", setupPending: true, nodeMissing: false });
    expect(install).toHaveBeenCalledTimes(1);
    expect(seen).toEqual(["pendente_configuracao"]);
    expect(stateFile(r, "modules/ai-scripts.json")).toMatchObject({ estado: "pendente_configuracao", origem: "catalogo", nome: "AI Scripts" });

    const skill = skillText(r, "ai-scripts");
    expect(skill?.startsWith("---\nname: configurar-ai-scripts\n")).toBe(true);

    // The temporary hook is a SessionStart entry without matcher; the protection hooks wait for the setup.
    const all = settingsFile(r).hooks.SessionStart as Array<Record<string, any>>;
    const groups = all.filter((g) => g.hooks[0].command.includes("ai-scripts"));
    expect(groups).toHaveLength(1);
    expect(groups[0]?.matcher).toBeUndefined();
    expect(groups[0]?.hooks[0].command).toContain("ai-scripts setup");
    const prompts = (settingsFile(r).hooks.UserPromptSubmit as Array<Record<string, any>>).filter((g) => g.hooks[0].command.includes("ai-scripts setup"));
    expect(prompts).toHaveLength(1);
    expect(prompts[0]?.matcher).toBeUndefined();
    expect(hasHook(r, "ai-scripts", "protecao")).toBe(false);

    const gemini = readVaultFile(r, "GEMINI.md") ?? "";
    expect(gemini).toContain("<!-- ai-ecosystem:start -->");
    expect(gemini).toContain("run_ai_script");
    expect(gemini).toContain("<!-- ai-ecosystem:end -->");
  });

  it("a failed download leaves nothing behind", async () => {
    const r = await startRig();
    const failed: InstallResult = { ok: false, method: "store-page", error: "boom" };

    const outcome = await installFromCatalog({ entry, setup: hostOf(r), confirm: async () => true, install: async () => failed });

    expect(outcome).toMatchObject({ status: "done", setupPending: false });
    expect(stateFile(r, "modules/ai-scripts.json")).toBeUndefined();
    expect(skillText(r, "ai-scripts")).toBeUndefined();
    expect(hasHook(r, "ai-scripts", "setup")).toBe(false);
  });

  it("installs the module without writing a hook when Node.js is missing, and says so", async () => {
    const r = await startRig({ node: false });
    const plan = await r.eco.setup!.planCatalogInstall("ai-scripts");
    expect(plan.node.available).toBe(false);

    const outcome = await installFromCatalog({
      entry,
      setup: hostOf(r),
      confirm: async () => true,
      install: async () => {
        enableModule(r, "ai-scripts", "AI Scripts");
        return okResult;
      },
    });
    await r.eco.setup!.whenIdle();

    expect(outcome).toMatchObject({ status: "done", setupPending: true, nodeMissing: true });
    expect(stateFile(r, "modules/ai-scripts.json")).toMatchObject({ estado: "pendente_configuracao", origem: "catalogo" });
    expect(hookCommands(r).filter((c) => c.includes("ai-scripts"))).toEqual([]);
    // The settings tab shows why the module stays pending.
    const row = r.eco.hooks!.getStatus().modules.find((m) => m.id === "ai-scripts");
    expect(row).toMatchObject({ estado: "pendente_configuracao", setupHook: false });
    expect(r.eco.hooks!.getStatus().node).toMatchObject({ available: false, checked: true });
  });

  it("without a setup host the module installs as before, with no confirmation", async () => {
    const confirm = vi.fn(async () => false);
    const install = vi.fn(async () => okResult);
    const outcome = await installFromCatalog({ entry, confirm, install });
    expect(confirm).not.toHaveBeenCalled();
    expect(install).toHaveBeenCalledTimes(1);
    expect(outcome).toMatchObject({ status: "done", setupPending: false });
  });

  it("starts the install again over an old state: answers and marker are cleared", async () => {
    const r = await startRig();
    const states = path.join(r.vault, ".claude", "ai-ecosystem", "modules");
    fs.writeFileSync(path.join(states, "ai-scripts.json"), JSON.stringify({ estado: "desativado", origem: "catalogo", atualizadoEm: "2026-01-01T00:00:00.000Z", respostas: { a: 1 } }));
    fs.writeFileSync(path.join(states, "ai-scripts.configurado.json"), "{}");
    // A new Ecosystem would read these files; the running one reads them lazily, so reset the cache through a restart.
    r.eco.setup!.beginCatalogInstall("ai-scripts", "AI Scripts");
    expect(stateFile(r, "modules/ai-scripts.json")).toMatchObject({ estado: "pendente_configuracao", origem: "catalogo", respostas: {} });
    expect(fs.existsSync(path.join(states, "ai-scripts.configurado.json"))).toBe(false);
  });
});
