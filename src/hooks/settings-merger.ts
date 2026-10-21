// Adds and removes the plugin's hook entries in the Claude Code settings of the vault
// (<vault>/.claude/settings.local.json or settings.json). It only ever touches entries whose
// command runs ai-ecosystem-hook.mjs: everything else the user wrote stays as it is. Before a
// write it keeps a backup, and after a write it reads the file back to check it. An invalid
// settings file is never overwritten. Pure Node (no "obsidian" import).
import * as fs from "node:fs";
import * as path from "node:path";
import { HOOK_TIMEOUT_SECONDS, buildCommand, parseCommand } from "./hook-specs";
import type { HookEvent, HookSpec, HookType } from "./hook-specs";
import { writeFileAtomic } from "./state-dir";

const MAX_BACKUPS = 5;
const BACKUP_PATTERN = /\.(\d{17}-\d{3})\.bak$/;

type Json = Record<string, unknown>;

export type MergeResult = { ok: true; changed: boolean } | { ok: false; error: string };

/** One entry of the plugin found in a settings file. */
export interface InstalledEntry {
  module: string;
  type: HookType;
  event: HookEvent;
  matcher?: string;
  command: string;
}

/** Which plugin entries to remove: all of a module, or one type of it. */
export interface EntrySelector {
  module: string;
  type?: HookType;
}

class MergeError extends Error {}

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function detectIndent(raw: string): string | number {
  const match = /^([ \t]+)"/m.exec(raw);
  const indent = match?.[1];
  if (!indent) return 2;
  return indent.includes("\t") ? "\t" : indent.length;
}

let backupSeq = 0;

function backupStamp(): string {
  const time = new Date().toISOString().replace(/\D/g, "");
  backupSeq = (backupSeq + 1) % 1000;
  return `${time}-${String(backupSeq).padStart(3, "0")}`;
}

export class SettingsMerger {
  /**
   * @param claudeDir <vault>/.claude
   * @param backupsDir <vault>/.claude/ai-ecosystem/backups
   * @param getVaultPath vault path used in the commands (read on every call, so a moved vault is followed)
   */
  constructor(
    private readonly claudeDir: string,
    private readonly backupsDir: string,
    private readonly getVaultPath: () => string,
  ) {}

  settingsPath(file: string): string {
    return path.join(this.claudeDir, file);
  }

  /** The plugin entries of a settings file. A missing file has none; an invalid one is an error. */
  list(file: string): { ok: true; entries: InstalledEntry[] } | { ok: false; error: string } {
    const read = this.read(file);
    if (!read.ok) return read;
    try {
      return { ok: true, entries: collectEntries(read.settings) };
    } catch (err) {
      return { ok: false, error: this.describe(file, err) };
    }
  }

  /** Adds the entries that are missing and points the existing ones at the current script path. */
  install(file: string, specs: HookSpec[]): MergeResult {
    if (specs.length === 0) return { ok: true, changed: false };
    const vaultPath = this.getVaultPath();
    return this.edit(
      file,
      true,
      (settings) => {
        let changed = false;
        for (const spec of specs) changed = installSpec(settings, spec, vaultPath) || changed;
        return changed;
      },
      (entries) => specs.every((spec) => entries.some((e) => e.module === spec.module && e.type === spec.type && e.event === spec.event)),
    );
  }

  /** Removes plugin entries; groups the plugin leaves empty go with them. */
  remove(file: string, selector: EntrySelector): MergeResult {
    return this.edit(
      file,
      false,
      (settings) => removeEntries(settings, selector),
      (entries) => !entries.some((e) => matches(e, selector)),
    );
  }

  /** Rewrites the script path of every plugin entry (the vault was moved). */
  syncPaths(file: string): MergeResult {
    const vaultPath = this.getVaultPath();
    return this.edit(
      file,
      false,
      (settings) => {
        let changed = false;
        for (const hook of pluginHooks(settings)) {
          const command = buildCommand(vaultPath, hook.parsed.module, hook.parsed.type);
          if (hook.hook.command !== command) {
            hook.hook.command = command;
            changed = true;
          }
        }
        return changed;
      },
      () => true,
    );
  }

