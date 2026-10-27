// ecosystem_setup_status and ecosystem_setup_save through the MCP server: what the status
// reports, which questions are left to ask, the core keys and the delegation to a module.
import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BLOCK_END, BLOCK_START } from "../../src/setup/guide-block";
import type { SetupHandler } from "../../src/types";
import {
  callTool,
  claudeSession,
  configureCore,
  enableModule,
  hasHook,
  hasProtection,
  hookCommands,
  registerHandler,
  setupSave,
  setupStatus,
  settingsFile,
  startRig,
  stateFile,
  stopRigs,
  toolNames,
  writeFile,
} from "./helpers";
import type { SetupRig } from "./helpers";

afterEach(stopRigs);

async function installFromCatalog(r: SetupRig, id: string, name = id): Promise<void> {
  r.eco.setup!.beginCatalogInstall(id, name);
  enableModule(r, id, name);
  await r.eco.setup!.finishCatalogInstall(id, true);
  await r.eco.setup!.whenIdle();
}

const pending = (status: any) => (status.perguntas as Array<any>).filter((q) => !q.ja_respondida && !q.detectada).map((q) => q.chave);

describe("ecosystem_setup_status", () => {
  it("reports the module, its state, the prerequisites and the usage block", async () => {
    const r = await startRig();
    await installFromCatalog(r, "ai-scripts", "AI Scripts");
    const status = await setupStatus(r, "ai-scripts");

    expect(status).toMatchObject({ modulo: "ai-scripts", nome: "AI Scripts", estado: "pendente_configuracao", origem: "catalogo", node_disponivel: true });
    expect(status.pre_requisitos).toEqual([{ modulo: "ai-ecosystem", estado: "pendente_configuracao", ok: false }]);
    expect(status.bloco_claude_md.startsWith(BLOCK_START)).toBe(true);
    expect(status.bloco_claude_md.endsWith(BLOCK_END)).toBe(true);
    expect(status.tools_do_modulo).toEqual([{ nome: "ai_scripts_ok", visivel_para_claude_code: false }]);

    await configureCore(r);
    const after = await setupStatus(r, "ai-scripts");
    expect(after.pre_requisitos[0].ok).toBe(true);
  });

  it("asks only what is neither detected nor answered", async () => {
    const r = await startRig();
    r.settings.scripts.allowedFolders = ["scripts"];
    writeFile(r.vault, "scripts/a.py", "print(1)");
    writeFile(r.vault, "scripts/b.py", "print(2)");
    await installFromCatalog(r, "ai-scripts", "AI Scripts");
    const handler: SetupHandler = {
      detect: async () => ({ scriptsFolder: "scripts", scriptCount: 2, languages: ["python"], registeredScriptIds: ["a", "b"] }),
    };
    registerHandler(r, "ai-scripts", handler);

    const status = await setupStatus(r, "ai-scripts");
    const byKey = Object.fromEntries((status.perguntas as Array<any>).map((q) => [q.chave, q]));
    // Folder and language were detected: shown for confirmation, not asked.
    expect(byKey.linguagens).toMatchObject({ detectada: true, valor_detectado: ["python"], salvar: false });
    expect(byKey.pastas_permitidas).toMatchObject({ detectada: true, valor_detectado: ["scripts"] });
    expect(byKey.pasta_de_scripts).toMatchObject({ detectada: true, valor_detectado: "scripts" });
    expect(pending(status)).toEqual(["pode_gravar_fora_do_cofre", "migrar_scripts"]);
    expect(status.detectado.nucleo.scripts_no_cofre).toEqual([{ pasta: "scripts", arquivos: 2, linguagens: ["python"] }]);
    expect(status.detectado.modulo.scriptCount).toBe(2);

    await setupSave(r, "ai-scripts", "pode_gravar_fora_do_cofre", false);
    const next = await setupStatus(r, "ai-scripts");
    expect(pending(next)).toEqual(["migrar_scripts"]);
    expect(next.respostas.pode_gravar_fora_do_cofre).toBe(false);
  });

  it("asks everything when nothing was detected, in the Obsidian language, with the recommended option marked", async () => {
    const r = await startRig({ language: "pt" });
    const status = await setupStatus(r, "ai-ecosystem");
    expect(pending(status)).toEqual(["agentes", "arquivo_settings", "modo_hooks", "claude_md"]);
    const mode = (status.perguntas as Array<any>).find((q) => q.chave === "modo_hooks");
    expect(mode.pergunta).toContain("hooks de proteção");
    expect(mode.opcoes[0]).toMatchObject({ valor: "bloquear", rotulo: "Bloquear", recomendada: true });
    const claudeMd = (status.perguntas as Array<any>).find((q) => q.chave === "claude_md");
    expect(claudeMd.opcoes.map((o: any) => o.valor)).toEqual(["criar", "recusado"]);
  });

  it("detects CLAUDE.md, git, the cloud folder, clients, modules, hook settings and Node.js without any secret", async () => {
    const r = await startRig({
      clientName: "Claude Code",
      prepare: (vault) => {
        writeFile(vault, "CLAUDE.md", "# mine\n");
        writeFile(vault, ".git/HEAD", "ref: refs/heads/main\n");
        writeFile(vault, ".gitignore", "node_modules\n.claude/\n");
        writeFile(vault, ".obsidian/core-plugins.json", JSON.stringify({ sync: true, "file-explorer": true }));
        for (const n of ["a", "b", "c"]) writeFile(vault, `tools/${n}.sh`, "echo");
        writeFile(vault, "tools/x.ps1", "Write-Host");
        writeFile(vault, "misc/one.js", "1");
        writeFile(vault, ".hidden/secret.py", "1");
        writeFile(vault, "node_modules/lib/x.js", "1");
      },
    });
    enableModule(r, "ai-templates", "AI Templates");

    const { nucleo } = (await setupStatus(r, "ai-ecosystem")).detectado;
    expect(nucleo.claude_md).toBe(true);
    expect(nucleo.gemini_md).toBe(false);
    expect(nucleo.git).toEqual({ repositorio: true, claude_ignorado: true });
    expect(nucleo.sincronizacao.obsidian_sync).toBe(true);
    expect(nucleo.clientes).toEqual(["Claude Code"]);
    expect(nucleo.modulos).toEqual([expect.objectContaining({ id: "ai-templates", nome: "AI Templates", registrado: true })]);
    expect(nucleo.scripts_no_cofre).toEqual([
      { pasta: "tools", arquivos: 4, linguagens: ["bash", "powershell"] },
      { pasta: "misc", arquivos: 1, linguagens: ["node"] },
    ]);
    expect(nucleo.hooks).toMatchObject({ arquivo_settings: "settings.local.json", node: true });
    expect(nucleo.hooks.modos).toEqual({ "ai-vault-search": "bloquear", "environment-variables": "bloquear", "ai-scripts": "bloquear", "ai-templates": "bloquear", "ai-git-tools": "avisar" });
    expect(JSON.stringify(nucleo)).not.toMatch(/tokenHash|Bearer/);
  });

  it("reports the CLAUDE.md state and the permission the user gave", async () => {
    const r = await startRig({ prepare: (vault) => writeFile(vault, "CLAUDE.md", `# mine\n\n${BLOCK_START}\nold\n${BLOCK_END}\n`) });
    let status = await setupStatus(r, "ai-ecosystem");
    expect(status.claude_md).toMatchObject({ existe: true, tem_bloco: true });
    expect(status.claude_md.caminho.replace(/\\/g, "/")).toMatch(/\/CLAUDE\.md$/);
    expect(status.claude_md.permissao).toBeUndefined();

    await setupSave(r, "ai-ecosystem", "claude_md", "permitido");
    await installFromCatalog(r, "ai-templates", "AI Templates");
    status = await setupStatus(r, "ai-templates");
    expect(status.claude_md.permissao).toBe("permitido");
  });

  it("a module installed after another gets a block that lists both", async () => {
    const r = await startRig();
    await configureCore(r);
    await installFromCatalog(r, "ai-scripts", "AI Scripts");
    expect((await setupStatus(r, "ai-scripts")).bloco_claude_md).not.toContain("create_note_from_template");
    await callTool(r, "ecosystem_setup_complete", { modulo: "ai-scripts" });

    await installFromCatalog(r, "ai-templates", "AI Templates");
    const block = (await setupStatus(r, "ai-templates")).bloco_claude_md as string;
    expect(block).toContain("run_ai_script");
    expect(block).toContain("create_note_from_template");
    expect(block).toContain("ecosystem_status");
    expect(block).not.toContain("telegram_send_message");
  });

  it("refuses an unknown module", async () => {
    const r = await startRig();
    const res = await callTool(r, "ecosystem_setup_status", { modulo: "nope" });
    expect(res.isError).toBe(true);
    expect(res.data.erro).toContain("nope");
    expect((await callTool(r, "ecosystem_setup_status", {})).isError).toBe(true);
  });

  it("marks which tools of the module Claude Code can see", async () => {
    const r = await startRig();
    await configureCore(r);
    await installFromCatalog(r, "ai-templates", "AI Templates");
    expect((await setupStatus(r, "ai-templates")).tools_do_modulo).toEqual([{ nome: "ai_templates_ok", visivel_para_claude_code: false }]);
    await callTool(r, "ecosystem_setup_complete", { modulo: "ai-templates" });
    expect((await setupStatus(r, "ai-templates")).tools_do_modulo).toEqual([{ nome: "ai_templates_ok", visivel_para_claude_code: true }]);
    await claudeSession(r);
  });

  it("a configured module leaves out the questions and the usage block, with a note, unless completo is true", async () => {
    const r = await startRig();
    await configureCore(r);
    await installFromCatalog(r, "ai-templates", "AI Templates");
    expect((await callTool(r, "ecosystem_setup_complete", { modulo: "ai-templates" })).isError).toBe(false);

    const compact = await setupStatus(r, "ai-templates");
    expect(compact.estado).toBe("configurado");
    expect(compact).not.toHaveProperty("perguntas");
    expect(compact).not.toHaveProperty("bloco_claude_md");
    expect(compact.nota).toContain("completo: true");
    expect(compact.tools_do_modulo).toEqual([{ nome: "ai_templates_ok", visivel_para_claude_code: true }]);

    const full = await setupStatus(r, "ai-templates", true);
    expect(full.perguntas.length).toBeGreaterThan(0);
    expect(full.bloco_claude_md.startsWith(BLOCK_START)).toBe(true);
    expect(full.bloco_claude_md.endsWith(BLOCK_END)).toBe(true);
    expect(full.nota).toBeUndefined();
  });

  it("a pending module gets the questions and the usage block, with no note", async () => {
    const r = await startRig();
    await installFromCatalog(r, "ai-templates", "AI Templates");
    const status = await setupStatus(r, "ai-templates");
    expect(status.estado).toBe("pendente_configuracao");
    expect(status.perguntas.length).toBeGreaterThan(0);
    expect(status.bloco_claude_md.startsWith(BLOCK_START)).toBe(true);
    expect(status.nota).toBeUndefined();
  });
});

