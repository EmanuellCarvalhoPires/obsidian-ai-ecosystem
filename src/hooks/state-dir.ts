// The state folder <vault>/.claude/ai-ecosystem/ the Claude Code hook script reads (see
// docs/hooks-setup-screens-design.md, section 2). The folder is hidden from Obsidian, so it is
// written with node:fs. Every write is atomic (temporary file + rename) and every read
// tolerates missing or invalid files. Pure Node (no "obsidian" import).
import * as fs from "node:fs";
import * as path from "node:path";
import type { HookRuleData, ModuleSetupState } from "../types";
import { toSlashPath } from "./hook-specs";

export type HookMode = "bloquear" | "avisar" | "off";
export type ModuleOrigin = "catalogo" | "nucleo" | "legado" | "manual";

export const DEFAULT_SETTINGS_FILE = "settings.local.json";
export const SETTINGS_FILES = ["settings.local.json", "settings.json"] as const;
const SCHEMA_VERSION = 1;

/** Mode of a module with no entry in config.modos. Modules not listed here default to "bloquear". */
const MODULE_DEFAULT_MODES: Record<string, HookMode> = {
  "ai-git-tools": "avisar",
};

/** The mode a module's protection hook has until the user picks one (the hook script uses the same table). */
export function defaultMode(moduleId: string): HookMode {
  return MODULE_DEFAULT_MODES[moduleId] ?? "bloquear";
}

export interface StateConfig {
  schemaVersion: number;
  vaultPath: string;
  /** File in <vault>/.claude/ that holds the hook entries. */
  settingsFile: string;
  /** Obsidian config folder name (app.vault.configDir); the Grep rule leaves it alone. */
  configDir?: string;
  /** Missing mode means the module default (see defaultMode: "bloquear" for most modules). */
  modos: Record<string, HookMode>;
}

export interface ModuleState {
  estado: ModuleSetupState;
  origem: ModuleOrigin;
  atualizadoEm: string;
  /** Display name, used by the setup hook. */
  nome?: string;
  respostas: Record<string, unknown>;
  /** The user removed the protection hooks of this module by hand: the core does not reinstall them on its own. */
  hooksRemovidos?: boolean;
}

export interface HookPastas {
  scripts: string[];
  templates: string[];
  foraDoIndice: string[];
  notasDeTools: string[];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Atomic write: a temporary file next to the target, then rename. */
export function writeFileAtomic(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, text, "utf8");
    fs.renameSync(tmp, file);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
}

/** Reads and parses a JSON file. Undefined when it is missing or invalid. */
export function readJsonFile(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\ufeff/, "")) as unknown;
  } catch {
    return undefined;
  }
}

export class StateDir {
  readonly root: string;
  /** Vault path with forward slashes. */
  readonly vaultPath: string;

  constructor(vaultBasePath: string) {
    this.vaultPath = toSlashPath(vaultBasePath);
    this.root = path.join(vaultBasePath, ".claude", "ai-ecosystem");
  }

  get claudeDir(): string {
    return path.join(this.vaultPath, ".claude");
  }

  get hooksDir(): string {
    return path.join(this.root, "hooks");
  }

  get backupsDir(): string {
    return path.join(this.root, "backups");
  }

  get modulesDir(): string {
    return path.join(this.root, "modules");
  }

  file(rel: string): string {
    return path.join(this.root, ...rel.split("/"));
  }

  /** Creates the folder and its subfolders. */
  ensure(): void {
    for (const dir of [this.root, this.modulesDir, this.hooksDir, this.backupsDir]) fs.mkdirSync(dir, { recursive: true });
  }

  readJson(rel: string): unknown {
    return readJsonFile(this.file(rel));
  }

  writeJson(rel: string, value: unknown): void {
    writeFileAtomic(this.file(rel), JSON.stringify(value, null, 2) + "\n");
  }

  exists(rel: string): boolean {
    return fs.existsSync(this.file(rel));
  }

  readText(rel: string): string | undefined {
    try {
      return fs.readFileSync(this.file(rel), "utf8");
    } catch {
      return undefined;
    }
  }

