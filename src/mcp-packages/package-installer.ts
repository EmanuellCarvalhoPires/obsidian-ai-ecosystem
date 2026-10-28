// Installs and removes downloaded MCP packages through a vault-agnostic store, so the
// logic can be tested without Obsidian. Existing text notes are never overwritten.

import { filesToInstall, McpCatalogEntry, McpDownloadSelection, McpPackageFile, McpPackageManifest, GithubReader } from "./catalog";

export interface McpPackageStore {
  /** Folder of the first markdown note with this basename ("" for the vault root), or undefined. */
  findNoteFolder(basename: string): Promise<string | undefined>;
  exists(path: string): Promise<boolean>;
  ensureFolder(path: string): Promise<void>;
  /** Creates a text note. Never overwrites. */
  createText(path: string, content: string): Promise<void>;
  /** Creates or overwrites a binary file. */
  writeBinary(path: string, data: ArrayBuffer): Promise<void>;
  trash(path: string): Promise<void>;
}

export const MCP_HUB_NOTE_NAME = "MCP Tools";

export interface InstallResult {
  written: number;
  skipped: number;
}

const HUB_NOTE_CONTENT = [
  "---",
  "tags:",
  "  - moc",
  "  - mcp",
  "---",
  `# ${MCP_HUB_NOTE_NAME}`,
  "",
  "Index of the MCP tool packages downloaded through AI Ecosystem.",
  "",
  "## Related notes",
  "```dataview",
  "LIST FROM [[]] WHERE contains(flat(list(up)), this.file.link)",
  "SORT file.name ASC",
  "```",
  "",
].join("\n");

/** The folder the hub note lives in, creating the note in the root when the vault has none. */
export async function ensureHubFolder(store: McpPackageStore): Promise<string> {
  const existing = await store.findNoteFolder(MCP_HUB_NOTE_NAME);
  if (existing !== undefined) return existing;
  await store.createText(`${MCP_HUB_NOTE_NAME}.md`, HUB_NOTE_CONTENT);
  return "";
}

/** `<hub>/<package name>`, or just the name when the hub is in the root. */
export function packageTargetFolder(hubFolder: string, entry: Pick<McpCatalogEntry, "name">): string {
  return hubFolder ? `${hubFolder}/${entry.name}` : entry.name;
}

/** Where a manifest file lands in the vault. A database is named after the package id. */
export function targetPathOf(folder: string, entry: Pick<McpCatalogEntry, "id">, file: McpPackageFile): string {
  const path = file.kind === "database" ? databasePathOf(folder, entry) : `${folder}/${file.path}`;
  return path.replace(/\\/g, "/");
}

function databasePathOf(folder: string, entry: Pick<McpCatalogEntry, "id">): string {
  return `${folder}/${entry.id}.db`;
}

/**
 * Copies a package (or one tool with its index and requests) into the hub folder. Existing
 * text notes are skipped; the database is always overwritten. Folders are never removed.
 */
export async function installPackage(
  store: McpPackageStore,
  reader: GithubReader,
  entry: McpCatalogEntry,
  manifest: McpPackageManifest,
  selection: McpDownloadSelection,
  onProgress?: (done: number, total: number) => void,
): Promise<InstallResult> {
  const hubFolder = await ensureHubFolder(store);
  const folder = packageTargetFolder(hubFolder, entry);
  const files = filesToInstall(manifest, selection);

  const madeFolders = new Set<string>();
  let written = 0;
  let skipped = 0;
  for (const file of files) {
    const target = targetPathOf(folder, entry, file);
    const slash = target.lastIndexOf("/");
    const parent = slash > 0 ? target.slice(0, slash) : "";
    if (parent && !madeFolders.has(parent)) {
      madeFolders.add(parent);
      if (!(await store.exists(parent))) await store.ensureFolder(parent);
    }

    if (file.kind === "database") {
      const data = await reader.fetchBinary(`${entry.path}/${file.path}`);
      await store.writeBinary(target, data);
      written++;
    } else if (await store.exists(target)) {
      skipped++;
    } else {
      const content = await reader.fetchText(`${entry.path}/${file.path}`);
      await store.createText(target, content);
      written++;
    }
    onProgress?.(written + skipped, files.length);
  }
  return { written, skipped };
}

/**
 * Removes a package's database, and with `deleteNotes` also the notes its manifest lists.
 * Folders are left in place.
 */
export async function removePackage(
  store: McpPackageStore,
  hubFolder: string,
  entry: McpCatalogEntry,
  manifest: McpPackageManifest | undefined,
  deleteNotes: boolean,
): Promise<void> {
  const folder = packageTargetFolder(hubFolder, entry);
  const dbPath = databasePathOf(folder, entry);
  if (await store.exists(dbPath)) await store.trash(dbPath);

  if (!deleteNotes || !manifest) return;
  for (const file of manifest.files) {
    if (file.kind === "database") continue;
    const target = targetPathOf(folder, entry, file);
    if (await store.exists(target)) await store.trash(target);
  }
}