describe("ecosystem_setup_save: core keys", () => {
  it("moves the hook entries when the settings file changes, and refuses other files", async () => {
    const r = await startRig();
    expect(hasHook(r, "ai-ecosystem", "falha", "settings.local.json")).toBe(true);

    const saved = await setupSave(r, "ai-ecosystem", "arquivo_settings", "settings.json");
    expect(saved.isError).toBe(false);
    expect(hasHook(r, "ai-ecosystem", "falha", "settings.json")).toBe(true);
    expect(hasHook(r, "ai-ecosystem", "setup", "settings.json")).toBe(true);
    expect(hookCommands(r, "settings.local.json")).toEqual([]);
    expect(stateFile(r, "config.json").settingsFile).toBe("settings.json");
    expect(stateFile(r, "modules/ai-ecosystem.json").respostas.arquivo_settings).toBe("settings.json");

    expect((await setupSave(r, "ai-ecosystem", "arquivo_settings", "outro.json")).isError).toBe(true);
    expect(stateFile(r, "config.json").settingsFile).toBe("settings.json");
  });

  it("writes the hook mode of every protection module, and per module on any module", async () => {
    const r = await startRig();
    expect((await setupSave(r, "ai-ecosystem", "modo_hooks", "avisar")).isError).toBe(false);
    expect(stateFile(r, "config.json").modos).toEqual({
      "ai-vault-search": "avisar",
      "environment-variables": "avisar",
      "ai-scripts": "avisar",
      "ai-templates": "avisar",
    });

    await installFromCatalog(r, "ai-scripts", "AI Scripts");
    expect((await setupSave(r, "ai-scripts", "modo_hooks", "off")).isError).toBe(false);
    expect(stateFile(r, "config.json").modos["ai-scripts"]).toBe("off");
    expect(stateFile(r, "config.json").modos["ai-templates"]).toBe("avisar");
    expect(stateFile(r, "modules/ai-scripts.json").respostas.modo_hooks).toBe("off");

    expect((await setupSave(r, "ai-ecosystem", "modo_hooks", "talvez")).isError).toBe(true);
  });

  it("keeps AI Git Tools on its own default (avisar) when the core picks bloquear, until the module answers", async () => {
    const r = await startRig();
    await configureCore(r); // modo_hooks "bloquear" for every module
    expect(stateFile(r, "config.json").modos["ai-scripts"]).toBe("bloquear");
    expect(stateFile(r, "config.json").modos["ai-git-tools"]).toBeUndefined();

    await installFromCatalog(r, "ai-git-tools", "AI Git Tools");
    expect((await callTool(r, "ecosystem_setup_complete", { modulo: "ai-git-tools" })).isError).toBe(false);
    expect(stateFile(r, "config.json").modos["ai-git-tools"]).toBe("avisar");
    expect(hasProtection(r, "ai-git-tools")).toBe(true);
    expect(hasHook(r, "ai-ecosystem", "despacho")).toBe(true);
    expect(hookCommands(r).some((c: string) => c.endsWith("ai-git-tools aprovacao"))).toBe(false);
  });

  it("puts AI Git Tools on bloquear when the module itself answers bloquear", async () => {
    const r = await startRig();
    await configureCore(r);
    await installFromCatalog(r, "ai-git-tools", "AI Git Tools");
    expect((await setupSave(r, "ai-git-tools", "modo_hooks", "bloquear")).isError).toBe(false);
    expect((await callTool(r, "ecosystem_setup_complete", { modulo: "ai-git-tools" })).isError).toBe(false);
    expect(stateFile(r, "config.json").modos["ai-git-tools"]).toBe("bloquear");
  });

  it("validates agentes and claude_md and refuses unknown core keys", async () => {
    const r = await startRig();
    expect((await setupSave(r, "ai-ecosystem", "agentes", [])).isError).toBe(true);
    expect((await setupSave(r, "ai-ecosystem", "agentes", "claude-code")).isError).toBe(true);
    expect((await setupSave(r, "ai-ecosystem", "agentes", ["claude-code", " codex "])).isError).toBe(false);
    expect(stateFile(r, "modules/ai-ecosystem.json").respostas.agentes).toEqual(["claude-code", " codex "]);
    expect((await setupSave(r, "ai-ecosystem", "claude_md", "talvez")).isError).toBe(true);
    expect((await setupSave(r, "ai-ecosystem", "claude_md", "criar")).isError).toBe(false);
    const unknown = await setupSave(r, "ai-ecosystem", "qualquer", 1);
    expect(unknown.isError).toBe(true);
    expect(unknown.data.erro).toContain("Unknown key");
    expect(stateFile(r, "modules/ai-ecosystem.json").respostas.qualquer).toBeUndefined();
  });

  it("pastas_permitidas, while AI Scripts is pending, adds the folders, saves, tells the user and logs it", async () => {
    const r = await startRig({
      prepare: (vault) => {
        for (const dir of ["Scripts", "tools/py", "bin"]) fs.mkdirSync(path.join(vault, ...dir.split("/")), { recursive: true });
      },
    });
    r.settings.scripts.allowedFolders = ["Scripts"];
    await installFromCatalog(r, "ai-scripts", "AI Scripts");

    const saved = await setupSave(r, "ai-scripts", "pastas_permitidas", ["tools\\py", "Scripts", "bin/"]);
    expect(saved.isError).toBe(false);
    expect(r.settings.scripts.allowedFolders).toEqual(["Scripts", "tools/py", "bin"]);
    expect(r.saves).toBe(1);
    expect(r.announced).toEqual([["tools/py", "bin"]]);
    expect(stateFile(r, "modules/ai-scripts.json").respostas.pastas_permitidas).toEqual(["tools\\py", "Scripts", "bin/"]);

    const entry = r.eco.logger.entries().find((e) => e.target.includes("pastas_permitidas"));
    expect(entry).toMatchObject({ kind: "module", moduleId: "ai-ecosystem", method: "Setup", status: 200 });
    expect(JSON.parse(String(entry?.payload))).toEqual({ added: ["tools/py", "bin"] });

    // Nothing new: no second notice, no second save.
    expect((await setupSave(r, "ai-scripts", "pastas_permitidas", ["Scripts"])).isError).toBe(false);
    expect(r.announced).toHaveLength(1);
    expect(r.saves).toBe(1);
  });

  it("pastas_permitidas is refused once AI Scripts is configured, pointing to the settings", async () => {
    const r = await startRig({ prepare: (vault) => fs.mkdirSync(path.join(vault, "tools")) });
    await configureCore(r);
    await installFromCatalog(r, "ai-scripts", "AI Scripts");
    expect((await callTool(r, "ecosystem_setup_complete", { modulo: "ai-scripts" })).isError).toBe(false);

    const refused = await setupSave(r, "ai-scripts", "pastas_permitidas", ["tools"]);
    expect(refused.isError).toBe(true);
    expect(refused.data.erro).toContain("AI Ecosystem settings");
    expect(r.settings.scripts.allowedFolders).toEqual([]);
    expect(r.announced).toEqual([]);
    expect(r.saves).toBe(0);
    expect(r.eco.logger.entries().some((e) => e.target.includes("pastas_permitidas"))).toBe(false);
  });

  it("pastas_permitidas refuses a folder that is absolute, outside, the root, protected, missing or a file", async () => {
    const r = await startRig({
      prepare: (vault) => {
        fs.mkdirSync(path.join(vault, "ok"));
        fs.mkdirSync(path.join(vault, ".claude", "hooks"), { recursive: true });
        fs.mkdirSync(path.join(vault, ".obsidian", "plugins"), { recursive: true });
        fs.writeFileSync(path.join(vault, "a-file"), "x");
      },
    });
    await installFromCatalog(r, "ai-scripts", "AI Scripts");
    const bad = ["C:\\Windows", "/etc", "\\\\server\\share", "../outside", "ok/../../x", ".", "", "  ", ".claude", ".claude/hooks", ".Obsidian/plugins", "missing", "a-file"];
    for (const folder of bad) {
      const res = await setupSave(r, "ai-scripts", "pastas_permitidas", ["ok", folder]);
      expect(res.isError, JSON.stringify(folder)).toBe(true);
      expect(res.data.erro).toMatch(/is not accepted|no empty entries/);
    }
    // One bad entry refuses the whole answer: not even "ok" was added.
    expect(r.settings.scripts.allowedFolders).toEqual([]);
    expect(r.announced).toEqual([]);
    expect((await setupSave(r, "ai-scripts", "pastas_permitidas", "ok")).isError).toBe(true);
    expect((await setupSave(r, "ai-scripts", "pastas_permitidas", ["ok"])).isError).toBe(false);
    expect(r.settings.scripts.allowedFolders).toEqual(["ok"]);
  });

  it("saves several answers in one call, in order, and lists them in salvas", async () => {
    const r = await startRig();
    const res = await callTool(r, "ecosystem_setup_save", { modulo: "ai-ecosystem", respostas: { agentes: ["claude-code"], modo_hooks: "avisar", claude_md: "permitido" } });
    expect(res.isError).toBe(false);
    expect(res.data).toEqual({ ok: true, modulo: "ai-ecosystem", salvas: ["agentes", "modo_hooks", "claude_md"] });
    const answers = stateFile(r, "modules/ai-ecosystem.json").respostas;
    expect(answers).toMatchObject({ agentes: ["claude-code"], modo_hooks: "avisar", claude_md: "permitido" });
    expect(stateFile(r, "config.json").modos["ai-vault-search"]).toBe("avisar");
  });

  it("a refused answer does not stop the others: the valid ones are saved, the refused one is listed in recusadas", async () => {
    const r = await startRig();
    const res = await callTool(r, "ecosystem_setup_save", { modulo: "ai-ecosystem", respostas: { agentes: ["claude-code"], modo_hooks: "x", claude_md: "criar" } });
    expect(res.isError).toBe(true);
    expect(res.data.ok).toBe(false);
    expect(res.data.salvas).toEqual(["agentes", "claude_md"]);
    expect(Object.keys(res.data.recusadas)).toEqual(["modo_hooks"]);
    expect(res.data.recusadas.modo_hooks).toContain("modo_hooks must be one of");
    const answers = stateFile(r, "modules/ai-ecosystem.json").respostas;
    expect(answers.agentes).toEqual(["claude-code"]);
    expect(answers.claude_md).toBe("criar");
    expect(answers.modo_hooks).toBeUndefined();
  });

  it("refuses respostas together with chave or valor, and an empty respostas", async () => {
    const r = await startRig();
    const both = await callTool(r, "ecosystem_setup_save", { modulo: "ai-ecosystem", chave: "claude_md", valor: "criar", respostas: { agentes: ["claude-code"] } });
    expect(both.isError).toBe(true);
    expect(both.data.erro).toContain("not both");
    expect(stateFile(r, "modules/ai-ecosystem.json")?.respostas?.agentes).toBeUndefined();

    const empty = await callTool(r, "ecosystem_setup_save", { modulo: "ai-ecosystem", respostas: {} });
    expect(empty.isError).toBe(true);
    expect(empty.data.erro).toContain("1 to 20");
  });

  it("keeps the single chave and valor answer as it was", async () => {
    const r = await startRig();
    const res = await setupSave(r, "ai-ecosystem", "claude_md", "criar");
    expect(res.isError).toBe(false);
    expect(res.data).toEqual({ ok: true, modulo: "ai-ecosystem", chave: "claude_md" });
  });
});

