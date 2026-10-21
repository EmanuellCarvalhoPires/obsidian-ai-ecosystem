// The guided setup of the modules: what happens when a module is installed from the catalog, the
// temporary setup hook and skill, the three setup tools' logic (status, save, complete), the
// removal of everything when a module is turned off, and the usage guide block of GEMINI.md.
// Pure Node (no "obsidian" import); main.ts and the catalog view reach it through the Ecosystem.
import * as fs from "node:fs";
import * as path from "node:path";
import { clearTimeout, setTimeout } from "node:timers";
import type { HookActionResult, HookInstallPlan, HookManager, HookManagerListener } from "../hooks/hook-manager";
import { NODE_MISSING } from "../hooks/hook-manager";
import { SETUP_EVENTS, buildCommand, protectionModuleIds, protectionSpec } from "../hooks/hook-specs";
import { SETTINGS_FILES, writeFileAtomic } from "../hooks/state-dir";
import type { HookMode } from "../hooks/state-dir";
import type { Lang } from "../i18n";
import { normalizeFolder } from "../settings/settings-store";
import { ECOSYSTEM_ID } from "../types";
import type { AIEcosystemSettings, ActivitySink, ModuleInfo, ModuleSetupState, RegisteredTool, SetupHandler } from "../types";
import { detectGit, obsidianSyncEnabled, cloudProvidersOf, scanScriptFolders } from "./detect";
import type { CoreDetection } from "./detect";
import { buildGuideBlock, hasBlock, upsertBlock } from "./guide-block";
import { buildQuestions, steeringKeys } from "./questions";
import type { QuestionView } from "./questions";
import { SkillFiles } from "./skill-files";
import { buildSkill, skillPath } from "./skill-texts";

export const GEMINI_FILE = "GEMINI.md";
export const CLAUDE_FILE = "CLAUDE.md";

const HOOK_MODES: readonly string[] = ["bloquear", "avisar", "off"];
const CLAUDE_MD_ANSWERS: readonly string[] = ["permitido", "recusado", "criar"];
/** Answers the core needs before it can finish its own setup. */
const CORE_REQUIRED = ["agentes", "modo_hooks", "claude_md"] as const;

const RESTART_NOTICE =
  "Hooks and new tools apply to new sessions: ask the user to restart the Claude Code session if a tool does not show up.";

export interface SetupManagerDeps {
  hooks: HookManager;
  vaultBasePath: string;
  /** app.vault.configDir. */
  configDir?: string;
  /** Language of the skills and of the guide blocks (the Obsidian language). */
  language: () => Lang;
  listModules: () => ModuleInfo[];
  listTools: () => RegisteredTool[];
  getSettings: () => AIEcosystemSettings;
  saveSettings?: () => Promise<void>;
  /** The tool list the MCP clients see changed (a module became visible). */
  notifyToolsChanged: () => void;
  /** The Inspector: the allowed script folders changing is recorded there. */
  activity?: ActivitySink;
  /** Script folders were added to the Script Engine allowed list (Obsidian shows a notice). */
  onScriptFoldersAdded?: (folders: string[]) => void;
  /** How long a module's detect() or validate() may take before it is given up on. Default 5000. */
  handlerTimeoutMs?: number;
}

export interface PrerequisiteView {
  modulo: string;
  estado: string;
  ok: boolean;
}

export interface SetupStatus {
  modulo: string;
  nome: string;
  estado: ModuleSetupState;
  origem: string;
  node_disponivel: boolean;
  detectado: { nucleo: CoreDetection; modulo: Record<string, unknown> };
  respostas: Record<string, unknown>;
  perguntas: QuestionView[];
  pre_requisitos: PrerequisiteView[];
  claude_md: { existe: boolean; caminho: string; tem_bloco: boolean; permissao?: string };
  bloco_claude_md: string;
  tools_do_modulo: Array<{ nome: string; visivel_para_claude_code: boolean }>;
}

export interface SetupFailure {
  ok: false;
  error: string;
  /** What blocks ecosystem_setup_complete. */
  faltando?: string[];
}

export type SetupResult<T extends object = object> = ({ ok: true } & T) | SetupFailure;

