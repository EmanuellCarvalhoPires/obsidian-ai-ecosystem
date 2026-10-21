// Writes and removes the setup skills in <vault>/.claude/skills/. The folder is hidden from
// Obsidian, so it is written with node:fs. Only the SKILL.md of a skill the core owns
// (configurar-<id>) is ever touched. Pure Node (no "obsidian" import).
import * as fs from "node:fs";
import * as path from "node:path";
import { writeFileAtomic } from "../hooks/state-dir";
import { skillName } from "./skill-texts";

export class SkillFiles {
  constructor(private readonly vaultBasePath: string) {}

  get skillsDir(): string {
    return path.join(this.vaultBasePath, ".claude", "skills");
  }

  fileOf(moduleId: string): string {
    return path.join(this.skillsDir, skillName(moduleId), "SKILL.md");
  }

  /** Keeps .claude/skills/ in place: Claude Code only notices new skills mid-session if the folder existed when it started. */
  ensureDir(): void {
    fs.mkdirSync(this.skillsDir, { recursive: true });
  }

  /** Writes the skill unless it is already there with the same text. Returns whether it wrote. */
  write(moduleId: string, text: string): boolean {
    const file = this.fileOf(moduleId);
    try {
      if (fs.readFileSync(file, "utf8") === text) return false;
    } catch {
      // Missing: written below.
    }
    writeFileAtomic(file, text);
    return true;
  }

  /** Removes the skill file and its folder when nothing else is in it. Returns whether the file was there. */
  remove(moduleId: string): boolean {
    const file = this.fileOf(moduleId);
    const existed = fs.existsSync(file);
    fs.rmSync(file, { force: true });
    try {
      fs.rmdirSync(path.dirname(file));
    } catch {
      // The folder holds something of the user's or is already gone.
    }
    return existed;
  }

  exists(moduleId: string): boolean {
    return fs.existsSync(this.fileOf(moduleId));
  }
}
