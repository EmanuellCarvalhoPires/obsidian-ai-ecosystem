// Light render test of the screen form and its windows: a tiny fake DOM and a fake Setting that
// run the real renderer, so we can check what is drawn and how the buttons behave.
import { beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => {
  type Listener = () => void;

  class El {
    children: El[] = [];
    classes = new Set<string>();
    text = "";
    attrs: Record<string, string> = {};
    listeners: Record<string, Listener[]> = {};
    value = "";
    checked = false;
    type = "";
    step = "";
    min = "";
    max = "";
    rows = 0;
    autocomplete = "";
    placeholder = "";
    readOnly = false;
    constructor(readonly tag: string) {}
    createEl(tag: string, info: Record<string, unknown> = {}): El {
      const el = new El(tag);
      if (typeof info.cls === "string") for (const c of info.cls.split(" ")) el.classes.add(c);
      if (typeof info.text === "string") el.text = info.text;
      if (typeof info.type === "string") el.type = info.type;
      if (typeof info.placeholder === "string") el.placeholder = info.placeholder;
      if (info.attr) Object.assign(el.attrs, info.attr);
      this.children.push(el);
      return el;
    }
    createDiv(info?: Record<string, unknown>): El {
      return this.createEl("div", info);
    }
    createSpan(info?: Record<string, unknown>): El {
      return this.createEl("span", info);
    }
    empty(): void {
      this.children = [];
    }
    addClass(...names: string[]): void {
      for (const n of names) this.classes.add(n);
    }
    removeClass(...names: string[]): void {
      for (const n of names) this.classes.delete(n);
    }
    toggleClass(name: string, on: boolean): void {
      if (on) this.classes.add(name);
      else this.classes.delete(name);
    }
    setText(text: string): void {
      this.text = text;
    }
    setAttribute(name: string, value: string): void {
      this.attrs[name] = value;
    }
    addEventListener(name: string, cb: Listener): void {
      (this.listeners[name] ??= []).push(cb);
    }
    fire(name: string): void {
      for (const cb of this.listeners[name] ?? []) cb();
    }
    prepend(): void {}
    all(): El[] {
      return [this, ...this.children.flatMap((c) => c.all())];
    }
  }

  interface Comp {
    kind: string;
    setting: SettingFake;
    el?: El;
    change?: (value: unknown) => void;
    click?: () => void;
    label?: string;
    disabled?: boolean;
    destructive?: boolean;
    cta?: boolean;
    limits?: number[];
  }

  const log = { settings: [] as SettingFake[], notices: [] as string[] };

  class SettingFake {
    settingEl: El;
    controlEl: El;
    nameEl: El;
    name = "";
    desc = "";
    heading = false;
    comps: Comp[] = [];
    constructor(container: El) {
      this.settingEl = container.createDiv({ cls: "setting-item" });
      this.nameEl = this.settingEl.createDiv();
      this.controlEl = this.settingEl.createDiv();
      log.settings.push(this);
    }
    setName(name: string) {
      this.name = name;
      return this;
    }
    setDesc(desc: string) {
      this.desc = desc;
      return this;
    }
    setHeading() {
      this.heading = true;
      return this;
    }
    private textual(kind: string, cb: (c: unknown) => void, tag: string) {
      const comp: Comp = { kind, setting: this, el: new El(tag) };
      const component = {
        inputEl: comp.el,
        setValue(v: string) {
          comp.el!.value = v;
          return component;
        },
        setPlaceholder(p: string) {
          comp.el!.placeholder = p;
          return component;
        },
        onChange(fn: (v: string) => void) {
          comp.change = (v) => fn(v as string);
          return component;
        },
      };
      this.comps.push(comp);
      cb(component);
      return this;
    }
    addText(cb: (c: unknown) => void) {
      return this.textual("text", cb, "input");
    }
    addTextArea(cb: (c: unknown) => void) {
      return this.textual("textarea", cb, "textarea");
    }
    addToggle(cb: (c: unknown) => void) {
      const comp: Comp = { kind: "toggle", setting: this };
      const c = {
        setValue: () => c,
        onChange: (fn: (v: boolean) => void) => {
          comp.change = (v) => fn(v as boolean);
          return c;
        },
      };
      this.comps.push(comp);
      cb(c);
      return this;
    }
    addDropdown(cb: (c: unknown) => void) {
      const comp: Comp = { kind: "dropdown", setting: this };
      const options: string[] = [];
      const c = {
        addOption: (v: string) => {
          options.push(v);
        },
        setValue: () => c,
        onChange: (fn: (v: string) => void) => {
          comp.change = (v) => fn(v as string);
          return c;
        },
      };
      this.comps.push(comp);
      cb(c);
      comp.label = options.join("|");
      return this;
    }
    addColorPicker(cb: (c: unknown) => void) {
      const comp: Comp = { kind: "color", setting: this };
      const c = {
        setValue: () => c,
        onChange: (fn: (v: string) => void) => {
          comp.change = (v) => fn(v as string);
          return c;
        },
      };
      this.comps.push(comp);
      cb(c);
      return this;
    }
    addSlider(cb: (c: unknown) => void) {
      const comp: Comp = { kind: "slider", setting: this };
      const c = {
        setLimits: (...limits: number[]) => {
          comp.limits = limits;
          return c;
        },
        setValue: () => c,
        onChange: (fn: (v: number) => void) => {
          comp.change = (v) => fn(v as number);
          return c;
        },
      };
      this.comps.push(comp);
      cb(c);
      return this;
    }
    addButton(cb: (c: unknown) => void) {
      const comp: Comp = { kind: "button", setting: this };
      const c = {
        setButtonText: (t: string) => {
          comp.label = t;
          return c;
        },
        setCta: () => {
          comp.cta = true;
          return c;
        },
        setDestructive: () => {
          comp.destructive = true;
          return c;
        },
        setIcon: () => c,
        setDisabled: (d: boolean) => {
          comp.disabled = d;
          return c;
        },
        onClick: (fn: () => void) => {
          comp.click = fn;
          return c;
        },
      };
      this.comps.push(comp);
      cb(c);
      return this;
    }
  }

  class ModalFake {
    contentEl = new El("div");
    titleEl = new El("div");
    title = "";
    opened = false;
    closed = 0;
    scope = { register() {} };
    constructor(readonly app: unknown) {}
    setTitle(t: string) {
      this.title = t;
    }
    open() {
      this.opened = true;
      (this as unknown as { onOpen(): void }).onOpen();
    }
    close() {
      this.closed++;
      (this as unknown as { onClose(): void }).onClose();
    }
  }

  return { El, SettingFake, ModalFake, log };
});

