import { describe, expect, it } from "vitest";
import { buildQuestions, steeringKeys } from "../../src/setup/questions";
import type { QuestionContext } from "../../src/setup/questions";
import { buildSkill, skillName } from "../../src/setup/skill-texts";

const ctx = (module: Record<string, unknown>): QuestionContext => ({
  core: { claude_md: false, scripts_no_cofre: [], clientes: [] } as never,
  module,
  allowedScriptFolders: [],
});

describe("AI Log Manager setup", () => {
  it("writes its own skill in both languages, with the common part", () => {
    expect(skillName("ai-log-manager")).toBe("configurar-ai-log-manager");
    const pt = buildSkill("ai-log-manager", "AI Log Manager", "pt");
    const en = buildSkill("ai-log-manager", "AI Log Manager", "en");
    expect(pt).toContain("name: configurar-ai-log-manager");
    expect(pt).toContain("`modo_dos_logs`");
    expect(pt).toContain("ecosystem_setup_status");
    expect(pt).not.toContain("{{");
    expect(en).toContain("name: configurar-ai-log-manager");
    expect(en).toContain('modulo: "ai-log-manager"');
    expect(en).not.toContain("{{");
  });

  it("asks the six questions, recommending observe when logs already exist", () => {
    const views = buildQuestions("ai-log-manager", ctx({ existingLogs: 12, projectsWithClone: ["App"], projectsRoot: "Projetos", projectsRootExists: true, hooksInstalled: false }), {}, "pt");
    expect(views.map((q) => q.chave)).toEqual(["modo_dos_logs", "pastas_acompanhadas", "registrar_eventos_dev", "ler_remoto", "instalar_hooks", "pasta_dos_projetos"]);
    const mode = views[0]!;
    expect(mode.opcoes!.find((o) => o.recomendada)!.valor).toBe("observe");
    expect(views[2]!.opcoes!.find((o) => o.recomendada)!.valor).toBe("true");
    expect(views[3]!.opcoes!.find((o) => o.recomendada)!.valor).toBe("false");
    expect(views[5]).toMatchObject({ detectada: true, valor_detectado: "Projetos" });
    expect(views[4]!.detectada).toBe(false);
    expect(views.every((q) => q.salvar)).toBe(true);
    expect(steeringKeys("ai-log-manager")).toEqual([]);
  });

  it("recommends active on a vault without logs, and detects installed hooks", () => {
    const views = buildQuestions("ai-log-manager", ctx({ existingLogs: 0, projectsWithClone: [], hooksInstalled: true, projectsRootExists: false }), { ler_remoto: "false" }, "en");
    expect(views[0]!.opcoes!.find((o) => o.recomendada)!.valor).toBe("active");
    expect(views[2]!.opcoes!.find((o) => o.recomendada)!.valor).toBe("false");
    expect(views[4]).toMatchObject({ detectada: true, valor_detectado: true });
    expect(views[3]!.ja_respondida).toBe(true);
    expect(views[5]!.detectada).toBe(false);
  });
});
