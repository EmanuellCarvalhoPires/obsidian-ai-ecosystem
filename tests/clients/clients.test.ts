import { describe, expect, it } from "vitest";
import {
  candidateServerNames,
  DEFAULT_MCP_SERVER_NAME,
  LEGACY_MCP_SERVER_NAME,
  SERVER_NAME_PATTERN,
  serverNameFor,
  slugOf,
  vaultIdOf,
} from "../../src/clients/vault-identity";
import {
  bearerOf,
  INTEGRATION_IDS,
  INTEGRATIONS,
  normalizeIntegrationId,
} from "../../src/clients/integrations";
import {
  findConnectedClient,
  listManualClients,
} from "../../src/clients/clients-section";
import type { ClientRecord } from "../../src/types";

describe("vault-identity", () => {
  it("computes a deterministic 16-hex vaultId", () => {
    const id1 = vaultIdOf("C:\\Users\\User\\Vault");
    const id2 = vaultIdOf("c:/users/user/vault");
    expect(id1).toBe(id2);
    expect(id1).toMatch(/^[0-9a-f]{16}$/);
  });

  it("slugifies vault names properly", () => {
    expect(slugOf("Cofre Pessoal", "abc1234567890")).toBe("cofre-pessoal");
    expect(slugOf("Café & Ação!", "abc1234567890")).toBe("cafe-acao");
    expect(slugOf("!!!", "abc1234567890")).toBe("abc12345");
  });

  it("builds server names matching SERVER_NAME_PATTERN", () => {
    const name = serverNameFor("My Vault", "1234567890abcdef");
    expect(name).toBe("ai-ecosystem-my-vault");
    expect(SERVER_NAME_PATTERN.test(name)).toBe(true);
  });

  it("accepts upper case letters but not spaces in a server name", () => {
    expect(SERVER_NAME_PATTERN.test("AI-Ecosystem")).toBe(true);
    expect(SERVER_NAME_PATTERN.test("AI Ecosystem")).toBe(false);
    expect(SERVER_NAME_PATTERN.test("-AI")).toBe(false);
  });

  it("provides candidate legacy and modern server names", () => {
    const candidates = candidateServerNames("Notes", "1234567890abcdef");
    expect(candidates).toEqual([
      "ai-ecosystem-notes",
      DEFAULT_MCP_SERVER_NAME,
      "environment-variables-notes",
      LEGACY_MCP_SERVER_NAME,
    ]);
  });
});

describe("integrations", () => {
  it("normalizes integration IDs from variations", () => {
    expect(normalizeIntegrationId("claude-code")).toBe("claude-code");
    expect(normalizeIntegrationId("Claude Code")).toBe("claude-code");
    expect(normalizeIntegrationId("claude")).toBe("claude-code");
    expect(normalizeIntegrationId("antigravity")).toBe("antigravity");
    expect(normalizeIntegrationId("Google Antigravity")).toBe("antigravity");
    expect(normalizeIntegrationId("gemini")).toBe("antigravity");
    expect(normalizeIntegrationId("codex")).toBe("codex");
    expect(normalizeIntegrationId("OpenAI Codex")).toBe("codex");
    expect(normalizeIntegrationId("cursor")).toBe("cursor");
    expect(normalizeIntegrationId("Cursor")).toBe("cursor");
    expect(normalizeIntegrationId("other-agent")).toBeUndefined();
  });

  it("extracts token from bearer strings", () => {
    expect(bearerOf("Bearer my-secret-token")).toBe("my-secret-token");
    expect(bearerOf("bearer aie_12345")).toBe("aie_12345");
    expect(bearerOf("Basic xyz")).toBeNull();
    expect(bearerOf(null)).toBeNull();
  });

  it("lists all 4 supported integrations", () => {
    expect(INTEGRATION_IDS).toEqual(["claude-code", "codex", "antigravity", "cursor"]);
    expect(INTEGRATIONS.map((i) => i.id)).toEqual(["claude-code", "codex", "antigravity", "cursor"]);
  });
});

describe("clients-section helpers", () => {
  const clients: ClientRecord[] = [
    {
      id: "c1",
      name: "Claude Code",
      integration: "claude-code",
      tokenHash: "abc",
      hint: "aie_",
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    {
      id: "c2",
      name: "Antigravity",
      tokenHash: "def",
      hint: "aie_",
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    {
      id: "c3",
      name: "My Custom Agent",
      tokenHash: "123",
      hint: "aie_",
      createdAt: "2026-01-01T00:00:00.000Z",
    },
  ];

  it("finds connected client by tag or by matching name", () => {
    expect(findConnectedClient(clients, "claude-code")?.id).toBe("c1");
    expect(findConnectedClient(clients, "antigravity")?.id).toBe("c2");
    expect(findConnectedClient(clients, "codex")).toBeUndefined();
  });

  it("lists only manual clients not bound to integrations", () => {
    const manual = listManualClients(clients);
    expect(manual.map((c) => c.id)).toEqual(["c3"]);
  });
});