vi.mock("obsidian", () => ({
  Setting: fake.SettingFake,
  Modal: fake.ModalFake,
  Notice: class {
    constructor(message: string) {
      fake.log.notices.push(message);
    }
  },
  AbstractInputSuggest: class {
    constructor(..._args: unknown[]) {}
    setValue() {}
    getValue() {
      return "";
    }
    close() {}
  },
  getAllTags: () => [],
  getLanguage: () => "en",
  setIcon: () => undefined,
}));

import { validateDefinition } from "../../src/screens/definition";
import type { OpenPreviewInput, OpenScreenInput, ScreenModalOutcome, SubmitOutcome } from "../../src/screens/host";
import type { FieldIssue, ScreenDefinition } from "../../src/screens/model";
import { renderScreenForm } from "../../src/screens/ui/form";
import type { FormState } from "../../src/screens/ui/form";
import { PreviewModal } from "../../src/screens/ui/preview-modal";
import { ScreenModal } from "../../src/screens/ui/screen-modal";

const EMOJI = /\p{Extended_Pictographic}/u;

function define(...campos: Array<Record<string, unknown>>): ScreenDefinition {
  const result = validateDefinition({ slug: "tela", titulo: "My screen", descricao: "About it", campos });
  if (!result.ok) throw new Error(result.errors.join("\n"));
  return result.definition;
}

