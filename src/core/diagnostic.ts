// ecosystem_diagnostico: one compact, actionable health report of the suite. Read-only. It only
// ever reports counts and yes/no answers: never a secret name or value, a token, a chat id or a
// user path. Pure Node (no "obsidian" import).
import * as fs from "node:fs";
import * as path from "node:path";
import type { HooksStatus } from "../hooks/hook-manager";
import { ECOSYSTEM_ID, SCRIPTS_SERVICE, SECRETS_SERVICE, TEMPLATES_SERVICE } from "../types";
import type { HubTool, HubToolResult, ModuleInfo, ScriptsListService, SecretVaultService, ServerStatus, TemplatesListService } from "../types";

export type Severity = "ok" | "aviso" | "erro";

export interface Finding {
  id: string;
  area: "modulos" | "servidor" | "hooks" | "setup" | "templates" | "scripts" | "telegram" | "segredos";
  severidade: Severity;
  mensagem: string;
  /** One sentence, present when the severity is not "ok". */
  acao?: string;
}

export interface DiagnosticReport {
  versao: string;
  resumo: Record<Severity, number>;
  achados: Finding[];
}

export interface DiagnosticDeps {
  version: string;
  getServerStatus: () => ServerStatus;
  listModules: () => ModuleInfo[];
  /** Undefined when the vault has no absolute folder (no hooks). */
  getHooksStatus?: () => HooksStatus;
  getService?: <T>(name: string) => T | undefined;
  /** Absolute vault folder and Obsidian config folder name, used to compare the loaded modules with the files on disk. */
  vaultBasePath?: string;
  configDir?: string;
}

/** The suite, in the order of the report. */
export const SUITE_MODULES: ReadonlyArray<{ id: string; name: string }> = [
  { id: ECOSYSTEM_ID, name: "AI Ecosystem" },
  { id: "environment-variables", name: "Environment Keys" },
  { id: "ai-git-tools", name: "AI Git Tools" },
  { id: "ai-log-manager", name: "AI Log Manager" },
  { id: "ai-scripts", name: "AI Scripts" },
  { id: "ai-templates", name: "AI Templates" },
  { id: "telegram-ai-gateway", name: "Telegram AI Gateway" },
  { id: "ai-vault-search", name: "AI Vault Search" },
];

const INSTALL_ACTION = "Instale pelo catálogo do AI Ecosystem (aba Catálogo nas configurações do plugin).";

function setupAction(moduleId: string): string {
  return `Rode a skill configurar-${moduleId} numa sessão do agente para concluir a configuração.`;
}

function modeLabel(mode: string): string {
  return mode === "off" ? "desligado" : mode;
}

/** Count of a list-like service method. Undefined when the service or the method is missing; -1 when it threw. */
async function countOf(read: (() => Promise<unknown[]> | unknown[]) | undefined): Promise<number | undefined> {
  if (typeof read !== "function") return undefined;
  try {
    const list = await read();
    return Array.isArray(list) ? list.length : -1;
  } catch {
    return -1;
  }
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

const STALE_ACTION = "Recarregue o plugin (desative e ative de novo em Plugins da comunidade) para carregar a versão que está em disco.";

/**
 * A registered module whose files on disk changed after it was loaded: another manifest version, or a
 * main.js written after the registration. Read-only; a read error is no signal and gives no finding.
 */
function staleModuleFinding(deps: DiagnosticDeps, info: ModuleInfo, name: string): Finding | undefined {
  if (!deps.vaultBasePath || !deps.configDir) return undefined;
  const dir = path.join(deps.vaultBasePath, deps.configDir, "plugins", info.id);
  let diskVersion: string | undefined;
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8")) as { version?: unknown };
    if (typeof manifest.version === "string") diskVersion = manifest.version;
  } catch {
    // No readable manifest: no version signal.
  }
  if (diskVersion !== undefined && diskVersion !== info.version) {
    return {
      id: `defasado:${info.id}`,
      area: "modulos",
      severidade: "aviso",
      mensagem: `${name}: carregado na versão ${info.version}, mas o manifest.json em disco é ${diskVersion}.`,
      acao: STALE_ACTION,
    };
  }
  try {
    const mtimeMs = fs.statSync(path.join(dir, "main.js")).mtimeMs;
    if (mtimeMs > info.registeredAt + 5000) {
      return {
        id: `defasado:${info.id}`,
        area: "modulos",
        severidade: "aviso",
        mensagem: `${name}: o main.js em disco foi alterado depois de o módulo ser carregado.`,
        acao: STALE_ACTION,
      };
    }
  } catch {
    // No main.js: no signal.
  }
  return undefined;
}

