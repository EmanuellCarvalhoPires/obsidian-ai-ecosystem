import { describe, expect, it } from "vitest";
import { buildPackageIndexEntries, effectOf, packageKeys, slugKey } from "../../src/mcp-packages/package-index";
import type { McpDbRequestRow, McpDbToolRow, PackageDbContent } from "../../src/mcp-packages/package-db";

function tool(overrides: Partial<McpDbToolRow> = {}): McpDbToolRow {
  return {
    id: "jira_get_issue",
    title: "Get issue",
    kind: "request",
    request_id: "get_issue",
    description: "Reads an issue",
    service_tag: null,
    service_param: null,
    service_exclude_tag: null,
    params_schema: null,
    tags: '["read"]',
    ...overrides,
  };
}

function request(overrides: Partial<McpDbRequestRow> = {}): McpDbRequestRow {
  return {
    id: "get_issue",
    title: "Get issue",
    method: "GET",
    path: "/rest/api/3/issue/{id}",
    category: null,
    writes_data: 0,
    doc_url: null,
    description: "Gets an issue",
    parameters_schema: null,
    body_schema: null,
    tags: null,
    ...overrides,
  };
}

function content(tools: McpDbToolRow[], requests: McpDbRequestRow[] = [request()]): PackageDbContent {
  return {
    package: {
      id: "jira",
      name: "Jira",
      app: "jira",
      tag: "mcp/jira",
      logo: null,
      service_tag: null,
      group_id: "atlassian",
      updated_at: "2026-01-01",
    },
    tools,
    requests: new Map(requests.map((r) => [r.id, r])),
  };
}

describe("effectOf", () => {
  it("GET, HEAD and OPTIONS are reads", () => {
    expect(effectOf(false, { method: "GET", path: "/x" })).toBe("leitura");
    expect(effectOf(true, { method: "head", path: "/x" })).toBe("leitura");
    expect(effectOf(true, { method: "OPTIONS", path: "/x" })).toBe("leitura");
  });

  it("POST to a JQL search is a read", () => {
    expect(effectOf(true, { method: "POST", path: "/rest/api/3/search/jql" })).toBe("leitura");
    expect(effectOf(true, { method: "POST", path: "/rest/api/3/jql/parse" })).toBe("leitura");
  });

  it("other writes are external, and no endpoint follows the writes flag", () => {
    expect(effectOf(false, { method: "DELETE", path: "/rest/api/3/issue/{id}" })).toBe("externo");
    expect(effectOf(false, { method: "POST", path: "/rest/api/3/issue" })).toBe("externo");
    expect(effectOf(true)).toBe("externo");
    expect(effectOf(false)).toBe("leitura");
  });
});

