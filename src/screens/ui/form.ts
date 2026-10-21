// Draws the fields of a screen definition and keeps what the user typed. Used by the window of a
// saved screen (it submits) and by the preview (it does not).
import { Notice, Setting, setIcon } from "obsidian";
import type { App } from "obsidian";
import { t } from "../../i18n";
import { formatIssue } from "../issues";
import { MIN_MASKED_SECRET_LENGTH } from "../model";
import type { FieldIssue, ScreenDefinition, ScreenField, TableColumn } from "../model";
import { initialValueFor, validateSubmission } from "../values";
import type { SubmitOptions } from "../values";
import { VaultSuggest, createVaultSource } from "./pickers";

export interface FormState {
  /** Nothing is missing or wrong and no password is blocked. */
  valid: boolean;
  /** Why a password cannot be saved (the first reason), if that is what blocks. */
  blocker?: string;
}

export interface FormOptions {
  app: App;
  definition: ScreenDefinition;
  initialValues: Record<string, unknown>;
  /** The preview: the buttons that would submit only show a notice, and password issues are notes. */
  preview: boolean;
  secretIssue(field: ScreenField): FieldIssue | undefined;
  /** A submitting button (acao, aprovacao) was clicked. */
  onAction?(options: SubmitOptions): void;
  /** The values or their validity changed. */
  onState?(state: FormState): void;
}

export interface FormController {
  getValues(): Record<string, unknown>;
  state(): FormState;
  /** Shows what the submit refused, under each field, and from now on shows every issue. */
  showErrors(errors: Record<string, FieldIssue>): void;
}

const INPUT_TYPES: Partial<Record<string, string>> = {
  texto: "text",
  url: "url",
  email: "email",
  telefone: "tel",
  data: "date",
  hora: "time",
  data_hora: "datetime-local",
  inteiro: "number",
  decimal: "number",
  senha: "password",
};

const PLACEHOLDERS: Partial<Record<string, string>> = {
  pasta: "screens.placeholder.folder",
  arquivo: "screens.placeholder.file",
  nota: "screens.placeholder.note",
  tag: "screens.placeholder.tag",
};

function asText(value: unknown): string {
  return typeof value === "string" ? value : typeof value === "number" ? String(value) : "";
}

function asList(value: unknown): unknown[] {
  return Array.isArray(value) ? [...(value as unknown[])] : [];
}

