// Modals of the settings tab: confirmation, text prompt and the one-time token display.
import { Modal, Notice, Setting, setIcon } from "obsidian";
import type { App } from "obsidian";
import type { HookInstallPlan } from "../hooks/hook-manager";
import { NODE_DOWNLOAD_URL } from "../hooks/node-check";
import { t } from "../i18n";

export const MCP_SERVER_NAME = "ai-ecosystem";

/** Command that registers the server in Claude Code. */
export function buildClaudeCommand(url: string, token: string): string {
  return `claude mcp add --transport http ${MCP_SERVER_NAME} ${url} --header "Authorization: Bearer ${token}"`;
}

/** JSON block for clients configured by file (Antigravity and others). */
export function buildJsonConfig(url: string, token: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        [MCP_SERVER_NAME]: {
          type: "http",
          url,
          headers: { Authorization: `Bearer ${token}` },
        },
      },
    },
    null,
    2,
  );
}

/** Copies text and tells the user. Returns whether it worked. */
export async function copyToClipboard(text: string, successMessage: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    new Notice(successMessage);
    return true;
  } catch {
    new Notice(t("core.notice.copyFailed"));
    return false;
  }
}

function addTitle(modal: Modal, title: string, icon?: string): void {
  modal.setTitle(title);
  if (icon) {
    const iconEl = createSpan({ cls: "aie-modal-icon" });
    setIcon(iconEl, icon);
    modal.titleEl.prepend(iconEl);
  }
}

export interface ConfirmOptions {
  title: string;
  paragraphs: string[];
  confirmText: string;
  /** Lucide icon shown before the title. */
  icon?: string;
  /** Styles the confirm button as a warning. */
  danger?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel?: () => void;
}

export class ConfirmModal extends Modal {
  private settled = false;

  constructor(app: App, private readonly options: ConfirmOptions) {
    super(app);
  }

  onOpen(): void {
    const { contentEl, options } = this;
    addTitle(this, options.title, options.icon);
    contentEl.addClass("aie-modal");
    for (const text of options.paragraphs) contentEl.createEl("p", { text });

    new Setting(contentEl)
      .addButton((btn) => btn.setButtonText(t("settings.modal.cancel")).onClick(() => this.close()))
      .addButton((btn) => {
        btn.setButtonText(options.confirmText);
        if (options.danger) btn.setDestructive();
        else btn.setCta();
        btn.onClick(() => {
          this.settled = true;
          this.close();
          void Promise.resolve(options.onConfirm());
        });
      });
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.settled) this.options.onCancel?.();
  }
}

export interface PromptOptions {
  title: string;
  label: string;
  placeholder?: string;
  submitText: string;
  /** Returns an error text, or undefined when the value is acceptable. */
  validate?: (value: string) => string | undefined;
  onSubmit: (value: string) => void | Promise<void>;
}

export class PromptModal extends Modal {
  private value = "";

  constructor(app: App, private readonly options: PromptOptions) {
    super(app);
  }

