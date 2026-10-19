import type * as http from "node:http";
import type { ClientContext, HttpMethod, HubRequest, HubResponse, RegistryLookup } from "../types";
import { errorBody } from "./http-utils";

export interface RestInput {
  method: string;
  /** Request path without the query string. */
  path: string;
  query: Record<string, string>;
  /** Lowercase header names. The Authorization header is removed before the handler sees them. */
  headers: Record<string, string>;
  rawBody: string;
  client: ClientContext;
}

export interface RestOutcome {
  status: number;
  /** Response headers, always including Cache-Control: no-store. */
  headers: Record<string, string>;
  payload: string | Buffer;
  /** Module that handled the request ("" when none matched). */
  moduleId: string;
  /** Parsed request body (for activity logs). */
  requestBody: unknown;
  /** Response body as the handler returned it (for activity logs). */
  responseBody: unknown;
}

const METHODS: readonly string[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];
const JSON_CONTENT_TYPE = /^\s*(application|text)\/([\w.+-]+\+)?json\b/i;

function jsonOutcome(
  status: number,
  body: unknown,
  extra: Record<string, string> = {},
  moduleId = "",
  requestBody: unknown = undefined,
): RestOutcome {
  return {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extra },
    payload: JSON.stringify(body),
    moduleId,
    requestBody,
    responseBody: body,
  };
}

/** Dispatches a REST request to the module route found in the registry. */
export async function handleRestRequest(registry: RegistryLookup, input: RestInput): Promise<RestOutcome> {
  const method = input.method.toUpperCase();
  const match = METHODS.includes(method) ? registry.findRoute(method as HttpMethod, input.path) : undefined;

  if (!match) {
    const allowed = registry.allowedMethods(input.path);
    if (allowed.length > 0) {
      return jsonOutcome(405, errorBody("method_not_allowed", `Method ${method} is not allowed for ${input.path}.`), {
        Allow: allowed.join(", "),
      });
    }
    return jsonOutcome(404, errorBody("not_found", `No route for ${method} ${input.path}.`));
  }

  let body: unknown = input.rawBody;
  if (JSON_CONTENT_TYPE.test(input.headers["content-type"] ?? "") && input.rawBody.trim() !== "") {
    try {
      body = JSON.parse(input.rawBody);
    } catch {
      return jsonOutcome(400, errorBody("invalid_json", "The request body is not valid JSON."), {}, match.moduleId);
    }
  }

  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(input.headers)) {
    if (name.toLowerCase() !== "authorization") headers[name.toLowerCase()] = value;
  }

  const request: HubRequest = {
    method: method as HttpMethod,
    path: match.path,
    fullPath: input.path,
    params: match.params,
    query: input.query,
    headers,
    body,
    rawBody: input.rawBody,
    client: input.client,
  };

  let response: HubResponse;
  try {
    response = await match.route.handler(request);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonOutcome(500, errorBody("handler_error", message), {}, match.moduleId, body);
  }

  try {
    return serialize(response, match.moduleId, body);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonOutcome(500, errorBody("handler_error", `Invalid response: ${message}`), {}, match.moduleId, body);
  }
}

function serialize(response: HubResponse, moduleId: string, requestBody: unknown): RestOutcome {
  const status = response?.status;
  if (!Number.isInteger(status) || status < 100 || status > 599) {
    throw new Error(`invalid status ${String(status)}`);
  }

  const headers: Record<string, string> = {};
  let hasContentType = false;
  for (const [name, value] of Object.entries(response.headers ?? {})) {
    const lower = name.toLowerCase();
    if (lower === "cache-control" || lower === "content-length" || lower === "transfer-encoding" || lower === "connection") continue;
    if (lower === "content-type") hasContentType = true;
    headers[name] = String(value);
  }
  headers["Cache-Control"] = "no-store";

  const body = response.body;
  let payload: string | Buffer = "";
  if (body === undefined) {
    payload = "";
  } else if (typeof body === "string") {
    payload = body;
    if (!hasContentType) headers["Content-Type"] = "text/plain; charset=utf-8";
  } else if (Buffer.isBuffer(body) || body instanceof Uint8Array) {
    payload = Buffer.isBuffer(body) ? body : Buffer.from(body);
    if (!hasContentType) headers["Content-Type"] = "application/octet-stream";
  } else {
    const json = JSON.stringify(body);
    if (json === undefined) throw new Error("body is not serializable");
    payload = json;
    if (!hasContentType) headers["Content-Type"] = "application/json; charset=utf-8";
  }

  return { status, headers, payload, moduleId, requestBody, responseBody: body };
}

/** Writes a RestOutcome to the HTTP response. */
export function sendOutcome(res: http.ServerResponse, outcome: RestOutcome): void {
  if (res.headersSent) return;
  res.writeHead(outcome.status, { ...outcome.headers, "Content-Length": Buffer.byteLength(outcome.payload) });
  res.end(outcome.payload);
}
