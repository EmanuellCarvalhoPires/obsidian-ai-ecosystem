// ecosystem_diagnostico: the report with every module there, with part of the suite missing,
// that nothing sensitive reaches the output, and the json format.
import { describe, expect, it } from "vitest";
import { buildDiagnostic, createDiagnosticTool, formatDiagnosticText, SUITE_MODULES } from "../../src/core/diagnostic";
import type { DiagnosticDeps } from "../../src/core/diagnostic";
import type { HooksStatus } from "../../src/hooks/hook-manager";
import type { ModuleInfo, ServerStatus } from "../../src/types";

const SECRET_NAME = "SENTINEL_SECRET_NAME_91x";
const SECRET_VALUE = "sentinel-secret-value-7f3a";
const TOKEN = "123456:SENTINEL-TELEGRAM-TOKEN";
const CHAT_ID = "SENTINEL-CHAT-4455";
const USER_PATH = "C:/Users/sentinel-user/Vault";

function info(id: string, warnings: string[] = []): ModuleInfo {
  return { id, name: id, version: "1.0.0", apiVersion: 1, registeredAt: 1, routeCount: 0, legacyAliasPaths: [], toolNames: ["a", "b"], promptNames: [], warnings };
}

const server: ServerStatus = { running: true, port: 27150, usingAlternativePort: false };

function hooksStatus(overrides: Partial<HooksStatus> = {}): HooksStatus {
  const entry = (module: string) => ({ module, type: "protecao" as never, event: "PreToolUse" as never, command: `node "${USER_PATH}/.claude/hook.mjs" ${module}` });
  return {
    node: { available: true, checked: true },
    settingsFile: "settings.local.json",
    settingsPath: `${USER_PATH}/.claude/settings.local.json`,
    coreInstalled: true,
    coreEstado: "configurado",
    modules: [
      { id: "ai-vault-search", name: "AI Vault Search", registered: true, estado: "configurado", mode: "bloquear", hasProtection: true, installed: [entry("ai-vault-search")], setupHook: false },
      { id: "ai-git-tools", name: "AI Git Tools", registered: true, estado: "configurado", mode: "off", hasProtection: true, installed: [entry("ai-git-tools")], setupHook: false },
      { id: "telegram-ai-gateway", name: "Telegram AI Gateway", registered: true, estado: "configurado", mode: "avisar", hasProtection: false, installed: [], setupHook: false },
    ],
    ...overrides,
  };
}

function services(extra: Record<string, unknown> = {}): DiagnosticDeps["getService"] {
  const all: Record<string, unknown> = {
    templates: { listTemplates: () => Promise.resolve([{ id: "t1" }, { id: "t2" }, { id: "t3" }]) },
    scripts: { listScripts: () => [{ id: "s1" }] },
    secrets: { isLocked: () => false, count: () => 4, secretNames: [SECRET_NAME], value: SECRET_VALUE },
    ...extra,
  };
  return <T,>(name: string) => all[name] as T | undefined;
}

function deps(overrides: Partial<DiagnosticDeps> = {}): DiagnosticDeps {
  return {
    version: "1.3.0",
    getServerStatus: () => server,
    listModules: () => SUITE_MODULES.map((m) => info(m.id)),
    getHooksStatus: () => hooksStatus(),
    getService: services(),
    ...overrides,
  };
}

const ctx = { client: { id: "c", name: "Test" }, moduleId: "ai-ecosystem" };

describe("ecosystem_diagnostico with the whole suite there", () => {
  it("reports every module as registered, the server, hooks with their mode, counts and Telegram as yes", async () => {
    const report = await buildDiagnostic(deps());
    const byId = new Map(report.achados.map((f) => [f.id, f]));
    for (const { id } of SUITE_MODULES) expect(byId.get(`modulo:${id}`)?.severidade).toBe("ok");
    expect(byId.get("servidor")).toMatchObject({ severidade: "ok", mensagem: "Servidor MCP em 127.0.0.1:27150." });
    expect(byId.get("hooks:ai-vault-search")?.mensagem).toContain("modo bloquear");
    expect(byId.get("hooks:ai-git-tools")).toMatchObject({ severidade: "aviso" });
    expect(byId.get("hooks:ai-git-tools")?.mensagem).toContain("desligados");
    expect(byId.get("setup")?.severidade).toBe("ok");
    expect(byId.get("templates")?.mensagem).toBe("3 templates carregados.");
    expect(byId.get("scripts")?.mensagem).toBe("1 script carregado.");
    expect(byId.get("telegram")?.mensagem).toBe("Telegram configurado: sim.");
    expect(byId.get("segredos")?.mensagem).toBe("4 segredos cadastrados.");
    expect(report.resumo.erro).toBe(0);
    // Every finding that is not ok carries a next action; ok ones carry none.
    for (const f of report.achados) expect(Boolean(f.acao), f.id).toBe(f.severidade !== "ok");
  });

  it("lists the pending setup of each module with the skill to run", async () => {
    const status = hooksStatus({ coreEstado: "pendente_configuracao" });
    status.modules[0]!.estado = "pendente_configuracao";
    const report = await buildDiagnostic(deps({ getHooksStatus: () => status }));
    const core = report.achados.find((f) => f.id === "setup:ai-ecosystem");
    expect(core?.acao).toContain("configurar-ai-ecosystem");
    expect(report.achados.find((f) => f.id === "setup:ai-vault-search")?.acao).toContain("configurar-ai-vault-search");
  });
});

