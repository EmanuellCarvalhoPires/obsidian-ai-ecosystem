import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { INTEGRATION_IDS } from "../clients/integrations";
import type { ClientContext, ClientRecord, IntegrationId } from "../types";

export const TOKEN_PREFIX = "aie_";

const HASH_PATTERN = /^[0-9a-f]{64}$/;

/** "aie_" followed by 64 hex characters (256 bits of randomness). */
export function generateToken(): string {
  return TOKEN_PREFIX + randomBytes(32).toString("hex");
}

/** Lowercase hex SHA-256 of a token. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Creates a client record; the token is returned once and only its hash is kept. */
export function createClient(name: string, integration?: IntegrationId): { record: ClientRecord; token: string } {
  const token = generateToken();
  const record: ClientRecord = {
    id: randomBytes(8).toString("hex"),
    name,
    tokenHash: hashToken(token),
    hint: token.slice(0, 10),
    createdAt: new Date().toISOString(),
    ...(integration ? { integration } : {}),
  };
  return { record, token };
}

export class ClientAuth {
  constructor(
    private readonly getClients: () => ClientRecord[],
    private readonly onUsed?: (clientId: string) => void,
  ) {}

  /** Accepts "Bearer <token>" for any token prefix (imported clients keep their "evc_" tokens). */
  authenticate(authorizationHeader: string | undefined): ClientContext | undefined {
    if (!authorizationHeader) return undefined;
    const match = /^Bearer\s+(\S+)\s*$/i.exec(authorizationHeader);
    if (!match?.[1]) return undefined;
    const given = Buffer.from(hashToken(match[1]), "hex");

    let found: ClientRecord | undefined;
    for (const client of this.getClients()) {
      if (!HASH_PATTERN.test(client.tokenHash)) continue;
      const stored = Buffer.from(client.tokenHash, "hex");
      if (stored.length === given.length && timingSafeEqual(stored, given) && !found) found = client;
    }
    if (!found) return undefined;

    try {
      this.onUsed?.(found.id);
    } catch {
      // Recording usage must never break authentication.
    }
    return { id: found.id, name: found.name };
  }
}

/**
 * Merges clients imported from a module into the stored list. Existing clients win; incoming
 * ones are added only when both id and token hash are new and the entry is well formed.
 * Inputs are never mutated.
 */
export function mergeImportedClients(
  existing: ClientRecord[],
  incoming: ClientRecord[],
  sourceModuleId: string,
): { clients: ClientRecord[]; added: number } {
  const clients = existing.map((c) => ({ ...c }));
  const ids = new Set(clients.map((c) => c.id));
  const hashes = new Set(clients.map((c) => c.tokenHash));
  let added = 0;

  for (const entry of incoming) {
    if (!entry || typeof entry !== "object") continue;
    if (typeof entry.id !== "string" || entry.id === "") continue;
    if (typeof entry.name !== "string" || entry.name === "") continue;
    if (typeof entry.tokenHash !== "string" || !HASH_PATTERN.test(entry.tokenHash)) continue;
    if (ids.has(entry.id) || hashes.has(entry.tokenHash)) continue;

    const record: ClientRecord = {
      id: entry.id,
      name: entry.name,
      tokenHash: entry.tokenHash,
      hint: typeof entry.hint === "string" ? entry.hint : "",
      createdAt: typeof entry.createdAt === "string" ? entry.createdAt : new Date().toISOString(),
      importedFrom: sourceModuleId,
    };
    if (typeof entry.lastUsedAt === "string") record.lastUsedAt = entry.lastUsedAt;
    if (entry.integration && (INTEGRATION_IDS as readonly string[]).includes(entry.integration)) {
      record.integration = entry.integration;
    }
    clients.push(record);
    ids.add(record.id);
    hashes.add(record.tokenHash);
    added++;
  }
  return { clients, added };
}