const ALL_TYPES = define(
  { id: "f_texto", tipo: "texto", rotulo: "Text", obrigatorio: true },
  { id: "f_longo", tipo: "texto_longo", rotulo: "Long" },
  { id: "f_inteiro", tipo: "inteiro", rotulo: "Integer", min: 0, max: 9 },
  { id: "f_decimal", tipo: "decimal", rotulo: "Decimal" },
  { id: "f_data", tipo: "data", rotulo: "Date" },
  { id: "f_hora", tipo: "hora", rotulo: "Time" },
  { id: "f_dh", tipo: "data_hora", rotulo: "Date time" },
  { id: "f_selecao", tipo: "selecao", rotulo: "Choice", opcoes: ["a", "b"] },
  { id: "f_multipla", tipo: "selecao_multipla", rotulo: "Choices", opcoes: ["x", "y"] },
  { id: "f_caixa", tipo: "caixa", rotulo: "Box" },
  { id: "f_interruptor", tipo: "interruptor", rotulo: "Switch" },
  { id: "f_url", tipo: "url", rotulo: "URL" },
  { id: "f_email", tipo: "email", rotulo: "Email" },
  { id: "f_telefone", tipo: "telefone", rotulo: "Phone" },
  { id: "f_cor", tipo: "cor", rotulo: "Color" },
  { id: "f_intervalo", tipo: "intervalo", rotulo: "Slider", min: 0, max: 10 },
  { id: "f_pasta", tipo: "pasta", rotulo: "Folder" },
  { id: "f_arquivo", tipo: "arquivo", rotulo: "File" },
  { id: "f_nota", tipo: "nota", rotulo: "Note" },
  { id: "f_tag", tipo: "tag", rotulo: "Tag" },
  { id: "f_lista", tipo: "lista", rotulo: "List" },
  { id: "f_tabela", tipo: "tabela", rotulo: "Table", colunas: [{ id: "a", rotulo: "A" }] },
  { id: "f_rotulo", tipo: "rotulo", rotulo: "Read first" },
  { id: "f_sep", tipo: "separador", rotulo: "More" },
  { id: "f_sep2", tipo: "separador" },
  { id: "f_aprova", tipo: "aprovacao", rotulo: "Approve?" },
  { id: "f_acao", tipo: "acao", rotulo: "Generate" },
  { id: "f_senha", tipo: "senha", rotulo: "Password", destino_nome: "PASS" },
);

function render(definition: ScreenDefinition, extra: Partial<Parameters<typeof renderScreenForm>[1]> = {}) {
  fake.log.settings.length = 0;
  const container = new fake.El("div");
  const states: FormState[] = [];
  const actions: unknown[] = [];
  const controller = renderScreenForm(container as never, {
    app: {} as never,
    definition,
    initialValues: {},
    preview: false,
    secretIssue: () => undefined,
    onState: (s) => states.push(s),
    onAction: (o) => actions.push(o),
    ...extra,
  });
  const byName = (name: string) => {
    const found = fake.log.settings.find((s) => s.name === name);
    if (!found) throw new Error(`no setting named ${name}`);
    return found;
  };
  const text = () => container.all().map((e) => e.text).filter(Boolean);
  return { container, controller, states, actions, byName, text, settings: [...fake.log.settings] };
}

beforeEach(() => {
  fake.log.notices.length = 0;
});

