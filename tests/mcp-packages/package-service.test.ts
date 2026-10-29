import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GithubReader, McpCatalogEntry, McpPackageManifest } from "../../src/mcp-packages/catalog";
import type { McpPackageStore } from "../../src/mcp-packages/package-installer";
import { McpPackageService, McpPackageServiceDeps } from "../../src/mcp-packages/package-service";

let dir: string;
let vault: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "mcp-packages-service-"));
  vault = path.join(dir, "vault");
  mkdirSync(vault);
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

/** Creates a .db file with the given content (a function that runs SQL) and returns its path. */
function createDb(file: string, fill: (db: DatabaseSync) => void): string {
  mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  try {
    fill(db);
  } finally {
    db.close();
  }
  return file;
}

/** A package .db: one mcp_package row and `toolCount` request tools. */
function writePackageDb(
  folder: string,
  fileName: string,
  id: string,
  name: string,
  toolCount: number,
  toolPrefix: string = id,
): string {
  return createDb(path.join(folder, fileName), (db) => {
    db.exec(
      "CREATE TABLE mcp_package (id TEXT PRIMARY KEY, name TEXT NOT NULL, app TEXT NOT NULL, tag TEXT NOT NULL, logo TEXT, service_tag TEXT, group_id TEXT, updated_at TEXT NOT NULL);",
    );
    db.prepare("INSERT INTO mcp_package VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
      id,
      name,
      name,
      `mcp/${id}`,
      "logo.png",
      `${id}-service`,
      "atlassian",
      "2026-01-01",
    );
    db.exec("CREATE TABLE tools (id TEXT, title TEXT, kind TEXT, request_id TEXT, description TEXT, params_schema TEXT, tags TEXT);");
    const insert = db.prepare("INSERT INTO tools VALUES (?, ?, ?, ?, ?, ?, ?)");
    for (let i = 1; i <= toolCount; i++) {
      insert.run(`${toolPrefix}_tool_${i}`, `Tool ${i}`, "request", null, `Does thing ${i}`, "{}", '["read"]');
    }
  });
}

/** All .db files under a folder, with vault-relative (slash) paths. */
function listDbFilesIn(root: string): Array<{ path: string; absPath: string }> {
  const found: Array<{ path: string; absPath: string }> = [];
  const walk = (folder: string): void => {
    if (!existsSync(folder)) return;
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const absPath = path.join(folder, entry.name);
      if (entry.isDirectory()) walk(absPath);
      else if (entry.name.endsWith(".db")) {
        found.push({ path: path.relative(root, absPath).split(path.sep).join("/"), absPath });
      }
    }
  };
  walk(root);
  return found;
}

/** Store that keeps text notes in memory and writes binary files to the vault folder on disk. */
class FakeStore implements McpPackageStore {
  readonly texts = new Map<string, string>();

  constructor(private readonly root: string) {}

  private absPath(vaultPath: string): string {
    return path.join(this.root, ...vaultPath.split("/"));
  }

  async findNoteFolder(basename: string): Promise<string | undefined> {
    const file = `${basename}.md`;
    for (const key of this.texts.keys()) {
      if (key === file) return "";
      if (key.endsWith(`/${file}`)) return key.slice(0, -file.length - 1);
    }
    return undefined;
  }

  async exists(vaultPath: string): Promise<boolean> {
    return this.texts.has(vaultPath) || existsSync(this.absPath(vaultPath));
  }

  async ensureFolder(vaultPath: string): Promise<void> {
    mkdirSync(this.absPath(vaultPath), { recursive: true });
  }

  async createText(vaultPath: string, content: string): Promise<void> {
    this.texts.set(vaultPath, content);
  }

  async writeBinary(vaultPath: string, data: ArrayBuffer): Promise<void> {
    mkdirSync(path.dirname(this.absPath(vaultPath)), { recursive: true });
    writeFileSync(this.absPath(vaultPath), Buffer.from(data));
  }