  writeText(rel: string, text: string): void {
    writeFileAtomic(this.file(rel), text);
  }

  remove(rel: string): void {
    fs.rmSync(this.file(rel), { force: true });
  }

  // ---- config.json ------------------------------------------------------

  /** The stored config with defaults filled in; undefined when the file is missing or invalid. */
  readConfig(): StateConfig | undefined {
    const raw = this.readJson("config.json");
    if (!isObject(raw)) return undefined;
    const modos: Record<string, HookMode> = {};
    if (isObject(raw.modos)) {
      for (const [id, mode] of Object.entries(raw.modos)) {
        if (mode === "bloquear" || mode === "avisar" || mode === "off") modos[id] = mode;
      }
    }
    const settingsFile =
      typeof raw.settingsFile === "string" && (SETTINGS_FILES as readonly string[]).includes(raw.settingsFile)
        ? raw.settingsFile
        : DEFAULT_SETTINGS_FILE;
    const config: StateConfig = { schemaVersion: SCHEMA_VERSION, vaultPath: this.vaultPath, settingsFile, modos };
    if (typeof raw.configDir === "string" && raw.configDir !== "") config.configDir = raw.configDir;
    return config;
  }

  /** Writes config.json with the current vault path, keeping the settings file and modes already stored. */
  writeConfig(patch: { configDir?: string; settingsFile?: string; modos?: Record<string, HookMode> } = {}): StateConfig {
    const current = this.readConfig();
    const config: StateConfig = {
      schemaVersion: SCHEMA_VERSION,
      vaultPath: this.vaultPath,
      settingsFile: patch.settingsFile ?? current?.settingsFile ?? DEFAULT_SETTINGS_FILE,
      modos: patch.modos ?? current?.modos ?? {},
    };
    const configDir = patch.configDir ?? current?.configDir;
    if (configDir) config.configDir = configDir;
    this.writeJson("config.json", config);
    return config;
  }

  getSettingsFile(): string {
    return this.readConfig()?.settingsFile ?? DEFAULT_SETTINGS_FILE;
  }

  getMode(moduleId: string): HookMode {
    return this.readConfig()?.modos[moduleId] ?? defaultMode(moduleId);
  }

  /** Whether the user (or the setup) stored a mode for the module. */
  hasExplicitMode(moduleId: string): boolean {
    return this.readConfig()?.modos[moduleId] !== undefined;
  }

  setMode(moduleId: string, mode: HookMode): void {
    const config = this.readConfig() ?? this.writeConfig();
    this.writeConfig({ modos: { ...config.modos, [moduleId]: mode } });
  }

  // ---- data of the rules ------------------------------------------------

  writeHosts(hosts: string[]): void {
    this.writeJson("hosts.json", { hosts });
  }

  writePastas(pastas: HookPastas): void {
    this.writeJson("pastas.json", pastas);
  }

  /** Tool name to module id, used by the failure hook. */
  writeTools(tools: Record<string, string>): void {
    this.writeJson("tools.json", tools);
  }

  // ---- failure markers --------------------------------------------------

  readFalhas(): Record<string, number> {
    const raw = this.readJson("falhas.json");
    const out: Record<string, number> = {};
    if (isObject(raw)) {
      for (const [id, at] of Object.entries(raw)) if (typeof at === "number" && Number.isFinite(at)) out[id] = at;
    }
    return out;
  }

  setFalha(moduleId: string, at: number): void {
    this.writeJson("falhas.json", { ...this.readFalhas(), [moduleId]: at });
  }

  /** Removes the marker of a module. Returns whether there was one (the file is left alone otherwise). */
  clearFalha(moduleId: string): boolean {
    const falhas = this.readFalhas();
    if (!(moduleId in falhas)) return false;
    delete falhas[moduleId];
    this.writeJson("falhas.json", falhas);
    return true;
  }

  // ---- modules/<id>.json ------------------------------------------------

