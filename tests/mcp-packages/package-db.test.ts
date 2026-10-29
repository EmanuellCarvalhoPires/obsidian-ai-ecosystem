import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readPackageDb } from "../../src/mcp-packages/package-db";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "package-db-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Creates a .db file in the temp folder with the given SQL and returns its path. */
function makeDb(sql: string): string {
  const file = path.join(dir, `mcp-${Math.random().toString(36).slice(2)}.db`);
  const db = new DatabaseSync(file);
  try {
    db.exec(sql);
  } finally {
    db.close();
  }
  return file;
}

const PACKAGE_DDL = `
CREATE TABLE mcp_package (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, version TEXT NOT NULL, app TEXT NOT NULL, tag TEXT NOT NULL, logo TEXT,
  service_tag TEXT, service_param TEXT, service_template TEXT, group_id TEXT,
  tool_count INTEGER NOT NULL, request_count INTEGER NOT NULL, updated_at TEXT NOT NULL
);
INSERT INTO mcp_package VALUES ('jira', 'Jira', '1.0.0', 'jira', 'mcp/jira', 'logo.png', 'jira-service', NULL, NULL, 'atlassian', 1, 1, '2026-01-01');
`;

const TOOLS_DDL = `
CREATE TABLE tools (
  id TEXT, title TEXT, kind TEXT, request_id TEXT, description TEXT,
  service_tag TEXT, service_param TEXT, service_exclude_tag TEXT,
  params_schema TEXT, tags TEXT
);
INSERT INTO tools VALUES ('jira_get_issue', 'Get issue', 'request', 'get_issue', 'Reads an issue', NULL, NULL, NULL, '{}', '["read"]');
`;

const REQUESTS_DDL = `
CREATE TABLE requests (
  id TEXT, title TEXT, method TEXT, path TEXT, category TEXT, writes_data INTEGER,
  doc_url TEXT, description TEXT, parameters_schema TEXT, body_schema TEXT, tags TEXT
);
INSERT INTO requests VALUES ('get_issue', 'Get issue', 'GET', '/rest/api/3/issue/{id}', NULL, 0, NULL, 'Gets an issue', NULL, NULL, NULL);
`;

describe("readPackageDb", () => {
  it("reads the package, the tools and the requests (requests indexed by id)", () => {
    const file = makeDb(PACKAGE_DDL + TOOLS_DDL + REQUESTS_DDL);

    const content = readPackageDb(file);

    expect(content.package?.id).toBe("jira");
    expect(content.package?.name).toBe("Jira");
    expect(content.package?.tag).toBe("mcp/jira");
    expect(content.package?.logo).toBe("logo.png");
    expect(content.package?.service_tag).toBe("jira-service");
    expect(content.package?.group_id).toBe("atlassian");
    expect(content.package?.updated_at).toBe("2026-01-01");
    expect(content.tools).toHaveLength(1);
    expect(content.tools[0].id).toBe("jira_get_issue");
    expect(content.tools[0].tags).toBe('["read"]');
    expect(content.requests.get("get_issue")?.path).toBe("/rest/api/3/issue/{id}");
    expect(content.requests.size).toBe(1);
  });

  it("only the tools table: no package, no requests", () => {
    const file = makeDb(TOOLS_DDL);

    const content = readPackageDb(file);

    expect(content.package).toBeUndefined();
    expect(content.tools.map((t) => t.id)).toEqual(["jira_get_issue"]);
    expect(content.requests.size).toBe(0);
  });

  it("no tables at all: empty content", () => {
    const file = makeDb("CREATE TABLE other (x TEXT);");

    const content = readPackageDb(file);

    expect(content.package).toBeUndefined();
    expect(content.tools).toEqual([]);
    expect(content.requests).toBeInstanceOf(Map);
    expect(content.requests.size).toBe(0);
  });

  it("throws when the file does not exist", () => {
    expect(() => readPackageDb(path.join(dir, "missing.db"))).toThrow();
  });
});
