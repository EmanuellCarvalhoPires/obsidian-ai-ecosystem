import { execFile } from "node:child_process";
import * as http from "node:http";
import type { PortConflict, PortOwnerKind } from "../types";

const HOST = "127.0.0.1";
const MAX_HEALTH_BYTES = 20_000;

interface HealthAnswer {
  /** Something answered over HTTP (any status). */
  answered: boolean;
  json?: Record<string, unknown>;
}

function getJson(port: number, path: string, timeoutMs: number): Promise<HealthAnswer> {
  return new Promise((resolve) => {
    // agent: false, so no keep-alive connection to the other server stays open.
    const req = http.get({ host: HOST, port, path, timeout: timeoutMs, agent: false }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => {
        if (body.length < MAX_HEALTH_BYTES) body += chunk;
      });
      res.on("end", () => {
        try {
          const parsed: unknown = JSON.parse(body);
          const json = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : undefined;
          resolve({ answered: true, json });
        } catch {
          resolve({ answered: true });
        }
      });
      res.on("error", () => resolve({ answered: true }));
    });
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve({ answered: false }));
  });
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function vaultName(value: unknown): string | undefined {
  if (typeof value === "string") return str(value);
  if (value && typeof value === "object") return str((value as { name?: unknown }).name);
  return undefined;
}

/** Recognizes the AI Ecosystem and Environment Keys from a health document. */
export function classifyHealth(json: Record<string, unknown>): Omit<PortConflict, "port"> | undefined {
  const app = str(json.app);
  const name = str(json.name);
  const version = str(json.version);
  const vault = vaultName(json.vault);

  if (app === "ai-ecosystem" || name === "ai-ecosystem") {
    return { owner: "ai-ecosystem", ownerVersion: version, ownerVault: vault };
  }
  if (name === "environment-variables" || app === "environment-variables") {
    const owner: PortOwnerKind = json.mode === "transition" ? "environment-keys-transition" : "environment-keys-1";
    return { owner, ownerVersion: version, ownerVault: vault };
  }
  return undefined;
}

function compact(conflict: PortConflict): PortConflict {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(conflict)) {
    if (value !== undefined) out[key] = value;
  }
  return out as unknown as PortConflict;
}

/** Finds out who holds a port from its /health (then /v1/health) answer. */
export async function probePortOwner(port: number, timeoutMs = 1500): Promise<PortConflict> {
  let answered = false;
  for (const path of ["/health", "/v1/health"]) {
    const answer = await getJson(port, path, timeoutMs);
    answered = answered || answer.answered;
    if (answer.json) {
      const known = classifyHealth(answer.json);
      if (known) return compact({ port, ...known });
    }
  }
  const owner: PortOwnerKind = answered ? "other" : "unknown";
  const processName = await findProcessName(port);
  return compact({ port, owner, processName });
}

function run(file: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    try {
      execFile(file, args, { timeout: 2000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
        resolve(err && !stdout ? "" : String(stdout));
      });
    } catch {
      resolve("");
    }
  });
}

/** PID of the process listening on the port, from `netstat -ano -p tcp` output. */
export function parseNetstatPid(output: string, port: number): string | undefined {
  for (const line of output.split(/\r?\n/)) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 5 || !/^TCP/i.test(cols[0] ?? "")) continue;
    if (!/^LISTENING$/i.test(cols[3] ?? "")) continue;
    if ((cols[1] ?? "").endsWith(`:${port}`)) return cols[4];
  }
  return undefined;
}

/** Image name from `tasklist /FO CSV /NH` output. */
export function parseTasklistName(output: string): string | undefined {
  const line = output.split(/\r?\n/).find((l) => l.trim().startsWith('"'));
  const match = line ? /^"([^"]+)"/.exec(line.trim()) : null;
  return match?.[1];
}

/** Command name from `lsof -nP -iTCP:<port> -sTCP:LISTEN` output. */
export function parseLsofName(output: string): string | undefined {
  const row = output.split(/\r?\n/).find((l) => l.trim() !== "" && !/^COMMAND\s/i.test(l));
  const name = row?.trim().split(/\s+/)[0];
  return name ? name.replace(/\\x20/g, " ") : undefined;
}

/** Best effort: name of the process listening on the port. Never throws. */
export async function findProcessName(port: number): Promise<string | undefined> {
  try {
    if (process.platform === "win32") {
      const pid = parseNetstatPid(await run("netstat", ["-ano", "-p", "tcp"]), port);
      if (!pid || !/^\d+$/.test(pid)) return undefined;
      return parseTasklistName(await run("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"]));
    }
    return parseLsofName(await run("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"]));
  } catch {
    return undefined;
  }
}
