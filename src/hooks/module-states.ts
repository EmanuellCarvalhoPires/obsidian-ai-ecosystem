// Setup state of each module, kept in <state>/modules/<id>.json (the hook script reads the same
// files). Reads are cached; every change is written through. Pure Node (no "obsidian" import).
import type { ModuleSetupState } from "../types";
import type { ModuleOrigin, ModuleState, StateDir } from "./state-dir";

export interface NewModuleState {
  origem: ModuleOrigin;
  estado?: ModuleSetupState;
  nome?: string;
}

export class ModuleStateStore {
  private readonly cache = new Map<string, ModuleState | undefined>();

  constructor(private readonly state: StateDir) {}

  get(moduleId: string): ModuleState | undefined {
    if (!this.cache.has(moduleId)) this.cache.set(moduleId, this.state.readModuleState(moduleId));
    return this.cache.get(moduleId);
  }

  estado(moduleId: string): ModuleSetupState | undefined {
    return this.get(moduleId)?.estado;
  }

  /** Creates the state of a module that has none and returns it. An existing state is left alone. */
  ensure(moduleId: string, create: NewModuleState): ModuleState {
    const existing = this.get(moduleId);
    if (existing) return existing;
    const state: ModuleState = {
      estado: create.estado ?? "configurado",
      origem: create.origem,
      atualizadoEm: new Date().toISOString(),
      respostas: {},
    };
    if (create.nome) state.nome = create.nome;
    this.save(moduleId, state);
    return state;
  }

  /** Starts a module over: new state (answers cleared) and no "configured" marker. */
  reset(moduleId: string, create: NewModuleState): ModuleState {
    const state: ModuleState = {
      estado: create.estado ?? "configurado",
      origem: create.origem,
      atualizadoEm: new Date().toISOString(),
      respostas: {},
    };
    if (create.nome) state.nome = create.nome;
    this.state.removeConfiguredMarker(moduleId);
    this.save(moduleId, state);
    return state;
  }

  /** Deletes the state of a module (an install that did not happen). */
  forget(moduleId: string): void {
    this.state.removeModuleState(moduleId);
    this.cache.set(moduleId, undefined);
  }

  /** Stores one answer of the guided setup. Returns undefined when the module has no state. */
  answer(moduleId: string, key: string, value: unknown): ModuleState | undefined {
    const current = this.get(moduleId);
    if (!current) return undefined;
    const next: ModuleState = { ...current, respostas: { ...current.respostas, [key]: value }, atualizadoEm: new Date().toISOString() };
    this.save(moduleId, next);
    return next;
  }

  /** Changes the setup state of a module that has one. Returns undefined when it has none. */
  setEstado(moduleId: string, estado: ModuleSetupState): ModuleState | undefined {
    const current = this.get(moduleId);
    if (!current) return undefined;
    const next: ModuleState = { ...current, estado, atualizadoEm: new Date().toISOString() };
    this.save(moduleId, next);
    return next;
  }

  /** Remembers (or forgets) that the user removed the protection hooks of a module by hand. */
  setHooksRemovidos(moduleId: string, removed: boolean): ModuleState | undefined {
    const current = this.get(moduleId);
    if (!current || (current.hooksRemovidos === true) === removed) return current;
    const next: ModuleState = { ...current, atualizadoEm: new Date().toISOString() };
    if (removed) next.hooksRemovidos = true;
    else delete next.hooksRemovidos;
    this.save(moduleId, next);
    return next;
  }

  /** Module ids with a state file. */
  ids(): string[] {
    return this.state.listModuleIds();
  }

  private save(moduleId: string, state: ModuleState): void {
    this.state.writeModuleState(moduleId, state);
    this.cache.set(moduleId, state);
  }
}
