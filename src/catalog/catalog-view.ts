import { ItemView, Notice, setIcon, type WorkspaceLeaf } from "obsidian";
import { currentLanguage, t } from "../i18n";
import type { HookInstallPlan } from "../hooks/hook-manager";
import { HooksInstallModal } from "../settings/modals";
import type { Catalog, CatalogEntry, ModuleInstallState } from "../types";
import type { CatalogService } from "./catalog-service";
import { installFromCatalog } from "./install-flow";
import type { CatalogSetupHost } from "./install-flow";
import { latestVersionOf } from "./installer-service";
import type { InstallerService, InstallResult, LatestRelease } from "./installer-service";
import { McpPackagesSection } from "./mcp-packages-section";
import type { McpPackagesSectionDeps } from "./mcp-packages-section";
import { ClientsSection } from "../clients/clients-section";
import type { ClientsSectionHost } from "../clients/clients-section";

export const CATALOG_VIEW_TYPE = "ai-ecosystem-catalog";

export interface CatalogViewDeps {
  catalog: CatalogService;
  installer: InstallerService;
  /** The setup side of the core. Without it a module installs with no confirmation and no setup. */
  setup?: CatalogSetupHost;
  /** The MCP packages block under the cards. Without it the block is not shown. */
  mcpPackages?: McpPackagesSectionDeps;
  /** The host providing AI client connection operations. */
  clientsHost?: ClientsSectionHost;
}

export class CatalogView extends ItemView {
  private readonly deps: CatalogViewDeps;
  private readonly mcpSection: McpPackagesSection | undefined;
  private readonly clientsSection: ClientsSection | undefined;
  private catalog: Catalog | undefined;
  private source: "remote" | "embedded" = "remote";
  private readonly releases = new Map<string, LatestRelease>();
  private readonly errors = new Map<string, string>();
  private loadToken = 0;

  constructor(leaf: WorkspaceLeaf, deps: CatalogViewDeps) {
    super(leaf);
    this.deps = deps;
    this.mcpSection = deps.mcpPackages ? new McpPackagesSection(deps.mcpPackages) : undefined;
    this.clientsSection = deps.clientsHost ? new ClientsSection(this.app, deps.clientsHost, () => this.refresh()) : undefined;
  }

  getViewType(): string {
    return CATALOG_VIEW_TYPE;
  }

  getDisplayText(): string {
    return t("catalog.title");
  }

  getIcon(): string {
    return "package-plus";
  }

  async onOpen(): Promise<void> {
    this.registerDomEvent(this.contentEl, "click", (evt) => this.onClick(evt));
    this.render();
    await this.reload(false);
  }

  onClose(): Promise<void> {
    this.loadToken++;
    this.mcpSection?.dispose();
    return Promise.resolve();
  }

  /** Re-renders the cards (main.ts calls it when modules register or unregister). */
  refresh(): void {
    this.render();
  }

  private onClick(evt: MouseEvent): void {
    const target = evt.target;
    if (!(target instanceof Element)) return;
    const btn = target.closest<HTMLElement>("[data-aie-action]");
    if (!btn || !this.contentEl.contains(btn)) return;
    const action = btn.dataset.aieAction;
    if (action === "refresh") {
      this.errors.clear();
      void this.reload(true);
      return;
    }
    const entry = this.catalog?.modules.find((m) => m.id === btn.dataset.aieId);
    if (!entry) return;
    switch (action) {
      case "install":
        void this.runCatalogInstall(entry);
        break;
      case "update":
        void this.runInstall(entry, "update");
        break;
      case "enable":
        void this.runEnable(entry);
        break;
      case "settings":
        this.deps.installer.openPluginSettings(entry.id);
        break;
      case "store":
        this.deps.installer.openStorePage(entry.id);
        break;
    }
  }

  private async reload(force: boolean): Promise<void> {
    const token = ++this.loadToken;
    const { catalog, source } = await this.deps.catalog.load(force);
    if (token !== this.loadToken) return;
    this.catalog = catalog;
    this.source = source;
    this.render();
    await Promise.all(
      catalog.modules.map(async (entry) => {
        this.releases.set(entry.id, await this.deps.installer.getLatestRelease(entry, force));
      }),
    );
    if (token === this.loadToken) this.render();
  }

