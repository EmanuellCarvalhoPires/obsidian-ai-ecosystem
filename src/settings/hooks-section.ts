// "Claude Code hooks" section of the settings tab: Node.js check, the settings file in use and
// one row per module with its state, mode and the install / remove buttons.
import { Notice, Setting, setIcon } from "obsidian";
import type { App } from "obsidian";
import type { HookActionResult, HookInstallPlan, HookModuleRow, HooksStatus } from "../hooks/hook-manager";
import { NODE_MISSING } from "../hooks/hook-manager";
import { NODE_DOWNLOAD_URL } from "../hooks/node-check";
import { SETTINGS_FILES } from "../hooks/state-dir";
import type { HookMode } from "../hooks/state-dir";
import { t } from "../i18n";
import { HooksInstallModal } from "./modals";

/** What the section needs from the plugin. */
export interface HooksSettingsHost {
  /** Undefined when the hooks are not available (no vault folder). */
  getHooksStatus(): HooksStatus | undefined;
  planHookInstall(moduleId: string): Promise<HookInstallPlan>;
  installHooks(moduleId: string): Promise<HookActionResult>;
  removeHooks(moduleId: string): HookActionResult;
  setHookMode(moduleId: string, mode: HookMode): void;
  useSettingsFile(file: string): HookActionResult;
}

const MODES: HookMode[] = ["bloquear", "avisar", "off"];

function stateKey(row: HookModuleRow): string {
  if (row.estado === "configurado" && (row.origem === "legado" || row.origem === "manual")) {
    return row.installed.length > 0 ? "configurado" : row.origem;
  }
  return row.estado ?? "unknown";
}

function stateIcon(key: string): string {
  switch (key) {
    case "configurado":
      return "shield-check";
    case "pendente_configuracao":
      return "clock";
    case "desativado":
      return "power-off";
    default:
      return "shield-off";
  }
}

function prependIcon(setting: Setting, icon: string): void {
  const el = createSpan({ cls: "aie-status-icon" });
  setIcon(el, icon);
  setting.nameEl.prepend(el);
}

function reportFailure(result: HookActionResult): void {
  if (result.ok) return;
  new Notice(result.error === NODE_MISSING ? t("settings.hooks.modal.nodeMissing") : t("settings.hooks.notice.failed", { error: result.error }));
}

export function renderHooksGroup(containerEl: HTMLElement, app: App, host: HooksSettingsHost, refresh: () => void): void {
  const status = host.getHooksStatus();
  if (!status) return;

  new Setting(containerEl).setHeading().setName(t("settings.hooks.heading"));
  containerEl.createDiv({ cls: "aie-empty-state", text: t("settings.hooks.intro") });

  renderNode(containerEl, status);

  new Setting(containerEl)
    .setName(t("settings.hooks.file"))
    .setDesc(t("settings.hooks.fileDesc", { path: status.settingsPath }))
    .addDropdown((dropdown) => {
      for (const file of SETTINGS_FILES) {
        dropdown.addOption(file, t(file === "settings.json" ? "settings.hooks.file.shared" : "settings.hooks.file.local"));
      }
      dropdown.setValue(status.settingsFile).onChange((file) => {
        reportFailure(host.useSettingsFile(file));
        refresh();
      });
    });

  const core = new Setting(containerEl)
    .setName(t("settings.hooks.core"))
    .setDesc(t(status.coreInstalled ? "settings.hooks.core.installed" : "settings.hooks.core.missing"));
  prependIcon(core, status.coreInstalled ? "shield-check" : "shield-off");
  if (status.coreEstado === "pendente_configuracao") {
    const pending = new Setting(containerEl).setName(t("settings.hooks.core.pendingName")).setDesc(t("settings.hooks.core.pending"));
    prependIcon(pending, "clock");
  }

  if (status.lastError) {
    const problem = new Setting(containerEl).setName(t("settings.hooks.error")).setDesc(status.lastError);
    prependIcon(problem, "alert-triangle");
  }

  if (status.modules.length === 0) {
    containerEl.createDiv({ cls: "aie-empty-state", text: t("settings.hooks.empty") });
    return;
  }
  for (const row of status.modules) renderModule(containerEl, app, host, refresh, row, status);
}

function renderNode(containerEl: HTMLElement, status: HooksStatus): void {
  const { node } = status;
  const setting = new Setting(containerEl).setName("Node.js");
  if (!node.checked) {
    setting.setDesc(t("settings.hooks.node.checking"));
    prependIcon(setting, "loader");
  } else if (node.available) {
    setting.setDesc(t("settings.hooks.node.ok", { version: node.version ?? "" }));
    prependIcon(setting, "check");
  } else {
    setting.setDesc(t("settings.hooks.node.missing"));
    prependIcon(setting, "alert-triangle");
    setting.addButton((btn) =>
      btn
        .setButtonText(t("settings.hooks.node.get"))
        .setIcon("external-link")
        .onClick(() => window.open(NODE_DOWNLOAD_URL)),
    );
  }
}

function renderModule(containerEl: HTMLElement, app: App, host: HooksSettingsHost, refresh: () => void, row: HookModuleRow, status: HooksStatus): void {
  const key = stateKey(row);
  // Waiting for the setup, but Node.js is missing: the setup hook could not be written.
  const noNode = key === "pendente_configuracao" && !row.setupHook && status.node.checked && !status.node.available;
  const parts = [t(noNode ? "settings.hooks.state.pendingNoNode" : `settings.hooks.state.${key}`)];
  if (!row.hasProtection) parts.push(t("settings.hooks.noProtection"));
  else parts.push(t(row.installed.length > 0 ? "settings.hooks.installed" : "settings.hooks.notInstalled"));

  const setting = new Setting(containerEl).setName(row.name).setDesc(parts.join(". "));
  prependIcon(setting, stateIcon(key));
  if (!row.hasProtection) return;

  setting.addDropdown((dropdown) => {
    for (const mode of MODES) dropdown.addOption(mode, t(`settings.hooks.mode.${mode}`));
    dropdown.setValue(row.mode).onChange((mode) => {
      host.setHookMode(row.id, mode as HookMode);
    });
    dropdown.selectEl.setAttribute("aria-label", t("settings.hooks.mode"));
  });

  if (row.installed.length > 0) {
    setting.addButton((btn) =>
      btn
        .setButtonText(t("settings.hooks.remove"))
        .setIcon("trash-2")
        .onClick(() => {
          const result = host.removeHooks(row.id);
          if (result.ok) new Notice(t("settings.hooks.notice.removed", { name: row.name }));
          else reportFailure(result);
          refresh();
        }),
    );
  } else if (row.estado === "configurado" && (row.origem === "legado" || row.origem === "manual")) {
    setting.addButton((btn) =>
      btn
        .setButtonText(t("settings.hooks.install"))
        .setIcon("shield-check")
        .setCta()
        .onClick(() => void confirmInstall(app, host, refresh, row)),
    );
  }
}

async function confirmInstall(app: App, host: HooksSettingsHost, refresh: () => void, row: HookModuleRow): Promise<void> {
  const plan = await host.planHookInstall(row.id);
  new HooksInstallModal(app, {
    moduleName: row.name,
    plan,
    onConfirm: async () => {
      const result = await host.installHooks(row.id);
      if (result.ok) new Notice(t("settings.hooks.notice.installed", { name: row.name }));
      else reportFailure(result);
      refresh();
    },
  }).open();
}
