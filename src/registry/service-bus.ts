// Service Bus: named services provided by modules (e.g. "secrets", "templates"). Pure Node.

import type { ServiceChangeListener, ServiceInfo } from "../types";

const SERVICE_NAME = /^[a-z0-9][a-z0-9:._-]{0,127}$/;

interface Entry {
  owner: string;
  instance: unknown;
  registeredAt: number;
}

export class ServiceBus {
  private readonly services = new Map<string, Entry>();
  private readonly listeners = new Set<ServiceChangeListener>();

  register<T>(name: string, ownerModuleId: string, instance: T): void {
    if (typeof name !== "string" || !SERVICE_NAME.test(name)) {
      throw new Error(`Invalid service name "${String(name)}"`);
    }
    const current = this.services.get(name);
    if (current && current.owner !== ownerModuleId) {
      throw new Error(`Service "${name}" is already provided by ${current.owner}`);
    }
    this.services.set(name, { owner: ownerModuleId, instance, registeredAt: Date.now() });
    this.notify(name, true);
  }

  unregister(name: string): void {
    if (this.services.delete(name)) this.notify(name, false);
  }

  get<T>(name: string): T | undefined {
    return this.services.get(name)?.instance as T | undefined;
  }

  list(): ServiceInfo[] {
    return [...this.services].map(([name, e]) => ({
      name,
      ownerModuleId: e.owner,
      registeredAt: e.registeredAt,
    }));
  }

  /** Removes every service of a module and returns their names. */
  removeOwnedBy(moduleId: string): string[] {
    const names = [...this.services].filter(([, e]) => e.owner === moduleId).map(([n]) => n);
    for (const name of names) {
      this.services.delete(name);
      this.notify(name, false);
    }
    return names;
  }

  onChange(cb: ServiceChangeListener): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  clear(): void {
    for (const name of [...this.services.keys()]) this.unregister(name);
  }

  private notify(name: string, available: boolean): void {
    for (const cb of [...this.listeners]) {
      try {
        cb(name, available);
      } catch (err) {
        console.warn(`[AI Ecosystem] A service listener failed for "${name}"`, err);
      }
    }
  }
}
