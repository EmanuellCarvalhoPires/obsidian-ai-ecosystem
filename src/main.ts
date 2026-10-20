import { FileSystemAdapter, Notice, Plugin, apiVersion, debounce, setIcon } from "obsidian";
import type { WorkspaceLeaf } from "obsidian";
import catalogData from "../catalog.json";
import { CatalogService } from "./catalog/catalog-service";
import { CATALOG_VIEW_TYPE, CatalogView } from "./catalog/catalog-view";
import { InstallerService } from "./catalog/installer-service";
import { collectDeclaredScripts } from "./core/declared-scripts";
import { Ecosystem } from "./core/ecosystem";
import { ConflictNotifier, mcpUrl, presentServer, statusBarText } from "./core/notices";
import { t } from "./i18n";
import { INSPECTOR_VIEW_TYPE, InspectorView } from "./inspector/inspector-view";
import { createClient, mergeImportedClients } from "./server/auth";
import { copyToClipboard } from "./settings/modals";
import { AIEcosystemSettingTab, type SettingsHost } from "./settings/settings-tab";
import { normalizeSettings } from "./settings/settings-store";
import {
  ECOSYSTEM_ID,
  type AIEcosystemAPI,
  type AIEcosystemSettings,
  type ClientRecord,
  type ModuleInfo,
  type ServerStatus,
  type ServiceInfo,
} from "./types";

const LAST_USED_INTERVAL_MS = 60_000;

export default class AIEcosystemPlugin extends Plugin implements SettingsHost {
  /** The frozen Provider API. Modules reach it with app.plugins.getPlugin("ai-ecosystem")?.api. */
  api: AIEcosystemAPI | undefined;
  settings: AIEcosystemSettings = normalizeSettings(undefined);

  private core!: Ecosystem;
  private tab: AIEcosystemSettingTab | undefined;
  private statusBarEl: HTMLElement | undefined;
  private statusIconEl: HTMLElement | undefined;
  private statusTextEl: HTMLElement | undefined;
  private declaredScripts: string[] = [];
  private unloaded = false;
  private readonly notifier = new ConflictNotifier();
  private readonly clientMarks = new Map<string, number>();

  private readonly saveSoon = debounce(() => void this.saveSettings(), 5000, true);
  private readonly refreshUiSoon = debounce(() => this.refreshUi(), 300, true);
  private readonly rescanScripts = debounce(() => this.scanDeclaredScripts(), 1000, true);
  readonly scheduleServerRestart = debounce(() => void this.restartServer(), 1200, true);

  async onload(): Promise<void> {
    this.settings = normalizeSettings(await this.loadData());

    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) {
      throw new Error("AI Ecosystem needs a vault stored in a local folder.");
    }

    this.core = new Ecosystem({
      vaultBasePath: adapter.getBasePath(),
      vaultName: this.app.vault.getName(),
      version: this.manifest.version,
      getSettings: () => this.settings,
      trigger: (name, ...data) => this.app.workspace.trigger(name, ...data),
      getDeclaredScripts: () => this.declaredScripts,
      onClientUsed: (id) => this.markClientUsed(id),
      importClients: (clients, source) => this.importClients(clients, source),
      onStatusChange: (status) => this.onServerStatus(status),
      onRegistryChange: () => this.refreshUiSoon(),
    });
    this.api = this.core.api;
    const { logger, redactor } = this.core;

    // Views, commands and settings.
    this.registerView(
      INSPECTOR_VIEW_TYPE,
      (leaf) => new InspectorView(leaf, { logger, isRedactionLimited: () => redactor.isLimited() }),
    );
    const installer = new InstallerService({
      app: this.app,
      ecosystemVersion: this.manifest.version,
      obsidianVersion: apiVersion,
      isRegistered: (id) => this.core.registry.has(id),
    });
    const catalog = new CatalogService({ embedded: catalogData });
    this.registerView(CATALOG_VIEW_TYPE, (leaf) => new CatalogView(leaf, { catalog, installer }));

