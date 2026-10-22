// The AI Git Tools setup in the core: its skill, its questions (secrets listed with no recommended
// option, no suggestion and a "none" option), its guide rows, and a setup that finishes with no secret.
import { afterEach, describe, expect, it } from "vitest";
import { buildGuideBlock } from "../../src/setup/guide-block";
import { buildQuestions, NO_SECRET, steeringKeys } from "../../src/setup/questions";
import type { QuestionContext, QuestionView } from "../../src/setup/questions";
import { buildSkill, skillName } from "../../src/setup/skill-texts";
import { configureCore, enableModule, hasHook, registerHandler, setupComplete, setupSave, setupStatus, skillText, startRig, stateFile, stopRigs } from "./helpers";

afterEach(stopRigs);

const ctx = (module: Record<string, unknown>): QuestionContext => ({
  core: { claude_md: false, scripts_no_cofre: [], clientes: [] } as never,
  module,
  allowedScriptFolders: [],
});

// Fictitious names only: no secret value ever reaches the setup.
const THREE_SECRETS = [
  { name: "FAKE_BB", type: "bearer", hasUsername: false, allowedHosts: ["api.bitbucket.org"], allowAnyHost: false, approval: "none" },
  { name: "FAKE_GH", type: "bearer", hasUsername: false, allowedHosts: ["api.github.com"], allowAnyHost: false, approval: "none" },
  { name: "FAKE_ANY", type: "basic", hasUsername: true, allowedHosts: [], allowAnyHost: true, approval: "writes" },
];

const byKey = (views: QuestionView[], key: string): QuestionView => {
  const found = views.find((q) => q.chave === key);
  if (!found) throw new Error(`no question ${key}`);
  return found;
};

describe("AI Git Tools skill", () => {
  it("has its own text in both languages, with the common part and no placeholder left", () => {
    expect(skillName("ai-git-tools")).toBe("configurar-ai-git-tools");
    for (const lang of ["pt", "en"] as const) {
      const text = buildSkill("ai-git-tools", "AI Git Tools", lang);
      expect(text.startsWith("---\nname: configurar-ai-git-tools\n")).toBe(true);
      expect(text).toContain("ecosystem_setup_status");
      expect(text).toContain('modulo: "ai-git-tools"');
      for (const key of ["`modo_hooks`", "`secret_bitbucket`", "`secret_github`", "`pasta_dos_projetos`", "`claude_md`", "`nenhuma`", "env_criar_secret"]) {
        expect(text).toContain(key);
      }
      expect(text).not.toContain("{{");
      // Not the generic text.
      expect(text).not.toBe(buildSkill("some-unknown-module", "AI Git Tools", lang));
    }
    expect(buildSkill("ai-git-tools", "AI Git Tools", "pt")).toContain("Nenhuma (configurar depois)");
    expect(buildSkill("ai-git-tools", "AI Git Tools", "en")).toContain("None (set it up later)");
  });
});

