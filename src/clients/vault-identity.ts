// Each vault runs its own server: its own port, its own MCP server name in the AI clients, and its own client tokens.
// Pure Node (no "obsidian" import).
import { createHash } from "node:crypto";

/** Default MCP server name prefix of AI Ecosystem. */
export const DEFAULT_MCP_SERVER_NAME = "ai-ecosystem";

/** Legacy MCP server name prefix used by Environment Keys 1.x / 2.x. */
export const LEGACY_MCP_SERVER_NAME = "environment-variables";

/** MCP server names accepted by Claude Code, Codex (TOML bare keys), Cursor and Antigravity. */
export const SERVER_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/** Stable, non-reversible id of a vault, from its folder on disk. */
export function vaultIdOf(basePath: string): string {
  return createHash("sha256").update(basePath.replace(/\\/g, "/").toLowerCase()).digest("hex").slice(0, 16);
}

/** "Work Notes" -> "work-notes", "Café Ação" -> "cafe-acao". Falls back to the vault id. */
export function slugOf(vaultName: string, vaultId: string): string {
  const slug = vaultName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  return slug || vaultId.slice(0, 8);
}

/** Default MCP server name of a vault, e.g. "ai-ecosystem-work-notes". */
export function serverNameFor(vaultName: string, vaultId: string, prefix = DEFAULT_MCP_SERVER_NAME): string {
  return `${prefix}-${slugOf(vaultName, vaultId)}`;
}

/** Candidate legacy names that this vault might have used in Environment Keys or AI Ecosystem. */
export function candidateServerNames(vaultName: string, vaultId: string): string[] {
  const slug = slugOf(vaultName, vaultId);
  return [
    `${DEFAULT_MCP_SERVER_NAME}-${slug}`,
    DEFAULT_MCP_SERVER_NAME,
    `${LEGACY_MCP_SERVER_NAME}-${slug}`,
    LEGACY_MCP_SERVER_NAME,
  ];
}