describe("buildPackageIndexEntries", () => {
  it("GET endpoint: read, description starts with the method and path, tags have api and get", () => {
    const [entry] = buildPackageIndexEntries(content([tool()]), "fallback", ["jira"]);

    expect(entry.name).toBe("jira_get_issue");
    expect(entry.kind).toBe("api");
    expect(entry.efeito).toBe("leitura");
    expect(entry.exposicao).toBe("indice");
    expect(entry.categoria).toBe("Jira");
    expect(entry.description.startsWith("GET /rest/api/3/issue/{id}.")).toBe(true);
    expect(entry.description).toBe("GET /rest/api/3/issue/{id}. Reads an issue");
    expect(entry.tags).toEqual(expect.arrayContaining(["api", "get"]));
    expect(entry.tags).toEqual(["api", "get", "jira"]);
    expect(entry.resumo).toBe("Get issue");
  });

  it("POST to a JQL search is read", () => {
    const req = request({ id: "search", method: "POST", path: "/rest/api/3/search/jql" });
    const [entry] = buildPackageIndexEntries(
      content([tool({ id: "jira_search", request_id: "search" })], [req]),
      "fallback",
      [],
    );

    expect(entry.efeito).toBe("leitura");
  });

  it("DELETE endpoint is external", () => {
    const req = request({ id: "del", method: "DELETE", path: "/rest/api/3/issue/{id}" });
    const [entry] = buildPackageIndexEntries(content([tool({ request_id: "del", tags: null })], [req]), "fallback", []);

    expect(entry.efeito).toBe("externo");
  });

  it("no request with a write tag is external", () => {
    const [entry] = buildPackageIndexEntries(
      content([tool({ request_id: null, tags: '["write"]' })], []),
      "fallback",
      [],
    );

    expect(entry.efeito).toBe("externo");
    expect(entry.description).toBe("Reads an issue");
    expect(entry.tags).toEqual(["api"]);
  });

  it("no request and no write tag is read", () => {
    const [entry] = buildPackageIndexEntries(content([tool({ request_id: null, tags: null })], []), "fallback", []);

    expect(entry.efeito).toBe("leitura");
  });

  it("required parameter without default is required; the one with default is not", () => {
    const params = JSON.stringify({
      issueIdOrKey: { type: "string", required: true, description: "Issue id" },
      maxResults: { type: "integer", required: true, default: 50 },
    });
    const [entry] = buildPackageIndexEntries(content([tool({ params_schema: params })]), "fallback", []);

    expect(entry.inputSchema).toEqual({
      type: "object",
      properties: {
        issueIdOrKey: { type: "string", description: "Issue id" },
        maxResults: { type: "integer", default: 50 },
        max_chars: { type: "integer", description: expect.stringContaining("Cut the response") },
      },
      additionalProperties: false,
      required: ["issueIdOrKey"],
    });
    expect(entry.exemplo).toEqual({ issueIdOrKey: "<issueIdOrKey>", maxResults: 50 });
  });

  it("declares the instance parameter first and required when the tool picks an instance", () => {
    const params = JSON.stringify({ issueIdOrKey: { type: "string", required: true } });
    const [entry] = buildPackageIndexEntries(
      content([tool({ params_schema: params, service_tag: "atlassian/instance", service_param: "instance" })]),
      "fallback",
      [],
    );

    const schema = entry.inputSchema as { properties: Record<string, { description?: string }>; required: string[] };
    expect(Object.keys(schema.properties)).toEqual(["instance", "issueIdOrKey", "max_chars"]);
    expect(schema.required).toEqual(["instance", "issueIdOrKey"]);
    expect(schema.properties.instance.description).toContain("#atlassian/instance");
    expect(entry.exemplo).toEqual({ instance: "<instance>", issueIdOrKey: "<issueIdOrKey>" });
  });

  it("does not repeat an instance parameter the package already lists", () => {
    const params = JSON.stringify({ instance: { type: "string", required: true, description: "mine" } });
    const [entry] = buildPackageIndexEntries(
      content([tool({ params_schema: params, service_tag: "atlassian/instance", service_param: "instance" })]),
      "fallback",
      [],
    );

    const schema = entry.inputSchema as { properties: Record<string, { description?: string }> };
    expect(schema.properties.instance.description).toBe("mine");
  });

  it("invalid params_schema and tags do not throw", () => {
    const [entry] = buildPackageIndexEntries(
      content([tool({ params_schema: "{not json", tags: "[oops" })]),
      "fallback",
      [],
    );

    expect(entry.inputSchema).toEqual({
      type: "object",
      properties: { max_chars: { type: "integer", description: expect.stringContaining("Cut the response") } },
      additionalProperties: false,
    });
    expect(entry.exemplo).toEqual({});
    expect(entry.efeito).toBe("leitura");
  });

  it("script tools are not indexed; request tools are", () => {
    const entries = buildPackageIndexEntries(
      content([tool({ id: "jira_script", kind: "script", request_id: null }), tool({ id: "jira_get_issue" })]),
      "fallback",
      [],
    );

    expect(entries.map((e) => e.name)).toEqual(["jira_get_issue"]);
  });

  it("any kind other than script is indexed, as Env Keys maps it to request", () => {
    const [entry] = buildPackageIndexEntries(content([tool({ kind: "" })]), "fallback", []);

    expect(entry.name).toBe("jira_get_issue");
  });

  it("falls back to the given name when the package has no name or app", () => {
    const base = content([tool({ request_id: null })], []);
    const [entry] = buildPackageIndexEntries({ ...base, package: undefined }, "my-folder", []);

    expect(entry.categoria).toBe("my-folder");
  });
});

describe("slugKey and packageKeys", () => {
  it("slugKey lowercases, drops accents and joins other characters with dashes", () => {
    expect(slugKey("  Jira Service_Management!! ")).toBe("jira-service-management");
    expect(slugKey("Comunicação")).toBe("comunicacao");
  });

  it("packageKeys skips empty and repeated values", () => {
    const pkg = { id: "jira", name: "Jira", app: "jira", tag: "api/app/jira" };

    expect(packageKeys(pkg, "Jira", "mcp")).toEqual(["jira"]);
    expect(packageKeys(undefined, undefined, "")).toEqual([]);
  });

  it("packageKeys never includes the generic mcp basename", () => {
    const pkg = { id: "jira", name: "Jira", app: "jira", tag: "api/app/jira" };

    expect(packageKeys(pkg, undefined, "mcp")).not.toContain("mcp");
  });

  it("packageKeys uses the last tag segment even when app differs", () => {
    const pkg = { id: "p1", name: "Pkg", app: "other", tag: "api/app/jira" };

    expect(packageKeys(pkg, undefined, "mcp")).toEqual(["p1", "pkg", "other", "jira"]);
  });

  it("packageKeys keeps a basename that is not mcp", () => {
    const pkg = { id: "jira", name: "Jira", app: "jira", tag: "api/app/jira" };

    expect(packageKeys(pkg, "Folder", "My File")).toEqual(["jira", "folder", "my-file"]);
  });
});
