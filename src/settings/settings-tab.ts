// Settings tab (imperative, Obsidian-standard): server, clients, scripts, inspector, modules.
import { PluginSettingTab, Setting, setIcon } from "obsidian";
import type { App, Plugin } from "obsidian";
import { mcpUrl, presentServer } from "../core/notices";
import { t } from "../i18n";
import type { AIEcosystemSettings, ClientRecord, ModuleInfo, ServerStatus, ServiceInfo } from "../types";
import { ConfirmModal, NewClientModal, PromptModal } from "./modals";
import {
  MAX_ENTRIES,
  MAX_PORT,
  MAX_TIMEOUT_SECONDS,
  MIN_ENTRIES,
  MIN_PORT,
  MIN_TIMEOUT_SECONDS,
  isValidPort,
  normalizeFolder,
  readSetting,
  writeSetting,
} from "./settings-store";

/** What the settings tab needs from the plugin. */
export interface SettingsHost {
  settings: AIEcosystemSettings;
  saveSettings(): Promise<void>;
  getServerStatus(): ServerStatus;
  restartServer(): Promise<void>;
  /** Restarts the server shortly after the last port change. */
  scheduleServerRestart(): void;
  copyMcpUrl(): void;
  listModules(): ModuleInfo[];
  listServices(): ServiceInfo[];
  /** Creates a client, stores its hash and returns the token (shown once). */
  createClient(name: string): Promise<{ record: ClientRecord; token: string }>;
  revokeClient(id: string): Promise<void>;
  onInterpretersChanged(): void;
  openInspector(): Promise<void>;
  openCatalog(): Promise<void>;
}

const INTERPRETERS = [
  { key: "python", label: "settings.scripts.python" },
  { key: "node", label: "settings.scripts.node" },
  { key: "bash", label: "settings.scripts.bash" },
  { key: "powershell", label: "settings.scripts.powershell" },
] as const;