    this.addRibbonIcon("activity", t("core.ribbon.inspector"), () => void this.openInspector("tab"));
    this.addRibbonIcon("package-plus", t("core.ribbon.catalog"), () => void this.openCatalog());
    this.addCommand({ id: "open-inspector", name: t("core.cmd.openInspector"), callback: () => void this.openInspector("tab") });
    this.addCommand({ id: "open-inspector-tab", name: t("core.cmd.openInspectorTab"), callback: () => void this.openInspector("tab") });
    this.addCommand({ id: "open-catalog", name: t("core.cmd.openCatalog"), callback: () => void this.openCatalog() });
    this.addCommand({ id: "restart-server", name: t("core.cmd.restartServer"), callback: () => void this.restartServer() });
    this.addCommand({ id: "copy-mcp-url", name: t("core.cmd.copyMcpUrl"), callback: () => this.copyMcpUrl() });

    this.setupStatusBar();
    this.tab = new AIEcosystemSettingTab(this.app, this, this);
    this.addSettingTab(this.tab);

    // Declared scripts (#mcp/script notes).
    this.app.workspace.onLayoutReady(() => this.scanDeclaredScripts());
    this.registerEvent(this.app.metadataCache.on("resolved", () => this.rescanScripts()));
    this.registerEvent(this.app.metadataCache.on("changed", () => this.rescanScripts()));
    this.registerEvent(this.app.metadataCache.on("deleted", () => this.rescanScripts()));

