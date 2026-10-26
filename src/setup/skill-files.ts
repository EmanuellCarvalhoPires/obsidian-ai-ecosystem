// Writes and removes the setup skills in <vault>/.claude/skills/. The folder is hidden from
// Obsidian, so it is written with node:fs. Only the SKILL.md of a skill the core owns
// (configurar-<id>) is ever touched. Pure Node (no "obsidian" import).
import * as fs from "node:fs";
import * as path from "node:path";
import { writeFileAtomic } from "../hooks/state-dir";
import { createHash } from "node:crypto";
import { KIT_SKILL_NAME, skillName } from "./skill-texts";

const KIT_MARK_PREFIX = "<!-- ai-ecosystem:kit sha256:";
const KIT_MARK_SUFFIX = " -->";
const KIT_MARK = /<!-- ai-ecosystem:kit sha256:([0-9a-f]{64}) -->\s*$/;

function hashOf(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

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

  kitExists(): boolean {
    return fs.existsSync(this.kitFile);
  }

  get kitFile(): string {
    return path.join(this.skillsDir, KIT_SKILL_NAME, "SKILL.md");
  }

  /**
   * Writes the welcome kit skill (/kit). Unlike the setup skills it is a file the user may well
   * edit, so it is written only when missing or when the file on disk is still exactly what the
   * plugin wrote (its last line holds the hash of the text above it). An edited file, or one the
   * user created without that line, is never touched. Returns whether it wrote.
   */
  writeKit(text: string): boolean {
    const file = this.kitFile;
    const stamped = `${text}${KIT_MARK_PREFIX}${hashOf(text)}${KIT_MARK_SUFFIX}\n`;
    let current: string | undefined;
    try {
      current = fs.readFileSync(file, "utf8");
    } catch {
      // Missing: written below.
    }
    if (current !== undefined) {
      if (current === stamped) return false;
      const match = KIT_MARK.exec(current);
      // Not stamped, or stamped but edited since: it is the user's now.
      if (!match || hashOf(current.slice(0, match.index)) !== match[1]) return false;
    }
    writeFileAtomic(file, stamped);
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