function formatDate(iso: string | undefined): string {
  if (!iso) return t("settings.clients.never");
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

export class AIEcosystemSettingTab extends PluginSettingTab {
  constructor(app: App, plugin: Plugin, private readonly host: SettingsHost) {
    super(app, plugin);
    this.icon = "server";
  }

  /** Re-renders the tab if currently visible. Safe to call while the tab is closed. */
  refresh(): void {
    try {
      if (this.containerEl && this.containerEl.isShown()) {
        this.display();
      }
    } catch (err) {
      console.debug("[AI Ecosystem] Could not refresh the settings tab", err);
    }
  }

  getControlValue(key: string): unknown {
    return readSetting(this.host.settings, key);
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    const effects = writeSetting(this.host.settings, key, value);
    await this.host.saveSettings();
    if (effects.includes("restart-server")) this.host.scheduleServerRestart();
    if (effects.includes("interpreters")) this.host.onInterpretersChanged();
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    this.renderServerGroup(containerEl);
    this.renderClientsGroup(containerEl);
    this.renderScriptsGroup(containerEl);
    this.renderFoldersGroup(containerEl);
    this.renderDangerGroup(containerEl);
    this.renderInspectorGroup(containerEl);
    this.renderModulesGroup(containerEl);
    this.renderServicesGroup(containerEl);
    this.renderCatalogGroup(containerEl);
  }

  // ---- server -------------------------------------------------------------

  private renderServerGroup(containerEl: HTMLElement): void {
    const { settings } = this.host;
    new Setting(containerEl).setHeading().setName(t("settings.server.heading"));

    // Server Status
    const statusSetting = new Setting(containerEl);
    const view = presentServer(this.host.getServerStatus());
    statusSetting.setName(view.title);
    if (view.detail) statusSetting.setDesc(view.detail);
    const statusIcon = createSpan({ cls: `aie-status-icon aie-status-${view.state}` });
    setIcon(statusIcon, view.icon);
    statusSetting.nameEl.prepend(statusIcon);

    // Port
    new Setting(containerEl)
      .setName(t("settings.server.port"))
      .setDesc(t("settings.server.portDesc"))
      .addText((text) => {
        text.inputEl.type = "number";
        text.inputEl.min = String(MIN_PORT);
        text.inputEl.max = String(MAX_PORT);
        text.setValue(String(settings.port));
        text.onChange(async (val) => {
          const num = parseInt(val, 10);
          const err = this.validatePort(num, settings.alternativePort);
          if (!err && num !== settings.port) {
            text.inputEl.removeClass("has-error");
            settings.port = num;
            await this.host.saveSettings();
            this.host.scheduleServerRestart();
          } else if (err) {
            text.inputEl.addClass("has-error");
          }
        });
      });

    // Alternative Port
    new Setting(containerEl)
      .setName(t("settings.server.altPort"))
      .setDesc(t("settings.server.altPortDesc"))
      .addText((text) => {
        text.inputEl.type = "number";
        text.inputEl.min = String(MIN_PORT);
        text.inputEl.max = String(MAX_PORT);
        text.setValue(String(settings.alternativePort));
        text.onChange(async (val) => {
          const num = parseInt(val, 10);
          const err = this.validatePort(num, settings.port);
          if (!err && num !== settings.alternativePort) {
            text.inputEl.removeClass("has-error");
            settings.alternativePort = num;
            await this.host.saveSettings();
            this.host.scheduleServerRestart();
          } else if (err) {
            text.inputEl.addClass("has-error");
          }
        });
      });

    // Actions
    new Setting(containerEl)
      .setName(t("settings.server.actions"))
      .addButton((btn) =>
        btn
          .setButtonText(t("settings.server.restart"))
          .setIcon("refresh-cw")
          .onClick(() => void this.host.restartServer()),
      )
      .addButton((btn) =>
        btn
          .setButtonText(t("settings.server.copyUrl"))
          .setIcon("copy")
          .onClick(() => this.host.copyMcpUrl()),
      );

    // URL Display
    new Setting(containerEl)
      .setName(t("settings.server.url"))
      .setDesc(mcpUrl(this.host.getServerStatus().port));
  }

  private validatePort(value: number, other: number): string | undefined {
    if (!isValidPort(value)) return t("settings.error.port", { min: MIN_PORT, max: MAX_PORT });
    if (value === other) return t("settings.error.portSame");
    return undefined;
  }

  // ---- clients ------------------------------------------------------------

  private renderClientsGroup(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setHeading()
      .setName(t("settings.clients.heading"))
      .addButton((btn) =>
        btn
          .setButtonText(t("settings.clients.add"))
          .setIcon("plus")
          .setCta()
          .onClick(() => this.promptClientName()),
      );

    const { clients } = this.host.settings;
    if (clients.length === 0) {
      containerEl.createDiv({ cls: "aie-empty-state", text: t("settings.clients.empty") });
      return;
    }

    for (const client of clients) {
      this.renderClient(containerEl, client);
    }
  }

  private renderClient(containerEl: HTMLElement, client: ClientRecord): void {
    const setting = new Setting(containerEl);
    setting.setName(client.name);
    setting.setDesc(
      t("settings.clients.details", {
        hint: client.hint ? `${client.hint}...` : "-",
        created: formatDate(client.createdAt),
        lastUsed: formatDate(client.lastUsedAt),
      }),
    );
    if (client.importedFrom) {
      setting.nameEl.createSpan({ cls: "aie-badge", text: t("settings.clients.imported") });
    }
    setting.addButton((btn) =>
      btn
        .setButtonText(t("settings.clients.revoke"))
        .setIcon("trash-2")
        .setDestructive()
        .onClick(() => this.confirmRevoke(client)),
    );
  }

  private promptClientName(): void {
    new PromptModal(this.app, {
      title: t("settings.clients.addTitle"),
      label: t("settings.clients.nameLabel"),
      placeholder: t("settings.clients.namePlaceholder"),
      submitText: t("settings.clients.create"),
      onSubmit: async (name) => {
        const { token } = await this.host.createClient(name);
        this.display();
        new NewClientModal(this.app, {
          clientName: name,
          token,
          url: mcpUrl(this.host.getServerStatus().port),
        }).open();
      },
    }).open();
  }

  private confirmRevoke(client: ClientRecord): void {
    new ConfirmModal(this.app, {
      title: t("settings.clients.revokeTitle", { name: client.name }),
      paragraphs: [t("settings.clients.revokeText")],
      confirmText: t("settings.clients.revoke"),
      icon: "alert-triangle",
      danger: true,
      onConfirm: async () => {
        await this.host.revokeClient(client.id);
        this.display();
      },
    }).open();
  }

  // ---- scripts ------------------------------------------------------------

  private renderScriptsGroup(containerEl: HTMLElement): void {
    const { scripts } = this.host.settings;
    new Setting(containerEl).setHeading().setName(t("settings.scripts.heading"));

    new Setting(containerEl)
      .setName(t("settings.scripts.timeout"))
      .setDesc(t("settings.scripts.timeoutDesc"))
      .addText((text) => {
        text.inputEl.type = "number";
        text.inputEl.min = String(MIN_TIMEOUT_SECONDS);
        text.inputEl.max = String(MAX_TIMEOUT_SECONDS);
        text.setValue(String(scripts.maxTimeoutSeconds));
        text.onChange(async (val) => {
          const num = parseInt(val, 10);
          if (Number.isFinite(num) && num >= MIN_TIMEOUT_SECONDS && num <= MAX_TIMEOUT_SECONDS) {
            text.inputEl.removeClass("has-error");
            scripts.maxTimeoutSeconds = num;
            await this.host.saveSettings();
          } else {
            text.inputEl.addClass("has-error");
          }
        });
      });

    for (const item of INTERPRETERS) {
      new Setting(containerEl)
        .setName(t(item.label))
        .setDesc(t("settings.scripts.interpreterDesc"))
        .addText((text) => {
          text
            .setPlaceholder(t("settings.scripts.autoDetect"))
            .setValue(scripts.interpreterPaths[item.key] ?? "")
            .onChange(async (val) => {
              const trimmed = val.trim();
              if (trimmed) {
                scripts.interpreterPaths[item.key] = trimmed;
              } else {
                delete scripts.interpreterPaths[item.key];
              }
              await this.host.saveSettings();
              this.host.onInterpretersChanged();
            });
        });
    }
  }

  private renderFoldersGroup(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setHeading()
      .setName(t("settings.folders.heading"))
      .addButton((btn) =>
        btn
          .setButtonText(t("settings.folders.add"))
          .setIcon("plus")
          .setCta()
          .onClick(() => this.promptFolder()),
      );

    const { allowedFolders } = this.host.settings.scripts;
    if (allowedFolders.length === 0) {
      containerEl.createDiv({ cls: "aie-empty-state", text: t("settings.folders.empty") });
      return;
    }

    allowedFolders.forEach((folder, index) => {
      new Setting(containerEl)
        .setName(folder)
        .addButton((btn) =>
          btn
            .setIcon("trash-2")
            .setDestructive()
            .onClick(async () => {
              this.host.settings.scripts.allowedFolders = this.host.settings.scripts.allowedFolders.filter((_, i) => i !== index);
              await this.host.saveSettings();
              this.display();
            }),
        );
    });
  }

  private promptFolder(): void {
    new PromptModal(this.app, {
      title: t("settings.folders.addTitle"),
      label: t("settings.folders.label"),
      placeholder: t("settings.folders.placeholder"),
      submitText: t("settings.folders.addButton"),
      validate: (value) => {
        const folder = normalizeFolder(value);
        if (!folder) return t("settings.folders.invalid");
        if (this.host.settings.scripts.allowedFolders.includes(folder)) return t("settings.folders.duplicate");
        return undefined;
      },
      onSubmit: async (value) => {
        const folder = normalizeFolder(value);
        if (!folder) return;
        const { scripts } = this.host.settings;
        if (!scripts.allowedFolders.includes(folder)) scripts.allowedFolders = [...scripts.allowedFolders, folder];
        await this.host.saveSettings();
        this.display();
      },
    }).open();
  }

  private renderDangerGroup(containerEl: HTMLElement): void {
    const dangerDiv = containerEl.createDiv({ cls: "aie-danger-zone" });
    new Setting(dangerDiv).setHeading().setName(t("settings.danger.heading"));

    new Setting(dangerDiv)
      .setName(t("settings.danger.toggle"))
      .setDesc(t("settings.danger.toggleDesc"))
      .addToggle((toggle) => {
        toggle.setValue(this.host.settings.scripts.restrictionsDisabled).onChange((enabled) => {
          if (!enabled) {
            this.host.settings.scripts.restrictionsDisabled = false;
            void this.host.saveSettings().then(() => this.display());
            return;
          }
          // Stay off until the user confirms.
          toggle.setValue(false);
          this.confirmUnrestricted();
        });
      });
  }

  private confirmUnrestricted(): void {
    new ConfirmModal(this.app, {
      title: t("settings.danger.modalTitle"),
      paragraphs: [
        t("settings.danger.modalRisk"),
        t("settings.danger.modalInline"),
        t("settings.danger.modalInspector"),
      ],
      confirmText: t("settings.danger.modalConfirm"),
      icon: "alert-triangle",
      danger: true,
      onConfirm: async () => {
        this.host.settings.scripts.restrictionsDisabled = true;
        await this.host.saveSettings();
        this.display();
      },
    }).open();
  }

  // ---- inspector ----------------------------------------------------------

  private renderInspectorGroup(containerEl: HTMLElement): void {
    const { inspector } = this.host.settings;
    new Setting(containerEl).setHeading().setName(t("settings.inspector.heading"));

    new Setting(containerEl)
      .setName(t("settings.inspector.maxEntries"))
      .setDesc(t("settings.inspector.maxEntriesDesc"))
      .addText((text) => {
        text.inputEl.type = "number";
        text.inputEl.min = String(MIN_ENTRIES);
        text.inputEl.max = String(MAX_ENTRIES);
        text.inputEl.step = "10";
        text.setValue(String(inspector.maxEntries));
        text.onChange(async (val) => {
          const num = parseInt(val, 10);
          if (Number.isFinite(num) && num >= MIN_ENTRIES && num <= MAX_ENTRIES) {
            text.inputEl.removeClass("has-error");
            inspector.maxEntries = num;
            await this.host.saveSettings();
          } else {
            text.inputEl.addClass("has-error");
          }
        });
      });

    new Setting(containerEl)
      .setName(t("settings.inspector.open"))
      .setDesc(t("settings.inspector.openDesc"))
      .addButton((btn) =>
        btn
          .setButtonText(t("settings.inspector.openButton"))
          .setIcon("activity")
          .onClick(() => void this.host.openInspector()),
      );
  }

  // ---- modules ------------------------------------------------------------

  private renderModulesGroup(containerEl: HTMLElement): void {
    new Setting(containerEl).setHeading().setName(t("settings.modules.heading"));

    const modules = this.host.listModules();
    if (modules.length === 0) {
      containerEl.createDiv({ cls: "aie-empty-state", text: t("settings.modules.empty") });
      return;
    }

    for (const module of modules) {
      const setting = new Setting(containerEl);
      setting.setName(module.name);
      const lines = [
        t("settings.modules.details", {
          version: module.version,
          api: module.apiVersion,
          tools: module.toolNames.length,
        }),
        ...module.warnings,
      ];
      setting.setDesc(lines.join(" "));
      if (module.warnings.length > 0) {
        const badge = setting.nameEl.createSpan({ cls: "aie-badge aie-badge-warning" });
        setIcon(badge, "alert-triangle");
        badge.setAttribute("aria-label", t("settings.modules.warnings"));
      }
    }
  }

  private renderServicesGroup(containerEl: HTMLElement): void {
    new Setting(containerEl).setHeading().setName(t("settings.services.heading"));

    const services = this.host.listServices();
    if (services.length === 0) {
      containerEl.createDiv({ cls: "aie-empty-state", text: t("settings.services.empty") });
      return;
    }

    for (const service of services) {
      new Setting(containerEl)
        .setName(service.name)
        .setDesc(t("settings.services.owner", { owner: service.ownerModuleId }));
    }
  }

  private renderCatalogGroup(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName(t("settings.modules.catalog"))
      .setDesc(t("settings.modules.catalogDesc"))
      .addButton((btn) =>
        btn
          .setButtonText(t("settings.modules.catalogButton"))
          .setIcon("package-plus")
          .onClick(() => void this.host.openCatalog()),
      );
  }
}