describe("ecosystem_diagnostico with part of the suite missing", () => {
  const partial = (): DiagnosticDeps =>
    deps({
      listModules: () => [info("ai-ecosystem"), info("ai-vault-search")],
      getService: services({ templates: undefined, scripts: undefined, secrets: undefined }),
    });

  it("reports an absent module as not installed (a warning with an action), never as an error", async () => {
    const report = await buildDiagnostic(partial());
    const missing = report.achados.filter((f) => f.id.startsWith("modulo:") && f.severidade !== "ok");
    expect(missing.map((f) => f.id)).toEqual(
      SUITE_MODULES.filter((m) => !["ai-ecosystem", "ai-vault-search"].includes(m.id)).map((m) => `modulo:${m.id}`),
    );
    for (const f of missing) {
      expect(f.severidade).toBe("aviso");
      expect(f.mensagem).toContain("não instalado");
      expect(f.acao).toContain("catálogo");
    }
    expect(report.resumo.erro).toBe(0);
  });

  it("leaves out the template, script and secret lines when their services are not there, and says Telegram is not configured", async () => {
    const report = await buildDiagnostic(partial());
    const ids = report.achados.map((f) => f.id);
    for (const gone of ["templates", "scripts", "segredos"]) expect(ids).not.toContain(gone);
    expect(report.achados.find((f) => f.id === "telegram")?.mensagem).toContain("não");
  });

  it("works without the hooks side and flags a stopped server, missing Node and a locked secrets vault", async () => {
    const noHooks = await buildDiagnostic(deps({ getHooksStatus: undefined }));
    expect(noHooks.achados.find((f) => f.id === "hooks")?.severidade).toBe("aviso");
    expect(noHooks.achados.some((f) => f.area === "setup")).toBe(false);

    const bad = await buildDiagnostic(
      deps({
        getServerStatus: () => ({ running: false, port: 27150, usingAlternativePort: false, error: "Port 27150 is in use" }),
        getHooksStatus: () => hooksStatus({ node: { available: false, checked: true } }),
        getService: services({ secrets: { isLocked: () => true, count: () => 4 } }),
      }),
    );
    expect(bad.achados.find((f) => f.id === "servidor")).toMatchObject({ severidade: "erro" });
    expect(bad.achados.find((f) => f.id === "hooks:node")).toMatchObject({ severidade: "erro" });
    expect(bad.achados.find((f) => f.id === "segredos")).toMatchObject({ severidade: "aviso" });
    // A locked vault never reports a count.
    expect(bad.achados.find((f) => f.id === "segredos")?.mensagem).not.toMatch(/\d/);
  });

  it("warns about an empty template list and about a service that throws", async () => {
    const report = await buildDiagnostic(
      deps({
        getService: services({
          templates: { listTemplates: () => [] },
          scripts: {
            listScripts: () => {
              throw new Error(`boom at ${USER_PATH}`);
            },
          },
        }),
      }),
    );
    expect(report.achados.find((f) => f.id === "templates")).toMatchObject({ severidade: "aviso", mensagem: "Nenhum template carregado." });
    const scripts = report.achados.find((f) => f.id === "scripts");
    expect(scripts?.severidade).toBe("aviso");
    expect(scripts?.mensagem).not.toContain("boom");
  });
});

describe("ecosystem_diagnostico output", () => {
  it("never carries a secret name or value, a token, a chat id or a user path", async () => {
    const tool = createDiagnosticTool(
      deps({
        listModules: () => SUITE_MODULES.map((m) => info(m.id, m.id === "telegram-ai-gateway" ? [`skipped ${TOKEN} ${CHAT_ID}`] : [])),
        getHooksStatus: () => hooksStatus({ lastError: `EACCES ${USER_PATH}/.claude/settings.local.json ${TOKEN}` }),
        getService: services({ telegram: { token: TOKEN, chatId: CHAT_ID } }),
      }),
    );
    for (const formato of ["texto", "json"]) {
      const result = await tool.handler({ formato }, ctx);
      const everything = JSON.stringify(result);
      for (const sentinel of [SECRET_NAME, SECRET_VALUE, TOKEN, CHAT_ID, "sentinel-user", "SENTINEL"]) expect(everything, `${formato}: ${sentinel}`).not.toContain(sentinel);
    }
  });

  it("is read-only, plain text by default and valid JSON with formato json", async () => {
    const tool = createDiagnosticTool(deps());
    expect(tool.annotations?.readOnlyHint).toBe(true);

    const text = (await tool.handler({}, ctx)).content[0] as { text: string };
    expect(text.text.startsWith("Diagnóstico do AI Ecosystem 1.3.0:")).toBe(true);
    expect(() => JSON.parse(text.text)).toThrow();

    const json = await tool.handler({ formato: "json" }, ctx);
    const parsed = JSON.parse((json.content[0] as { text: string }).text) as { versao: string; resumo: Record<string, number>; achados: Array<{ id: string; severidade: string }> };
    expect(parsed.versao).toBe("1.3.0");
    expect(parsed.achados.length).toBeGreaterThan(8);
    expect(parsed.resumo.ok + parsed.resumo.aviso + parsed.resumo.erro).toBe(parsed.achados.length);
    expect(json.structuredContent).toMatchObject({ versao: "1.3.0" });
  });

  it("formats one line per finding with the action after an arrow", async () => {
    const text = formatDiagnosticText(await buildDiagnostic(deps({ listModules: () => [info("ai-ecosystem")] })));
    expect(text).toContain("[aviso] AI Git Tools (ai-git-tools): não instalado. -> ");
    expect(text).toContain("[ok] AI Ecosystem 1.0.0: registrado, 2 tools.");
  });
});
