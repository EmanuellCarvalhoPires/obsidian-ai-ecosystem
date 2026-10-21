// What the core detects about the vault for the setup of the core module (and as context for the
// other modules): memory files, git, sync, registered clients, installed modules, folders with
// scripts and the hook settings in use. Nothing here reads a secret. Pure Node (no "obsidian" import).
import * as fs from "node:fs";
import * as path from "node:path";
import type { HookMode } from "../hooks/state-dir";
import { inferLanguage } from "../runner/script-tools";
import type { ModuleSetupState } from "../types";

export interface CoreDetection {
  claude_md: boolean;
  gemini_md: boolean;
  git: { repositorio: boolean; claude_ignorado: boolean };
  sincronizacao: { obsidian_sync: boolean; pastas_na_nuvem: string[] };
  /** Display names of the registered clients (never tokens). */
  clientes: string[];
  modulos: Array<{ id: string; nome: string; estado?: ModuleSetupState; registrado: boolean }>;
  /** The folders with the most script files (top 5). */
  scripts_no_cofre: Array<{ pasta: string; arquivos: number; linguagens: string[] }>;
  hooks: { arquivo_settings: string; caminho_settings: string; modos: Record<string, HookMode>; node: boolean };
}

const MAX_DEPTH = 6;
const MAX_DIRS = 3000;
const TOP_FOLDERS = 5;

const CLOUD_PROVIDERS: Array<{ name: string; pattern: RegExp }> = [
  { name: "OneDrive", pattern: /onedrive/i },
  { name: "Dropbox", pattern: /dropbox/i },
  { name: "Google Drive", pattern: /google ?drive|googledrive|\/my drive(\/|$)|drivefs/i },
  { name: "iCloud", pattern: /icloud|mobile documents/i },
];

/** Names of the sync providers whose folder holds the vault, from its path. */
export function cloudProvidersOf(vaultPath: string): string[] {
  const normalized = vaultPath.split("\\").join("/");
  return CLOUD_PROVIDERS.filter((p) => p.pattern.test(normalized)).map((p) => p.name);
}

function readText(file: string): string | undefined {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
}

const IGNORING_CLAUDE = new Set([".claude", ".claude/", "/.claude", "/.claude/", ".claude/*", "/.claude/*", ".claude/**", "/.claude/**"]);

function ignoresClaudeDir(ignoreText: string | undefined): boolean {
  if (!ignoreText) return false;
  return ignoreText.split(/\r?\n/).some((line) => IGNORING_CLAUDE.has(line.trim()));
}

export function detectGit(vaultBasePath: string): CoreDetection["git"] {
  const repositorio = fs.existsSync(path.join(vaultBasePath, ".git"));
  if (!repositorio) return { repositorio: false, claude_ignorado: false };
  const claudeIgnored =
    ignoresClaudeDir(readText(path.join(vaultBasePath, ".gitignore"))) ||
    ignoresClaudeDir(readText(path.join(vaultBasePath, ".git", "info", "exclude")));
  return { repositorio: true, claude_ignorado: claudeIgnored };
}

/** Whether the Obsidian Sync core plugin is turned on (core-plugins.json is an object or a list, depending on the version). */
export function obsidianSyncEnabled(vaultBasePath: string, configDir: string | undefined): boolean {
  if (!configDir) return false;
  const text = readText(path.join(vaultBasePath, configDir, "core-plugins.json"));
  if (!text) return false;
  try {
    const parsed = JSON.parse(text) as unknown;
    if (Array.isArray(parsed)) return parsed.includes("sync");
    if (typeof parsed === "object" && parsed !== null) return (parsed as Record<string, unknown>).sync === true;
  } catch {
    // An unreadable file means no signal.
  }
  return false;
}

/** Folders of the vault with script files, most files first (hidden folders and node_modules are skipped). */
export async function scanScriptFolders(vaultBasePath: string): Promise<CoreDetection["scripts_no_cofre"]> {
  const found: Array<{ pasta: string; arquivos: number; linguagens: Set<string> }> = [];
  let visited = 0;

  const walk = async (relDir: string, depth: number): Promise<void> => {
    if (depth > MAX_DEPTH || visited >= MAX_DIRS) return;
    visited++;
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(path.join(vaultBasePath, relDir), { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    const here = { pasta: relDir === "" ? "." : relDir, arquivos: 0, linguagens: new Set<string>() };
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      if (entry.isDirectory()) {
        await walk(relDir ? `${relDir}/${entry.name}` : entry.name, depth + 1);
      } else if (entry.isFile()) {
        const language = inferLanguage(entry.name);
        if (language) {
          here.arquivos++;
          here.linguagens.add(language);
        }
      }
    }
    if (here.arquivos > 0) found.push(here);
  };

  await walk("", 0);
  return found
    .sort((a, b) => b.arquivos - a.arquivos || a.pasta.localeCompare(b.pasta))
    .slice(0, TOP_FOLDERS)
    .map((f) => ({ pasta: f.pasta, arquivos: f.arquivos, linguagens: [...f.linguagens].sort() }));
}