describe("ecosystem_setup_save: modules", () => {
  it("hands the answer to the module and stores it, or relays the refusal", async () => {
    const r = await startRig();
    await installFromCatalog(r, "ai-templates", "AI Templates");
    const save = vi.fn(async (key: string, value: unknown) => (key === "regra_de_colisao" && value === "x" ? "regra_de_colisao must be one of: incremental" : undefined));
    registerHandler(r, "ai-templates", { save });

    expect((await setupSave(r, "ai-templates", "pasta_de_templates", "Templates")).isError).toBe(false);
    expect(save).toHaveBeenCalledWith("pasta_de_templates", "Templates");
    expect(stateFile(r, "modules/ai-templates.json").respostas.pasta_de_templates).toBe("Templates");

    const refused = await setupSave(r, "ai-templates", "regra_de_colisao", "x");
    expect(refused.isError).toBe(true);
    expect(refused.data.erro).toBe("regra_de_colisao must be one of: incremental");
    expect(stateFile(r, "modules/ai-templates.json").respostas.regra_de_colisao).toBeUndefined();
  });

  it("keeps the answers that only steer the interview away from the module", async () => {
    const r = await startRig();
    await installFromCatalog(r, "ai-scripts", "AI Scripts");
    const save = vi.fn(async () => "Unknown key");
    registerHandler(r, "ai-scripts", { save });
    expect((await setupSave(r, "ai-scripts", "migrar_scripts", "sim")).isError).toBe(false);
    expect(save).not.toHaveBeenCalled();
    expect(stateFile(r, "modules/ai-scripts.json").respostas.migrar_scripts).toBe("sim");
  });

  it("only stores the answer when the module has no handler (an older version)", async () => {
    const r = await startRig();
    await installFromCatalog(r, "ai-vault-search", "AI Vault Search");
    expect((await setupSave(r, "ai-vault-search", "pastas_fora_do_indice", ["Anexos"])).isError).toBe(false);
    expect(stateFile(r, "modules/ai-vault-search.json").respostas.pastas_fora_do_indice).toEqual(["Anexos"]);
  });

  it("refuses a module that is unknown or turned off, and a missing key or value", async () => {
    const r = await startRig();
    expect((await setupSave(r, "nope", "a", 1)).isError).toBe(true);
    expect((await callTool(r, "ecosystem_setup_save", { modulo: "ai-ecosystem", chave: "agentes" })).isError).toBe(true);
    expect((await callTool(r, "ecosystem_setup_save", { modulo: "ai-ecosystem", valor: 1 })).isError).toBe(true);

    await installFromCatalog(r, "ai-scripts", "AI Scripts");
    r.enabled.delete("ai-scripts");
    r.eco.api.unregisterModule("ai-scripts");
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect((await setupSave(r, "ai-scripts", "pode_gravar_fora_do_cofre", true)).isError).toBe(true);
  });

  it("the settings file written by the tools stays valid JSON next to the user's own hooks", async () => {
    const r = await startRig({
      prepare: (vault) =>
        writeFile(vault, ".claude/settings.local.json", JSON.stringify({ permissions: { allow: ["Bash(ls)"] }, hooks: { SessionStart: [{ hooks: [{ type: "command", command: "echo mine" }] }] } })),
    });
    await installFromCatalog(r, "ai-scripts", "AI Scripts");
    const settings = settingsFile(r);
    expect(settings.permissions).toEqual({ allow: ["Bash(ls)"] });
    expect(settings.hooks.SessionStart[0].hooks[0].command).toBe("echo mine");
    expect(fs.readdirSync(path.join(r.vault, ".claude", "ai-ecosystem", "backups")).length).toBeGreaterThan(0);
  });
});

