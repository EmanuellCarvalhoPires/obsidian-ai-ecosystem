// Lists the MCP packages installed in the vault (their .db files) and installs or removes
// downloaded ones. Obsidian-free: vault access comes in through McpPackageServiceDeps.

import type { InstalledMcpPackage, McpPackagesHost, ToolIndexEntry } from "../types";
import {
  GithubReader,
  McpCatalog,
  McpCatalogEntry,
  McpCatalogGroup,
  McpDownloadSelection,
  McpPackageManifest,
  MCP_PACKAGES_CATALOG_URL,
  fetchCatalog as loadCatalog,
  fetchPackageManifest,
  isAllowedCatalogUrl,
} from "./catalog";
import { InstallResult, McpPackageStore, ensureHubFolder, installPackage, removePackage } from "./package-installer";
import { PackageDbContent, RawToolRecord, readPackageDb, readPackageDbRawTools } from "./package-db";
import { buildPackageIndexEntries, packageKeys } from "./package-index";

export interface McpPackageServiceDeps {
  store: McpPackageStore;
  reader: () => GithubReader;
  /** Every .db file of the vault: vault-relative path and absolute path. */
  listDbFiles: () => Array<{ path: string; absPath: string }>;
  catalogUrl?: string;
}

interface Scanned {
  pkg: InstalledMcpPackage;
  updatedAt: string;
  entries: ToolIndexEntry[];
}

export class McpPackageService implements McpPackagesHost {
  private packages: InstalledMcpPackage[] = [];
  private entries: ToolIndexEntry[] = [];
  private signature = "";
  private loaded = false;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly deps: McpPackageServiceDeps) {}

  /** Rejects when the catalog URL is not the official packages repo. */
  async fetchCatalog(): Promise<McpCatalog> {
    const url = this.deps.catalogUrl ?? MCP_PACKAGES_CATALOG_URL;
    if (!isAllowedCatalogUrl(url)) throw new Error("Catalog URL not allowed");
    return loadCatalog(this.deps.reader());
  }

  fetchManifest(entry: McpCatalogEntry): Promise<McpPackageManifest> {
    return fetchPackageManifest(this.deps.reader(), entry);
  }

  list(): InstalledMcpPackage[] {
    this.ensureLoaded();
    return [...this.packages];
  }

  indexEntries(): ToolIndexEntry[] {
    this.ensureLoaded();
    return [...this.entries];
  }

  isInstalled(entryId: string): boolean {
    this.ensureLoaded();
    return this.packages.some((pkg) => pkg.id === entryId);
  }

  /** Gets all tool and request rows from the SQLite databases installed for this catalog group. */
  getRawToolsForGroup(group: McpCatalogGroup): RawToolRecord[] {
    this.ensureLoaded();
    const dbFiles = new Map<string, string>();
    for (const f of this.deps.listDbFiles()) {
      dbFiles.set(f.path.replace(/\\/g, "/"), f.absPath);
    }

    const records: RawToolRecord[] = [];
    for (const entry of group.entries) {
      const pkg = this.packages.find((p) => p.id === entry.id);
      if (!pkg) continue;
      const normalizedDbPath = pkg.dbPath.replace(/\\/g, "/");
      const absPath = dbFiles.get(normalizedDbPath);
      if (!absPath) continue;
      try {
        const tools = readPackageDbRawTools(absPath, { id: pkg.id, name: pkg.name });
        records.push(...tools);
      } catch (err) {
        console.warn(`Failed to read raw tools from ${absPath}`, err);
      }
    }
    return records;
  }

  /** Rescans the vault. Listeners are told only when the list changed. */
  refresh(): void {
    if (this.reload()) this.notify();
  }

  async install(
    entry: McpCatalogEntry,
    manifest: McpPackageManifest,
    selection: McpDownloadSelection,
    onProgress?: (done: number, total: number) => void,
  ): Promise<InstallResult> {
    await ensureHubFolder(this.deps.store);
    const result = await installPackage(this.deps.store, this.deps.reader(), entry, manifest, selection, onProgress);
    this.refresh();
    return result;
  }

  async remove(entry: McpCatalogEntry, manifest: McpPackageManifest | undefined, deleteNotes: boolean): Promise<void> {
    const hubFolder = await ensureHubFolder(this.deps.store);
    const installed = this.packages.find((pkg) => pkg.id === entry.id);
    let resolvedManifest = manifest;
    if (!resolvedManifest && deleteNotes) {
      try {
        resolvedManifest = await this.fetchManifest(entry);
      } catch {
        // Continue with best-effort deletion if manifest can't be fetched
      }
    }
    await removePackage(this.deps.store, hubFolder, entry, resolvedManifest, deleteNotes, installed?.dbPath);
    this.refresh();
  }

  /** Returns the unsubscribe function. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Loads the cache without telling listeners (first use only). */
  private ensureLoaded(): void {
    if (!this.loaded) this.reload();
  }

  /** Replaces the cache. Returns true when the list changed. */
  private reload(): boolean {
    const scanned = this.scan();
    const signature = scanned.map(({ pkg, updatedAt }) => `${pkg.id}|${pkg.toolCount}|${pkg.requestCount ?? 0}|${updatedAt}`).join("\n");
    this.packages = scanned.map((item) => item.pkg);
    this.entries = scanned.flatMap((item) => item.entries);
    this.loaded = true;
    const changed = signature !== this.signature;
    this.signature = signature;
    return changed;
  }

  /** Reads every .db file; unreadable ones are skipped, and so are files that are not packages. */
  private scan(): Scanned[] {
    const seen = new Set<string>();
    const seenTools = new Set<string>(); // tool ids already indexed: the first package wins
    const found: Scanned[] = [];
    for (const file of this.deps.listDbFiles()) {
      let content: PackageDbContent;
      try {
        content = readPackageDb(file.absPath);
      } catch (error) {
        console.warn(`MCP package skipped: ${file.path}`, error);
        continue;
      }

      const pkg = content.package;
      if (!pkg && content.tools.length === 0) continue;

      const parts = file.path.replace(/\\/g, "/").split("/");
      const basename = (parts[parts.length - 1] ?? "").replace(/\.[^.]*$/, "");
      const folderName = parts.length >= 2 ? parts[parts.length - 2] : "";
      const id = pkg?.id || basename;
      if (seen.has(id)) continue;
      seen.add(id);

      const name = pkg?.name || pkg?.app || folderName;
      const entries = buildPackageIndexEntries(content, name, packageKeys(pkg, folderName, basename)).filter(
        (entry) => {
          if (seenTools.has(entry.name)) return false;
          seenTools.add(entry.name);
          return true;
        },
      );
      found.push({
        pkg: {
          id,
          name,
          app: pkg?.app ?? "",
          tag: pkg?.tag ?? "",
          logo: pkg?.logo ?? "",
          serviceTag: pkg?.service_tag ?? undefined,
          groupId: pkg?.group_id ?? undefined,
          toolCount: content.tools.length,
          requestCount: content.requests.size,
          dbPath: file.path,
        },
        updatedAt: pkg?.updated_at ?? "",
        entries,
      });
    }
    return found.sort((a, b) => a.pkg.name.localeCompare(b.pkg.name));
  }

  private notify(): void {
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch (error) {
        console.warn("MCP package listener failed", error);
      }
    }
  }
}
