// The life of a module through the setup: the core's own setup, the temporary hook, hidden tools,
// completing the setup (and its order), Antigravity and GEMINI.md, and turning a module off.
import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BLOCK_END, BLOCK_START } from "../../src/setup/guide-block";
import {
  antigravitySession,
  callTool,
  claudeSession,
  configureCore,
  enableModule,
  hasHook,
  hasProtection,
  hookCommands,
  readVaultFile,
  registerHandler,
  restartRig,
  runSetupHook,
  setupComplete,
  setupSave,
  skillText,
  sleep,
  startRig,
  stateFile,
  stopRigs,
  toolNames,
  writeFile,
} from "./helpers";
import type { SetupRig } from "./helpers";

afterEach(stopRigs);

/** The catalog install of a module, up to the point where the plugin registered. */
async function installFromCatalog(r: SetupRig, id: string, name = id): Promise<void> {
  r.eco.setup!.beginCatalogInstall(id, name);
  enableModule(r, id, name);
  await r.eco.setup!.finishCatalogInstall(id, true);
  await r.eco.setup!.whenIdle();
}

describe("the core's own setup", () => {
  it("installs its skill and its temporary hook on the first run, without asking", async () => {
    const r = await startRig();

    expect(stateFile(r, "modules/ai-ecosystem.json")).toMatchObject({ estado: "pendente_configuracao", origem: "nucleo", nome: "AI Ecosystem" });
    const skill = skillText(r, "ai-ecosystem");
    expect(skill?.startsWith("---\nname: configurar-ai-ecosystem\n")).toBe(true);
    expect(hasHook(r, "ai-ecosystem", "setup")).toBe(true);
    expect(fs.existsSync(path.join(r.vault, ".claude", "skills"))).toBe(true);
    // Nothing for the other files: GEMINI.md waits for a module the user accepted.
    expect(readVaultFile(r, "GEMINI.md")).toBeUndefined();
  });

  it("keeps a state that already exists and writes no hook when the core is configured", async () => {
    const first = await startRig();
    await configureCore(first);
    expect(hasHook(first, "ai-ecosystem", "setup")).toBe(false);

    const second = await restartRig(first);
    expect(stateFile(second, "modules/ai-ecosystem.json")).toMatchObject({ estado: "configurado", origem: "nucleo" });
    expect(hasHook(second, "ai-ecosystem", "setup")).toBe(false);
    expect(fs.existsSync(path.join(second.vault, ".claude", "skills", "configurar-ai-ecosystem", "SKILL.md"))).toBe(true);
  });

  it("never hides the core tools, not even while it is pending", async () => {
    const r = await startRig();
    const names = await toolNames(r, await claudeSession(r));
    expect(names).toEqual(expect.arrayContaining(["ecosystem_status", "ecosystem_setup_status", "ecosystem_setup_save", "ecosystem_setup_complete"]));
  });

  it("writes the skill in the Obsidian language", async () => {
    const pt = await startRig({ language: "pt" });
    expect(skillText(pt, "ai-ecosystem")).toContain("Configurar o AI Ecosystem");
    const en = await startRig({ language: "en" });
    expect(skillText(en, "ai-ecosystem")).toContain("Set up AI Ecosystem");
  });

  it("completes only with its answers, then removes the temporary hook", async () => {
    const r = await startRig();
    const refused = await setupComplete(r, "ai-ecosystem");
    expect(refused.isError).toBe(true);
    expect(refused.data.faltando).toEqual(["resposta: agentes", "resposta: modo_hooks", "resposta: claude_md"]);
    expect(hasHook(r, "ai-ecosystem", "setup")).toBe(true);

    await configureCore(r);
    expect(hasHook(r, "ai-ecosystem", "setup")).toBe(false);
    expect(stateFile(r, "modules/ai-ecosystem.json").estado).toBe("configurado");
    expect(stateFile(r, "modules/ai-ecosystem.configurado.json")).toBeDefined();
  });
});

