// Measures how long the Claude Code hook script takes per call (node startup included).
// Usage: node scripts/bench-hooks.mjs [runs]   (default 200 runs per case)
// Builds a throwaway vault in the temp folder, runs src/hooks/script/ai-ecosystem-hook.mjs
// with synthetic inputs and prints p50 and p95 for each hook type.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RUNS = Number(process.argv[2]) > 0 ? Number(process.argv[2]) : 200;
const SOURCE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "hooks", "script", "ai-ecosystem-hook.mjs");

const vault = fs.mkdtempSync(path.join(os.tmpdir(), "aie-bench-"));
const vaultPath = vault.replace(/\\/g, "/");
const state = path.join(vault, ".claude", "ai-ecosystem");
const script = path.join(state, "hooks", "ai-ecosystem-hook.mjs");

function write(rel, value) {
  const file = path.join(state, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value));
}

fs.mkdirSync(path.dirname(script), { recursive: true });
fs.copyFileSync(SOURCE, script);
write("config.json", { schemaVersion: 1, vaultPath, modos: {} });
write("hosts.json", { hosts: ["acme.atlassian.net", "*.atlassian.net", "api.github.com/repos/acme"] });
write("pastas.json", { scripts: ["scripts"], templates: ["Knowledge/Logs/*.md"], foraDoIndice: ["Anexos"], notasDeTools: ["MCP"] });
write("tools.json", { search_notes: "ai-vault-search" });
for (const id of ["ai-vault-search", "environment-variables", "ai-scripts", "ai-templates"]) {
  write(`modules/${id}.json`, { estado: "configurado" });
}
write("modules/ai-scripts-pendente.json", { estado: "pendente_configuracao", nome: "AI Scripts" });

const cases = [
  ["protecao ai-vault-search (libera, fora do cofre)", "ai-vault-search", "protecao", { tool_name: "Grep", tool_input: { pattern: "x", path: os.tmpdir() }, cwd: vault }],
  ["protecao ai-vault-search (bloqueia)", "ai-vault-search", "protecao", { tool_name: "Grep", tool_input: { pattern: "x" }, cwd: vault }],
  ["protecao environment-variables (bloqueia)", "environment-variables", "protecao", { tool_name: "Bash", tool_input: { command: "curl https://acme.atlassian.net/rest/api/3/myself" }, cwd: vault }],
  ["protecao ai-scripts (libera)", "ai-scripts", "protecao", { tool_name: "Bash", tool_input: { command: "git status" }, cwd: vault }],
  ["protecao ai-templates (libera)", "ai-templates", "protecao", { tool_name: "Write", tool_input: { file_path: `${vaultPath}/Outra/Nota.md`, content: "x" }, cwd: vault }],
  ["setup (temporario)", "ai-scripts-pendente", "setup", { hook_event_name: "SessionStart", cwd: vault }],
  ["falha (PostToolUseFailure)", "ai-ecosystem", "falha", { tool_name: "mcp__aie__search_notes", error: "x", cwd: vault }],
];

function percentile(sorted, p) {
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

console.log(`node ${process.version}, ${os.platform()} ${os.release()}, ${RUNS} runs per case`);
for (const [label, moduleId, type, input] of cases) {
  const text = JSON.stringify(input);
  const times = [];
  for (let i = 0; i < RUNS; i++) {
    // Keep the heartbeat fresh and the repetition lock empty so every run takes the same path.
    write("heartbeat", String(Date.now()));
    write("bloqueios.json", {});
    const started = process.hrtime.bigint();
    spawnSync(process.execPath, [script, moduleId, type], { input: text });
    times.push(Number(process.hrtime.bigint() - started) / 1e6);
  }
  times.sort((a, b) => a - b);
  console.log(`${label.padEnd(52)} p50 ${percentile(times, 50).toFixed(0).padStart(4)} ms   p95 ${percentile(times, 95).toFixed(0).padStart(4)} ms`);
}

fs.rmSync(vault, { recursive: true, force: true });