describe("a module that does not answer", () => {
  it("does not freeze the status or the completion", async () => {
    const r = await startRig({ handlerTimeoutMs: 50 });
    await configureCore(r);
    await installFromCatalog(r, "ai-vault-search", "AI Vault Search");
    const never = new Promise<never>(() => undefined);
    registerHandler(r, "ai-vault-search", { detect: () => never, validate: () => never });

    const status = await setupStatus(r, "ai-vault-search");
    expect(status.detectado.modulo.erro_na_deteccao).toContain("detect() did not answer");
    expect(pending(status)).toEqual(["pastas_fora_do_indice"]);

    const refused = await callTool(r, "ecosystem_setup_complete", { modulo: "ai-vault-search" });
    expect(refused.isError).toBe(true);
    expect(refused.data.faltando[0]).toContain("validate() did not answer");
  });
});

describe("setup tools in tools/list (modo completo)", () => {
  const SETUP_TOOLS = ["ecosystem_setup_status", "ecosystem_setup_save", "ecosystem_setup_complete"];
  const setupNames = (names: string[]) => names.filter((name) => name.startsWith("ecosystem_setup_"));

  it("lists the three core setup tools while the core is not configured", async () => {
    const r = await startRig();
    expect(setupNames(await toolNames(r))).toEqual(SETUP_TOOLS);
  });

  it("leaves them out of tools/list once nothing is pending", async () => {
    const r = await startRig();
    await configureCore(r);
    expect(setupNames(await toolNames(r))).toEqual([]);
  });

  it("still runs them by name while they are left out of tools/list", async () => {
    const r = await startRig();
    await configureCore(r);
    expect(setupNames(await toolNames(r))).toEqual([]);
    const status = await callTool(r, "ecosystem_setup_status", { modulo: "ai-ecosystem" });
    expect(status.isError).toBe(false);
    expect(status.data.modulo).toBe("ai-ecosystem");
  });

  it("brings them back once a module is installed from the catalog", async () => {
    const r = await startRig();
    await configureCore(r);
    expect(setupNames(await toolNames(r))).toEqual([]);
    await installFromCatalog(r, "ai-templates", "AI Templates");
    expect(setupNames(await toolNames(r))).toEqual(SETUP_TOOLS);
  });

  it("tells the clients the list changed as soon as a catalog install begins", async () => {
    const r = await startRig();
    await configureCore(r);
    const notify = vi.spyOn(r.eco.server, "notifyListChanged");
    r.eco.setup!.beginCatalogInstall("ai-templates", "AI Templates");
    expect(notify).toHaveBeenCalledWith("tools");
    expect(setupNames(await toolNames(r))).toEqual(SETUP_TOOLS);
  });
});
