// Interface strings in English and Portuguese. Each area keeps its strings in its own
// file under src/i18n/ (keys prefixed with the area name, e.g. "inspector.title"); this
// file merges them and picks the language of the Obsidian interface.
import { getLanguage } from "obsidian";
import { catalogStrings } from "./i18n/catalog";
import { coreStrings } from "./i18n/core";
import { inspectorStrings } from "./i18n/inspector";
import { runnerStrings } from "./i18n/runner";
import { serverStrings } from "./i18n/server";
import { settingsStrings } from "./i18n/settings";

export type Lang = "en" | "pt";

export interface StringTable {
  en: Record<string, string>;
  pt: Record<string, string>;
}

const tables: StringTable[] = [coreStrings, serverStrings, runnerStrings, inspectorStrings, catalogStrings, settingsStrings];

const merged: StringTable = { en: {}, pt: {} };
for (const table of tables) {
  Object.assign(merged.en, table.en);
  Object.assign(merged.pt, table.pt);
}

let forced: Lang | undefined;

/** For tests. */
export function setLanguage(lang: Lang | undefined): void {
  forced = lang;
}

export function currentLanguage(): Lang {
  if (forced) return forced;
  try {
    return getLanguage().toLowerCase().startsWith("pt") ? "pt" : "en";
  } catch {
    return "en";
  }
}

/** Translates a key, replacing {name} with vars.name. Falls back to English, then to the key. */
export function t(key: string, vars?: Record<string, string | number>): string {
  const lang = currentLanguage();
  let text = merged[lang][key] ?? merged.en[key] ?? key;
  if (vars) {
    for (const [name, value] of Object.entries(vars)) text = text.split(`{${name}}`).join(String(value));
  }
  return text;
}

/** All keys, for tests that check both languages have the same keys. */
export function allStrings(): StringTable {
  return merged;
}