  async trash(vaultPath: string): Promise<void> {
    this.texts.delete(vaultPath);
    rmSync(this.absPath(vaultPath), { force: true });
  }
}

/** Reader that serves binary files from a map (path -> bytes) and no text files. */
function fakeReader(binaries: Record<string, Buffer>): GithubReader {
  return {
    async fetchText(repoPath: string): Promise<string> {
      throw new Error(`unexpected text fetch: ${repoPath}`);
    },
    async fetchBinary(repoPath: string): Promise<ArrayBuffer> {
      const data = binaries[repoPath];
      if (!data) throw new Error(`missing file: ${repoPath}`);
      const copy = new Uint8Array(data.byteLength);
      copy.set(data);
      return copy.buffer;
    },
  };
}

function newService(overrides: Partial<McpPackageServiceDeps> = {}): McpPackageService {
  return new McpPackageService({
    store: new FakeStore(vault),
    reader: () => fakeReader({}),
    listDbFiles: () => listDbFilesIn(vault),
    ...overrides,
  });
}

describe("McpPackageService.list", () => {
  it("lists two packages sorted by name, with their tool counts", () => {
    writePackageDb(path.join(vault, "Zeta"), "zeta.db", "zeta", "Zeta", 3);
    writePackageDb(path.join(vault, "Alpha"), "alpha.db", "alpha", "Alpha", 1);

    const packages = newService().list();

    expect(packages.map((p) => p.name)).toEqual(["Alpha", "Zeta"]);
    expect(packages.map((p) => p.toolCount)).toEqual([1, 3]);
    expect(packages.map((p) => p.id)).toEqual(["alpha", "zeta"]);
    expect(packages.map((p) => p.dbPath)).toEqual(["Alpha/alpha.db", "Zeta/zeta.db"]);
  });

  it("keeps the package identity columns", () => {
    writePackageDb(path.join(vault, "Alpha"), "alpha.db", "alpha", "Alpha", 1);

    expect(newService().list()[0]).toMatchObject({
      app: "Alpha",
      tag: "mcp/alpha",
      logo: "logo.png",
      serviceTag: "alpha-service",
      groupId: "atlassian",
    });
  });

  it("a corrupted file does not stop the other packages from being listed", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mkdirSync(path.join(vault, "Broken"), { recursive: true });
    writeFileSync(path.join(vault, "Broken", "broken.db"), "this is not a sqlite database");
    writePackageDb(path.join(vault, "Good"), "good.db", "good", "Good", 2);

    const packages = newService().list();

    expect(packages.map((p) => p.id)).toEqual(["good"]);
    expect(packages[0].toolCount).toBe(2);
  });

  it("a .db without tables does not appear", () => {
    createDb(path.join(vault, "Empty", "empty.db"), (db) => db.exec("CREATE TABLE other (x TEXT);"));
    writePackageDb(path.join(vault, "Alpha"), "alpha.db", "alpha", "Alpha", 1);

    const packages = newService().list();

    expect(packages.map((p) => p.id)).toEqual(["alpha"]);
  });

  it("when two files give the same id, the first one wins", () => {
    const first = writePackageDb(path.join(vault, "Alpha"), "dup.db", "dup", "Alpha", 1);
    const second = writePackageDb(path.join(vault, "Beta"), "dup.db", "dup", "Beta", 5);
    const service = newService({
      listDbFiles: () => [
        { path: "Alpha/dup.db", absPath: first },
        { path: "Beta/dup.db", absPath: second },
      ],
    });

    const packages = service.list();

    expect(packages).toHaveLength(1);
    expect(packages[0].name).toBe("Alpha");
    expect(packages[0].toolCount).toBe(1);
  });
});

