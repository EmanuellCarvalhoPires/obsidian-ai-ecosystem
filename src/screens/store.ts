// Saved screens: one JSON file per screen in <configDir>/plugins/ai-ecosystem/telas/<slug>.json.
// Written with node:fs (atomic: temporary file, then rename), so it can be tested without Obsidian.
import * as fs from "node:fs";
import * as nodePath from "node:path";
import { ECOSYSTEM_ID } from "../types";
import { validateDefinition } from "./definition";
import { SLUG_PATTERN } from "./model";
import type { ScreenDefinition } from "./model";

export const SCREENS_FOLDER = "telas";

/** Absolute folder of the saved screens of a vault. */
export function screensDir(vaultBasePath: string, configDir: string): string {
  return nodePath.join(vaultBasePath, configDir, "plugins", ECOSYSTEM_ID, SCREENS_FOLDER);
}

export interface LoadedScreens {
  definitions: ScreenDefinition[];
  /** Files that could not be used (invalid JSON, invalid definition, name that does not match the slug). */
  problems: string[];
}

export class ScreenStore {
  constructor(private readonly dir: string) {}

  private fileOf(slug: string): string {
    if (!SLUG_PATTERN.test(slug)) throw new Error(`Invalid screen slug: ${slug}`);
    return nodePath.join(this.dir, `${slug}.json`);
  }

  /** Reads every valid screen, sorted by slug. Never throws. */
  load(): LoadedScreens {
    const definitions: ScreenDefinition[] = [];
    const problems: string[] = [];
    let names: string[];
    try {
      names = fs.readdirSync(this.dir).filter((n) => n.endsWith(".json"));
    } catch {
      return { definitions, problems };
    }
    for (const name of names.sort()) {
      try {
        const parsed: unknown = JSON.parse(fs.readFileSync(nodePath.join(this.dir, name), "utf8"));
        const checked = validateDefinition(parsed);
        if (!checked.ok) {
          problems.push(`${name}: ${checked.errors.join(" ")}`);
        } else if (`${checked.definition.slug}.json` !== name) {
          problems.push(`${name}: the file name does not match the slug "${checked.definition.slug}".`);
        } else {
          definitions.push(checked.definition);
        }
      } catch (err) {
        problems.push(`${name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return { definitions, problems };
  }

  save(definition: ScreenDefinition): void {
    const file = this.fileOf(definition.slug);
    fs.mkdirSync(this.dir, { recursive: true });
    const temp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temp, `${JSON.stringify(definition, null, 2)}\n`, "utf8");
    fs.renameSync(temp, file);
  }

  /** Returns false when there was no such file. */
  remove(slug: string): boolean {
    try {
      fs.unlinkSync(this.fileOf(slug));
      return true;
    } catch {
      return false;
    }
  }
}
