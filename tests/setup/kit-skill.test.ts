// The /kit welcome skill: valid and generic text, installed with the core, idempotent, and never
// written over a file the user edited.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SkillFiles } from "../../src/setup/skill-files";
import { KIT_SKILL_PATH, buildKitSkill } from "../../src/setup/skill-texts";
import { startRig, stopRigs } from "./helpers";

afterEach(stopRigs);

const EMOJI = /\p{Extended_Pictographic}/u;

function tmpVault(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "aie-kit-"));
}

describe("the kit skill text", () => {
  it.each(["pt", "en"] as const)("%s: valid frontmatter, triggers, no emoji and no placeholder", (lang) => {
    const text = buildKitSkill(lang);
    const lines = text.split("\n");
    expect(lines[0]).toBe("---");
    expect(lines[1]).toBe("name: kit");
    expect(lines[2]).toMatch(/^description: ".{40,}"$/);
    expect(lines[2]!.slice(14, -1)).not.toContain('"');
    expect(lines[3]).toBe("---");
    expect(lines[2]).toContain("/kit");
    expect(EMOJI.test(text)).toBe(false);
    expect(text).not.toMatch(/\{\{\w+\}\}/);
    expect(text.endsWith("\n")).toBe(true);
    for (const word of ["ecosystem_diagnostico", "list_templates", "list_ai_scripts", "nota_diaria", "links_quebrados", "backup_cofre", "dry_run", "search", "find", "get_section"]) {
      expect(text, word).toContain(word);
    }
  });

  it("pt: the triggers, the choose-before-run rule and the omit-what-is-missing rule", () => {
    const text = buildKitSkill("pt");
    for (const phrase of ["por onde começar", "o que a suíte faz", "primeiros passos", "mostrar o que está instalado"]) expect(text).toContain(phrase);
    expect(text).toContain("**Não execute nada ainda.**");
    expect(text).toContain("grave fora do cofre ou envie mensagem");
    expect(text).toContain("deve ser omitido");
  });

  it("is generic: no company, client or person name", () => {
    for (const lang of ["pt", "en"] as const) {
      expect(buildKitSkill(lang)).not.toMatch(/csp|telecall|a5x|fgc|everllence|emanuell|jira|bitbucket/i);
    }
  });
});

describe("installing the kit skill", () => {
  it("writes it once, and a second run changes nothing", () => {
    const files = new SkillFiles(tmpVault());
    const text = buildKitSkill("en");
    expect(files.kitExists()).toBe(false);
    expect(files.writeKit(text)).toBe(true);
    const first = fs.readFileSync(files.kitFile, "utf8");
    expect(first.startsWith(text)).toBe(true);
    expect(files.writeKit(text)).toBe(false);
    expect(fs.readFileSync(files.kitFile, "utf8")).toBe(first);
  });

  it("never overwrites a file the user edited", () => {
    const files = new SkillFiles(tmpVault());
    files.writeKit(buildKitSkill("en"));
    const edited = fs.readFileSync(files.kitFile, "utf8").replace("# Welcome kit", "# My own kit");
    fs.writeFileSync(files.kitFile, edited);
    expect(files.writeKit(buildKitSkill("en"))).toBe(false);
    expect(files.writeKit(buildKitSkill("pt"))).toBe(false);
    expect(fs.readFileSync(files.kitFile, "utf8")).toBe(edited);
  });

  it("never overwrites a kit skill the user created without the plugin's mark", () => {
    const files = new SkillFiles(tmpVault());
    fs.mkdirSync(path.dirname(files.kitFile), { recursive: true });
    fs.writeFileSync(files.kitFile, "---\nname: kit\ndescription: mine\n---\nmy text\n");
    expect(files.writeKit(buildKitSkill("pt"))).toBe(false);
    expect(fs.readFileSync(files.kitFile, "utf8")).toContain("my text");
  });

  it("updates a file that is still exactly what the plugin wrote (new language or new text)", () => {
    const files = new SkillFiles(tmpVault());
    files.writeKit(buildKitSkill("en"));
    expect(files.writeKit(buildKitSkill("pt"))).toBe(true);
    expect(fs.readFileSync(files.kitFile, "utf8")).toContain("# Kit de boas-vindas");
  });

  it("comes with the core: written at start in the Obsidian language, listed in the catalog plan only while missing", async () => {
    const r = await startRig({ language: "pt" });
    await r.eco.setup!.whenIdle();
    const file = path.join(r.vault, ...KIT_SKILL_PATH.split("/"));
    expect(fs.readFileSync(file, "utf8")).toContain("# Kit de boas-vindas");

    const plan = await r.eco.setup!.planCatalogInstall("ai-scripts");
    expect(plan.catalog?.kitSkillPath).toBeUndefined();
    fs.rmSync(file);
    expect((await r.eco.setup!.planCatalogInstall("ai-scripts")).catalog?.kitSkillPath).toBe(".claude/skills/kit/SKILL.md");
  });

  it("is also put in the usage guide of the agents", async () => {
    const { buildGuideBlock } = await import("../../src/setup/guide-block");
    const block = buildGuideBlock({ lang: "pt", modules: [], target: "gemini" });
    expect(block).toContain("ecosystem_diagnostico");
    expect(block).toContain("/kit");
  });
});