describe("renderScreenForm", () => {
  it("draws every field type", () => {
    const view = render(ALL_TYPES);
    const names = view.settings.map((s) => s.name).filter(Boolean);
    for (const label of ["Text", "Long", "Integer", "Decimal", "Date", "Time", "Date time", "Choice", "Choices", "Box", "Switch", "URL", "Email", "Phone", "Color", "Slider", "Folder", "File", "Note", "Tag", "List", "Table", "More", "Approve?", "Password"]) {
      expect(names, label).toContain(label);
    }
    expect(view.text()).toContain("Read first");
    expect(view.container.all().some((e) => e.tag === "hr")).toBe(true);
    expect(view.byName("Approve?").comps.map((c) => c.label)).toEqual(["Approve", "Reject"]);
    expect(view.settings.some((s) => s.comps.some((c) => c.kind === "button" && c.label === "Generate"))).toBe(true);
    expect(EMOJI.test(JSON.stringify(view.text()))).toBe(false);
  });

  it("uses the right input for each type", () => {
    const view = render(ALL_TYPES);
    const input = (name: string) => view.byName(name).comps[0]!.el!;
    expect(input("URL").type).toBe("url");
    expect(input("Email").type).toBe("email");
    expect(input("Phone").type).toBe("tel");
    expect(input("Date").type).toBe("date");
    expect(input("Time").type).toBe("time");
    expect(input("Date time").type).toBe("datetime-local");
    expect(input("Integer")).toMatchObject({ type: "number", step: "1", min: "0", max: "9" });
    expect(input("Decimal")).toMatchObject({ type: "number", step: "any" });
    expect(input("Password")).toMatchObject({ type: "password", autocomplete: "new-password" });
    expect(view.byName("Slider").comps[0]?.limits).toEqual([0, 10, 1]);
    expect(view.byName("Choice").comps[0]?.label).toBe("|a|b");
  });

  it("marks required fields and keeps the form invalid until they are filled", () => {
    const view = render(define({ id: "nome", tipo: "texto", rotulo: "Name", obrigatorio: true }, { id: "idade", tipo: "inteiro", rotulo: "Age", min: 18 }));
    expect(view.byName("Name").settingEl.classes.has("aie-screen-required")).toBe(true);
    expect(view.byName("Age").settingEl.classes.has("aie-screen-required")).toBe(false);
    expect(view.controller.state().valid).toBe(false);
    // Nothing was touched yet, so no error is shown.
    expect(view.container.all().filter((e) => e.classes.has("aie-screen-error")).every((e) => e.text === "")).toBe(true);

    view.byName("Name").comps[0]!.change!("Ana");
    expect(view.controller.state().valid).toBe(true);
    view.byName("Age").comps[0]!.change!("10");
    expect(view.controller.state().valid).toBe(false);
    expect(view.text()).toContain("Must be at least 18.");
    view.byName("Age").comps[0]!.change!("20");
    expect(view.controller.state().valid).toBe(true);
    expect(view.controller.getValues()).toEqual({ nome: "Ana", idade: "20" });
    expect(view.states.at(-1)?.valid).toBe(true);
  });

  it("starts from the pre-filled values and the defaults", () => {
    const view = render(define({ id: "nome", tipo: "texto", rotulo: "Name" }, { id: "sim", tipo: "caixa", rotulo: "Yes", padrao: true }, { id: "n", tipo: "intervalo", rotulo: "N", min: 2, max: 8 }), {
      initialValues: { nome: "Ana" },
    });
    expect(view.controller.getValues()).toEqual({ nome: "Ana", sim: true, n: 2 });
    expect(view.byName("Name").comps[0]?.el?.value).toBe("Ana");
  });

  it("shows the issues the submit refused, under the fields", () => {
    const view = render(define({ id: "email", tipo: "email", rotulo: "Email" }));
    view.controller.showErrors({ email: { code: "invalid_email" } satisfies FieldIssue });
    expect(view.text()).toContain("Enter a valid email address.");
    view.byName("Email").comps[0]!.change!("ana@example.com");
    expect(view.text()).not.toContain("Enter a valid email address.");
  });

  it("buttons: approval, rejection and actions call onAction; the preview only shows a notice", () => {
    const def = define({ id: "ok", tipo: "aprovacao", rotulo: "Approve?" }, { id: "go", tipo: "acao", rotulo: "Go" });
    const view = render(def);
    const [approve, reject] = view.byName("Approve?").comps;
    approve!.click!();
    expect(view.controller.getValues().ok).toBe("aprovado");
    reject!.click!();
    expect(view.controller.getValues().ok).toBe("recusado");
    view.settings.find((s) => s.comps[0]?.label === "Go")!.comps[0]!.click!();
    expect(view.actions).toEqual([{}, { skipRequired: true }, { action: "go" }]);
    expect(reject?.destructive).toBe(true);
    expect(approve?.cta).toBe(true);

    const preview = render(def, { preview: true });
    preview.byName("Approve?").comps[0]!.click!();
    expect(preview.actions).toEqual([]);
    expect(fake.log.notices).toEqual(["Preview: this button would send the answer."]);
  });

  describe("password field", () => {
    const def = define({ id: "token", tipo: "senha", rotulo: "Token", obrigatorio: true, destino_nome: "API_TOKEN" });

    it("says where the value goes and warns about short values", () => {
      const view = render(def);
      expect(view.text()).toContain("Saved in Environment Keys as API_TOKEN. The AI never receives this value.");
      const warning = () => view.container.all().find((e) => e.classes.has("aie-screen-warning"))!;
      expect(warning().classes.has("aie-screen-hidden")).toBe(true);
      view.byName("Token").comps[0]!.change!("abc");
      expect(warning().classes.has("aie-screen-hidden")).toBe(false);
      view.byName("Token").comps[0]!.change!("abcdef");
      expect(warning().classes.has("aie-screen-hidden")).toBe(true);
    });

    it("blocks Confirm with the reason when the password cannot be saved", () => {
      let reason: FieldIssue | undefined = { code: "secret_locked" };
      const view = render(def, { secretIssue: () => reason });
      view.byName("Token").comps[0]!.change!("a-long-secret");
      expect(view.controller.state()).toEqual({ valid: false, blocker: "The Environment Keys vault is locked. Unlock it to save this password." });
      reason = undefined;
      view.byName("Token").comps[0]!.change!("another-long-secret");
      expect(view.controller.state()).toEqual({ valid: true });
    });

    it("only notes the problem in the preview, without blocking", () => {
      const view = render(def, { preview: true, secretIssue: () => ({ code: "secret_unavailable" }) });
      expect(view.controller.state().blocker).toBeUndefined();
      expect(view.text().some((t) => t.startsWith("Using this screen now would be blocked:"))).toBe(true);
    });

    it("never puts the typed password in the visible text", () => {
      const view = render(def);
      view.byName("Token").comps[0]!.change!("super-secret-value");
      expect(JSON.stringify(view.text())).not.toContain("super-secret-value");
    });
  });
});

