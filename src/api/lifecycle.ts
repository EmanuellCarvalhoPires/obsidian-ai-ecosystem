// Workspace events of the AI Ecosystem lifecycle. Pure Node: the trigger function is injected.

import { ECOSYSTEM_EVENTS, type AIEcosystemAPI, type ServerStatus } from "../types";

export class EcosystemLifecycle {
  private ready = false;

  constructor(private readonly trigger: (name: string, ...data: unknown[]) => void) {}

  isReady(): boolean {
    return this.ready;
  }

  announceReady(api: AIEcosystemAPI): void {
    this.ready = true;
    this.emit(ECOSYSTEM_EVENTS.ready, api);
  }

  announceUnloading(): void {
    this.ready = false;
    this.emit(ECOSYSTEM_EVENTS.unloading);
  }

  moduleRegistered(id: string): void {
    this.emit(ECOSYSTEM_EVENTS.moduleRegistered, id);
  }

  moduleUnregistered(id: string): void {
    this.emit(ECOSYSTEM_EVENTS.moduleUnregistered, id);
  }

  serviceChanged(name: string, available: boolean): void {
    this.emit(ECOSYSTEM_EVENTS.serviceChanged, name, available);
  }

  serverStatus(status: ServerStatus): void {
    this.emit(ECOSYSTEM_EVENTS.serverStatus, status);
  }

  private emit(name: string, ...data: unknown[]): void {
    try {
      this.trigger(name, ...data);
    } catch (err) {
      console.warn(`[AI Ecosystem] A listener of "${name}" failed`, err);
    }
  }
}
