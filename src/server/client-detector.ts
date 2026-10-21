// Tells which kind of AI client is calling, from the MCP clientInfo.name (sent on "initialize")
// or, when the client did not send one, from the name of its token. Pure Node (no "obsidian" import).
import type { ClientKind } from "../types";

const CLAUDE = /claude/i;
const ANTIGRAVITY = /antigravity|gemini/i;

function fromName(name: string): ClientKind {
  if (CLAUDE.test(name)) return "claude-code";
  if (ANTIGRAVITY.test(name)) return "antigravity";
  return "other";
}

export function detectClientKind(clientInfoName: string | undefined, tokenName: string | undefined): ClientKind {
  if (clientInfoName !== undefined && clientInfoName.trim() !== "") return fromName(clientInfoName);
  return tokenName ? fromName(tokenName) : "other";
}
