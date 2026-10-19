// Settings tab (declarative, Obsidian 1.13+): server, clients, scripts, inspector, modules.
import { PluginSettingTab, Setting, setIcon } from "obsidian";
import type { App, Plugin, SettingDefinitionItem, SettingGroupItem } from "obsidian";
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
  { key: "scripts.interpreter.python", label: "settings.scripts.python" },
  { key: "scripts.interpreter.node", label: "settings.scripts.node" },
  { key: "scripts.interpreter.bash", label: "settings.scripts.bash" },
  { key: "scripts.interpreter.powershell", label: "settings.scripts.powershell" },
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

  /** Re-renders the tab (status, modules and clients changed). Safe to call while the tab is closed. */
  refresh(): void {
    try {
      this.update();
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

  getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      this.serverGroup(),
      this.clientsGroup(),
      this.scriptsGroup(),
      this.foldersGroup(),
      this.dangerGroup(),
      this.inspectorGroup(),
      this.modulesGroup(),
      this.servicesGroup(),
      this.catalogGroup(),
    ];
  }

  // ---- server -------------------------------------------------------------

  private serverGroup(): SettingDefinitionItem {
    const { settings } = this.host;
    return {
      type: "group",
      heading: t("settings.server.heading"),
      items: [
        {
          name: t("settings.server.status"),
          searchable: false,
          render: (setting) => {
            const view = presentServer(this.host.getServerStatus());
            setting.setName(view.title);
            if (view.detail) setting.setDesc(view.detail);
            const icon = createSpan({ cls: `aie-status-icon aie-status-${view.state}` });
            setIcon(icon, view.icon);
            setting.nameEl.prepend(icon);
          },
        },
        {
          name: t("settings.server.port"),
          desc: t("settings.server.portDesc"),
          control: {
            type: "number",
            key: "port",
            min: MIN_PORT,
            max: MAX_PORT,
            step: 1,
            defaultValue: settings.port,
            validate: (value: number) => this.validatePort(value, settings.alternativePort),
          },
        },
        {
          name: t("settings.server.altPort"),
          desc: t("settings.server.altPortDesc"),
          control: {
            type: "number",
            key: "alternativePort",
            min: MIN_PORT,
            max: MAX_PORT,
            step: 1,
            defaultValue: settings.alternativePort,
            validate: (value: number) => this.validatePort(value, settings.port),
          },
        },
        {
          name: t("settings.server.actions"),
          searchable: false,
          render: (setting) => {
            setting
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
          },
        },
        {
          name: t("settings.server.url"),
          desc: mcpUrl(this.host.getServerStatus().port),
        },
      ],
    };
  }

  private validatePort(value: number, other: number): string | undefined {
    if (!isValidPort(value)) return t("settings.error.port", { min: MIN_PORT, max: MAX_PORT });
    if (value === other) return t("settings.error.portSame");
    return undefined;
  }

  // ---- clients ------------------------------------------------------------

  private clientsGroup(): SettingDefinitionItem {
    const items: SettingGroupItem[] = this.host.settings.clients.map((client) => ({
      name: client.name,
      searchable: false,
      render: (setting: Setting) => this.renderClient(setting, client),
    }));
    return {
      type: "list",
      heading: t("settings.clients.heading"),
      emptyState: t("settings.clients.empty"),
      items,
      addItem: {
        name: t("settings.clients.add"),
        action: () => this.promptClientName(),
      },
    };
  }

  private renderClient(setting: Setting, client: ClientRecord): void {
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
        this.refresh();
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
        this.refresh();
      },
    }).open();
  }

  // ---- scripts ------------------------------------------------------------

  private scriptsGroup(): SettingDefinitionItem {
    return {
      type: "group",
      heading: t("settings.scripts.heading"),
      items: [
        {
          name: t("settings.scripts.timeout"),
          desc: t("settings.scripts.timeoutDesc"),
          control: {
            type: "number",
            key: "scripts.maxTimeoutSeconds",
            min: MIN_TIMEOUT_SECONDS,
            max: MAX_TIMEOUT_SECONDS,
            step: 1,
            defaultValue: 300,
            validate: (value: number) =>
              Number.isFinite(value) && value >= MIN_TIMEOUT_SECONDS && value <= MAX_TIMEOUT_SECONDS
                ? undefined
                : t("settings.error.range", { min: MIN_TIMEOUT_SECONDS, max: MAX_TIMEOUT_SECONDS }),
          },
        },
        ...INTERPRETERS.map(
          (item): SettingGroupItem => ({
            name: t(item.label),
            desc: t("settings.scripts.interpreterDesc"),
            control: { type: "text", key: item.key, placeholder: t("settings.scripts.autoDetect") },
          }),
        ),
      ],
    };
  }

  private foldersGroup(): SettingDefinitionItem {
    const folders = this.host.settings.scripts.allowedFolders;
    return {
      type: "list",
      heading: t("settings.folders.heading"),
      emptyState: t("settings.folders.empty"),
      items: folders.map((folder): SettingGroupItem => ({ name: folder, searchable: false })),
      onDelete: (index) => {
        const current = this.host.settings.scripts.allowedFolders;
        if (index < 0 || index >= current.length) return;
        this.host.settings.scripts.allowedFolders = current.filter((_, i) => i !== index);
        void this.host.saveSettings().then(() => this.refresh());
      },
      addItem: {
        name: t("settings.folders.add"),
        action: () => this.promptFolder(),
      },
    };
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
        this.refresh();
      },
    }).open();
  }

  private dangerGroup(): SettingDefinitionItem {
    return {
      type: "group",
      heading: t("settings.danger.heading"),
      cls: "aie-danger-zone",
      items: [
        {
          name: t("settings.danger.toggle"),
          desc: t("settings.danger.toggleDesc"),
          render: (setting) => {
            setting.addToggle((toggle) => {
              toggle.setValue(this.host.settings.scripts.restrictionsDisabled).onChange((enabled) => {
                if (!enabled) {
                  this.host.settings.scripts.restrictionsDisabled = false;
                  void this.host.saveSettings().then(() => this.refresh());
                  return;
                }
                // Stay off until the user confirms.
                toggle.setValue(false);
                this.confirmUnrestricted();
              });
            });
          },
        },
      ],
    };
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
        this.refresh();
      },
    }).open();
  }

  // ---- inspector ----------------------------------------------------------

  private inspectorGroup(): SettingDefinitionItem {
    return {
      type: "group",
      heading: t("settings.inspector.heading"),
      items: [
        {
          name: t("settings.inspector.maxEntries"),
          desc: t("settings.inspector.maxEntriesDesc"),
          control: {
            type: "number",
            key: "inspector.maxEntries",
            min: MIN_ENTRIES,
            max: MAX_ENTRIES,
            step: 10,
            defaultValue: 500,
            validate: (value: number) =>
              Number.isFinite(value) && value >= MIN_ENTRIES && value <= MAX_ENTRIES
                ? undefined
                : t("settings.error.range", { min: MIN_ENTRIES, max: MAX_ENTRIES }),
          },
        },
        {
          name: t("settings.inspector.open"),
          desc: t("settings.inspector.openDesc"),
          render: (setting) => {
            setting.addButton((btn) =>
              btn
                .setButtonText(t("settings.inspector.openButton"))
                .setIcon("activity")
                .onClick(() => void this.host.openInspector()),
            );
          },
        },
      ],
    };
  }

  // ---- modules ------------------------------------------------------------

  private modulesGroup(): SettingDefinitionItem {
    const items: SettingGroupItem[] = this.host.listModules().map((module) => ({
      name: module.name,
      searchable: false,
      render: (setting: Setting) => {
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
      },
    }));
    return {
      type: "list",
      heading: t("settings.modules.heading"),
      emptyState: t("settings.modules.empty"),
      items,
    };
  }

  private servicesGroup(): SettingDefinitionItem {
    const items: SettingGroupItem[] = this.host.listServices().map((service) => ({
      name: service.name,
      desc: t("settings.services.owner", { owner: service.ownerModuleId }),
      searchable: false,
    }));
    return {
      type: "list",
      heading: t("settings.services.heading"),
      emptyState: t("settings.services.empty"),
      items,
    };
  }

  private catalogGroup(): SettingDefinitionItem {
    return {
      type: "group",
      items: [
        {
          name: t("settings.modules.catalog"),
          desc: t("settings.modules.catalogDesc"),
          render: (setting) => {
            setting.addButton((btn) =>
              btn
                .setButtonText(t("settings.modules.catalogButton"))
                .setIcon("package-plus")
                .onClick(() => void this.host.openCatalog()),
            );
          },
        },
      ],
    };
  }
}
