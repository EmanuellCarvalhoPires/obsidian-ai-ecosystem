// Render test of McpDeleteModal: a tiny fake DOM, Setting and Modal run the real modal.
import { beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => {
  class El {
    children: El[] = [];
    classes = new Set<string>();
    text = "";
    constructor(readonly tag: string) {}
    createEl(tag: string, info: Record<string, unknown> = {}): El {
      const el = new El(tag);
      if (typeof info.text === "string") el.text = info.text;
      this.children.push(el);
      return el;
    }
    createDiv(info?: Record<string, unknown>): El {
      return this.createEl("div", info);
    }
    empty(): void {
      this.children = [];
    }
    addClass(...names: string[]): void {
      for (const n of names) this.classes.add(n);
    }
  }

  interface Comp {
    kind: string;
    change?: (value: boolean) => void;
    click?: () => void;
    label?: string;
    destructive?: boolean;
    cta?: boolean;
  }

  const log = { settings: [] as SettingFake[] };

  class SettingFake {
    settingEl: El;
    name = "";
    comps: Comp[] = [];
    constructor(container: El) {
      this.settingEl = container.createDiv({ cls: "setting-item" });
      log.settings.push(this);
    }
    setName(name: string) {
      this.name = name;
      return this;
    }
    addToggle(cb: (c: unknown) => void) {
      const comp: Comp = { kind: "toggle" };
      const c = {
        setValue: () => c,
        onChange: (fn: (v: boolean) => void) => {
          comp.change = fn;
          return c;
        },
      };
      this.comps.push(comp);
      cb(c);
      return this;
    }
    addButton(cb: (c: unknown) => void) {
      const comp: Comp = { kind: "button" };
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
    title = "";
    closed = 0;
    constructor(readonly app: unknown) {}
    setTitle(t: string) {
      this.title = t;
    }
    open() {
      (this as unknown as { onOpen(): void }).onOpen();
    }
    close() {
      this.closed++;
      (this as unknown as { onClose(): void }).onClose();
    }
  }

  return { SettingFake, ModalFake, log };
});

vi.mock("obsidian", () => ({
  Setting: fake.SettingFake,
  Modal: fake.ModalFake,
  getLanguage: () => "en",
  setIcon: () => undefined,
}));

import { McpDeleteModal } from "../../src/catalog/mcp-delete-modal";
import { t } from "../../src/i18n";

function open(onConfirm: (deleteNotes: boolean) => void) {
  const modal = new McpDeleteModal({} as never, { name: "jira", noteCount: 7, onConfirm });
  modal.open();
  const [toggleSetting, buttonSetting] = fake.log.settings;
  const toggle = toggleSetting.comps[0];
  const [cancel, confirm] = buttonSetting.comps;
  return { modal: modal as unknown as InstanceType<typeof fake.ModalFake>, toggleSetting, toggle, cancel, confirm };
}

describe("McpDeleteModal", () => {
  beforeEach(() => {
    fake.log.settings.length = 0;
  });

  it("titles the modal with the package name", () => {
    const { modal } = open(vi.fn());
    expect(modal.title).toBe(t("catalog.mcp.deleteTitle", { name: "jira" }));
    expect(modal.title).toContain("jira");
  });

  it("labels the toggle with the note count", () => {
    const { toggleSetting } = open(vi.fn());
    expect(toggleSetting.name).toBe(t("catalog.mcp.deleteNotes", { n: 7 }));
    expect(toggleSetting.name).toContain("7");
  });

  it("closes on cancel without confirming", () => {
    const onConfirm = vi.fn();
    const { modal, cancel } = open(onConfirm);
    cancel.click!();
    expect(modal.closed).toBe(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("confirms with false when the toggle is untouched", () => {
    const onConfirm = vi.fn();
    const { modal, confirm } = open(onConfirm);
    confirm.click!();
    expect(modal.closed).toBe(1);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith(false);
  });

  it("confirms with true after the toggle is turned on", () => {
    const onConfirm = vi.fn();
    const { toggle, confirm } = open(onConfirm);
    toggle.change!(true);
    confirm.click!();
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith(true);
  });

  it("marks the confirm button as destructive", () => {
    const { confirm, cancel } = open(vi.fn());
    expect(confirm.destructive).toBe(true);
    expect(confirm.cta).toBeUndefined();
    expect(cancel.destructive).toBeUndefined();
  });
});