describe("AI Git Tools questions", () => {
  it("asks in the contract order, all saved, warn recommended", () => {
    const views = buildQuestions("ai-git-tools", ctx({}), {}, "pt");
    expect(views.map((q) => q.chave)).toEqual(["modo_hooks", "secret_bitbucket", "secret_github", "pasta_dos_projetos"]);
    expect(views.every((q) => q.salvar)).toBe(true);
    expect(steeringKeys("ai-git-tools")).toEqual([]);
    const mode = byKey(views, "modo_hooks");
    expect(mode.opcoes!.map((o) => o.valor)).toEqual(["avisar", "bloquear", "off"]);
    expect(mode.opcoes!.filter((o) => o.recomendada).map((o) => o.valor)).toEqual(["avisar"]);
  });

  it("lists the three detected secrets plain (names only), none recommended, no suggestion, plus none", () => {
    const views = buildQuestions("ai-git-tools", ctx({ secrets: ["FAKE_A", "FAKE_B", "FAKE_C"] }), {}, "pt");
    for (const key of ["secret_bitbucket", "secret_github"]) {
      const q = byKey(views, key);
      expect(q.tipo).toBe("unica");
      expect(q.opcoes!.map((o) => o.valor)).toEqual(["FAKE_A", "FAKE_B", "FAKE_C", NO_SECRET]);
      expect(q.opcoes!.some((o) => o.recomendada)).toBe(false);
      expect(q.opcoes!.every((o) => !("recomendada" in o))).toBe(true);
      expect(q).not.toHaveProperty("sugestao");
      expect(q.detectada).toBe(false);
      expect(q.opcoes!.at(-1)!.rotulo).toBe("Nenhuma (configurar depois)");
    }
  });

  it("filters the metadata rows by provider host, keeping the ones open to any host", () => {
    const views = buildQuestions("ai-git-tools", ctx({ secrets: THREE_SECRETS }), {}, "en");
    expect(byKey(views, "secret_bitbucket").opcoes!.map((o) => o.valor)).toEqual(["FAKE_BB", "FAKE_ANY", NO_SECRET]);
    expect(byKey(views, "secret_github").opcoes!.map((o) => o.valor)).toEqual(["FAKE_GH", "FAKE_ANY", NO_SECRET]);
    const github = byKey(views, "secret_github");
    expect(github.opcoes![0]!.rotulo).toBe("FAKE_GH (bearer)");
    expect(github.opcoes!.at(-1)!.rotulo).toBe("None (set it up later)");
    expect(github.opcoes!.some((o) => o.recomendada)).toBe(false);
    expect(github).not.toHaveProperty("sugestao");
  });

  it("accepts hosts written as URLs or wildcards, and offers only 'none' when nothing fits or nothing was found", () => {
    const rows = [
      { name: "FAKE_URL", allowedHosts: ["https://api.github.com/repos"], allowAnyHost: false },
      { name: "FAKE_WILD", allowedHosts: ["*.bitbucket.org"], allowAnyHost: false },
      { name: "FAKE_JIRA", allowedHosts: ["example.atlassian.net"], allowAnyHost: false },
    ];
    const views = buildQuestions("ai-git-tools", ctx({ secrets: rows }), {}, "pt");
    expect(byKey(views, "secret_github").opcoes!.map((o) => o.valor)).toEqual(["FAKE_URL", NO_SECRET]);
    expect(byKey(views, "secret_bitbucket").opcoes!.map((o) => o.valor)).toEqual(["FAKE_WILD", NO_SECRET]);

    const empty = buildQuestions("ai-git-tools", ctx({ secrets: [] }), {}, "pt");
    expect(byKey(empty, "secret_github").opcoes!.map((o) => o.valor)).toEqual([NO_SECRET]);
    const garbage = buildQuestions("ai-git-tools", ctx({ secrets: "not a list" }), {}, "pt");
    expect(byKey(garbage, "secret_bitbucket").opcoes!.map((o) => o.valor)).toEqual([NO_SECRET]);
  });

  it("detects the projects folder only when it exists, and marks answered questions", () => {
    const found = buildQuestions("ai-git-tools", ctx({ projectsRoot: "Projetos", projectsRootExists: true }), { secret_github: NO_SECRET }, "pt");
    expect(byKey(found, "pasta_dos_projetos")).toMatchObject({ detectada: true, valor_detectado: "Projetos" });
    expect(byKey(found, "pasta_dos_projetos")).not.toHaveProperty("sugestao");
    expect(byKey(found, "secret_github").ja_respondida).toBe(true);
    expect(byKey(found, "secret_bitbucket").ja_respondida).toBe(false);

    const missing = buildQuestions("ai-git-tools", ctx({ projectsRoot: "Projetos", projectsRootExists: false }), {}, "pt");
    expect(byKey(missing, "pasta_dos_projetos").detectada).toBe(false);
  });
});

