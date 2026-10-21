// Turns an issue into text. The UI passes its t() (any language); agents get the English table.
// Pure Node: the string table only needs a type from "../i18n", so "obsidian" is never loaded.
import { screensStrings } from "../i18n/screens";
import type { FieldIssue } from "./model";

export type Translate = (key: string, vars?: Record<string, string | number>) => string;

/** English text of a screens string. */
export const englishText: Translate = (key, vars) => {
  let text = screensStrings.en[key] ?? key;
  if (vars) for (const [name, value] of Object.entries(vars)) text = text.split(`{${name}}`).join(String(value));
  return text;
};

export function formatIssue(issue: FieldIssue, translate: Translate = englishText): string {
  const detail = issue.cause ? formatIssue(issue.cause, translate) : "";
  return translate(`screens.issue.${issue.code}`, { ...issue.params, detail });
}
