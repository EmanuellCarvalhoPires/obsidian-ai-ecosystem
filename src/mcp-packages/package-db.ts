// Read-only access to the .db file of an MCP package (tables mcp_package, tools and requests). Pure Node.

import { DatabaseSync } from "node:sqlite";

export interface McpDbToolRow {
  id: string;
  title: string;
  kind: string;
  request_id: string | null;
  description: string;
  service_tag: string | null;
  service_param: string | null;
  service_exclude_tag: string | null;
  response_fields?: string | null;
  params_schema: string | null;
  tags: string | null;
}

export interface McpDbRequestRow {
  id: string;
  title: string;
  method: string;
  path: string;
  category: string | null;
  writes_data: number;
  doc_url: string | null;
  description: string;
  parameters_schema: string | null;
  body_schema: string | null;
  tags: string | null;
}

export interface McpDbPackageRow {
  id: string;
  name: string;
  app: string;
  tag: string;
  logo: string | null;
  service_tag: string | null;
  group_id: string | null;
  updated_at: string;
}

export interface PackageDbContent {
  package: McpDbPackageRow | undefined;
  tools: McpDbToolRow[];
  requests: Map<string, McpDbRequestRow>;
}

/** Runs a query and returns its rows, or undefined when the query fails (e.g. missing table). */
function rowsOf<T>(db: DatabaseSync, sql: string): T[] | undefined {
  try {
    return db.prepare(sql).all() as unknown as T[];
  } catch {
    return undefined;
  }
}

/**
 * Reads the package, tools and requests of a .db file, read-only. JSON columns are left as text.
 * A missing table gives an empty value for it. Throws if the file cannot be opened.
 */
export function readPackageDb(filePath: string): PackageDbContent {
  const db = new DatabaseSync(filePath, { readOnly: true });
  try {
    const packages = rowsOf<McpDbPackageRow>(
      db,
      "SELECT id, name, app, tag, logo, service_tag, group_id, updated_at FROM mcp_package LIMIT 1",
    );
    const tools = rowsOf<McpDbToolRow>(db, "SELECT * FROM tools") ?? [];
    const requests = rowsOf<McpDbRequestRow>(db, "SELECT * FROM requests") ?? [];
    return {
      package: packages?.[0],
      tools,
      requests: new Map(requests.map((row) => [row.id, row])),
    };
  } finally {
    db.close();
  }
}

export interface RawToolRecord {
  table: "tools" | "requests";
  id: string;
  title: string;
  packageId?: string;
  packageName?: string;
  method?: string;
  path?: string;
  kind?: string;
  description?: string;
  raw: Record<string, unknown>;
  linkedRequest?: Record<string, unknown>;
}

/**
 * Reads all tools and requests from a package .db with their full raw columns/values.
 */
function toSafeString(val: unknown): string {
  if (typeof val === "string") return val;
  if (typeof val === "number" || typeof val === "boolean") return val.toString();
  return "";
}

export function readPackageDbRawTools(filePath: string, pkgInfo?: { id: string; name: string }): RawToolRecord[] {
  const db = new DatabaseSync(filePath, { readOnly: true });
  try {
    const toolRows = rowsOf<Record<string, unknown>>(db, "SELECT * FROM tools") ?? [];
    const requestRows = rowsOf<Record<string, unknown>>(db, "SELECT * FROM requests") ?? [];
    const requestsById = new Map<string, Record<string, unknown>>();
    for (const req of requestRows) {
      if (typeof req.id === "string") requestsById.set(req.id, req);
    }

    const pairedReqIds = new Set<string>();
    const records: RawToolRecord[] = toolRows.map((row) => {
      const reqId = typeof row.request_id === "string" ? row.request_id : undefined;
      if (reqId) pairedReqIds.add(reqId);
      const linked = reqId ? requestsById.get(reqId) : undefined;
      return {
        table: "tools",
        id: toSafeString(row.id),
        title: toSafeString(row.title) || toSafeString(row.id),
        packageId: pkgInfo?.id,
        packageName: pkgInfo?.name,
        kind: typeof row.kind === "string" ? row.kind : undefined,
        description: typeof row.description === "string" ? row.description : undefined,
        method: linked && typeof linked.method === "string" ? linked.method : undefined,
        path: linked && typeof linked.path === "string" ? linked.path : undefined,
        raw: row,
        linkedRequest: linked,
      };
    });

    for (const req of requestRows) {
      if (typeof req.id === "string" && !pairedReqIds.has(req.id)) {
        records.push({
          table: "requests",
          id: toSafeString(req.id),
          title: toSafeString(req.title) || toSafeString(req.id),
          packageId: pkgInfo?.id,
          packageName: pkgInfo?.name,
          method: typeof req.method === "string" ? req.method : undefined,
          path: typeof req.path === "string" ? req.path : undefined,
          kind: "request",
          description: typeof req.description === "string" ? req.description : undefined,
          raw: req,
        });
      }
    }

    return records;
  } finally {
    db.close();
  }
}
