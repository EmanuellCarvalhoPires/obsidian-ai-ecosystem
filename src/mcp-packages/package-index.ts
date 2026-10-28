// Builds the tools.db index entries (kind "api") of an MCP package. Pure: no I/O.

import type { ToolEffect, ToolIndexEntry } from "../types";
import type { McpDbToolRow, PackageDbContent } from "./package-db";

/** One parameter of a tool, as stored in params_schema. */
export interface PackageParam {
  type: "string" | "number" | "integer" | "boolean" | "object" | "array";
  required: boolean;
  description?: string;
  enum?: Array<string | number>;
  default?: unknown;
}

export interface ApiEndpoint {
  method: string;
  path: string;
}

const MAX_RESUMO = 100;
const MAX_DESCRIPTION = 4000;
const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const WRITE_WORDS = ["write", "create", "delete", "update"];

/** POST endpoints that only read: JQL searches and parsing. */
const POST_READ_PATH = /\/(search(\/jql)?|jql\/(parse|autocompletedata\/suggestions|match))(\/|\?|$)/i;

/** GET is a read; POST/PUT/PATCH/DELETE write, except JQL searches by POST. No endpoint: `writes` decides. */
export function effectOf(writes: boolean, endpoint?: ApiEndpoint): ToolEffect {
  if (!endpoint) return writes ? "externo" : "leitura";
  const method = endpoint.method.toUpperCase();
  if (READ_METHODS.has(method)) return "leitura";
  if (method === "POST" && POST_READ_PATH.test(endpoint.path)) return "leitura";
  return "externo";
}

/** One line, whitespace collapsed, at most `max` characters (ends with "…" when cut). */
function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

/** JSON Schema for the inputSchema of an index entry. */
export function inputSchemaFromParams(params: Record<string, PackageParam>): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const [name, p] of Object.entries(params)) {
    const prop: Record<string, unknown> = { type: p.type };
    if (p.description) prop.description = p.description;
    if (p.enum) prop.enum = p.enum;
    if (p.default !== undefined) prop.default = p.default;
    properties[name] = prop;
    if (p.required && p.default === undefined) required.push(name);
  }
  const schema: Record<string, unknown> = { type: "object", properties, additionalProperties: false };
  if (required.length) schema.required = required;
  return schema;
}

/**
 * A tool that picks an instance (service_param) takes it as its first, required parameter. The package db does not
 * list it in params_schema: Environment Keys adds it from the notes tagged service_tag, so the index declares it here.
 */
function withInstanceParam(params: Record<string, PackageParam>, row: Pick<McpDbToolRow, "service_param" | "service_tag">): Record<string, PackageParam> {
  const name = row.service_param?.trim();
  if (!name || name in params) return params;
  const source = row.service_tag ? `a note tagged #${row.service_tag}` : "an instance note";
  return {
    [name]: {
      type: "string",
      required: true,
      description: `Which instance to use: the name of ${source}. The end of the name is enough (e.g. "CSP Tech" for "Jira Access - CSP Tech"); an ambiguous or unknown name lists the valid ones.`,
    },
    ...params,
  };
}

/** Every API tool accepts max_chars (Environment Keys cuts the response), so the index advertises it with the tool's own parameters. */
function withMaxChars(schema: Record<string, unknown>): Record<string, unknown> {
  const properties = { ...((schema.properties as Record<string, unknown> | undefined) ?? {}) };
  if (!("max_chars" in properties)) {
    properties.max_chars = { type: "integer", description: "Cut the response after this many characters (1 to 1000000); the answer then has truncated and total_chars." };
  }
  return { ...schema, properties };
}

/** Example arguments: the required parameters with their default, first enum value or a <name> marker. */
export function exampleFromParams(params: Record<string, PackageParam>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, spec] of Object.entries(params)) {
    if (!spec.required) continue;
    if (spec.default !== undefined) out[name] = spec.default;
    else if (spec.enum?.length) out[name] = spec.enum[0];
    else if (spec.type === "number" || spec.type === "integer") out[name] = 1;
    else if (spec.type === "boolean") out[name] = true;
    else if (spec.type === "object") out[name] = {};
    else if (spec.type === "array") out[name] = [];
    else out[name] = `<${name}>`;
  }
  return out;
}

/** Lowercase ASCII slug: accents removed, other characters become "-", no "-" at the ends. */
export function slugKey(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Lookup keys of a package (its id, name, app, group, folder and file name), deduplicated. */
export function packageKeys(
  pkg: { id: string; name: string; app: string; tag: string } | undefined,
  folderName: string | undefined,
  basename: string,
): string[] {
  const group = pkg?.tag ? pkg.tag.split("/").pop() : undefined;
  const raw = [pkg?.id, pkg?.name, pkg?.app, group, folderName, basename === "mcp" ? undefined : basename];
  const keys = raw.map((text) => slugKey(text ?? "")).filter(Boolean);
  return [...new Set(keys)];
}

/** Parses a JSON column; null or invalid JSON gives the fallback. */
function parseJson(text: string | null, fallback: unknown): unknown {
  if (text == null) return fallback;
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

/**
 * One index entry per request tool of the package. Script tools are skipped, as in Env Keys
 * (mcpDb.ts: kind "script" stays "script"; apiIndex.ts: only kind "request" is indexed; status is always "ready").
 */
export function buildPackageIndexEntries(
  content: PackageDbContent,
  fallbackName: string,
  keys: string[],
): ToolIndexEntry[] {
  const pkg = content.package;
  const categoria = pkg?.name || pkg?.app || fallbackName;
  const requestTools = content.tools.filter((row) => row.kind !== "script");

  return requestTools.map((row) => {
    const parsedParams = parseJson(row.params_schema, {});
    const ownParams = (parsedParams && typeof parsedParams === "object" && !Array.isArray(parsedParams)
      ? parsedParams
      : {}) as Record<string, PackageParam>;
    const params = withInstanceParam(ownParams, row);
    const parsedTags = parseJson(row.tags, []);
    const tags = Array.isArray(parsedTags) ? parsedTags.filter((t): t is string => typeof t === "string") : [];
    const writes = tags.some((t) => WRITE_WORDS.some((word) => t.includes(word)));

    const request = row.request_id != null ? content.requests.get(row.request_id) : undefined;
    const endpoint: ApiEndpoint | undefined = request ? { method: request.method, path: request.path } : undefined;

    const description = oneLine(row.description || row.title || row.id, MAX_DESCRIPTION);

    return {
      name: row.id,
      title: row.title,
      description: endpoint ? `${endpoint.method.toUpperCase()} ${endpoint.path}. ${description}` : description,
      inputSchema: withMaxChars(inputSchemaFromParams(params)),
      kind: "api",
      categoria,
      tags: [...new Set(["api", ...(endpoint ? [endpoint.method.toLowerCase()] : []), ...keys])],
      resumo: oneLine(row.title || description, MAX_RESUMO),
      efeito: effectOf(writes, endpoint),
      exposicao: "indice",
      exemplo: exampleFromParams(params),
    };
  });
}
