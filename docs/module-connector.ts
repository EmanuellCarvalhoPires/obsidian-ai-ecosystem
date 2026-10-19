// Reference code for module authors. Not compiled by the AI Ecosystem build.
//
// Copy this file into your module plugin (Environment Keys, AI Templates, Telegram AI
// Gateway...). It connects your plugin to the AI Ecosystem no matter which plugin Obsidian
// loads first, and again every time the AI Ecosystem reloads.
//
// Usage, in your plugin's onload():
//
//   this.connector = new EcosystemConnector(this, {
//     buildRegistration: () => ({
//       id: "my-module",
//       name: "My module",
//       version: this.manifest.version,
//       apiVersion: 1,
//       tools: [...],
//       onUnload: () => { /* free what the registration holds */ },
//     }),
//     onStatus: (status, detail) => this.updateStatusBar(status, detail),
//     onMissing: () => new MissingEcosystemModal(this.app).open(),
//     onIncompatible: (reason) => new Notice(reason),
//     onConnected: (api) => api.registerService("my-service", "my-module", this.service),
//   });
//   this.connector.start();
//
// And in onunload():
//
//   this.connector.stop();

import { Plugin } from "obsidian";

/** Mirror of the AI Ecosystem events (see ECOSYSTEM_EVENTS in the AI Ecosystem types). */
const EVENT_READY = "ai-ecosystem:ready";
const EVENT_UNLOADING = "ai-ecosystem:unloading";
const ECOSYSTEM_PLUGIN_ID = "ai-ecosystem";

export type ConnectorStatus =
  /** Registered in the AI Ecosystem. */
  | "connected"
  /** The AI Ecosystem is installed but not ready yet; waiting for its "ready" event. */
  | "waiting"
  /** The AI Ecosystem is reloading or was disabled; the module will register again on "ready". */
  | "disconnected"
  /** The AI Ecosystem is not installed or not enabled. */
  | "missing"
  /** The AI Ecosystem refused the registration (for example an unsupported Provider API version). */
  | "incompatible";

/**
 * Loose typing on purpose: a module must not depend on the AI Ecosystem's source. Copy the
 * types you use (HubModuleRegistration...) or keep them as "unknown".
 */
interface EcosystemApi {
  isReady(): boolean;
  registerModule(module: unknown): { ok: true; warnings?: string[] } | { ok: false; reason: string };
  unregisterModule(moduleId: string): boolean;
  registerService(name: string, ownerModuleId: string, instance: unknown): void;
}

export interface EcosystemConnectorOptions {
  /** Builds the registration. Called on every (re-)registration, so handlers can use fresh state. */
  buildRegistration: () => { id: string } & Record<string, unknown>;
  /** Called whenever the connection status changes. `detail` carries the refusal reason. */
  onStatus?: (status: ConnectorStatus, detail?: string) => void;
  /** After the layout is ready the AI Ecosystem is not installed or enabled: show your dependency modal here. */
  onMissing?: () => void;
  /** The AI Ecosystem refused the registration: tell the user (for example "Update AI Ecosystem"). */
  onIncompatible?: (reason: string) => void;
  /** Right after a successful registration: register services, update tools, read services of other modules. */
  onConnected?: (api: EcosystemApi) => void;
}

export class EcosystemConnector {
  private moduleId: string | undefined;
  private api: EcosystemApi | undefined;
  private stopped = false;

  constructor(
    private readonly plugin: Plugin,
    private readonly options: EcosystemConnectorOptions,
  ) {}

  /** Call from onload(). Safe to call before the AI Ecosystem has loaded. */
  start(): void {
    const { app } = this.plugin;

    // Obsidian does not guarantee the plugin load order, so wait for the layout first.
    app.workspace.onLayoutReady(() => {
      if (this.stopped) return;

      const api = this.findApi();
      if (api?.isReady()) {
        this.connect(api);
      } else if (api) {
        // Installed and enabled, but still starting: the "ready" event below registers us.
        this.options.onStatus?.("waiting");
      } else {
        this.options.onStatus?.("missing");
        this.options.onMissing?.();
      }
    });

    // Fires on every load of the AI Ecosystem, including reloads: register again each time.
    // registerEvent unregisters the listener when this plugin unloads.
    this.plugin.registerEvent(
      // Cast: the custom event names are not part of the Workspace typings.
      (app.workspace as unknown as {
        on(name: string, cb: (...args: unknown[]) => void): ReturnType<typeof app.workspace.on>;
      }).on(EVENT_READY, (api) => this.connect(api as EcosystemApi)),
    );

    // The AI Ecosystem is being disabled or reloaded: it drops the registration by itself.
    this.plugin.registerEvent(
      (app.workspace as unknown as {
        on(name: string, cb: (...args: unknown[]) => void): ReturnType<typeof app.workspace.on>;
      }).on(EVENT_UNLOADING, () => {
        this.api = undefined;
        this.options.onStatus?.("disconnected");
      }),
    );
  }

  /** Call from onunload(). Removes the module (and its services) from the AI Ecosystem. */
  stop(): void {
    this.stopped = true;
    if (this.api && this.moduleId) {
      try {
        this.api.unregisterModule(this.moduleId);
      } catch (err) {
        console.warn("Could not unregister from the AI Ecosystem", err);
      }
    }
    this.api = undefined;
  }

  /** The AI Ecosystem plugin's public API, or undefined when it is not installed or enabled. */
  private findApi(): EcosystemApi | undefined {
    const plugins = (this.plugin.app as unknown as {
      plugins?: { getPlugin(id: string): { api?: EcosystemApi } | null };
    }).plugins;
    return plugins?.getPlugin(ECOSYSTEM_PLUGIN_ID)?.api;
  }

  private connect(api: EcosystemApi): void {
    if (this.stopped) return;
    const registration = this.options.buildRegistration();
    this.moduleId = registration.id;

    const result = api.registerModule(registration);
    if (!result.ok) {
      this.api = undefined;
      this.options.onStatus?.("incompatible", result.reason);
      this.options.onIncompatible?.(result.reason);
      return;
    }

    // result.warnings lists tools, prompts or aliases that were skipped (name already in use).
    this.api = api;
    this.options.onStatus?.("connected");
    // Services are removed when the module is unregistered but survive a re-registration, so
    // registering them here again is harmless: the same owner just replaces the instance.
    this.options.onConnected?.(api);
  }
}