  readModuleState(moduleId: string): ModuleState | undefined {
    const raw = this.readJson(`modules/${moduleId}.json`);
    if (!isObject(raw)) return undefined;
    const { estado, origem } = raw;
    if (estado !== "pendente_configuracao" && estado !== "configurado" && estado !== "desativado") return undefined;
    if (origem !== "catalogo" && origem !== "nucleo" && origem !== "legado" && origem !== "manual") return undefined;
    const state: ModuleState = {
      estado,
      origem,
      atualizadoEm: typeof raw.atualizadoEm === "string" ? raw.atualizadoEm : new Date(0).toISOString(),
      respostas: isObject(raw.respostas) ? raw.respostas : {},
    };
    if (typeof raw.nome === "string" && raw.nome !== "") state.nome = raw.nome;
    if (raw.hooksRemovidos === true) state.hooksRemovidos = true;
    return state;
  }

  writeModuleState(moduleId: string, state: ModuleState): void {
    this.writeJson(`modules/${moduleId}.json`, state);
  }

  /** Deletes the state file and the marker of a module. */
  removeModuleState(moduleId: string): void {
    this.remove(`modules/${moduleId}.json`);
    this.remove(`modules/${moduleId}.configurado.json`);
  }

  /** The marker the core writes when ecosystem_setup_complete finishes (the setup hook reads it). */
  hasConfiguredMarker(moduleId: string): boolean {
    return this.exists(`modules/${moduleId}.configurado.json`);
  }

  writeConfiguredMarker(moduleId: string): void {
    this.writeJson(`modules/${moduleId}.configurado.json`, { concluidoEm: new Date().toISOString() });
  }

  removeConfiguredMarker(moduleId: string): void {
    this.remove(`modules/${moduleId}.configurado.json`);
  }

  /** Module ids that have a state file. */
  listModuleIds(): string[] {
    try {
      return fs
        .readdirSync(this.modulesDir)
        .filter((f) => f.endsWith(".json") && !f.endsWith(".configurado.json"))
        .map((f) => f.slice(0, -".json".length));
    } catch {
      return [];
    }
  }
}

// ---------------------------------------------------------------------------
// Rule data (what the modules give through the "hooks" service)
// ---------------------------------------------------------------------------

function cleanList(values: unknown, clean: (value: string) => string | undefined): string[] {
  const out: string[] = [];
  if (!Array.isArray(values)) return out;
  for (const value of values) {
    if (typeof value !== "string") continue;
    const cleaned = clean(value.trim());
    if (cleaned && !out.includes(cleaned)) out.push(cleaned);
  }
  return out;
}

function cleanHost(value: string): string | undefined {
  const host = value.toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return host === "" || /\s/.test(host) ? undefined : host;
}

/** Vault-relative glob with forward slashes; absolute paths and ".." are refused. */
function cleanFolder(value: string): string | undefined {
  const folder = value.replace(/\\/g, "/").replace(/^\.?\/+/, "").replace(/\/+$/, "");
  if (folder === "" || /^[A-Za-z]:/.test(folder) || folder.split("/").includes("..")) return undefined;
  return folder;
}

/** Merges the data of every module into the contents of hosts.json and pastas.json. */
export function mergeRuleData(all: Iterable<HookRuleData>): { hosts: string[]; pastas: HookPastas } {
  const hosts: string[] = [];
  const pastas: HookPastas = { scripts: [], templates: [], foraDoIndice: [], notasDeTools: [] };
  const add = (list: string[], values: string[]) => {
    for (const value of values) if (!list.includes(value)) list.push(value);
  };
  for (const data of all) {
    add(hosts, cleanList(data.hosts, cleanHost));
    add(pastas.scripts, cleanList(data.scriptFolders, cleanFolder));
    add(pastas.templates, cleanList(data.templateTargets, cleanFolder));
    add(pastas.foraDoIndice, cleanList(data.excludedFolders, cleanFolder));
    add(pastas.notasDeTools, cleanList(data.toolNoteFolders, cleanFolder));
  }
  return { hosts, pastas };
}