/** Draws the form into `container` and returns what the window needs to read and check it. */
export function renderScreenForm(container: HTMLElement, options: FormOptions): FormController {
  const { app, definition } = options;
  const values: Record<string, unknown> = {};
  const touched = new Set<string>();
  let submitErrors: Record<string, FieldIssue> = {};
  let showAll = false;
  const errorEls = new Map<string, HTMLElement>();
  const secretEls = new Map<string, { short: HTMLElement; issue: HTMLElement }>();
  let last: FormState = { valid: true };

  for (const field of definition.campos) {
    if (field.tipo === "rotulo" || field.tipo === "separador" || field.tipo === "acao") continue;
    const initial = options.initialValues[field.id] ?? initialValueFor(field);
    values[field.id] = field.tipo === "senha" ? "" : Array.isArray(initial) ? asList(initial) : initial;
  }

  const evaluate = (): FormState => {
    const checked = validateSubmission(definition, values);
    const issues = checked.ok ? {} : checked.errors;
    let blocker: string | undefined;

    for (const field of definition.campos) {
      const errorEl = errorEls.get(field.id);
      if (errorEl) {
        const issue = submitErrors[field.id] ?? (touched.has(field.id) || showAll ? issues[field.id] : undefined);
        errorEl.setText(issue ? formatIssue(issue, t) : "");
      }
      const secret = secretEls.get(field.id);
      if (secret) {
        const typed = asText(values[field.id]);
        secret.short.toggleClass("aie-screen-hidden", !(typed.length > 0 && typed.length < MIN_MASKED_SECRET_LENGTH));
        const relevant = field.obrigatorio === true || typed !== "";
        const problem = relevant || options.preview ? options.secretIssue(field) : undefined;
        const reason = problem ? formatIssue(problem, t) : "";
        // Outside the preview the footer already says why Confirm is blocked, so the reason is not repeated here.
        secret.issue.setText(problem && options.preview ? t("screens.preview.secretNote", { reason }) : "");
        if (problem && relevant && !options.preview) blocker ??= reason;
      }
    }

    const valid = !blocker && Object.keys(issues).length === 0;
    return blocker ? { valid, blocker } : { valid };
  };

  const refresh = (): void => {
    last = evaluate();
    options.onState?.(last);
  };

  const change = (field: ScreenField, value: unknown): void => {
    values[field.id] = value;
    touched.add(field.id);
    delete submitErrors[field.id];
    refresh();
  };

  const act = (actionOptions: SubmitOptions): void => {
    if (options.preview) {
      new Notice(t("screens.previewButton"));
      return;
    }
    options.onAction?.(actionOptions);
  };

  const heading = (field: ScreenField): Setting => {
    const setting = new Setting(container).setName(field.rotulo);
    if (field.ajuda) setting.setDesc(field.ajuda);
    if (field.obrigatorio) setting.settingEl.addClass("aie-screen-required");
    return setting;
  };

  const errorLine = (field: ScreenField): void => {
    errorEls.set(field.id, container.createDiv({ cls: "aie-modal-error aie-screen-error" }));
  };

  for (const field of definition.campos) {
    switch (field.tipo) {
      case "rotulo": {
        const note = container.createDiv({ cls: "aie-screen-note" });
        note.createEl("p", { text: field.rotulo });
        if (field.ajuda) note.createEl("p", { cls: "aie-screen-muted", text: field.ajuda });
        break;
      }
      case "separador":
        if (field.rotulo) new Setting(container).setName(field.rotulo).setHeading();
        else container.createEl("hr");
        break;
      case "acao":
        new Setting(container)
          .setDesc(field.ajuda ?? "")
          .addButton((btn) => btn.setButtonText(field.rotulo).setCta().onClick(() => act({ action: field.id })));
        break;
      case "aprovacao": {
        const setting = heading(field);
        setting
          .addButton((btn) =>
            btn
              .setButtonText(t("screens.approve"))
              .setCta()
              .onClick(() => {
                values[field.id] = "aprovado";
                act({});
              }),
          )
          .addButton((btn) =>
            btn
              .setButtonText(t("screens.reject"))
              .setDestructive()
              .onClick(() => {
                values[field.id] = "recusado";
                act({ skipRequired: true });
              }),
          );
        break;
      }
      case "texto":
      case "url":
      case "email":
      case "telefone":
      case "data":
      case "hora":
      case "data_hora":
      case "inteiro":
      case "decimal":
      case "senha": {
        const setting = heading(field);
        setting.addText((text) => {
          const input = text.inputEl;
          input.type = INPUT_TYPES[field.tipo] ?? "text";
          if (field.tipo === "inteiro" || field.tipo === "decimal") {
            input.step = field.passo !== undefined ? String(field.passo) : field.tipo === "inteiro" ? "1" : "any";
          }
          if (field.tipo !== "texto" && field.tipo !== "senha") {
            if (field.min !== undefined) input.min = String(field.min);
            if (field.max !== undefined) input.max = String(field.max);
          }
          if (field.tipo === "senha") input.autocomplete = "new-password";
          text.setValue(asText(values[field.id])).onChange((value) => change(field, value));
        });
        if (field.tipo === "senha") {
          container.createDiv({ cls: "aie-screen-muted", text: t("screens.secret.hint", { name: field.destino_nome ?? "" }) });
          const short = container.createDiv({ cls: "aie-screen-warning aie-screen-hidden", text: t("screens.secret.short") });
          const issue = container.createDiv({ cls: "aie-modal-error aie-screen-error" });
          secretEls.set(field.id, { short, issue });
        }
        errorLine(field);
        break;
      }
      case "texto_longo": {
        heading(field).addTextArea((area) => {
          area.inputEl.rows = 4;
          area.setValue(asText(values[field.id])).onChange((value) => change(field, value));
        });
        errorLine(field);
        break;
      }
      case "selecao": {
        heading(field).addDropdown((drop) => {
          drop.addOption("", t("screens.choose"));
          for (const option of field.opcoes ?? []) drop.addOption(option.valor, option.rotulo);
          drop.setValue(asText(values[field.id])).onChange((value) => change(field, value));
        });
        errorLine(field);
        break;
      }
      case "selecao_multipla": {
        heading(field);
        const group = container.createDiv({ cls: "aie-screen-options" });
        for (const option of field.opcoes ?? []) {
          const label = group.createEl("label", { cls: "aie-screen-option" });
          const box = label.createEl("input", { type: "checkbox" });
          box.checked = asList(values[field.id]).includes(option.valor);
          label.createSpan({ text: option.rotulo });
          box.addEventListener("change", () => {
            const chosen = asList(values[field.id]).filter((v) => v !== option.valor);
            if (box.checked) chosen.push(option.valor);
            // Keep the order of the options, whatever order the boxes were ticked in.
            const ordered = (field.opcoes ?? []).map((o) => o.valor).filter((v) => chosen.includes(v));
            change(field, ordered);
          });
        }
        errorLine(field);
        break;
      }
      case "caixa": {
        const setting = heading(field);
        const box = setting.controlEl.createEl("input", { type: "checkbox" });
        box.checked = values[field.id] === true;
        box.addEventListener("change", () => change(field, box.checked));
        errorLine(field);
        break;
      }
      case "interruptor": {
        heading(field).addToggle((toggle) => toggle.setValue(values[field.id] === true).onChange((value) => change(field, value)));
        errorLine(field);
        break;
      }
      case "cor": {
        heading(field).addColorPicker((picker) => picker.setValue(asText(values[field.id]) || "#000000").onChange((value) => change(field, value)));
        errorLine(field);
        break;
      }
      case "intervalo": {
        const setting = heading(field);
        const min = typeof field.min === "number" ? field.min : 0;
        const max = typeof field.max === "number" ? field.max : 100;
        const shown = setting.controlEl.createSpan({ cls: "aie-screen-slider-value", text: asText(values[field.id]) });
        setting.addSlider((slider) => {
          slider
            .setLimits(min, max, field.passo ?? 1)
            .setValue(typeof values[field.id] === "number" ? (values[field.id] as number) : min)
            .onChange((value) => {
              shown.setText(String(value));
              change(field, value);
            });
        });
        errorLine(field);
        break;
      }
      case "pasta":
      case "arquivo":
      case "nota":
      case "tag": {
        heading(field).addText((text) => {
          text.setPlaceholder(t(PLACEHOLDERS[field.tipo] ?? "screens.placeholder.file"));
          text.setValue(asText(values[field.id])).onChange((value) => change(field, value));
          new VaultSuggest(app, text.inputEl, createVaultSource(app, field), (value) => change(field, value));
        });
        errorLine(field);
        break;
      }
      case "lista": {
        heading(field);
        renderList(container, field, values, (items) => change(field, items));
        errorLine(field);
        break;
      }
      case "tabela": {
        heading(field);
        renderTable(container, field, values, (rows) => change(field, rows));
        errorLine(field);
        break;
      }
    }
  }

  refresh();

  return {
    getValues: () => {
      const copy: Record<string, unknown> = {};
      for (const [id, value] of Object.entries(values)) copy[id] = Array.isArray(value) ? asList(value) : value;
      return copy;
    },
    state: () => last,
    showErrors: (errors) => {
      showAll = true;
      submitErrors = errors;
      refresh();
    },
  };
}

