import { describe, expect, it } from "vitest";
import { GithubReader, McpCatalogEntry, McpPackageFile, McpPackageManifest } from "../../src/mcp-packages/catalog";
import {
  ensureHubFolder,
  installPackage,
  McpPackageStore,
  packageTargetFolder,
  removePackage,
  targetPathOf,
} from "../../src/mcp-packages/package-installer";

/** In-memory vault: text notes, binary files and folders, keyed by full path. */
class FakeStore implements McpPackageStore {
  files = new Map<string, string | ArrayBuffer>();
  folders = new Set<string>();
  ensured: string[] = [];
  trashed: string[] = [];

  async findNoteFolder(basename: string): Promise<string | undefined> {
    for (const [path, value] of this.files) {
      if (typeof value !== "string") continue;
      if (path === `${basename}.md`) return "";
      if (path.endsWith(`/${basename}.md`)) return path.slice(0, path.lastIndexOf("/"));
    }
    return undefined;
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path) || this.folders.has(path);
  }

  async ensureFolder(path: string): Promise<void> {
    this.ensured.push(path);
    this.folders.add(path);
  }

  async createText(path: string, content: string): Promise<void> {
    if (this.files.has(path)) throw new Error(`createText would overwrite ${path}`);
    this.files.set(path, content);
  }

  async writeBinary(path: string, data: ArrayBuffer): Promise<void> {
    this.files.set(path, data);
  }

  async trash(path: string): Promise<void> {
    this.trashed.push(path);
    this.files.delete(path);
  }

  /** Paths under a folder, sorted, for easy comparison. */
  under(folder: string): string[] {
    return [...this.files.keys()].filter((p) => p.startsWith(`${folder}/`)).sort();
  }
}

class FakeReader implements GithubReader {
  texts = new Map<string, string>();
  binaries = new Map<string, ArrayBuffer>();
  requested: string[] = [];

  async fetchText(path: string): Promise<string> {
    this.requested.push(path);
    const text = this.texts.get(path);
    if (text === undefined) throw new Error(`missing ${path}`);
    return text;
  }

  async fetchBinary(path: string): Promise<ArrayBuffer> {
    this.requested.push(path);
    const data = this.binaries.get(path);
    if (!data) throw new Error(`missing ${path}`);
    return data;
  }
}

const bytes = (data: ArrayBuffer): number[] => Array.from(new Uint8Array(data));
const bin = (...values: number[]): ArrayBuffer => new Uint8Array(values).buffer;

const entry: McpCatalogEntry = {
  id: "jsm-assets",
  name: "Jira Service Management",
  tag: "api/app/assets",
  logo: "jira",
  path: "packages/jsm",
  toolCount: 2,
  requestOnlyCount: 0,
};

const PKG = "Dados/Jira Service Management";

// Index, two tools and a database, no request notes.
const toolsOnly: McpPackageManifest = {
  id: "jsm-assets",
  name: "Jira Service Management",
  tag: "api/app/assets",
  logo: "jira",
  index: "index.md",
  database: "mcp.db",
  files: [
    { path: "index.md", kind: "index" },
    { path: "a.md", kind: "tool", pair: null },
    { path: "b.md", kind: "tool", pair: null },
    { path: "mcp.db", kind: "database" },
  ],
};

// Same, but each tool needs its own request note.
const paired: McpPackageManifest = {
  ...toolsOnly,
  files: [
    { path: "index.md", kind: "index" },
    { path: "a.md", kind: "tool", pair: "req-a.md" },
    { path: "b.md", kind: "tool", pair: "req-b.md" },
    { path: "req-a.md", kind: "request" },
    { path: "req-b.md", kind: "request" },
    { path: "mcp.db", kind: "database" },
  ],
};

/** A reader that serves every file of a manifest, and the database bytes. */
function readerFor(manifest: McpPackageManifest): FakeReader {
  const reader = new FakeReader();
  for (const file of manifest.files) {
    if (file.kind === "database") reader.binaries.set(`${entry.path}/${file.path}`, bin(1, 2, 3));
    else reader.texts.set(`${entry.path}/${file.path}`, `content of ${file.path}`);
  }
  return reader;
}

describe("ensureHubFolder", () => {
  it("creates the hub note in the root when the vault has none", async () => {
    const store = new FakeStore();
    expect(await ensureHubFolder(store)).toBe("");
    const note = store.files.get("MCP Tools.md");
    expect(typeof note).toBe("string");
    expect(note).toContain("# MCP Tools");
    expect(note).toContain("  - moc");
    expect(note).toContain("```dataview");
  });

  it("returns the folder of an existing hub note", async () => {
    const store = new FakeStore();
    store.files.set("Dados/MCP Tools.md", "my hub");
    expect(await ensureHubFolder(store)).toBe("Dados");
    expect(store.files.has("MCP Tools.md")).toBe(false);
    expect(store.files.get("Dados/MCP Tools.md")).toBe("my hub");
  });
});

