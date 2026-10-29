import { Modal, Setting } from "obsidian";
import type { App } from "obsidian";
import { t } from "../i18n";

export interface McpDeleteOptions {
  name: string;
  /** Tool and request notes the package has in the vault. */
  noteCount: number;
  /** Called once, when the user confirms. deleteNotes is the toggle value. */
  onConfirm: (deleteNotes: boolean) => void;
}

/** Confirms the removal of a downloaded MCP package and asks whether its notes go too. */
export class McpDeleteModal extends Modal {
  private deleteNotes = false;

  constructor(app: App, private readonly options: McpDeleteOptions) {
    super(app);
  }

  onOpen(): void {
    const { contentEl, options } = this;
    this.setTitle(t("catalog.mcp.deleteTitle", { name: options.name }));
    contentEl.addClass("aie-modal");
    contentEl.createEl("p", { text: t("catalog.mcp.deleteBody") });

    new Setting(contentEl)
      .setName(t("catalog.mcp.deleteNotes", { n: options.noteCount }))
      .addToggle((toggle) =>
        toggle.setValue(false).onChange((value) => {
          this.deleteNotes = value;
        }),
      );

    new Setting(contentEl)
      .addButton((btn) => btn.setButtonText(t("catalog.mcp.cancel")).onClick(() => this.close()))
      .addButton((btn) =>
        btn
          .setButtonText(t("catalog.mcp.confirmDelete"))
          .setDestructive()
          .onClick(() => {
            this.close();
            options.onConfirm(this.deleteNotes);
          }),
      );
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