function renderList(container: HTMLElement, field: ScreenField, values: Record<string, unknown>, onChange: (items: string[]) => void): void {
  const wrap = container.createDiv({ cls: "aie-screen-list" });
  let items = asList(values[field.id]).map((v) => asText(v));

  const draw = (): void => {
    wrap.empty();
    items.forEach((item, index) => {
      const row = wrap.createDiv({ cls: "aie-screen-list-row" });
      const input = row.createEl("input", { type: "text", placeholder: t("screens.listItem") });
      input.value = item;
      input.addEventListener("input", () => {
        items[index] = input.value;
        onChange([...items]);
      });
      const remove = row.createEl("button", { cls: "clickable-icon", attr: { "aria-label": t("screens.listRemove") } });
      setIcon(remove, "trash-2");
      remove.addEventListener("click", () => {
        items = items.filter((_, i) => i !== index);
        onChange([...items]);
        draw();
      });
    });
    new Setting(wrap).addButton((btn) =>
      btn
        .setButtonText(t("screens.listAdd"))
        .setIcon("plus")
        .onClick(() => {
          items = [...items, ""];
          onChange([...items]);
          draw();
        }),
    );
  };
  draw();
}

function renderTable(container: HTMLElement, field: ScreenField, values: Record<string, unknown>, onChange: (rows: Array<Record<string, unknown>>) => void): void {
  const wrap = container.createDiv({ cls: "aie-screen-table" });
  const columns = field.colunas ?? [];
  let rows = asList(values[field.id]).map((r) => ({ ...(typeof r === "object" && r !== null ? (r as Record<string, unknown>) : {}) }));

  const cell = (td: HTMLElement, column: TableColumn, row: Record<string, unknown>): void => {
    if (column.tipo === "caixa") {
      const box = td.createEl("input", { type: "checkbox" });
      box.checked = row[column.id] === true;
      box.addEventListener("change", () => {
        row[column.id] = box.checked;
        onChange(rows.map((r) => ({ ...r })));
      });
      return;
    }
    const input = td.createEl("input", { type: column.tipo === "texto" ? "text" : "number" });
    if (column.tipo === "decimal") input.step = "any";
    input.value = asText(row[column.id]);
    input.addEventListener("input", () => {
      row[column.id] = input.value;
      onChange(rows.map((r) => ({ ...r })));
    });
  };

  const draw = (): void => {
    wrap.empty();
    const table = wrap.createEl("table");
    const head = table.createEl("thead").createEl("tr");
    for (const column of columns) head.createEl("th", { text: column.rotulo });
    head.createEl("th");
    const body = table.createEl("tbody");
    rows.forEach((row, index) => {
      const tr = body.createEl("tr");
      for (const column of columns) cell(tr.createEl("td"), column, row);
      const remove = tr.createEl("td").createEl("button", { cls: "clickable-icon", attr: { "aria-label": t("screens.tableRemove") } });
      setIcon(remove, "trash-2");
      remove.addEventListener("click", () => {
        rows = rows.filter((_, i) => i !== index);
        onChange(rows.map((r) => ({ ...r })));
        draw();
      });
    });
    new Setting(wrap).addButton((btn) =>
      btn
        .setButtonText(t("screens.tableAdd"))
        .setIcon("plus")
        .onClick(() => {
          rows = [...rows, {}];
          onChange(rows.map((r) => ({ ...r })));
          draw();
        }),
    );
  };
  draw();
}