  /** Moves every plugin entry from one settings file to the other (the target is written first). */
  move(from: string, to: string): MergeResult {
    if (from === to) return { ok: true, changed: false };
    const source = this.list(from);
    if (!source.ok) return source;
    if (source.entries.length === 0) return { ok: true, changed: false };
    const specs: HookSpec[] = source.entries.map((e) => ({ module: e.module, type: e.type, event: e.event, matcher: e.matcher }));
    const added = this.install(to, specs);
    if (!added.ok) return added;
    for (const spec of specs) {
      const removed = this.remove(from, { module: spec.module, type: spec.type });
      if (!removed.ok) return removed;
    }
    return { ok: true, changed: true };
  }

  // ---- internals ----------------------------------------------------------

  private describe(file: string, err: unknown): string {
    return `${file}: ${errorText(err)}`;
  }

  private read(file: string): { ok: true; settings: Json; raw: string | undefined } | { ok: false; error: string } {
    const full = this.settingsPath(file);
    let raw: string;
    try {
      raw = fs.readFileSync(full, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return { ok: true, settings: {}, raw: undefined };
      return { ok: false, error: this.describe(file, err) };
    }
    const text = raw.replace(/^\ufeff/, "");
    if (text.trim() === "") return { ok: true, settings: {}, raw };
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      return { ok: false, error: `${file} is not valid JSON, so it was left untouched (${errorText(err)}).` };
    }
    if (!isObject(parsed)) return { ok: false, error: `${file} does not hold a JSON object, so it was left untouched.` };
    return { ok: true, settings: parsed, raw };
  }

  /**
   * Reads, applies `mutate` and, only when it changed something, backs up, writes and checks the
   * result with `verify`. `create` lets the file be created when it does not exist yet.
   */
  private edit(file: string, create: boolean, mutate: (settings: Json) => boolean, verify: (entries: InstalledEntry[]) => boolean): MergeResult {
    const read = this.read(file);
    if (!read.ok) return read;
    if (read.raw === undefined && !create) return { ok: true, changed: false };

    let changed: boolean;
    try {
      changed = mutate(read.settings);
    } catch (err) {
      return { ok: false, error: this.describe(file, err) };
    }
    if (!changed && read.raw !== undefined) return { ok: true, changed: false };

    const full = this.settingsPath(file);
    try {
      if (read.raw !== undefined) this.backup(file, read.raw);
      const text = JSON.stringify(read.settings, null, read.raw === undefined ? 2 : detectIndent(read.raw)) + "\n";
      writeFileAtomic(full, text);
    } catch (err) {
      return { ok: false, error: this.describe(file, err) };
    }

    const check = this.list(file);
    if (check.ok && verify(check.entries)) return { ok: true, changed: true };
    this.restore(full, read.raw);
    return { ok: false, error: `${file}: the written file did not pass the check, so the previous content was restored.` };
  }

  private backup(file: string, raw: string): void {
    fs.mkdirSync(this.backupsDir, { recursive: true });
    fs.writeFileSync(path.join(this.backupsDir, `${file}.${backupStamp()}.bak`), raw, "utf8");
    const backups = fs
      .readdirSync(this.backupsDir)
      .map((name) => ({ name, stamp: BACKUP_PATTERN.exec(name)?.[1] }))
      .filter((b): b is { name: string; stamp: string } => b.stamp !== undefined)
      .sort((a, b) => (a.stamp < b.stamp ? 1 : a.stamp > b.stamp ? -1 : 0));
    for (const old of backups.slice(MAX_BACKUPS)) fs.rmSync(path.join(this.backupsDir, old.name), { force: true });
  }