    // Announces "ready" before the server starts (see Ecosystem.start).
    this.core.start().catch((err: unknown) => console.error("[AI Ecosystem] The server failed to start", err));
  }

  onunload(): void {
    this.unloaded = true;
    this.scheduleServerRestart.cancel();
    this.refreshUiSoon.cancel();
    this.rescanScripts.cancel();
    this.saveSoon.cancel();
    void this.saveSettings();
    void this.core?.unload();
  }

  // ---- settings host ------------------------------------------------------

  async saveSettings(): Promise<void> {
    try {
      await this.saveData(this.settings);
    } catch (err) {
      console.error("[AI Ecosystem] Could not save the settings", err);
      new Notice(t("core.notice.saveFailed"));
    }
  }

  getServerStatus(): ServerStatus {
    return this.core.server.getStatus();
  }

  async restartServer(): Promise<void> {
    if (this.unloaded) return;
    const status = await this.core.server.restart();
    new Notice(status.running ? t("core.notice.restarted", { port: status.port }) : t("core.notice.notRunning"));
  }

  copyMcpUrl(): void {
    const status = this.core.server.getStatus();
    if (!status.running) {
      new Notice(t("core.notice.notRunning"));
      return;
    }
    void copyToClipboard(mcpUrl(status.port), t("core.notice.urlCopied"));
  }

  listModules(): ModuleInfo[] {
    return this.core.registry.listModules();
  }

  listServices(): ServiceInfo[] {
    return this.core.bus.list();
  }

  async createClient(name: string): Promise<{ record: ClientRecord; token: string }> {
    const created = createClient(name);
    this.settings.clients = [...this.settings.clients, created.record];
    await this.saveSettings();
    return created;
  }

  async revokeClient(id: string): Promise<void> {
    this.settings.clients = this.settings.clients.filter((c) => c.id !== id);
    this.clientMarks.delete(id);
    await this.saveSettings();
  }

  onInterpretersChanged(): void {
    this.core.detector.clearCache();
  }

  async openInspector(placement: "sidebar" | "tab" = "tab"): Promise<void> {
    await this.openView(INSPECTOR_VIEW_TYPE, placement);
  }

  async openInspectorView(placement: "sidebar" | "tab" = "tab"): Promise<void> {
    await this.openInspector(placement);
  }

  async openCatalog(): Promise<void> {
    await this.openView(CATALOG_VIEW_TYPE, "tab");
  }

  // ---- internals ----------------------------------------------------------

  private async openView(type: string, placement: "sidebar" | "tab"): Promise<void> {
    const { workspace } = this.app;
    const leaves = workspace.getLeavesOfType(type);
    const existing = leaves.find((l) =>
      placement === "tab" ? l.getRoot() === workspace.rootSplit : l.getRoot() !== workspace.rootSplit,
    );
    let leaf: WorkspaceLeaf | null | undefined = existing ?? (placement === "tab" ? undefined : leaves[0]);
    if (!leaf) {
      leaf = placement === "sidebar" ? workspace.getRightLeaf(false) : workspace.getLeaf("tab");
      if (!leaf) return;
      await leaf.setViewState({ type, active: true });
    }
    await workspace.revealLeaf(leaf);
  }

  /** Imports clients of a module once, then remembers it. Returns how many were added. */
  private async importClients(clients: ClientRecord[], source: string): Promise<number> {
    if (this.settings.importedClientsFrom.includes(source)) return 0;
    const merged = mergeImportedClients(this.settings.clients, clients, source);
    this.settings.clients = merged.clients;
    this.settings.importedClientsFrom = [...this.settings.importedClientsFrom, source];
    await this.saveSettings();
    this.refreshUiSoon();
    return merged.added;
  }

  private markClientUsed(id: string): void {
    const now = Date.now();
    const last = this.clientMarks.get(id);
    if (last !== undefined && now - last < LAST_USED_INTERVAL_MS) return;
    const client = this.settings.clients.find((c) => c.id === id);
    if (!client) return;
    this.clientMarks.set(id, now);
    client.lastUsedAt = new Date(now).toISOString();
    this.saveSoon();
  }

  private onServerStatus(status: ServerStatus): void {
    if (this.unloaded) return;
    this.notifier.notify(status);
    this.updateStatusBar(status);
    this.refreshUiSoon();
  }

  private scanDeclaredScripts(): void {
    if (this.unloaded) return;
    this.declaredScripts = collectDeclaredScripts(this.app);
  }

  private refreshUi(): void {
    if (this.unloaded) return;
    for (const leaf of this.app.workspace.getLeavesOfType(CATALOG_VIEW_TYPE)) {
      if (leaf.view instanceof CatalogView) leaf.view.refresh();
    }
    this.tab?.refresh();
  }

  private setupStatusBar(): void {
    const el = this.addStatusBarItem();
    el.addClass("aie-status-bar", "mod-clickable");
    el.setAttribute("role", "button");
    el.setAttribute("tabindex", "0");
    el.setAttribute("aria-label", t("core.status.open"));
    this.statusIconEl = el.createSpan({ cls: "aie-status-bar-icon" });
    this.statusTextEl = el.createSpan({ cls: "aie-status-bar-text" });
    this.registerDomEvent(el, "click", () => this.openOwnSettings());
    this.registerDomEvent(el, "keydown", (evt) => {
      if (evt.key === "Enter" || evt.key === " ") {
        evt.preventDefault();
        this.openOwnSettings();
      }
    });
    this.statusBarEl = el;
    this.updateStatusBar({ running: false, port: this.settings.port, usingAlternativePort: false });
  }

  private updateStatusBar(status: ServerStatus): void {
    if (!this.statusBarEl || !this.statusIconEl || !this.statusTextEl) return;
    const view = presentServer(status);
    this.statusBarEl.removeClasses(["aie-state-running", "aie-state-alternative", "aie-state-waiting", "aie-state-conflict", "aie-state-stopped"]);
    this.statusBarEl.addClass(`aie-state-${view.state}`);
    setIcon(this.statusIconEl, "server");
    this.statusTextEl.setText(statusBarText(status));
  }

  private openOwnSettings(): void {
    const setting = (this.app as unknown as { setting?: { open(): void; openTabById(id: string): void } }).setting;
    setting?.open();
    setting?.openTabById(ECOSYSTEM_ID);
  }
}