  private render(): void {
    const root = this.contentEl;
    root.empty();
    root.addClass("aie-catalog");

    const header = root.createDiv({ cls: "aie-catalog-header" });
    const titles = header.createDiv();
    titles.createEl("h2", { cls: "aie-catalog-title", text: t("catalog.title") });
    titles.createEl("p", { cls: "aie-catalog-desc", text: t("catalog.description") });
    const refresh = header.createEl("button", {
      cls: "clickable-icon aie-catalog-btn",
      attr: { "aria-label": t("catalog.refresh") },
    });
    setIcon(refresh, "refresh-cw");
    refresh.dataset.aieAction = "refresh";

    if (!this.catalog) {
      root.createEl("p", { cls: "aie-catalog-note", text: t("catalog.loading") });
    } else {
      if (this.source === "embedded") root.createEl("p", { cls: "aie-catalog-note", text: t("catalog.offlineNote") });
      const grid = root.createDiv({ cls: "aie-catalog-grid" });
      for (const entry of this.catalog.modules) this.renderCard(grid, entry);
    }
    if (this.clientsSection) {
      const clientsBox = root.createDiv({ cls: "aie-catalog-clients-box" });
      const secHeader = clientsBox.createDiv({ cls: "aie-catalog-header" });
      const titles = secHeader.createDiv();
      titles.createEl("h3", { cls: "aie-catalog-title", text: t("catalog.clients.title") });
      this.clientsSection.renderBody(clientsBox);
    }
    this.mcpSection?.mount(root);
  }

  private renderCard(grid: HTMLElement, entry: CatalogEntry): void {
    const release = this.releases.get(entry.id);
    const latestVersion = latestVersionOf(release);
    const noRelease = !!release && "error" in release && release.error === "No release published yet";
    const state = this.deps.installer.getState(entry, latestVersion);

    const card = grid.createDiv({ cls: "aie-catalog-card" });
    const head = card.createDiv({ cls: "aie-catalog-card-head" });
    setIcon(head.createSpan({ cls: "aie-catalog-card-icon" }), entry.icon);
    head.createSpan({ cls: "aie-catalog-card-name", text: entry.name });
    card.createDiv({ cls: "aie-catalog-card-text", text: entry.description[currentLanguage()] });

    const meta = card.createDiv({ cls: "aie-catalog-meta" });
    if ("installedVersion" in state) {
      meta.createSpan({ text: t("catalog.installedVersion", { version: state.installedVersion }) });
    }
    if (latestVersion) meta.createSpan({ text: t("catalog.latestVersion", { version: latestVersion }) });
    if (noRelease) meta.createSpan({ text: t("catalog.noRelease") });

    if (state.kind === "active") {
      const conn = card.createDiv({ cls: "aie-catalog-conn" });
      if (state.registered) conn.addClass("aie-catalog-conn-on");
      setIcon(conn.createSpan(), state.registered ? "plug" : "unplug");
      conn.createSpan({ text: t(state.registered ? "catalog.connected" : "catalog.notConnected") });
    }

    const error = this.errors.get(entry.id);
    if (error) card.createDiv({ cls: "aie-catalog-error", text: error });

    const actions = card.createDiv({ cls: "aie-catalog-actions" });
    this.renderPrimary(actions, entry, state, noRelease);
    if (!noRelease) {
      const store = actions.createEl("button", {
        cls: "clickable-icon aie-catalog-btn",
        attr: { "aria-label": t("catalog.openStore") },
      });
      setIcon(store, "external-link");
      store.dataset.aieAction = "store";
      store.dataset.aieId = entry.id;
    }
  }

