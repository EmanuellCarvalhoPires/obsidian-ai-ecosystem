// The resumo entry: a short summary of the active modules at the start of a session.
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CORE_SPECS, buildCommand, parseCommand } from "../../src/hooks/hook-specs";
import { HookWorld } from "./helpers";

let world: HookWorld;
beforeEach(() => {
  world = new HookWorld();
});
afterEach(() => world.cleanup());

const SESSION = { hook_event_name: "SessionStart" };

describe("hook specs: resumo", () => {
  it("is installed on SessionStart next to the falha entry, and its command parses back", () => {
    expect(CORE_SPECS.map((s) => s.type)).toEqual(["falha", "resumo"]);
    const summary = CORE_SPECS.find((s) => s.type === "resumo");
    expect(summary).toEqual({ module: "ai-ecosystem", type: "resumo", event: "SessionStart" });
    expect(parseCommand(buildCommand("/v", "ai-ecosystem", "resumo"))).toEqual({ module: "ai-ecosystem", type: "resumo" });
  });
});

describe("hook script: resumo (SessionStart)", () => {
  it("lists the active modules and the pending one with its setup skill", () => {
    world.module("ai-ecosystem");
    world.module("ai-vault-search");
    world.module("ai-scripts");
    world.module("ai-templates", "pendente_configuracao");
    const out = world.run("ai-ecosystem", "resumo", SESSION);
    expect(out.status).toBe(0);
    expect(out.json?.hookSpecificOutput.hookEventName).toBe("SessionStart");
    const text = out.context ?? "";
    expect(text).toContain("Módulos: ai-scripts, ai-vault-search.");
    expect(text).toContain("Pendentes: ai-templates (skill configurar-ai-templates).");
    expect(text).not.toContain("ai-ecosystem");
    expect(text.length).toBeLessThanOrEqual(300);
  });

  it("stays silent when the core is the only configured module", () => {
    world.module("ai-ecosystem");
    const out = world.run("ai-ecosystem", "resumo", SESSION);
    expect(out.status).toBe(0);
    expect(out.stdout).toBe("");
  });

  it("stays silent while the core is pending, even with other modules", () => {
    world.module("ai-ecosystem", "pendente_configuracao");
    world.module("ai-scripts");
    const out = world.run("ai-ecosystem", "resumo", SESSION);
    expect(out.status).toBe(0);
    expect(out.stdout).toBe("");
  });

  it("stays silent without the heartbeat", () => {
    world.module("ai-ecosystem");
    world.module("ai-scripts");
    world.heartbeat(null);
    const out = world.run("ai-ecosystem", "resumo", SESSION);
    expect(out.status).toBe(0);
    expect(out.stdout).toBe("");
  });

  it("stays silent for any event other than SessionStart", () => {
    world.module("ai-ecosystem");
    world.module("ai-scripts");
    const out = world.run("ai-ecosystem", "resumo", { hook_event_name: "UserPromptSubmit" });
    expect(out.status).toBe(0);
    expect(out.stdout).toBe("");
  });

  it("cuts a long summary to 300 characters ending with an ellipsis (40 modules)", () => {
    world.module("ai-ecosystem");
    for (let i = 0; i < 40; i++) {
      world.module(`modulo-com-identificador-bem-longo-${String(i).padStart(2, "0")}`);
    }
    const out = world.run("ai-ecosystem", "resumo", SESSION);
    expect(out.status).toBe(0);
    const text = out.context ?? "";
    expect(text.length).toBeLessThanOrEqual(300);
    expect(text.endsWith("…")).toBe(true);
  });

  it("is off with AI_ECOSYSTEM_HOOKS=off", () => {
    world.module("ai-ecosystem");
    world.module("ai-scripts");
    const out = world.run("ai-ecosystem", "resumo", SESSION, { AI_ECOSYSTEM_HOOKS: "off" });
    expect(out.status).toBe(0);
    expect(out.stdout).toBe("");
  });

  it("ignores a module file that is not valid JSON", () => {
    world.module("ai-ecosystem");
    world.module("ai-scripts");
    world.json("modules/ai-broken.json", "{ isto nao e json");
    const out = world.run("ai-ecosystem", "resumo", SESSION);
    expect(out.status).toBe(0);
    expect(out.context).toContain("Módulos: ai-scripts.");
    expect(out.context).not.toContain("ai-broken");
  });

  it("exits 0 with no output when the input is not JSON", () => {
    world.module("ai-ecosystem");
    world.module("ai-scripts");
    const result = spawnSync(process.execPath, [world.script, "ai-ecosystem", "resumo"], { input: "not json", encoding: "utf8", timeout: 15000 });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
  });
});