describe("McpPackageService.onChange", () => {
  it("does not notify when a refresh changes nothing, and notifies once when a new package appears", () => {
    writePackageDb(path.join(vault, "Alpha"), "alpha.db", "alpha", "Alpha", 1);
    const service = newService();
    expect(service.list()).toHaveLength(1);

    const listener = vi.fn();
    service.onChange(listener);
    service.refresh();
    expect(listener).not.toHaveBeenCalled();

    writePackageDb(path.join(vault, "Zeta"), "zeta.db", "zeta", "Zeta", 2);
    service.refresh();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(service.list()).toHaveLength(2);
  });

  it("stops notifying after the unsubscribe function is called", () => {
    const service = newService();
    const listener = vi.fn();
    const unsubscribe = service.onChange(listener);

    writePackageDb(path.join(vault, "Alpha"), "alpha.db", "alpha", "Alpha", 1);
    service.refresh();
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    writePackageDb(path.join(vault, "Zeta"), "zeta.db", "zeta", "Zeta", 1);
    service.refresh();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("a listener that throws does not stop the other listeners", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const service = newService();
    const failing = vi.fn(() => {
      throw new Error("boom");
    });
    const healthy = vi.fn();
    service.onChange(failing);
    service.onChange(healthy);

    writePackageDb(path.join(vault, "Alpha"), "alpha.db", "alpha", "Alpha", 1);
    service.refresh();

    expect(failing).toHaveBeenCalledTimes(1);
    expect(healthy).toHaveBeenCalledTimes(1);
  });
});

describe("McpPackageService.indexEntries", () => {
  it("returns an api entry for every tool of every package", () => {
    writePackageDb(path.join(vault, "Alpha"), "alpha.db", "alpha", "Alpha", 1);
    writePackageDb(path.join(vault, "Zeta"), "zeta.db", "zeta", "Zeta", 2);

    const entries = newService().indexEntries();

    expect(entries).toHaveLength(3);
    expect(entries.every((e) => e.kind === "api")).toBe(true);
    expect(entries.map((e) => e.name).sort()).toEqual(["alpha_tool_1", "zeta_tool_1", "zeta_tool_2"]);
  });

  it("a tool id shared by two packages is indexed once, from the first package", () => {
    const first = writePackageDb(path.join(vault, "Zeta"), "zeta.db", "zeta", "Zeta", 1, "shared");
    const second = writePackageDb(path.join(vault, "Alpha"), "alpha.db", "alpha", "Alpha", 1, "shared");
    const service = newService({
      listDbFiles: () => [
        { path: "Zeta/zeta.db", absPath: first },
        { path: "Alpha/alpha.db", absPath: second },
      ],
    });

    const entries = service.indexEntries();

    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe("shared_tool_1");
    expect(entries[0].categoria).toBe("Zeta");
  });
});

describe("McpPackageService install and remove", () => {
  it("install then remove takes isInstalled from false to true to false", async () => {
    const repo = path.join(dir, "repo");
    const source = writePackageDb(path.join(repo, "packages"), "jira-test.db", "jira-test", "Jira", 2);
    const reader = fakeReader({ "packages/jira-test/jira-test.db": readFileSync(source) });
    const service = newService({ store: new FakeStore(vault), reader: () => reader });

    const entry: McpCatalogEntry = {
      id: "jira-test",
      name: "Jira",
      tag: "mcp/jira-test",
      logo: "jira",
      path: "packages/jira-test",
      toolCount: 2,
      requestOnlyCount: 0,
    };
    const manifest: McpPackageManifest = {
      id: "jira-test",
      name: "Jira",
      tag: "mcp/jira-test",
      logo: "jira",
      index: "",
      files: [{ path: "jira-test.db", kind: "database" }],
    };

    expect(service.isInstalled("jira-test")).toBe(false);

    await service.install(entry, manifest, "all");
    expect(service.isInstalled("jira-test")).toBe(true);
    expect(service.list()[0].dbPath).toBe("Jira/jira-test.db");

    await service.remove(entry, manifest, false);
    expect(service.isInstalled("jira-test")).toBe(false);
  });
});

describe("McpPackageService.fetchCatalog", () => {
  it("rejects a catalog URL outside the official packages repo", async () => {
    const service = newService({ catalogUrl: "https://example.com/x" });

    await expect(service.fetchCatalog()).rejects.toThrow("Catalog URL not allowed");
  });
});