function screenInput(definition: ScreenDefinition, submit: OpenScreenInput["submit"]): OpenScreenInput {
  return { definition, initialValues: {}, context: "Why I ask", secretIssue: () => undefined, submit };
}

describe("ScreenModal", () => {
  const def = define({ id: "nome", tipo: "texto", rotulo: "Name", obrigatorio: true });

  function open(submit: OpenScreenInput["submit"], definition = def) {
    const outcomes: ScreenModalOutcome[] = [];
    const modal = new ScreenModal({} as never, screenInput(definition, submit), (o) => outcomes.push(o)) as unknown as InstanceType<typeof fake.ModalFake>;
    modal.open();
    const buttons = fake.log.settings.flatMap((s) => s.comps).filter((c) => c.kind === "button");
    return { modal, outcomes, cancel: buttons.find((b) => b.label === "Cancel")!, confirm: buttons.find((b) => b.label === "Confirm") };
  }

  it("shows the title, the context and the description, and keeps Confirm disabled until the form is valid", () => {
    fake.log.settings.length = 0;
    const { modal, confirm } = open(async () => ({ ok: false }));
    expect(modal.title).toBe("My screen");
    const texts = modal.contentEl.all().map((e) => e.text);
    expect(texts).toContain("Why I ask");
    expect(texts).toContain("About it");
    expect(confirm?.disabled).toBe(true);
    expect(texts.some((t) => t.startsWith("Fill in the required fields"))).toBe(true);
    fake.log.settings.find((s) => s.name === "Name")!.comps[0]!.change!("Ana");
    expect(confirm?.disabled).toBe(false);
  });

  it("submits the values, settles and closes when the submit is accepted", async () => {
    fake.log.settings.length = 0;
    const result: SubmitOutcome = { ok: true, result: { status: "confirmado", valores: { nome: "Ana" }, secretos: {} } };
    const seen: unknown[] = [];
    const { modal, outcomes, confirm } = open(async (values, options) => {
      seen.push(values, options);
      return result;
    });
    fake.log.settings.find((s) => s.name === "Name")!.comps[0]!.change!("Ana");
    confirm!.click!();
    await vi.waitFor(() => expect(outcomes).toHaveLength(1));
    expect(seen).toEqual([{ nome: "Ana" }, {}]);
    expect(outcomes[0]).toEqual({ kind: "submitted", result: result.result });
    expect(modal.closed).toBe(1);
  });

  it("stays open and shows the refusal", async () => {
    fake.log.settings.length = 0;
    const { modal, outcomes, confirm } = open(async () => ({ ok: false, errors: { nome: { code: "too_short", params: { min: 5 } } } }));
    fake.log.settings.find((s) => s.name === "Name")!.comps[0]!.change!("Ana");
    confirm!.click!();
    await vi.waitFor(() => expect(modal.contentEl.all().some((e) => e.text === "Must have at least 5 characters.")).toBe(true));
    expect(outcomes).toEqual([]);
    expect(modal.closed).toBe(0);
  });

  it("settles as closed when the user cancels, and only once", () => {
    fake.log.settings.length = 0;
    const { modal, outcomes, cancel } = open(async () => ({ ok: false }));
    cancel.click!();
    modal.close();
    expect(outcomes).toEqual([{ kind: "closed" }]);
  });

  it("has no Confirm button when the screen has its own approval or action buttons", () => {
    fake.log.settings.length = 0;
    const { confirm } = open(async () => ({ ok: false }), define({ id: "ok", tipo: "aprovacao", rotulo: "Approve?" }));
    expect(confirm).toBeUndefined();
  });
});

