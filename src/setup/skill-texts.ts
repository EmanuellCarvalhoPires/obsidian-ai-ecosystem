// The setup skills the core writes to <vault>/.claude/skills/configurar-<id>/SKILL.md. The texts
// are Markdown files embedded in the bundle (pt and en); the Obsidian language picks one.
// Pure Node (no "obsidian" import).
import type { Lang } from "../i18n";
import aiEcosystemEn from "./skills/ai-ecosystem.en.md?raw";
import aiEcosystemPt from "./skills/ai-ecosystem.pt.md?raw";
import aiGitToolsEn from "./skills/ai-git-tools.en.md?raw";
import aiGitToolsPt from "./skills/ai-git-tools.pt.md?raw";
import aiLogManagerEn from "./skills/ai-log-manager.en.md?raw";
import aiLogManagerPt from "./skills/ai-log-manager.pt.md?raw";
import aiScriptsEn from "./skills/ai-scripts.en.md?raw";
import aiScriptsPt from "./skills/ai-scripts.pt.md?raw";
import aiTemplatesEn from "./skills/ai-templates.en.md?raw";
import aiTemplatesPt from "./skills/ai-templates.pt.md?raw";
import aiVaultSearchEn from "./skills/ai-vault-search.en.md?raw";
import aiVaultSearchPt from "./skills/ai-vault-search.pt.md?raw";
import commonEn from "./skills/common.en.md?raw";
import commonPt from "./skills/common.pt.md?raw";
import environmentVariablesEn from "./skills/environment-variables.en.md?raw";
import environmentVariablesPt from "./skills/environment-variables.pt.md?raw";
import genericEn from "./skills/generic.en.md?raw";
import genericPt from "./skills/generic.pt.md?raw";
import kitEn from "./skills/kit.en.md?raw";
import kitPt from "./skills/kit.pt.md?raw";
import telegramEn from "./skills/telegram-ai-gateway.en.md?raw";
import telegramPt from "./skills/telegram-ai-gateway.pt.md?raw";

const SPECIFIC: Record<string, Record<Lang, string>> = {
  "ai-ecosystem": { en: aiEcosystemEn, pt: aiEcosystemPt },
  "environment-variables": { en: environmentVariablesEn, pt: environmentVariablesPt },
  "telegram-ai-gateway": { en: telegramEn, pt: telegramPt },
  "ai-vault-search": { en: aiVaultSearchEn, pt: aiVaultSearchPt },
  "ai-scripts": { en: aiScriptsEn, pt: aiScriptsPt },
  "ai-templates": { en: aiTemplatesEn, pt: aiTemplatesPt },
  "ai-log-manager": { en: aiLogManagerEn, pt: aiLogManagerPt },
  "ai-git-tools": { en: aiGitToolsEn, pt: aiGitToolsPt },
};

const GENERIC: Record<Lang, string> = { en: genericEn, pt: genericPt };
const COMMON: Record<Lang, string> = { en: commonEn, pt: commonPt };

const KIT: Record<Lang, string> = { en: kitEn, pt: kitPt };

/** The welcome kit skill (/kit) is not a setup skill: it belongs to the core and has its own name. */
export const KIT_SKILL_NAME = "kit";
export const KIT_SKILL_PATH = `.claude/skills/${KIT_SKILL_NAME}/SKILL.md`;

/** Complete SKILL.md of the welcome kit, in the given language (always LF). */
export function buildKitSkill(lang: Lang): string {
  return KIT[lang].replace(/\r\n/g, "\n").replace(/\s+$/, "") + "\n";
}

/** Name of the folder (and of the skill) of a module. */
export function skillName(moduleId: string): string {
  return `configurar-${moduleId}`;
}

/** Vault-relative path of the skill file of a module. */
export function skillPath(moduleId: string): string {
  return `.claude/skills/${skillName(moduleId)}/SKILL.md`;
}

function fill(template: string, values: Record<string, string>): string {
  let text = template;
  for (const [key, value] of Object.entries(values)) text = text.split(`{{${key}}}`).join(value);
  return text;
}

/** Complete SKILL.md of a module, in the given language. Modules without a text of their own get the generic one. */
export function buildSkill(moduleId: string, name: string, lang: Lang): string {
  // The embedded files may come with CRLF from a Windows checkout; the skill is always LF.
  const template = (SPECIFIC[moduleId]?.[lang] ?? GENERIC[lang]).replace(/\r\n/g, "\n");
  const safeName = name.replace(/["\r\n]/g, "").trim() || moduleId;
  // The common part first: its own {{ID}} is filled together with the rest.
  const text = fill(template, { COMMON: COMMON[lang].replace(/\r\n/g, "\n").trimEnd() });
  return fill(text, { ID: moduleId, NAME: safeName }).replace(/\s+$/, "") + "\n";
}