describe("a module installed from the catalog", () => {
  it("is hidden from Claude Code while pending, visible to Antigravity, and gets the GEMINI.md block", async () => {
    const r = await startRig();
    writeFile(r.vault, "GEMINI.md", "# My notes\r\n\r\nKeep this line.\r\n");
    const before = readVaultFile(r, "GEMINI.md")!;
    await installFromCatalog(r, "ai-scripts", "AI Scripts");

    const claude = await claudeSession(r);
    const antigravity = await antigravitySession(r);
    expect(await toolNames(r, claude)).not.toContain("ai_scripts_ok");
    expect(await toolNames(r, antigravity)).toContain("ai_scripts_ok");

    // Claude Code gets the reason when it calls a hidden tool anyway.
    const refused = await callTool(r, "ai_scripts_ok", {}, claude);
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain("configurar-ai-scripts");

    const gemini = readVaultFile(r, "GEMINI.md")!;
    expect(gemini.startsWith(before)).toBe(true);
    const block = gemini.slice(gemini.indexOf(BLOCK_START), gemini.indexOf(BLOCK_END) + BLOCK_END.length);
    expect(block).toContain("run_ai_script");
    expect(block).toContain("ecosystem_run_script");
    expect(gemini.slice(0, gemini.indexOf(BLOCK_START))).toBe(before + "\r\n");
    expect(gemini.slice(gemini.indexOf(BLOCK_END) + BLOCK_END.length)).toBe("\r\n");
  });

  it("makes the temporary hook order the skill, again after an interrupted session, and nothing after the marker", async () => {
    const r = await startRig();
    await installFromCatalog(r, "ai-scripts", "AI Scripts");

    const order = JSON.parse(runSetupHook(r, "ai-scripts"));
    expect(order.hookSpecificOutput.hookEventName).toBe("SessionStart");
    expect(order.hookSpecificOutput.additionalContext).toContain("configurar-ai-scripts");
    expect(order.hookSpecificOutput.additionalContext).toContain("AI Scripts");

    // The user closed the session without finishing: the next one gets the order again, the tools stay hidden.
    expect(runSetupHook(r, "ai-scripts")).toContain("configurar-ai-scripts");
    expect(await toolNames(r, await claudeSession(r))).not.toContain("ai_scripts_ok");

    await configureCore(r);
    expect((await setupComplete(r, "ai-scripts")).isError).toBe(false);
    expect(runSetupHook(r, "ai-scripts")).toBe("");
  });

  it("refuses to complete before the core is configured, and tells what to run", async () => {
    const r = await startRig();
    await installFromCatalog(r, "ai-scripts", "AI Scripts");
    const refused = await setupComplete(r, "ai-scripts");
    expect(refused.isError).toBe(true);
    expect(refused.data.faltando[0]).toContain("configurar-ai-ecosystem");
    expect(hasHook(r, "ai-scripts", "setup")).toBe(true);
    expect(stateFile(r, "modules/ai-scripts.json").estado).toBe("pendente_configuracao");
  });

  it("completes in order: marker, temporary hook, state, protection hooks, tools and the list change", async () => {
    const r = await startRig();
    await configureCore(r);
    await installFromCatalog(r, "ai-scripts", "AI Scripts");
    const claude = await claudeSession(r);
    expect(await toolNames(r, claude)).not.toContain("ai_scripts_ok");

    const hooks = r.eco.hooks!;
    const calls: string[] = [];
    const spy = <T extends object>(target: T, method: keyof T & string, label: string) => {
      const original = (target[method] as unknown as (...args: unknown[]) => unknown).bind(target);
      vi.spyOn(target as never, method as never).mockImplementation(((...args: unknown[]) => {
        calls.push(label);
        return original(...args);
      }) as never);
    };
    spy(hooks.state, "writeConfiguredMarker", "marker");
    spy(hooks, "removeSetupHook", "remove-setup-hook");
    spy(hooks.states, "setEstado", "state");
    spy(hooks, "installProtection", "protection");
    spy(r.eco.server, "notifyListChanged", "list-changed");
    spy(r.eco.setup!, "syncGuides", "gemini");

    const done = await setupComplete(r, "ai-scripts");
    expect(done.isError).toBe(false);
    expect(calls).toEqual(["marker", "remove-setup-hook", "state", "protection", "list-changed", "gemini"]);

    expect(done.data).toMatchObject({ ok: true, estado: "configurado", hook_temporario_removido: true, hooks_protecao: "instalados", gemini_md: "sem_alteracao" });
    expect(hasHook(r, "ai-scripts", "setup")).toBe(false);
    expect(hasProtection(r, "ai-scripts")).toBe(true);
    expect(stateFile(r, "modules/ai-scripts.json").estado).toBe("configurado");
    expect(stateFile(r, "modules/ai-scripts.configurado.json")).toBeDefined();
    expect(await toolNames(r, claude)).toContain("ai_scripts_ok");
    expect(runSetupHook(r, "ai-scripts")).toBe("");
  });

  it("uses the hook mode chosen in the core round for the module that finishes later", async () => {
    const r = await startRig();
    await setupSave(r, "ai-ecosystem", "agentes", ["claude-code"]);
    await setupSave(r, "ai-ecosystem", "modo_hooks", "avisar");
    await setupSave(r, "ai-ecosystem", "claude_md", "recusado");
    await setupComplete(r, "ai-ecosystem");
    await installFromCatalog(r, "ai-templates", "AI Templates");
    // The core round wrote the mode of every module with a protection hook.
    expect(stateFile(r, "config.json").modos).toMatchObject({ "ai-templates": "avisar", "ai-scripts": "avisar" });
    await setupComplete(r, "ai-templates");
    expect(hasProtection(r, "ai-templates")).toBe(true);
  });

  it("Telegram needs Environment Keys configured, and its own handler to agree", async () => {
    const r = await startRig();
    await configureCore(r);
    await installFromCatalog(r, "telegram-ai-gateway", "Telegram AI Gateway");
    registerHandler(r, "telegram-ai-gateway", { validate: async () => ({ ok: true }) });

    const refused = await setupComplete(r, "telegram-ai-gateway");
    expect(refused.isError).toBe(true);
    expect(refused.data.faltando).toEqual([expect.stringContaining("environment-variables")]);
    expect(stateFile(r, "modules/telegram-ai-gateway.json").estado).toBe("pendente_configuracao");

    // Environment Keys was already there (legacy) and is configured.
    enableModule(r, "environment-variables", "Environment Keys");
    expect(stateFile(r, "modules/environment-variables.json").estado).toBe("configurado");
    const done = await setupComplete(r, "telegram-ai-gateway");
    expect(done.isError).toBe(false);
    expect(done.data.hooks_protecao).toBe("nenhum");
  });

  it("does not finish while the module's own validation fails, and lists what is missing", async () => {
    const r = await startRig();
    await configureCore(r);
    await installFromCatalog(r, "ai-vault-search", "AI Vault Search");
    registerHandler(r, "ai-vault-search", { validate: async () => ({ ok: false, missing: ["pick the folders"] }) });

    const refused = await setupComplete(r, "ai-vault-search");
    expect(refused.isError).toBe(true);
    expect(refused.data.faltando).toEqual(["pick the folders"]);
    expect(hasHook(r, "ai-vault-search", "setup")).toBe(true);
    expect(hasProtection(r, "ai-vault-search")).toBe(false);
    expect(stateFile(r, "modules/ai-vault-search.configurado.json")).toBeUndefined();
    expect(await toolNames(r, await claudeSession(r))).not.toContain("ai_vault_search_ok");
  });

  it("completing without Node.js still configures the module and reports the missing hooks", async () => {
    const r = await startRig({ node: false });
    await configureCore(r);
    await installFromCatalog(r, "ai-templates", "AI Templates");
    const done = await setupComplete(r, "ai-templates");
    expect(done.data).toMatchObject({ ok: true, hooks_protecao: "node_ausente" });
    expect(hookCommands(r).filter((c) => c.includes("ai-templates"))).toEqual([]);
  });

  it("starts the next module's setup only: the first stays configured", async () => {
    const r = await startRig();
    await configureCore(r);
    await installFromCatalog(r, "ai-scripts", "AI Scripts");
    await setupComplete(r, "ai-scripts");
    await installFromCatalog(r, "ai-templates", "AI Templates");

    expect(runSetupHook(r, "ai-scripts")).toBe("");
    expect(runSetupHook(r, "ai-templates")).toContain("configurar-ai-templates");
    expect(hasHook(r, "ai-scripts", "setup")).toBe(false);
    expect(hasHook(r, "ai-templates", "setup")).toBe(true);
  });
});