describe("paths", () => {
  it("packageTargetFolder puts the package under the hub folder", () => {
    expect(packageTargetFolder("Dados", entry)).toBe("Dados/Jira Service Management");
    expect(packageTargetFolder("", entry)).toBe("Jira Service Management");
  });

  it("targetPathOf names a database after the package id and normalizes backslashes", () => {
    const db: McpPackageFile = { path: "mcp.db", kind: "database" };
    const tool: McpPackageFile = { path: "tools\\a.md", kind: "tool" };
    expect(targetPathOf("Dados\\Pkg", entry, db)).toBe("Dados/Pkg/jsm-assets.db");
    expect(targetPathOf("Dados\\Pkg", entry, tool)).toBe("Dados/Pkg/tools/a.md");
  });
});

describe("installPackage", () => {
  it("writes the missing files, skips an existing note and overwrites the database", async () => {
    const store = new FakeStore();
    store.files.set("Dados/MCP Tools.md", "hub");
    store.files.set(`${PKG}/index.md`, "mine");
    const reader = readerFor(toolsOnly);
    const progress: Array<[number, number]> = [];

    const result = await installPackage(store, reader, entry, toolsOnly, "all", (done, total) => progress.push([done, total]));

    expect(result).toEqual({ written: 3, skipped: 1 });
    expect(store.files.get(`${PKG}/index.md`)).toBe("mine");
    expect(store.files.get(`${PKG}/a.md`)).toBe("content of a.md");
    expect(store.files.get(`${PKG}/b.md`)).toBe("content of b.md");
    expect(bytes(store.files.get(`${PKG}/jsm-assets.db`) as ArrayBuffer)).toEqual([1, 2, 3]);
    expect(store.files.has(`${PKG}/mcp.db`)).toBe(false);
    expect(store.ensured).toEqual([PKG]);
    expect(progress).toEqual([[1, 4], [2, 4], [3, 4], [4, 4]]);
  });

  it("overwrites the database on reinstall but keeps the notes", async () => {
    const store = new FakeStore();
    store.files.set("Dados/MCP Tools.md", "hub");
    const reader = readerFor(toolsOnly);
    await installPackage(store, reader, entry, toolsOnly, "all");

    reader.binaries.set(`${entry.path}/mcp.db`, bin(9));
    const again = await installPackage(store, reader, entry, toolsOnly, "all");

    expect(again).toEqual({ written: 1, skipped: 3 });
    expect(bytes(store.files.get(`${PKG}/jsm-assets.db`) as ArrayBuffer)).toEqual([9]);
  });

  it("installs only the index, the tool and its requests for one tool", async () => {
    const store = new FakeStore();
    store.files.set("Dados/MCP Tools.md", "hub");
    const reader = readerFor(paired);

    const result = await installPackage(store, reader, entry, paired, { toolPath: "a.md" });

    expect(result).toEqual({ written: 3, skipped: 0 });
    expect(store.under(PKG)).toEqual([`${PKG}/a.md`, `${PKG}/index.md`, `${PKG}/req-a.md`]);
    expect(reader.requested).not.toContain(`${entry.path}/b.md`);
    expect(reader.requested).not.toContain(`${entry.path}/req-b.md`);
  });
});

describe("removePackage", () => {
  function seededStore(): FakeStore {
    const store = new FakeStore();
    store.files.set(`${PKG}/jsm-assets.db`, bin(1));
    store.files.set(`${PKG}/index.md`, "index");
    store.files.set(`${PKG}/a.md`, "a");
    store.folders.add(PKG);
    return store;
  }

  it("with deleteNotes off, trashes only the database", async () => {
    const store = seededStore();
    await removePackage(store, "Dados", entry, paired, false);
    expect(store.trashed).toEqual([`${PKG}/jsm-assets.db`]);
    expect(store.files.has(`${PKG}/index.md`)).toBe(true);
  });

  it("with deleteNotes on, also trashes the manifest notes that exist", async () => {
    const store = seededStore();
    await removePackage(store, "Dados", entry, paired, true);
    expect(store.trashed).toEqual([`${PKG}/jsm-assets.db`, `${PKG}/index.md`, `${PKG}/a.md`]);
    expect(store.folders.has(PKG)).toBe(true);
  });

  it("trashes legacy mcp.db if present instead of or in addition to entry.id.db", async () => {
    const store = new FakeStore();
    store.files.set(`${PKG}/mcp.db`, bin(1));
    await removePackage(store, "Dados", entry, undefined, false);
    expect(store.trashed).toContain(`${PKG}/mcp.db`);
  });

  it("trashes knownDbPath if passed", async () => {
    const store = new FakeStore();
    store.files.set("Other/custom.db", bin(1));
    await removePackage(store, "Dados", entry, undefined, false, "Other/custom.db");
    expect(store.trashed).toContain("Other/custom.db");
  });

  it("with deleteNotes on and no manifest, still trashes standard index note", async () => {
    const store = new FakeStore();
    store.files.set(`${PKG}/mcp.db`, bin(1));
    store.files.set(`${PKG}/MCP - ${entry.name}.md`, "index content");
    await removePackage(store, "Dados", entry, undefined, true);
    expect(store.trashed).toEqual([`${PKG}/mcp.db`, `${PKG}/MCP - ${entry.name}.md`]);
  });
});