export async function buildDiagnostic(deps: DiagnosticDeps): Promise<DiagnosticReport> {
  const findings: Finding[] = [];
  const add = (f: Finding): void => {
    findings.push(f.severidade === "ok" ? { ...f, acao: undefined } : f);
  };
  const modules = deps.listModules();
  const registered = new Map(modules.map((m) => [m.id, m]));
  const hooks = deps.getHooksStatus?.();
  const stateOf = (id: string): string | undefined => (id === ECOSYSTEM_ID ? hooks?.coreEstado : hooks?.modules.find((m) => m.id === id)?.estado);

  // Modules: registered vs. expected. A missing one is "not installed", never an error.
  for (const { id, name } of SUITE_MODULES) {
    const info = registered.get(id);
    if (!info) {
      add({ id: `modulo:${id}`, area: "modulos", severidade: "aviso", mensagem: `${name} (${id}): não instalado.`, acao: INSTALL_ACTION });
    } else if (info.warnings.length > 0) {
      add({
        id: `modulo:${id}`,
        area: "modulos",
        severidade: "aviso",
        mensagem: `${name} ${info.version}: registrado com ${plural(info.warnings.length, "aviso", "avisos")} de registro.`,
        acao: "Chame ecosystem_status para ler os avisos de registro (tools ou rotas repetidas por outro módulo).",
      });
    } else {
      add({ id: `modulo:${id}`, area: "modulos", severidade: "ok", mensagem: `${name} ${info.version}: registrado, ${plural(info.toolNames.length, "tool", "tools")}.` });
    }
    if (info) {
      const stale = staleModuleFinding(deps, info, name);
      if (stale) add(stale);
    }
  }
  const extra = modules.filter((m) => !SUITE_MODULES.some((s) => s.id === m.id)).length;
  if (extra > 0) add({ id: "modulo:outros", area: "modulos", severidade: "ok", mensagem: `${plural(extra, "módulo extra registrado", "módulos extras registrados")} fora da suíte.` });

  // Server and port.
  const server = deps.getServerStatus();
  if (!server.running) {
    add({
      id: "servidor",
      area: "servidor",
      severidade: "erro",
      mensagem: `Servidor MCP parado (porta configurada ${server.port})${server.error ? `: ${server.error}` : ""}.`,
      acao: "Reinicie o plugin AI Ecosystem; se a porta estiver ocupada, troque-a nas configurações do plugin.",
    });
  } else if (server.usingAlternativePort) {
    add({
      id: "servidor",
      area: "servidor",
      severidade: "aviso",
      mensagem: `Servidor MCP em 127.0.0.1:${server.port}, que não é a porta configurada${server.configuredPort ? ` (${server.configuredPort})` : ""}.`,
      acao: "Confira se a URL do servidor nos clientes MCP (Claude Code, Antigravity) usa esta porta.",
    });
  } else {
    add({ id: "servidor", area: "servidor", severidade: "ok", mensagem: `Servidor MCP em 127.0.0.1:${server.port}.` });
  }

  // Hooks.
  if (!hooks) {
    add({
      id: "hooks",
      area: "hooks",
      severidade: "aviso",
      mensagem: "Hooks do Claude Code indisponíveis neste cofre (sem pasta absoluta).",
      acao: "Abra o cofre por uma pasta local para o AI Ecosystem poder instalar os hooks.",
    });
  } else {
    if (!hooks.node.checked) {
      add({ id: "hooks:node", area: "hooks", severidade: "aviso", mensagem: "Node.js ainda não foi verificado.", acao: "Aguarde alguns segundos e rode o diagnóstico de novo." });
    } else if (!hooks.node.available) {
      add({
        id: "hooks:node",
        area: "hooks",
        severidade: "erro",
        mensagem: "Node.js não foi encontrado no PATH: os hooks não podem rodar.",
        acao: "Instale o Node.js (nodejs.org) e reinicie o Obsidian.",
      });
    }
    if (hooks.lastError) {
      add({
        id: "hooks:escrita",
        area: "hooks",
        severidade: "erro",
        mensagem: `Falha ao gravar o arquivo de settings dos hooks (${hooks.settingsFile}).`,
        acao: "Abra Configurações > AI Ecosystem > Hooks para ver o erro e tente instalar de novo.",
      });
    }
    if (hooks.coreInstalled) {
      add({ id: "hooks:nucleo", area: "hooks", severidade: "ok", mensagem: `Hook do núcleo instalado (${hooks.settingsFile}).` });
    } else {
      add({
        id: "hooks:nucleo",
        area: "hooks",
        severidade: "aviso",
        mensagem: "Hook do núcleo não está instalado.",
        acao: "Abra Configurações > AI Ecosystem > Hooks e use Instalar hooks.",
      });
    }
    for (const row of hooks.modules) {
      if (!row.hasProtection || row.estado === "desativado") continue;
      const label = `Hooks de ${row.name}`;
      if (row.estado === "pendente_configuracao") continue; // Covered by the setup findings.
      if (row.installed.length === 0) {
        add({
          id: `hooks:${row.id}`,
          area: "hooks",
          severidade: "aviso",
          mensagem: `${label}: não instalados (modo ${modeLabel(row.mode)}).`,
          acao: "Abra Configurações > AI Ecosystem > Hooks e instale os hooks do módulo.",
        });
      } else if (row.mode === "off") {
        add({
          id: `hooks:${row.id}`,
          area: "hooks",
          severidade: "aviso",
          mensagem: `${label}: instalados, mas desligados.`,
          acao: "Mude o modo para bloquear ou avisar nas configurações de Hooks se quiser que o agente seja guiado às tools do plugin.",
        });
      } else {
        add({ id: `hooks:${row.id}`, area: "hooks", severidade: "ok", mensagem: `${label}: instalados, modo ${row.mode}.` });
      }
    }
  }

  // Setup pending (the state ecosystem_setup_status reports).
  const pending: string[] = [];
  for (const { id } of SUITE_MODULES) if (stateOf(id) === "pendente_configuracao") pending.push(id);
  if (!hooks) {
    // No state without the hooks side.
  } else if (pending.length === 0) {
    add({ id: "setup", area: "setup", severidade: "ok", mensagem: "Nenhuma configuração pendente nos módulos." });
  } else {
    for (const id of pending) {
      const name = SUITE_MODULES.find((s) => s.id === id)?.name ?? id;
      add({ id: `setup:${id}`, area: "setup", severidade: "aviso", mensagem: `${name}: configuração pendente.`, acao: setupAction(id) });
    }
  }

  // Templates and scripts loaded (only when the module's service is there).
  const getService = deps.getService;
  const templates = getService?.<TemplatesListService>(TEMPLATES_SERVICE);
  if (templates) {
    const n = await countOf(templates.listTemplates?.bind(templates));
    if (n === -1) {
      add({ id: "templates", area: "templates", severidade: "aviso", mensagem: "Não foi possível listar os templates.", acao: "Abra o AI Templates nas configurações do Obsidian e confira a pasta de templates." });
    } else if (n !== undefined) {
      add(
        n === 0
          ? { id: "templates", area: "templates", severidade: "aviso", mensagem: "Nenhum template carregado.", acao: "Crie o primeiro com create_template ou use o kit inicial do AI Templates." }
          : { id: "templates", area: "templates", severidade: "ok", mensagem: `${plural(n, "template carregado", "templates carregados")}.` },
      );
    }
  }
  const scripts = getService?.<ScriptsListService>(SCRIPTS_SERVICE);
  if (scripts) {
    const n = await countOf(scripts.listScripts?.bind(scripts));
    if (n === -1) {
      add({ id: "scripts", area: "scripts", severidade: "aviso", mensagem: "Não foi possível listar os scripts.", acao: "Abra o AI Scripts nas configurações do Obsidian e confira a pasta de scripts." });
    } else if (n !== undefined) {
      add(
        n === 0
          ? { id: "scripts", area: "scripts", severidade: "aviso", mensagem: "Nenhum script carregado.", acao: "Registre o primeiro script no AI Scripts ou use o kit inicial do módulo." }
          : { id: "scripts", area: "scripts", severidade: "ok", mensagem: `${plural(n, "script carregado", "scripts carregados")}.` },
      );
    }
  }

  // Telegram: yes or no, nothing else.
  if (!registered.has("telegram-ai-gateway")) {
    add({ id: "telegram", area: "telegram", severidade: "aviso", mensagem: "Telegram configurado: não (módulo não instalado).", acao: INSTALL_ACTION });
  } else if (stateOf("telegram-ai-gateway") === "configurado") {
    add({ id: "telegram", area: "telegram", severidade: "ok", mensagem: "Telegram configurado: sim." });
  } else {
    add({ id: "telegram", area: "telegram", severidade: "aviso", mensagem: "Telegram configurado: não.", acao: setupAction("telegram-ai-gateway") });
  }

  // Secrets: only the count (and whether the vault is locked).
  const secrets = getService?.<SecretVaultService>(SECRETS_SERVICE);
  if (secrets) {
    let locked = false;
    try {
      locked = secrets.isLocked();
    } catch {
      locked = false;
    }
    if (locked) {
      add({ id: "segredos", area: "segredos", severidade: "aviso", mensagem: "Cofre de segredos bloqueado.", acao: "Desbloqueie o Environment Keys no Obsidian para usar segredos." });
    } else if (typeof secrets.count === "function") {
      try {
        const n = secrets.count();
        if (Number.isFinite(n)) add({ id: "segredos", area: "segredos", severidade: "ok", mensagem: `${plural(n, "segredo cadastrado", "segredos cadastrados")}.` });
      } catch {
        // No signal: the line is left out.
      }
    }
  }

  const resumo: Record<Severity, number> = { ok: 0, aviso: 0, erro: 0 };
  for (const f of findings) resumo[f.severidade] += 1;
  return { versao: deps.version, resumo, achados: findings };
}