describe("turning a module off", () => {
  it("removes its skill, its hooks and its part of the GEMINI.md block", async () => {
    const r = await startRig();
    await configureCore(r);
    await installFromCatalog(r, "ai-scripts", "AI Scripts");
    await installFromCatalog(r, "ai-templates", "AI Templates");
    await setupComplete(r, "ai-scripts");
    expect(hasProtection(r, "ai-scripts")).toBe(true);
    expect(readVaultFile(r, "GEMINI.md")).toContain("run_ai_script");

    r.enabled.delete("ai-scripts");
    r.eco.api.unregisterModule("ai-scripts");
    await sleep(120);
    await r.eco.setup!.whenIdle();

    expect(stateFile(r, "modules/ai-scripts.json").estado).toBe("desativado");
    expect(skillText(r, "ai-scripts")).toBeUndefined();
    expect(fs.existsSync(path.join(r.vault, ".claude", "skills", "configurar-ai-scripts"))).toBe(false);
    expect(hookCommands(r).filter((c) => c.includes("ai-scripts"))).toEqual([]);
    const gemini = readVaultFile(r, "GEMINI.md")!;
    expect(gemini).not.toContain("run_ai_script");
    expect(gemini).toContain("create_note_from_template");
    // The other module and the core are untouched.
    expect(skillText(r, "ai-templates")).toBeDefined();
    expect(hasHook(r, "ai-templates", "setup")).toBe(true);
    expect(hasHook(r, "ai-ecosystem", "falha")).toBe(true);
  });

  it("removes the temporary hook of a module that never finished", async () => {
    const r = await startRig();
    await installFromCatalog(r, "ai-scripts", "AI Scripts");
    expect(hasHook(r, "ai-scripts", "setup")).toBe(true);

    r.enabled.delete("ai-scripts");
    r.eco.api.unregisterModule("ai-scripts");
    await sleep(120);
    await r.eco.setup!.whenIdle();

    expect(hasHook(r, "ai-scripts", "setup")).toBe(false);
    expect(skillText(r, "ai-scripts")).toBeUndefined();
  });

  it("does nothing while Obsidian only closes (the plugin is still enabled)", async () => {
    const r = await startRig();
    await installFromCatalog(r, "ai-scripts", "AI Scripts");
    r.eco.api.unregisterModule("ai-scripts");
    await sleep(120);
    expect(stateFile(r, "modules/ai-scripts.json").estado).toBe("pendente_configuracao");
    expect(skillText(r, "ai-scripts")).toBeDefined();
    expect(hasHook(r, "ai-scripts", "setup")).toBe(true);
  });

  it("enabling a catalog module that was never configured starts its setup over", async () => {
    const r = await startRig();
    await installFromCatalog(r, "ai-scripts", "AI Scripts");
    r.enabled.delete("ai-scripts");
    r.eco.api.unregisterModule("ai-scripts");
    await sleep(120);
    await r.eco.setup!.whenIdle();
    expect(skillText(r, "ai-scripts")).toBeUndefined();

    enableModule(r, "ai-scripts", "AI Scripts");
    await r.eco.setup!.whenIdle();
    expect(stateFile(r, "modules/ai-scripts.json").estado).toBe("pendente_configuracao");
    expect(skillText(r, "ai-scripts")).toBeDefined();
    expect(hasHook(r, "ai-scripts", "setup")).toBe(true);
    expect(await toolNames(r, await claudeSession(r))).not.toContain("ai_scripts_ok");
  });

  it("enabling a configured catalog module again brings its protection hooks back, without a new setup", async () => {
    const r = await startRig();
    await configureCore(r);
    await installFromCatalog(r, "ai-scripts", "AI Scripts");
    await setupComplete(r, "ai-scripts");
    r.enabled.delete("ai-scripts");
    r.eco.api.unregisterModule("ai-scripts");
    await sleep(120);
    await r.eco.setup!.whenIdle();
    expect(hasProtection(r, "ai-scripts")).toBe(false);

    enableModule(r, "ai-scripts", "AI Scripts");
    await sleep(50);
    await r.eco.setup!.whenIdle();
    expect(stateFile(r, "modules/ai-scripts.json").estado).toBe("configurado");
    expect(hasProtection(r, "ai-scripts")).toBe(true);
    expect(hasHook(r, "ai-scripts", "setup")).toBe(false);
    expect(runSetupHook(r, "ai-scripts")).toBe("");
  });
});