  private renderPrimary(
    actions: HTMLElement,
    entry: CatalogEntry,
    state: ModuleInstallState,
    noRelease: boolean,
  ): void {
    const button = (icon: string, label: string, action?: string, disabled = false): HTMLButtonElement => {
      const btn = actions.createEl("button", { cls: "aie-catalog-btn" });
      setIcon(btn.createSpan(), icon);
      btn.createSpan({ text: label });
      btn.disabled = disabled;
      if (action) {
        btn.dataset.aieAction = action;
        btn.dataset.aieId = entry.id;
      }
      return btn;
    };

    switch (state.kind) {
      case "not-installed":
        if (noRelease) button("circle-slash", t("catalog.noRelease"), undefined, true);
        else button("download", t("catalog.install"), "install");
        break;
      case "installing": {
        const btn = button("loader-2", t("catalog.installing"), undefined, true);
        btn.addClass("aie-catalog-spin");
        break;
      }
      case "installed-disabled":
        button("power", t("catalog.enable"), "enable");
        break;
      case "active": {
        const badge = actions.createSpan({ cls: "aie-catalog-badge" });
        setIcon(badge.createSpan(), "check-circle-2");
        badge.createSpan({ text: t("catalog.active") });
        const settings = actions.createEl("button", {
          cls: "clickable-icon aie-catalog-btn",
          attr: { "aria-label": t("catalog.settings") },
        });
        setIcon(settings, "settings");
        settings.dataset.aieAction = "settings";
        settings.dataset.aieId = entry.id;
        break;
      }
      case "update-available":
        button("arrow-up-circle", t("catalog.update"), "update");
        break;
      case "unavailable":
        button("circle-slash", this.reasonText(state.reason), undefined, true);
        break;
    }
  }

  private reasonText(reason: string): string {
    if (reason.includes("restricted mode")) return t("catalog.restricted");
    const m = /^Requires AI Ecosystem (.+)$/.exec(reason);
    return m ? t("catalog.requiresEcosystem", { version: m[1] }) : reason;
  }

  /** Install: the confirmation comes first, then the download, then the setup of the module. */
  private async runCatalogInstall(entry: CatalogEntry): Promise<void> {
    this.errors.delete(entry.id);
    const outcome = await installFromCatalog({
      entry,
      setup: this.deps.setup,
      confirm: (plan) => this.confirmInstall(entry, plan),
      install: () => this.deps.installer.install(entry),
      onInstalling: () => this.render(),
    });
    if (outcome.status === "cancelled") {
      new Notice(t("catalog.installCancelled", { name: entry.name }));
      return;
    }
    this.report(entry, "install", outcome.result);
    if (outcome.result.ok && outcome.setupPending) {
      new Notice(t(outcome.nodeMissing ? "catalog.setupNodeMissing" : "catalog.setupPending", { name: entry.name }));
    }
    this.render();
  }

  private confirmInstall(entry: CatalogEntry, plan: HookInstallPlan): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      new HooksInstallModal(this.app, {
        moduleName: entry.name,
        plan,
        onConfirm: () => resolve(true),
        onCancel: () => resolve(false),
      }).open();
    });
  }

  private async runInstall(entry: CatalogEntry, mode: "install" | "update"): Promise<void> {
    this.errors.delete(entry.id);
    const pending = mode === "install" ? this.deps.installer.install(entry) : this.deps.installer.update(entry);
    this.render();
    this.report(entry, mode, await pending);
    this.render();
  }

  private report(entry: CatalogEntry, mode: "install" | "update", result: InstallResult): void {
    if (result.ok) {
      new Notice(t(mode === "install" ? "catalog.installOk" : "catalog.updateOk", { name: entry.name }));
    } else if (result.error === "No release published yet") {
      this.errors.set(entry.id, t("catalog.noRelease"));
      new Notice(t("catalog.noRelease"));
    } else {
      this.errors.set(entry.id, result.error);
      new Notice(t("catalog.installFailed", { name: entry.name, error: result.error }));
    }
  }

  private async runEnable(entry: CatalogEntry): Promise<void> {
    this.errors.delete(entry.id);
    const result = await this.deps.installer.enable(entry);
    if (result.ok) {
      new Notice(t("catalog.enableOk", { name: entry.name }));
    } else {
      this.errors.set(entry.id, result.error);
      new Notice(t("catalog.enableFailed", { name: entry.name, error: result.error }));
    }
    this.render();
  }
}
