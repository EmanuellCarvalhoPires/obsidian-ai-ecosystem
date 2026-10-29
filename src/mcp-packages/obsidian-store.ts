// Obsidian adapters for the MCP package installer: vault storage, GitHub raw reads and the
// list of database files. Everything vault-specific lives here, so the services stay testable.

import { FileSystemAdapter, TFile, normalizePath, requestUrl } from "obsidian";
import type { App, TAbstractFile } from "obsidian";
import type { GithubReader } from "./catalog";
import type { McpPackageStore } from "./package-installer";

export class ObsidianMcpPackageStore implements McpPackageStore {
  constructor(private readonly app: App) {}

  async findNoteFolder(basename: string): Promise<string | undefined> {
    const note = this.app.vault.getMarkdownFiles().find((file) => file.basename === basename);
    if (!note) return undefined;
    const path = note.parent?.path ?? "/";
    return path === "/" ? "" : path;
  }

  async exists(path: string): Promise<boolean> {
    return this.fileAt(path) !== null;
  }

  async ensureFolder(path: string): Promise<void> {
    let current = "";
    for (const part of path.split("/").filter((p) => p.length > 0)) {
      current = current ? `${current}/${part}` : part;
      if (this.app.vault.getFolderByPath(current)) continue;
      try {
        await this.app.vault.createFolder(current);
      } catch (error) {
        // Created by someone else in the meantime: fine. Anything else is a real failure.
        if (!this.app.vault.getFolderByPath(current)) throw error;
      }
    }
  }

  async createText(path: string, content: string): Promise<void> {
    await this.app.vault.create(path, content);
  }

  async writeBinary(path: string, data: ArrayBuffer): Promise<void> {
    const existing = this.fileAt(path);
    if (existing instanceof TFile) await this.app.vault.modifyBinary(existing, data);
    else await this.app.vault.createBinary(path, data);
  }

  async trash(path: string): Promise<void> {
    const file = this.fileAt(path);
    if (file) await this.app.fileManager.trashFile(file);
  }

  private fileAt(path: string): TAbstractFile | null {
    return this.app.vault.getAbstractFileByPath(normalizePath(path));
  }
}

/** Reads the raw files of a GitHub repo over HTTP. Uses Obsidian's requestUrl, never fetch. */
export class HttpGithubReader implements GithubReader {
  constructor(private readonly baseUrl: string) {}

  async fetchText(path: string): Promise<string> {
    const response = await requestUrl({ url: `${this.baseUrl}/${path}`, throw: false });
    if (response.status < 200 || response.status > 299) throw new Error(`${response.status} fetching ${path}`);
    return response.text;
  }

  async fetchBinary(path: string): Promise<ArrayBuffer> {
    const response = await requestUrl({ url: `${this.baseUrl}/${path}`, throw: false });
    if (response.status < 200 || response.status > 299) throw new Error(`${response.status} fetching binary ${path}`);
    return response.arrayBuffer;
  }
}

/** Every .db file of the vault, with its path inside the vault and on disk. Empty without a local folder. */
export function listVaultDbFiles(app: App): Array<{ path: string; absPath: string }> {
  const adapter = app.vault.adapter;
  if (!(adapter instanceof FileSystemAdapter)) return [];
  const base = adapter.getBasePath();
  return app.vault
    .getFiles()
    .filter((file) => file.extension === "db")
    .map((file) => ({ path: file.path, absPath: `${base}/${file.path}` }));
}
