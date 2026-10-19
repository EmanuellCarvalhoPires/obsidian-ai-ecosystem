import type * as http from "node:http";

/** Writes a JSON response. No CORS headers on purpose: browsers are not clients. */
export function sendJson(
  res: http.ServerResponse,
  status: number,
  value: unknown,
  extraHeaders: Record<string, string> = {},
): void {
  if (res.headersSent) return;
  const payload = JSON.stringify(value);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
    ...extraHeaders,
  });
  res.end(payload);
}

export function errorBody(code: string, message: string): { error: { code: string; message: string } } {
  return { error: { code, message } };
}

export function sendError(
  res: http.ServerResponse,
  status: number,
  code: string,
  message: string,
  extraHeaders: Record<string, string> = {},
): void {
  sendJson(res, status, errorBody(code, message), extraHeaders);
}

export type BodyResult =
  | { kind: "ok"; body: string }
  | { kind: "too-large" }
  | { kind: "aborted" };

/**
 * Reads the request body as UTF-8 text. When it exceeds maxBytes the rest is drained (not
 * stored) so the client can still read the 413 answer; a hard cap destroys runaway uploads.
 */
export function readBody(req: http.IncomingMessage, maxBytes: number): Promise<BodyResult> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let tooLarge = false;
    let settled = false;
    const hardCap = Math.max(maxBytes * 8, maxBytes + 64 * 1024 * 1024);
    const finish = (result: BodyResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > hardCap) {
        req.destroy();
        finish({ kind: "too-large" });
        return;
      }
      if (size > maxBytes) {
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      if (!tooLarge) chunks.push(chunk);
    });
    req.on("end", () => finish(tooLarge ? { kind: "too-large" } : { kind: "ok", body: Buffer.concat(chunks).toString("utf8") }));
    req.on("error", () => finish({ kind: "aborted" }));
    req.on("close", () => finish({ kind: "aborted" }));
  });
}

/** Request headers with lowercase names; repeated headers are joined with ", ". */
export function flattenHeaders(headers: http.IncomingHttpHeaders): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    out[name.toLowerCase()] = Array.isArray(value) ? value.join(", ") : value;
  }
  return out;
}

export function withoutAuthorization(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() !== "authorization") out[name] = value;
  }
  return out;
}

/** Splits a request target into path and query string. Undefined when it is not an origin-form path. */
export function splitUrl(rawUrl: string | undefined): { pathname: string; search: string } | undefined {
  const raw = rawUrl ?? "/";
  if (!raw.startsWith("/")) return undefined;
  const hashless = raw.split("#", 1)[0] ?? raw;
  const q = hashless.indexOf("?");
  return q === -1
    ? { pathname: hashless, search: "" }
    : { pathname: hashless.slice(0, q), search: hashless.slice(q + 1) };
}

/** Query string to an object (last value wins). */
export function parseQuery(search: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of new URLSearchParams(search)) out[key] = value;
  return out;
}
