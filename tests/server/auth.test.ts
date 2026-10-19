import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { ClientAuth, TOKEN_PREFIX, createClient, generateToken, hashToken, mergeImportedClients } from "../../src/server/auth";
import type { ClientRecord } from "../../src/types";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

function record(id: string, tokenHash: string, extra: Partial<ClientRecord> = {}): ClientRecord {
  return { id, name: `Client ${id}`, tokenHash, hint: "evc_abcdef", createdAt: "2026-01-01T00:00:00.000Z", ...extra };
}

describe("token helpers", () => {
  it("generates aie_ tokens with 64 hex characters", () => {
    const token = generateToken();
    expect(TOKEN_PREFIX).toBe("aie_");
    expect(token).toMatch(/^aie_[0-9a-f]{64}$/);
    expect(generateToken()).not.toBe(token);
  });

  it("hashes with SHA-256 as lowercase hex", () => {
    expect(hashToken("abc")).toBe(createHash("sha256").update("abc").digest("hex"));
    expect(hashToken("abc")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("creates a client whose record keeps only the hash", () => {
    const { record: rec, token } = createClient("Claude Code");
    expect(rec.name).toBe("Claude Code");
    expect(rec.id).toMatch(/^[0-9a-f]{16}$/);
    expect(rec.tokenHash).toBe(hashToken(token));
    expect(rec.hint).toBe(token.slice(0, 10));
    expect(Number.isNaN(Date.parse(rec.createdAt))).toBe(false);
    expect(JSON.stringify(rec)).not.toContain(token);
  });
});

describe("ClientAuth", () => {
  const { record: rec, token } = createClient("Script");
  const legacyToken = "evc_" + "1".repeat(64);
  const legacy = record("legacy1", hashToken(legacyToken), { name: "Antigravity", importedFrom: "environment-variables" });

  it("accepts a valid Bearer token and calls onUsed", () => {
    const onUsed = vi.fn();
    const auth = new ClientAuth(() => [rec], onUsed);
    expect(auth.authenticate(`Bearer ${token}`)).toEqual({ id: rec.id, name: "Script" });
    expect(onUsed).toHaveBeenCalledWith(rec.id);
  });

  it("parses the scheme case-insensitively", () => {
    const auth = new ClientAuth(() => [rec]);
    expect(auth.authenticate(`bearer ${token}`)?.id).toBe(rec.id);
    expect(auth.authenticate(`BEARER   ${token}  `)?.id).toBe(rec.id);
  });

  it("rejects missing, malformed and wrong tokens", () => {
    const onUsed = vi.fn();
    const auth = new ClientAuth(() => [rec], onUsed);
    expect(auth.authenticate(undefined)).toBeUndefined();
    expect(auth.authenticate("")).toBeUndefined();
    expect(auth.authenticate(token)).toBeUndefined();
    expect(auth.authenticate(`Basic ${token}`)).toBeUndefined();
    expect(auth.authenticate("Bearer")).toBeUndefined();
    expect(auth.authenticate(`Bearer ${generateToken()}`)).toBeUndefined();
    expect(onUsed).not.toHaveBeenCalled();
  });

  it("accepts imported tokens with another prefix", () => {
    const auth = new ClientAuth(() => [rec, legacy]);
    expect(auth.authenticate(`Bearer ${legacyToken}`)).toEqual({ id: "legacy1", name: "Antigravity" });
  });

  it("reads the client list on every call and survives a throwing onUsed", () => {
    const list: ClientRecord[] = [];
    const auth = new ClientAuth(
      () => list,
      () => {
        throw new Error("boom");
      },
    );
    expect(auth.authenticate(`Bearer ${token}`)).toBeUndefined();
    list.push(rec);
    expect(auth.authenticate(`Bearer ${token}`)?.id).toBe(rec.id);
  });

  it("ignores records with a malformed hash", () => {
    const broken = record("x", "not-a-hash");
    const auth = new ClientAuth(() => [broken]);
    expect(auth.authenticate("Bearer not-a-hash")).toBeUndefined();
  });
});

describe("mergeImportedClients", () => {
  it("adds new clients, tagging the source, and keeps existing ones", () => {
    const existing = [record("e1", HASH_A)];
    const incoming = [record("i1", HASH_B, { lastUsedAt: "2026-02-02T00:00:00.000Z" })];
    const { clients, added } = mergeImportedClients(existing, incoming, "environment-variables");
    expect(added).toBe(1);
    expect(clients).toHaveLength(2);
    expect(clients[0]).toEqual(existing[0]);
    expect(clients[1]).toMatchObject({ id: "i1", tokenHash: HASH_B, importedFrom: "environment-variables", lastUsedAt: "2026-02-02T00:00:00.000Z" });
  });

  it("skips duplicates by id or by token hash", () => {
    const existing = [record("e1", HASH_A)];
    const incoming = [record("e1", HASH_B), record("other", HASH_A), record("i3", "c".repeat(64)), record("i3", "d".repeat(64))];
    const { clients, added } = mergeImportedClients(existing, incoming, "mod");
    expect(added).toBe(1);
    expect(clients.map((c) => c.id)).toEqual(["e1", "i3"]);
    expect(clients[1]?.tokenHash).toBe("c".repeat(64));
  });

  it("drops entries without id, name or a lowercase 64-hex hash", () => {
    const incoming = [
      record("", HASH_B),
      { ...record("n", HASH_B), name: "" },
      record("short", "abc"),
      record("upper", "A".repeat(64)),
      record("nonhex", "g".repeat(64)),
      record("ok", "e".repeat(64)),
    ];
    const { clients, added } = mergeImportedClients([], incoming, "mod");
    expect(added).toBe(1);
    expect(clients.map((c) => c.id)).toEqual(["ok"]);
  });

  it("never mutates its inputs", () => {
    const existing = [record("e1", HASH_A)];
    const incoming = [record("i1", HASH_B)];
    const snapshotExisting = JSON.stringify(existing);
    const snapshotIncoming = JSON.stringify(incoming);
    const { clients } = mergeImportedClients(existing, incoming, "mod");
    expect(JSON.stringify(existing)).toBe(snapshotExisting);
    expect(JSON.stringify(incoming)).toBe(snapshotIncoming);
    expect(clients[0]).not.toBe(existing[0]);
    expect(incoming[0]?.importedFrom).toBeUndefined();
  });
});