/**
 * The report as the tool returns it: the same counts, but only the warnings and errors in `achados`
 * unless `completo` is true. buildDiagnostic keeps the full report.
 */
export function compactReport(report: DiagnosticReport, completo: boolean): DiagnosticReport {
  if (completo) return report;
  return { ...report, achados: report.achados.filter((f) => f.severidade !== "ok") };
}

export function formatDiagnosticText(report: DiagnosticReport): string {
  const { resumo } = report;
  const lines = [`Diagnóstico do AI Ecosystem ${report.versao}: ${resumo.ok} ok, ${resumo.aviso} avisos, ${resumo.erro} erros.`];
  if (report.achados.length === 0 && resumo.ok > 0) lines.push("Nenhum aviso ou erro. Use completo: true para listar os itens ok.");
  for (const f of report.achados) {
    lines.push(`[${f.severidade}] ${f.mensagem}${f.acao ? ` -> ${f.acao}` : ""}`);
  }
  return lines.join("\n");
}

export function createDiagnosticTool(deps: DiagnosticDeps): HubTool {
  return {
    name: "ecosystem_diagnostico",
    title: "AI Ecosystem diagnostic",
    description:
      "Health report of the AI Ecosystem suite: modules registered vs. expected (a missing one is just not installed), MCP server and port, " +
      "Claude Code hooks (installed and mode per module), pending setup, loaded templates and scripts, whether Telegram is configured and how many secrets exist. " +
      "Each finding has a severity (ok, aviso, erro) and, when not ok, a next action. " +
      "Only warnings and errors are listed (completo: true lists everything). Read-only; never returns secret names or values.",
    inputSchema: {
      type: "object",
      properties: {
        formato: { type: "string", enum: ["texto", "json"], description: 'Output format. Default "texto".' },
        completo: {
          type: "boolean",
          default: false,
          description: "Also list the items that are ok. Default: only warnings and errors, with the count of ok items.",
        },
      },
      additionalProperties: false,
    },
    annotations: { title: "AI Ecosystem diagnostic", readOnlyHint: true, openWorldHint: false },
    handler: async (args) => {
      const report = compactReport(await buildDiagnostic(deps), args.completo === true);
      const asJson = args.formato === "json";
      const result: HubToolResult = {
        content: [{ type: "text", text: asJson ? JSON.stringify(report, null, 2) : formatDiagnosticText(report) }],
        structuredContent: { ...report },
      };
      return result;
    },
  };
}
