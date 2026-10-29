import { describe, expect, it } from "vitest";
import {
  appForEntry,
  fetchCatalog,
  filesToInstall,
  GithubReader,
  groupCatalogEntries,
  isAllowedCatalogUrl,
  McpCatalogEntry,
  McpPackageManifest,
  MCP_PACKAGES_CATALOG_URL,
} from "../../src/mcp-packages/catalog";
import { formatGroupCounts } from "../../src/catalog/mcp-packages-section";

function entry(overrides: Partial<McpCatalogEntry>): McpCatalogEntry {
  return {
    id: "app",
    name: "App",
    tag: "api/app",
    logo: "app",
    path: "packages/app",
    toolCount: 1,
    requestOnlyCount: 0,
    ...overrides,
  };
}

const manifest: McpPackageManifest = {
  id: "jsm-assets",
  name: "Jira Service Management",
  tag: "api/app/assets",
  logo: "jira",
  index: "index.md",
  database: "mcp.db",
  files: [
    { path: "index.md", kind: "index" },
    { path: "a.md", kind: "tool", pair: "req-a.md" },
    { path: "b.md", kind: "tool", pair: "req-b.md" },
    { path: "req-a.md", kind: "request" },
    { path: "req-b.md", kind: "request" },
    { path: "mcp.db", kind: "database" },
  ],
};

function readerWithManifest(text: string): GithubReader {
  return {
    fetchText: async () => text,
    fetchBinary: async () => new ArrayBuffer(0),
  };
}

describe("groupCatalogEntries", () => {
  it("sums the counts of entries sharing a groupId", () => {
    const groups = groupCatalogEntries([
      entry({ id: "confluence-v1", name: "Confluence", groupId: "confluence", toolCount: 3, requestCount: 4 }),
      entry({ id: "confluence-v2", name: "Confluence", groupId: "confluence", toolCount: 2, requestOnlyCount: 1, requestCount: 5 }),
      entry({ id: "solo", name: "Solo", toolCount: 7 }),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ id: "confluence", name: "Confluence", toolCount: 5, requestOnlyCount: 1, requestCount: 9 });
    expect(groups[0].entries.map((e) => e.id)).toEqual(["confluence-v1", "confluence-v2"]);
    expect(groups[1]).toMatchObject({ id: "solo", toolCount: 7, requestCount: 0 });
  });
});

describe("filesToInstall", () => {
  it("returns every file for 'all'", () => {
    expect(filesToInstall(manifest, "all")).toEqual(manifest.files);
  });

  it("returns the index, the tool and its requests, without duplicates", () => {
    const shared: McpPackageManifest = {
      ...manifest,
      files: [
        { path: "index.md", kind: "index" },
        { path: "a.md", kind: "tool", pair: "req-a.md", pairs: ["req-a.md", "req-c.md"] },
        { path: "req-a.md", kind: "request" },
        { path: "req-c.md", kind: "request" },
      ],
    };
    const paths = filesToInstall(shared, { toolPath: "a.md" }).map((f) => f.path);
    expect(paths).toEqual(["index.md", "a.md", "req-a.md", "req-c.md"]);
  });

  it("returns nothing when the tool path is not in the manifest", () => {
    expect(filesToInstall(manifest, { toolPath: "missing.md" })).toEqual([]);
  });
});

describe("appForEntry", () => {
  it("groups Atlassian and Bitbucket services under the Atlassian app", () => {
    expect(appForEntry({ serviceTag: "atlassian/instance" })).toEqual({ name: "Atlassian", logo: "atlassian" });
    expect(appForEntry({ serviceTag: "bitbucket/workspace" })).toEqual({ name: "Atlassian", logo: "atlassian" });
  });

  it("returns undefined without a serviceTag", () => {
    expect(appForEntry({})).toBeUndefined();
  });
});

describe("fetchCatalog", () => {
  it("reads a valid catalog", async () => {
    const text = JSON.stringify({ version: 2, packages: [entry({ id: "x" })] });
    const catalog = await fetchCatalog(readerWithManifest(text));
    expect(catalog.version).toBe(2);
    expect(catalog.packages.map((p) => p.id)).toEqual(["x"]);
  });

  it("rejects a catalog without packages", async () => {
    await expect(fetchCatalog(readerWithManifest(JSON.stringify({ version: 1 })))).rejects.toThrow("Invalid catalog");
  });
});

describe("isAllowedCatalogUrl", () => {
  it("accepts the official packages repo", () => {
    expect(isAllowedCatalogUrl(MCP_PACKAGES_CATALOG_URL)).toBe(true);
  });

  it("rejects other hosts", () => {
    expect(isAllowedCatalogUrl("https://example.com/x")).toBe(false);
  });
});

describe("formatGroupCounts", () => {
  it("formats tools only", () => {
    expect(formatGroupCounts({ toolCount: 60, requestOnlyCount: 0 })).toBe("60 tools");
  });

  it("formats requests only when toolCount is 0", () => {
    expect(formatGroupCounts({ toolCount: 0, requestCount: 60 })).toBe("60 requests");
    expect(formatGroupCounts({ toolCount: 0, requestOnlyCount: 24, requestCount: 24 })).toBe("24 requests");
  });

  it("formats both when toolCount > 0 and requestOnlyCount > 0", () => {
    expect(formatGroupCounts({ toolCount: 61, requestOnlyCount: 44, requestCount: 105 })).toBe("61 tools · 44 requests");
  });

  it("formats 0 tools when everything is 0", () => {
    expect(formatGroupCounts({ toolCount: 0, requestOnlyCount: 0, requestCount: 0 })).toBe("0 tools");
  });
});
