// Modals of the settings tab: confirmation, text prompt and the one-time token display.
import { Modal, Notice, Setting, setIcon } from "obsidian";
import type { App } from "obsidian";
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
