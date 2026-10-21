// The window where the user reviews a screen an agent wants to create, change or remove (or just
// looks at a saved one): the screen itself, working but not submitting, and its JSON definition.
import { Modal, Setting } from "obsidian";
import type { App } from "obsidian";
import { t } from "../../i18n";
import type { OpenPreviewInput, PreviewDecision, PreviewMode } from "../host";
import { screenToolName } from "../model";
import { renderScreenForm } from "./form";

const INTRO: Record<PreviewMode, string> = {
  create: "screens.preview.introCreate",
  edit: "screens.preview.introEdit",
  remove: "screens.preview.introRemove",
  view: "screens.preview.introView",
};

export class PreviewModal extends Modal {
  private settled = false;

  constructor(
    app: App,
    private readonly input: OpenPreviewInput,
    private readonly onDecision: (decision: PreviewDecision) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl, input } = this;
    const { definition, mode } = input;
    const tool = screenToolName(definition.slug);
    this.setTitle(t(`screens.preview.${mode}`, { title: definition.titulo }));
    contentEl.addClass("aie-modal", "aie-screen", "aie-screen-review");

    contentEl.createEl("p", { text: t(INTRO[mode], { tool }) });
    contentEl.createEl("p", { cls: "aie-screen-muted", text: t("screens.settings.details", { tool, count: definition.campos.length }) });

    const frame = contentEl.createDiv({ cls: "aie-screen-frame" });
    if (definition.descricao) frame.createEl("p", { cls: "aie-screen-muted", text: definition.descricao });
    renderScreenForm(frame, {
      app: this.app,
      definition,
      initialValues: {},
      preview: true,
      secretIssue: (field) => input.secretIssue(field),
    });

    this.addJson(t("screens.preview.json"), input.json);
    if (input.previous) this.addJson(t("screens.preview.jsonBefore"), JSON.stringify(input.previous, null, 2));

    const footer = new Setting(contentEl);
    if (mode === "view") {
      footer.addButton((btn) => btn.setButtonText(t("screens.close")).setCta().onClick(() => this.close()));
      return;
    }
    footer
      .addButton((btn) => btn.setButtonText(t("screens.reject")).onClick(() => this.close()))
      .addButton((btn) => {
        btn.setButtonText(t(mode === "remove" ? "screens.preview.approveRemove" : "screens.preview.approveSave"));
        if (mode === "remove") btn.setDestructive();
        else btn.setCta();
        btn.onClick(() => {
          this.settle("aprovado");
          this.close();
        });
      });
  }

  onClose(): void {
    this.contentEl.empty();
    this.settle("recusado");
  }

  private addJson(summary: string, text: string): void {
    const details = this.contentEl.createEl("details", { cls: "aie-screen-json" });
    details.createEl("summary", { text: summary });
    details.createEl("pre", { cls: "aie-code" }).createEl("code", { text });
  }

  private settle(decision: PreviewDecision): void {
    if (this.settled) return;
    this.settled = true;
    this.onDecision(decision);
  }
}
