// The window of a saved screen (tela_<slug>): the form, the Confirm and Cancel buttons and the
// context text the agent sent. It stays open until the user confirms or closes it.
import { Modal, Setting } from "obsidian";
import type { App } from "obsidian";
import { t } from "../../i18n";
import type { OpenScreenInput, ScreenModalOutcome } from "../host";
import { formatIssue } from "../issues";
import { SUBMIT_TYPES } from "../model";
import type { SubmitOptions } from "../values";
import { renderScreenForm } from "./form";
import type { FormController, FormState } from "./form";

export class ScreenModal extends Modal {
  private settled = false;
  private busy = false;
  private form: FormController | undefined;
  private statusEl: HTMLElement | undefined;
  private confirmButton: { setDisabled(disabled: boolean): unknown } | undefined;

  constructor(
    app: App,
    private readonly input: OpenScreenInput,
    private readonly onSettled: (outcome: ScreenModalOutcome) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl, input } = this;
    const { definition } = input;
    this.setTitle(definition.titulo);
    contentEl.addClass("aie-modal", "aie-screen");

    if (input.context) contentEl.createEl("p", { cls: "aie-screen-context", text: input.context });
    if (definition.descricao) contentEl.createEl("p", { cls: "aie-screen-muted", text: definition.descricao });

    const body = contentEl.createDiv({ cls: "aie-screen-body" });
    this.form = renderScreenForm(body, {
      app: this.app,
      definition,
      initialValues: input.initialValues,
      preview: false,
      secretIssue: (field) => input.secretIssue(field),
      onAction: (options) => void this.submit(options),
      onState: (state) => this.showState(state),
    });

    this.statusEl = contentEl.createDiv({ cls: "aie-modal-error" });
    const hasOwnButtons = definition.campos.some((f) => SUBMIT_TYPES.includes(f.tipo));
    const footer = new Setting(contentEl).addButton((btn) => btn.setButtonText(t("screens.cancel")).onClick(() => this.close()));
    if (!hasOwnButtons) {
      footer.addButton((btn) => {
        btn.setButtonText(t("screens.confirm")).setCta().onClick(() => void this.submit({}));
        this.confirmButton = btn;
      });
    }
    this.showState(this.form.state());
  }

  onClose(): void {
    this.contentEl.empty();
    this.settle({ kind: "closed" });
  }

  private settle(outcome: ScreenModalOutcome): void {
    if (this.settled) return;
    this.settled = true;
    this.onSettled(outcome);
  }

  private showState(state: FormState): void {
    this.confirmButton?.setDisabled(this.busy || !state.valid);
    if (!this.statusEl) return;
    if (state.blocker) this.statusEl.setText(t("screens.blocked", { reason: state.blocker }));
    else this.statusEl.setText(state.valid ? "" : t("screens.fixFields"));
  }

  private async submit(options: SubmitOptions): Promise<void> {
    if (this.busy || !this.form) return;
    this.busy = true;
    this.confirmButton?.setDisabled(true);
    try {
      const outcome = await this.input.submit(this.form.getValues(), options);
      if (outcome.ok) {
        this.settle({ kind: "submitted", result: outcome.result });
        this.close();
        return;
      }
      this.form.showErrors(outcome.errors ?? {});
      if (outcome.form) this.statusEl?.setText(formatIssue(outcome.form, t));
    } finally {
      this.busy = false;
      if (this.form && !this.settled) this.confirmButton?.setDisabled(!this.form.state().valid);
    }
  }
}
