// The "hooks" service the AI Ecosystem offers on the Service Bus (see HooksService in types).
// Modules give it the data of their protection rules and their setup handlers; the core turns
// the rule data into hosts.json and pastas.json for the Claude Code hook script.
// Pure Node (no "obsidian" import).
import { clearTimeout, setTimeout } from "node:timers";
import type { HookRuleData, HooksService, ModuleSetupState, SetupHandler } from "../types";
import type { ModuleStateStore } from "./module-states";
import { mergeRuleData } from "./state-dir";
import type { StateDir } from "./state-dir";

export const RULE_WRITE_DEBOUNCE_MS = 500;

export interface HooksServiceDeps {
  state: StateDir;
  states: ModuleStateStore;
  /** Default 500. */
  debounceMs?: number;
}

function copyData(data: HookRuleData): HookRuleData {
  const out: HookRuleData = {};
  const keys = ["hosts", "scriptFolders", "templateTargets", "toolNoteFolders", "excludedFolders"] as const;
  for (const key of keys) {
    const list = (data as Record<string, unknown> | undefined)?.[key];
    if (Array.isArray(list)) out[key] = list.filter((v): v is string => typeof v === "string");
  }
  return out;
}

export class HooksServiceImpl implements HooksService {
  private readonly ruleData = new Map<string, HookRuleData>();
  private readonly handlers = new Map<string, SetupHandler>();
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly deps: HooksServiceDeps) {}

  setRuleData(moduleId: string, data: HookRuleData): void {
    if (typeof moduleId !== "string" || moduleId === "") return;
    this.ruleData.set(moduleId, copyData(data));
    this.scheduleWrite();
  }

  registerSetupHandler(moduleId: string, handler: SetupHandler): () => void {
    this.handlers.set(moduleId, handler);
    return () => {
      if (this.handlers.get(moduleId) === handler) this.handlers.delete(moduleId);
    };
  }

  getModuleState(moduleId: string): ModuleSetupState | undefined {
    return this.deps.states.estado(moduleId);
  }

  /** The handler a module registered for its setup (used by the setup tools). */
  getSetupHandler(moduleId: string): SetupHandler | undefined {
    return this.handlers.get(moduleId);
  }

  /** Forgets what a module gave (it was unregistered). */
  dropModule(moduleId: string): void {
    this.handlers.delete(moduleId);
    if (this.ruleData.delete(moduleId)) this.scheduleWrite();
  }

  /** Writes hosts.json and pastas.json now. */
  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    try {
      const { hosts, pastas } = mergeRuleData(this.ruleData.values());
      this.deps.state.writeHosts(hosts);
      this.deps.state.writePastas(pastas);
    } catch (err) {
      console.warn("[AI Ecosystem] Could not write the hook rule data", err);
    }
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.handlers.clear();
  }

  private scheduleWrite(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.deps.debounceMs ?? RULE_WRITE_DEBOUNCE_MS);
    this.timer.unref();
  }
}