describe("PreviewModal", () => {
  const def = define({ id: "nome", tipo: "texto", rotulo: "Name" });
  const input = (mode: OpenPreviewInput["mode"], extra: Partial<OpenPreviewInput> = {}): OpenPreviewInput => ({
    mode,
    definition: def,
    json: JSON.stringify(def, null, 2),
    secretIssue: () => undefined,
    ...extra,
  });

  function open(preview: OpenPreviewInput) {
    fake.log.settings.length = 0;
    const decisions: string[] = [];
    const modal = new PreviewModal({} as never, preview, (d) => decisions.push(d)) as unknown as InstanceType<typeof fake.ModalFake>;
    modal.open();
    const buttons = fake.log.settings.flatMap((s) => s.comps).filter((c) => c.kind === "button");
    return { modal, decisions, buttons };
  }

  it("shows the screen and the JSON, and saves nothing until Approve", () => {
    const { modal, decisions, buttons } = open(input("create"));
    expect(modal.title).toBe("New screen: My screen");
    const texts = modal.contentEl.all().map((e) => e.text);
    expect(texts.some((t) => t.includes("tela_tela") && t.includes("Nothing is saved until you approve"))).toBe(true);
    expect(texts.some((t) => t.includes('"slug": "tela"'))).toBe(true);
    expect(modal.contentEl.all().some((e) => e.tag === "details")).toBe(true);
    expect(fake.log.settings.some((s) => s.name === "Name")).toBe(true);
    expect(decisions).toEqual([]);
    expect(buttons.map((b) => b.label).filter((l) => l === "Reject" || l === "Approve and save")).toEqual(["Reject", "Approve and save"]);
  });

  it("approves and closes", () => {
    const { modal, decisions, buttons } = open(input("create"));
    buttons.find((b) => b.label === "Approve and save")!.click!();
    expect(decisions).toEqual(["aprovado"]);
    expect(modal.closed).toBe(1);
  });

  it("counts a rejection and closing the window as recusado, once", () => {
    const first = open(input("edit", { previous: def }));
    first.buttons.find((b) => b.label === "Reject")!.click!();
    expect(first.decisions).toEqual(["recusado"]);
    const second = open(input("create"));
    second.modal.close();
    second.modal.close();
    expect(second.decisions).toEqual(["recusado"]);
  });

  it("shows the saved version too when editing, and a destructive approval when removing", () => {
    const edit = open(input("edit", { previous: def }));
    expect(edit.modal.contentEl.all().filter((e) => e.tag === "details")).toHaveLength(2);
    const remove = open(input("remove"));
    expect(remove.buttons.find((b) => b.label === "Approve removal")?.destructive).toBe(true);
  });

  it("only offers Close for the view of a saved screen", () => {
    const { decisions, buttons } = open(input("view"));
    expect(buttons.map((b) => b.label)).toEqual(["Close"]);
    buttons[0]!.click!();
    expect(decisions).toEqual(["recusado"]);
  });
});