  onOpen(): void {
    const { contentEl, options } = this;
    addTitle(this, options.title);
    contentEl.addClass("aie-modal");
    const errorEl = contentEl.createDiv({ cls: "aie-modal-error" });

    const submit = (): void => {
      const value = this.value.trim();
      const problem = value === "" ? t("settings.modal.required") : options.validate?.(value);
      if (problem) {
        errorEl.setText(problem);
        return;
      }
      this.close();
      void Promise.resolve(options.onSubmit(value));
    };

    new Setting(contentEl).setName(options.label).addText((text) => {
      text.setPlaceholder(options.placeholder ?? "").onChange((v) => {
        this.value = v;
        errorEl.setText("");
      });
      window.setTimeout(() => text.inputEl.focus(), 0);
    });
    this.scope.register([], "Enter", (evt) => {
      evt.preventDefault();
      submit();
      return false;
    });

    new Setting(contentEl)
      .addButton((btn) => btn.setButtonText(t("settings.modal.cancel")).onClick(() => this.close()))
      .addButton((btn) => btn.setButtonText(options.submitText).setCta().onClick(submit));
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

export interface NewClientOptions {
  clientName: string;
  /** The plain token. Shown once, never stored or logged. */
  token: string;
  url: string;
}

export class NewClientModal extends Modal {
  constructor(app: App, private readonly options: NewClientOptions) {
    super(app);
  }

  onOpen(): void {
    const { contentEl, options } = this;
    addTitle(this, t("settings.newClient.title", { name: options.clientName }), "key-round");
    contentEl.addClass("aie-modal");
    contentEl.createEl("p", { text: t("settings.newClient.once") });

    new Setting(contentEl)
      .setName(t("settings.newClient.token"))
      .addText((text) => {
        text.setValue(options.token);
        text.inputEl.readOnly = true;
        text.inputEl.addClass("aie-token-input");
      })
      .addButton((btn) =>
        btn
          .setButtonText(t("settings.copy"))
          .setIcon("copy")
          .onClick(() => void copyToClipboard(options.token, t("settings.newClient.tokenCopied"))),
      );

    this.addSnippet(t("settings.newClient.claude"), buildClaudeCommand(options.url, options.token), "claude");
    this.addSnippet(t("settings.newClient.json"), buildJsonConfig(options.url, options.token), "json");

    new Setting(contentEl).addButton((btn) => btn.setButtonText(t("settings.newClient.done")).setCta().onClick(() => this.close()));
  }

  private addSnippet(label: string, text: string, kind: string): void {
    const { contentEl } = this;
    new Setting(contentEl)
      .setName(label)
      .setHeading()
      .addButton((btn) =>
        btn
          .setButtonText(t("settings.copy"))
          .setIcon("copy")
          .onClick(() => void copyToClipboard(text, t("settings.newClient.snippetCopied"))),
      );
    const pre = contentEl.createEl("pre", { cls: `aie-code aie-code-${kind}` });
    pre.createEl("code", { text });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

export interface HooksInstallOptions {
  moduleName: string;
  /** What will be written, and whether Node.js is there to run it. */
  plan: HookInstallPlan;
  onConfirm: () => void | Promise<void>;
  /** The window was closed without confirming (Cancel button or Escape). */
  onCancel?: () => void;
}

/**
 * Lists exactly what an install writes and asks for a confirmation. For a module from the
 * catalog (plan.catalog) it runs before anything is downloaded and covers the skill, the
 * temporary setup hook, the protection hooks and the GEMINI.md block; for "Install hooks" of a
 * module that is already there it lists the protection entries only.
 */
export class HooksInstallModal extends Modal {
  private confirmed = false;

  constructor(app: App, private readonly options: HooksInstallOptions) {
    super(app);
  }

  onOpen(): void {
    const { contentEl, options } = this;
    const { plan } = options;
    contentEl.addClass("aie-modal");
    const catalog = plan.catalog;
    if (catalog) this.renderCatalog(catalog);
    else this.renderProtection();

    // A module from the catalog can still be installed without Node.js: it stays pending and no hook is written.
    const canInstall = catalog ? true : plan.node.available && plan.entries.length > 0;
    new Setting(contentEl)
      .addButton((btn) => btn.setButtonText(t("settings.modal.cancel")).onClick(() => this.close()))
      .addButton((btn) =>
        btn
          .setButtonText(t(catalog ? "settings.hooks.modal.catalogConfirm" : "settings.hooks.modal.confirm"))
          .setCta()
          .setDisabled(!canInstall)
          .onClick(() => {
            this.confirmed = true;
            this.close();
            void Promise.resolve(options.onConfirm());
          }),
      );
  }

  private renderProtection(): void {
    const { contentEl, options } = this;
    const { plan } = options;
    addTitle(this, t("settings.hooks.modal.title", { name: options.moduleName }), "shield-check");
    if (plan.entries.length === 0) {
      contentEl.createEl("p", { text: t("settings.hooks.modal.noEntries") });
    } else {
      contentEl.createEl("p", { text: t("settings.hooks.modal.text", { path: plan.settingsPath }) });
      this.addEntries(plan.entries);
    }
    if (!plan.node.available) this.addNodeWarning("settings.hooks.modal.nodeMissing");
  }

  private renderCatalog(catalog: NonNullable<HookInstallPlan["catalog"]>): void {
    const { contentEl, options } = this;
    const { plan } = options;
    addTitle(this, t("settings.hooks.modal.catalogTitle", { name: options.moduleName }), "package-plus");
    contentEl.createEl("p", { text: t("settings.hooks.modal.catalogIntro", { name: options.moduleName }) });

    const list = contentEl.createEl("ul", { cls: "aie-install-list" });
    list.createEl("li", { text: t("settings.hooks.modal.catalogSkill", { path: catalog.skillPath }) });
    const setup = list.createEl("li");
    setup.createSpan({ text: t("settings.hooks.modal.catalogSetupHook", { path: plan.settingsPath }) });
    this.addEntries(catalog.setupEntries, setup);
    const protection = list.createEl("li");
    if (plan.entries.length === 0) {
      protection.setText(t("settings.hooks.modal.catalogNoProtection"));
    } else {
      protection.createSpan({ text: t("settings.hooks.modal.catalogProtection", { path: plan.settingsPath }) });
      this.addEntries(plan.entries, protection);
    }
    list.createEl("li", { text: t("settings.hooks.modal.catalogGemini", { path: catalog.geminiPath }) });

    contentEl.createEl("p", { cls: "aie-modal-note", text: t("settings.hooks.modal.catalogDecline") });
    if (!plan.node.available) this.addNodeWarning("settings.hooks.modal.catalogNodeMissing");
  }

  private addEntries(entries: HookInstallPlan["entries"], parent: HTMLElement = this.contentEl): void {
    const pre = parent.createEl("pre", { cls: "aie-code" });
    const lines = entries.map((e) => `${e.event}${e.matcher ? ` (${e.matcher})` : ""}\n  ${e.command}`);
    pre.createEl("code", { text: lines.join("\n") });
  }

  private addNodeWarning(key: string): void {
    const warning = this.contentEl.createEl("p", { text: t(key) });
    warning.createEl("a", { text: ` ${NODE_DOWNLOAD_URL}`, href: NODE_DOWNLOAD_URL });
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.confirmed) this.options.onCancel?.();
  }
}