export interface CompleteSummary {
  modulo: string;
  nome: string;
  estado: ModuleSetupState;
  hook_temporario_removido: boolean;
  hooks_protecao: string;
  tools_liberadas: number;
  gemini_md: "atualizado" | "sem_alteracao" | "nao_autorizado";
  respostas: Record<string, unknown>;
  aviso: string;
}

export interface CatalogInstallOutcome {
  /** Node.js is missing: the module stays pending and no hook was written. */
  nodeMissing: boolean;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function readText(file: string): string | undefined {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
}

/** Gives up on a module that does not answer, so a stuck handler never freezes the setup. */
async function withTimeout<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} did not answer in ${ms} ms`)), ms);
    timer.unref();
  });
  try {
    return await Promise.race([work, limit]);
  } finally {
    clearTimeout(timer);
  }
}

function stringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") return undefined;
    const clean = item.trim();
    if (clean !== "" && !out.includes(clean)) out.push(clean);
  }
  return out;
}

export class SetupManager implements HookManagerListener {
  private readonly skills: SkillFiles;
  private chain: Promise<void> = Promise.resolve();
  private disposed = false;

  constructor(private readonly deps: SetupManagerDeps) {
    this.skills = new SkillFiles(deps.vaultBasePath);
  }

  private get handlerTimeoutMs(): number {
    return this.deps.handlerTimeoutMs ?? 5000;
  }

  private get hooks(): HookManager {
    return this.deps.hooks;
  }

  private get states() {
    return this.deps.hooks.states;
  }

  /** Keeps .claude/skills/ in place and brings the skills, setup hooks and GEMINI.md up to date. Never throws. */
  start(): void {
    try {
      this.skills.ensureDir();
    } catch (err) {
      console.warn("[AI Ecosystem] Could not create the skills folder", err);
    }
    this.background(async () => {
      for (const id of this.states.ids()) await this.reconcileModule(id);
      this.syncGuides();
    });
  }

  dispose(): void {
    this.disposed = true;
  }

  /** Resolves when everything scheduled so far (setup hooks, skills, GEMINI.md) is done. */
  whenIdle(): Promise<void> {
    return this.chain;
  }

  // ---- install from the catalog ------------------------------------------------

  /** What accepting the install writes, for the confirmation modal. Nothing is written here. */
  async planCatalogInstall(moduleId: string): Promise<HookInstallPlan> {
    const base = await this.hooks.planInstall(moduleId);
    return {
      ...base,
      catalog: {
        skillPath: skillPath(moduleId),
        setupEntries: SETUP_EVENTS.map((event) => ({ event, command: buildCommand(this.hooks.state.vaultPath, moduleId, "setup") })),
        geminiPath: GEMINI_FILE,
      },
    };
  }

  /**
   * The user accepted: the module is pending from this moment, so it never shows up configured
   * (and its tools never show up) between the download and the end of its setup.
   */
  beginCatalogInstall(moduleId: string, name: string): void {
    this.hooks.state.ensure();
    this.states.reset(moduleId, { origem: "catalogo", estado: "pendente_configuracao", nome: name });
  }

  /** The installer finished. On success the skill, the setup hook and GEMINI.md follow; on failure nothing is left behind. */
  async finishCatalogInstall(moduleId: string, ok: boolean): Promise<CatalogInstallOutcome> {
    if (!ok) {
      await this.enqueue(() => this.abortInstall(moduleId));
      return { nodeMissing: false };
    }
    await this.enqueue(async () => {
      await this.reconcileModule(moduleId);
      this.syncGuides();
    });
    const node = await this.hooks.nodeStatus();
    return { nodeMissing: !node.available };
  }

  private async abortInstall(moduleId: string): Promise<void> {
    const state = this.states.get(moduleId);
    if (!state || state.origem !== "catalogo" || state.estado !== "pendente_configuracao") return;
    // A module that did register stays: it is installed, only its setup is pending.
    if (this.deps.listModules().some((m) => m.id === moduleId)) return;
    this.states.forget(moduleId);
    this.skills.remove(moduleId);
    this.hooks.removeSetupHook(moduleId);
  }

  // ---- HookManager listener --------------------------------------------------------

  onModuleRegistered(moduleId: string): void {
    this.background(async () => {
      await this.reconcileModule(moduleId);
      this.syncGuides();
    });
  }

  onModuleDisabled(moduleId: string): void {
    this.background(async () => {
      await this.reconcileModule(moduleId);
      this.syncGuides();
    });
  }

  /** Brings the skill and the setup hook of one module in line with its state. */
  private async reconcileModule(moduleId: string): Promise<void> {
    if (this.disposed) return;
    const state = this.states.get(moduleId);
    if (!state) return;
    try {
      if (state.estado === "desativado") {
        this.skills.remove(moduleId);
        this.hooks.removeSetupHook(moduleId);
        return;
      }
      // Modules that were already there (legacy, manual) never went through the confirmation.
      if (state.origem !== "catalogo" && state.origem !== "nucleo") return;
      this.skills.write(moduleId, buildSkill(moduleId, state.nome ?? moduleId, this.deps.language()));
      if (state.estado === "pendente_configuracao" && !this.hooks.state.hasConfiguredMarker(moduleId)) {
        const result = await this.hooks.installSetupHook(moduleId);
        if (!result.ok && result.error !== NODE_MISSING) console.warn(`[AI Ecosystem] Could not write the setup hook of ${moduleId}: ${result.error}`);
      }
    } catch (err) {
      console.warn(`[AI Ecosystem] Could not prepare the setup of ${moduleId}`, err);
    }
  }

  // ---- GEMINI.md -----------------------------------------------------------------------

  /**
   * Keeps the usage block of GEMINI.md up to date: the modules installed and enabled. It is only
   * written after the user accepted a module install (the confirmation lists it) or when the
   * block is already there.
   */
  syncGuides(): "atualizado" | "sem_alteracao" | "nao_autorizado" {
    try {
      const file = path.join(this.deps.vaultBasePath, GEMINI_FILE);
      const text = readText(file);
      const authorized = (text !== undefined && hasBlock(text)) || this.states.ids().some((id) => this.states.get(id)?.origem === "catalogo");
      if (!authorized) return "nao_autorizado";
      const block = buildGuideBlock({ lang: this.deps.language(), modules: this.installedModuleIds(), target: "gemini" });
      const next = upsertBlock(text ?? "", block);
      if (next === text) return "sem_alteracao";
      writeFileAtomic(file, next);
      return "atualizado";
    } catch (err) {
      console.warn("[AI Ecosystem] Could not update GEMINI.md", err);
      return "sem_alteracao";
    }
  }

  /** Ids of the registered modules that are not turned off. */
  private installedModuleIds(): string[] {
    return this.deps.listModules()
      .map((m) => m.id)
      .filter((id) => this.states.estado(id) !== "desativado");
  }

  // ---- ecosystem_setup_status ----------------------------------------------------------

  async status(moduleId: string): Promise<SetupResult<{ status: SetupStatus }>> {
    const state = this.states.get(moduleId);
    const info = this.deps.listModules().find((m) => m.id === moduleId);
    if (!state) return { ok: false, error: `Unknown module "${moduleId}". Call ecosystem_status to see the installed modules.` };

    const core = await this.detectCore();
    const handlerData = await this.handlerDetect(this.setupHandler(moduleId));
    const lang = this.deps.language();
    const coreAnswers = this.states.get(ECOSYSTEM_ID)?.respostas ?? {};
    const claudeFile = path.join(this.hooks.state.vaultPath, CLAUDE_FILE);
    const claudeText = readText(path.join(this.deps.vaultBasePath, CLAUDE_FILE));
    const permission = coreAnswers.claude_md;

    const status: SetupStatus = {
      modulo: moduleId,
      nome: info?.name ?? state.nome ?? moduleId,
      estado: state.estado,
      origem: state.origem,
      node_disponivel: (await this.hooks.nodeStatus()).available,
      detectado: { nucleo: core, modulo: handlerData },
      respostas: state.respostas,
      perguntas: buildQuestions(
        moduleId,
        { core, module: handlerData, allowedScriptFolders: [...this.deps.getSettings().scripts.allowedFolders] },
        state.respostas,
        lang,
      ),
      pre_requisitos: this.prerequisites(moduleId),
      claude_md: {
        existe: claudeText !== undefined,
        caminho: claudeFile,
        tem_bloco: claudeText !== undefined && hasBlock(claudeText),
        ...(typeof permission === "string" ? { permissao: permission } : {}),
      },
      bloco_claude_md: buildGuideBlock({ lang, modules: this.installedModuleIds(), target: "claude" }),
      tools_do_modulo: this.deps
        .listTools()
        .filter((t) => t.moduleId === moduleId)
        .map((t) => ({ nome: t.tool.name, visivel_para_claude_code: !this.hooks.isToolHidden(t, "claude-code") })),
    };
    return { ok: true, status };
  }

  private async handlerDetect(handler: SetupHandler | undefined): Promise<Record<string, unknown>> {
    if (!handler?.detect) return {};
    try {
      return (await withTimeout(handler.detect(), this.handlerTimeoutMs, "detect()")) ?? {};
    } catch (err) {
      return { erro_na_deteccao: errorText(err) };
    }
  }

  private setupHandler(moduleId: string): SetupHandler | undefined {
    return this.hooks.service.getSetupHandler(moduleId);
  }

  private prerequisites(moduleId: string): PrerequisiteView[] {
    const needed: string[] = [];
    if (moduleId !== ECOSYSTEM_ID) needed.push(ECOSYSTEM_ID);
    if (moduleId === "telegram-ai-gateway") needed.push("environment-variables");
    return needed.map((id) => {
      const estado = this.states.estado(id) ?? "nao_instalado";
      return { modulo: id, estado, ok: estado === "configurado" };
    });
  }

  /** The facts the core finds out about the vault by itself. Never throws. */
  async detectCore(): Promise<CoreDetection> {
    const vault = this.deps.vaultBasePath;
    const registered = new Set(this.deps.listModules().map((m) => m.id));
    const names = new Map(this.deps.listModules().map((m) => [m.id, m.name]));
    const ids = new Set([...registered, ...this.states.ids()]);
    ids.delete(ECOSYSTEM_ID);

    let scripts: CoreDetection["scripts_no_cofre"] = [];
    try {
      scripts = await scanScriptFolders(vault);
    } catch {
      // No signal.
    }
    const node = await this.hooks.nodeStatus();
    const modes: Record<string, HookMode> = {};
    for (const id of protectionModuleIds()) modes[id] = this.hooks.state.getMode(id);
    const settingsFile = this.hooks.state.getSettingsFile();

    return {
      claude_md: fs.existsSync(path.join(vault, CLAUDE_FILE)),
      gemini_md: fs.existsSync(path.join(vault, GEMINI_FILE)),
      git: detectGit(vault),
      sincronizacao: { obsidian_sync: obsidianSyncEnabled(vault, this.deps.configDir), pastas_na_nuvem: cloudProvidersOf(vault) },
      clientes: this.deps.getSettings().clients.map((c) => c.name),
      modulos: [...ids].map((id) => ({
        id,
        nome: names.get(id) ?? this.states.get(id)?.nome ?? id,
        estado: this.states.estado(id),
        registrado: registered.has(id),
      })),
      scripts_no_cofre: scripts,
      hooks: {
        arquivo_settings: settingsFile,
        caminho_settings: path.join(this.hooks.state.claudeDir, settingsFile).replace(/\\/g, "/"),
        modos: modes,
        node: node.available,
      },
    };
  }

  // ---- ecosystem_setup_save ------------------------------------------------------------

  async save(moduleId: string, key: string, value: unknown): Promise<SetupResult> {
    const state = this.states.get(moduleId);
    if (!state) return { ok: false, error: `Unknown module "${moduleId}".` };
    if (state.estado === "desativado") return { ok: false, error: `The module "${moduleId}" is turned off.` };
    if (typeof key !== "string" || key.trim() === "") return { ok: false, error: "chave is required." };

    try {
      const refusal = await this.applyAnswer(moduleId, key, value);
      if (refusal) return { ok: false, error: refusal };
      this.states.answer(moduleId, key, value);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: errorText(err) };
    }
  }

  /** Applies one answer. Returns the reason when it is refused. */
  private async applyAnswer(moduleId: string, key: string, value: unknown): Promise<string | undefined> {
    if (key === "modo_hooks") return this.applyHookMode(moduleId, value);

    if (moduleId === ECOSYSTEM_ID) {
      switch (key) {
        case "agentes": {
          const list = stringList(value);
          if (!list || list.length === 0) return "agentes must be a non-empty list of names.";
          return undefined;
        }
        case "arquivo_settings": {
          if (typeof value !== "string" || !(SETTINGS_FILES as readonly string[]).includes(value)) {
            return `arquivo_settings must be one of: ${SETTINGS_FILES.join(", ")}.`;
          }
          const moved = this.hooks.useSettingsFile(value);
          return moved.ok ? undefined : moved.error;
        }
        case "claude_md":
          return typeof value === "string" && CLAUDE_MD_ANSWERS.includes(value) ? undefined : `claude_md must be one of: ${CLAUDE_MD_ANSWERS.join(", ")}.`;
        default:
          return `Unknown key "${key}" for ${ECOSYSTEM_ID}. Accepted keys: agentes, arquivo_settings, modo_hooks, claude_md.`;
      }
    }

    if (moduleId === "ai-scripts" && key === "pastas_permitidas") return this.applyScriptFolders(value);
    // Answers that only steer the interview never reach the module.
    if (steeringKeys(moduleId).includes(key)) return undefined;

    const handler = this.setupHandler(moduleId);
    if (!handler?.save) return undefined;
    const refusal = await handler.save(key, value);
    return typeof refusal === "string" && refusal !== "" ? refusal : undefined;
  }

  private applyHookMode(moduleId: string, value: unknown): string | undefined {
    if (typeof value !== "string" || !HOOK_MODES.includes(value)) return `modo_hooks must be one of: ${HOOK_MODES.join(", ")}.`;
    const mode = value as HookMode;
    if (moduleId === ECOSYSTEM_ID) {
      for (const id of protectionModuleIds()) this.hooks.setMode(id, mode);
    } else if (protectionSpec(moduleId)) {
      this.hooks.setMode(moduleId, mode);
    }
    return undefined;
  }

  /**
   * The core Script Engine owns the allowed folders, and widening them lets scripts run, so an
   * agent may do it only while the AI Scripts setup is in progress (the user is in the interview).
   * It adds folders, never removes one; the user sees a notice and the Inspector logs it.
   */
  private async applyScriptFolders(value: unknown): Promise<string | undefined> {
    if (this.states.estado("ai-scripts") !== "pendente_configuracao") {
      return "The allowed script folders can only be set while the AI Scripts setup is in progress. Change them in the AI Ecosystem settings.";
    }
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim() === "")) {
      return "pastas_permitidas must be a list of vault folders (no empty entries).";
    }
    const folders: string[] = [];
    for (const item of value as string[]) {
      const problem = this.scriptFolderProblem(item);
      if (problem) return `"${item}" is not accepted: ${problem}`;
      const folder = normalizeFolder(item) as string;
      if (!folders.includes(folder)) folders.push(folder);
    }
    const scripts = this.deps.getSettings().scripts;
    const added = folders.filter((folder) => !scripts.allowedFolders.includes(folder));
    if (added.length === 0) return undefined;
    scripts.allowedFolders.push(...added);
    await this.deps.saveSettings?.();
    this.deps.onScriptFoldersAdded?.(added);
    this.deps.activity?.log({
      kind: "module",
      method: "Setup",
      target: "ecosystem_setup_save ai-scripts pastas_permitidas",
      moduleId: ECOSYSTEM_ID,
      status: 200,
      durationMs: 0,
      payload: { added },
    });
    return undefined;
  }

  /** Why a folder cannot be an allowed script folder, or undefined when it can. */
  private scriptFolderProblem(raw: string): string | undefined {
    const text = raw.trim();
    if (/^([\\/]|[A-Za-z]:)/.test(text)) return "absolute paths are not allowed, use a folder inside the vault.";
    if (text.replace(/\\/g, "/").split("/").includes("..")) return 'a path with ".." is not allowed.';
    const folder = normalizeFolder(text);
    if (!folder) return "use a folder inside the vault, not the vault root.";
    const first = folder.split("/")[0]?.toLowerCase();
    const configDir = this.deps.configDir?.toLowerCase();
    if (first === ".claude" || (configDir !== undefined && first === configDir)) {
      return "the .claude folder and the Obsidian configuration folder cannot hold scripts.";
    }
    try {
      if (!fs.statSync(path.join(this.deps.vaultBasePath, ...folder.split("/"))).isDirectory()) return "it is not a folder.";
    } catch {
      return "the folder does not exist in the vault.";
    }
    return undefined;
  }

  // ---- ecosystem_setup_complete --------------------------------------------------------

  complete(moduleId: string): Promise<SetupResult<{ resumo: CompleteSummary }>> {
    return this.enqueue(() => this.doComplete(moduleId));
  }

  private async doComplete(moduleId: string): Promise<SetupResult<{ resumo: CompleteSummary }>> {
    const state = this.states.get(moduleId);
    if (!state) return { ok: false, error: `Unknown module "${moduleId}".` };
    if (state.estado === "desativado") return { ok: false, error: `The module "${moduleId}" is turned off.` };

    const missing = await this.missingForComplete(moduleId, state.respostas);
    if (missing.length > 0) return { ok: false, error: "The setup cannot finish yet.", faltando: missing };

    try {
      // The order matters: marker, setup hook, state, protection hooks, tools, GEMINI.md.
      this.hooks.state.writeConfiguredMarker(moduleId);
      const removed = this.hooks.removeSetupHook(moduleId);
      this.states.setEstado(moduleId, "configurado");
      const protection = await this.installProtection(moduleId);
      this.hooks.syncTools();
      this.deps.notifyToolsChanged();
      const gemini = this.syncGuides();

      const name = this.deps.listModules().find((m) => m.id === moduleId)?.name ?? state.nome ?? moduleId;
      return {
        ok: true,
        resumo: {
          modulo: moduleId,
          nome: name,
          estado: "configurado",
          hook_temporario_removido: removed.ok && removed.changed,
          hooks_protecao: protection,
          tools_liberadas: this.deps.listTools().filter((t) => t.moduleId === moduleId).length,
          gemini_md: gemini,
          respostas: this.states.get(moduleId)?.respostas ?? {},
          aviso: RESTART_NOTICE,
        },
      };
    } catch (err) {
      return { ok: false, error: errorText(err) };
    }
  }

  private async missingForComplete(moduleId: string, answers: Record<string, unknown>): Promise<string[]> {
    const missing: string[] = [];
    for (const pre of this.prerequisites(moduleId)) {
      if (pre.ok) continue;
      missing.push(
        pre.modulo === ECOSYSTEM_ID
          ? "pre_requisito: ai-ecosystem must be configured first (run the skill configurar-ai-ecosystem)"
          : `pre_requisito: ${pre.modulo} must be installed and configured first (state: ${pre.estado})`,
      );
    }
    if (moduleId === ECOSYSTEM_ID) {
      for (const key of CORE_REQUIRED) if (!(key in answers)) missing.push(`resposta: ${key}`);
    }
    const handler = this.setupHandler(moduleId);
    if (handler?.validate) {
      try {
        const result = await withTimeout(handler.validate(), this.handlerTimeoutMs, "validate()");
        if (!result.ok) missing.push(...(result.missing?.length ? result.missing : ["the module refused to finish its setup"]));
      } catch (err) {
        missing.push(`validation failed: ${errorText(err)}`);
      }
    }
    return missing;
  }

  /** Writes the protection hooks of a module. A mode chosen for all modules in the core round applies to it too. */
  private async installProtection(moduleId: string): Promise<string> {
    if (!protectionSpec(moduleId)) return "nenhum";
    const coreMode = this.states.get(ECOSYSTEM_ID)?.respostas.modo_hooks;
    const explicit = this.hooks.state.readConfig()?.modos[moduleId];
    if (!explicit && typeof coreMode === "string" && HOOK_MODES.includes(coreMode)) this.hooks.setMode(moduleId, coreMode as HookMode);
    const result: HookActionResult = await this.hooks.installProtection(moduleId);
    if (result.ok) return "instalados";
    return result.error === NODE_MISSING ? "node_ausente" : `erro: ${result.error}`;
  }

  // ---- internals ---------------------------------------------------------------------------

  /** Runs tasks one after the other, so the hooks and files are never changed by two of them at once. */
  private enqueue<T>(task: () => Promise<T> | T): Promise<T> {
    const run = this.chain.then(task, task);
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private background(task: () => Promise<void>): void {
    this.enqueue(task).catch((err: unknown) => console.warn("[AI Ecosystem] Setup task failed", err));
  }
}