  private restore(full: string, raw: string | undefined): void {
    try {
      if (raw === undefined) fs.rmSync(full, { force: true });
      else fs.writeFileSync(full, raw, "utf8");
    } catch {
      // Nothing else to do; the error is reported to the caller.
    }
  }
}

// ---------------------------------------------------------------------------
// Pure helpers over the parsed settings
// ---------------------------------------------------------------------------

interface PluginHook {
  event: string;
  group: Json;
  hook: Json;
  parsed: { module: string; type: HookType };
}

/** Every command hook of the plugin, with the group and event it lives in. */
function pluginHooks(settings: Json): PluginHook[] {
  const out: PluginHook[] = [];
  const root = settings.hooks;
  if (root === undefined) return out;
  if (!isObject(root)) throw new MergeError('"hooks" is not an object');
  for (const [event, groups] of Object.entries(root)) {
    if (!Array.isArray(groups)) continue;
    for (const group of groups) {
      if (!isObject(group) || !Array.isArray(group.hooks)) continue;
      for (const hook of group.hooks) {
        if (!isObject(hook)) continue;
        const parsed = parseCommand(hook.command);
        if (parsed) out.push({ event, group, hook, parsed });
      }
    }
  }
  return out;
}

function collectEntries(settings: Json): InstalledEntry[] {
  return pluginHooks(settings).map(({ event, group, hook, parsed }) => {
    const entry: InstalledEntry = { module: parsed.module, type: parsed.type, event: event as HookEvent, command: String(hook.command) };
    if (typeof group.matcher === "string") entry.matcher = group.matcher;
    return entry;
  });
}

function matches(entry: { module: string; type: HookType }, selector: EntrySelector): boolean {
  return entry.module === selector.module && (selector.type === undefined || entry.type === selector.type);
}

/** Adds one entry unless it exists; rewrites the command of an existing one. Returns whether it changed. */
function installSpec(settings: Json, spec: HookSpec, vaultPath: string): boolean {
  const command = buildCommand(vaultPath, spec.module, spec.type);
  const existing = pluginHooks(settings).filter((h) => h.event === spec.event && h.parsed.module === spec.module && h.parsed.type === spec.type);
  if (existing.length > 0) {
    let changed = false;
    for (const { hook } of existing) {
      if (hook.command !== command) {
        hook.command = command;
        changed = true;
      }
    }
    return changed;
  }

  if (settings.hooks === undefined) settings.hooks = {};
  const root = settings.hooks;
  if (!isObject(root)) throw new MergeError('"hooks" is not an object');
  if (root[spec.event] === undefined) root[spec.event] = [];
  const groups = root[spec.event];
  if (!Array.isArray(groups)) throw new MergeError(`"hooks.${spec.event}" is not a list`);
  const group: Json = {};
  if (spec.matcher !== undefined) group.matcher = spec.matcher;
  group.hooks = [{ type: "command", command, timeout: HOOK_TIMEOUT_SECONDS }];
  groups.push(group);
  return true;
}

/** Removes the selected plugin hooks, then the groups, events and "hooks" key they leave empty. */
function removeEntries(settings: Json, selector: EntrySelector): boolean {
  const targets = pluginHooks(settings).filter((h) => matches(h.parsed, selector));
  if (targets.length === 0) return false;

  const touchedEvents = new Set<string>();
  for (const { event, group, hook } of targets) {
    const hooks = group.hooks as unknown[];
    hooks.splice(hooks.indexOf(hook), 1);
    touchedEvents.add(event);
  }
  const root = settings.hooks as Json;
  for (const event of touchedEvents) {
    const groups = (root[event] as unknown[]).filter((g) => !(isObject(g) && Array.isArray(g.hooks) && g.hooks.length === 0 && targets.some((t) => t.group === g)));
    if (groups.length === 0) delete root[event];
    else root[event] = groups;
  }
  if (Object.keys(root).length === 0) delete settings.hooks;
  return true;
}