describe("AI Git Tools guide rows", () => {
  it("adds the three rows in both languages, keeps the dev_* row of the Log Manager, and gives advice to clients without hooks", () => {
    const pt = buildGuideBlock({ lang: "pt", modules: ["ai-git-tools", "ai-log-manager"], target: "claude" });
    expect(pt).toContain("| Commit, push, branch, merge, stash e tag | AI Git Tools |");
    expect(pt).toContain("| Abrir, listar, comentar e mesclar PR; ver pipeline | AI Git Tools |");
    expect(pt).toContain("| Grafo, changelog e eventos de projeto | AI Git Tools |");
    for (const tool of ["git_commit", "git_push", "git_pr_criar", "git_pr_merge", "git_pipeline_status", "git_graph", "git_changelog", "git_sync", "git_registrar_evento"]) {
      expect(pt).toContain(`\`${tool}\``);
    }
    expect(pt).toContain("`dev_sync`");
    expect(pt).not.toContain("Como usar sem hooks");

    const en = buildGuideBlock({ lang: "en", modules: ["ai-git-tools"], target: "gemini" });
    expect(en).toContain("| Commit, push, branch, merge, stash and tag | AI Git Tools |");
    expect(en).toContain("| Open, list, comment on and merge a PR; see the pipeline | AI Git Tools |");
    expect(en).toContain("| Graph, changelog and project events | AI Git Tools |");
    expect(en).toContain("For git and for the GitHub and Bitbucket APIs, use the AI Git Tools tools");

    const without = buildGuideBlock({ lang: "pt", modules: [], target: "claude" });
    expect(without).not.toContain("AI Git Tools");
  });
});

describe("AI Git Tools setup without a secret", () => {
  it("finishes with 'none' for both secrets: the temporary hook goes away and the module is configured", async () => {
    const r = await startRig();
    await configureCore(r);

    const saved: Record<string, unknown> = {};
    r.eco.setup!.beginCatalogInstall("ai-git-tools", "AI Git Tools");
    enableModule(r, "ai-git-tools", "AI Git Tools");
    registerHandler(r, "ai-git-tools", {
      detect: async () => ({ secrets: THREE_SECRETS, projectsRoot: "Projetos", projectsRootExists: true }),
      // Like the module will do: "nenhuma" becomes an empty string.
      save: async (key, value) => {
        saved[key] = value === NO_SECRET ? "" : value;
      },
      // The contract: ok whenever the projects folder exists; an empty secret never blocks.
      validate: async () => ({ ok: true }),
    });
    await r.eco.setup!.finishCatalogInstall("ai-git-tools", true);
    await r.eco.setup!.whenIdle();

    expect(skillText(r, "ai-git-tools")?.startsWith("---\nname: configurar-ai-git-tools\n")).toBe(true);
    expect(hasHook(r, "ai-git-tools", "setup")).toBe(true);

    const status = await setupStatus(r, "ai-git-tools");
    const github = (status.perguntas as QuestionView[]).find((q) => q.chave === "secret_github")!;
    expect(github.opcoes!.map((o) => o.valor)).toEqual(["FAKE_GH", "FAKE_ANY", NO_SECRET]);
    expect(github.opcoes!.some((o) => o.recomendada)).toBe(false);

    for (const [key, value] of [
      ["modo_hooks", "avisar"],
      ["secret_bitbucket", NO_SECRET],
      ["secret_github", NO_SECRET],
      ["pasta_dos_projetos", "Projetos"],
    ] as const) {
      const result = await setupSave(r, "ai-git-tools", key, value);
      expect(result.isError, result.text).toBe(false);
    }
    expect(saved).toEqual({ secret_bitbucket: "", secret_github: "", pasta_dos_projetos: "Projetos" });

    const done = await setupComplete(r, "ai-git-tools");
    expect(done.isError, done.text).toBe(false);
    expect(hasHook(r, "ai-git-tools", "setup")).toBe(false);
    expect(stateFile(r, "modules/ai-git-tools.json")).toMatchObject({ estado: "configurado" });
  });
});
