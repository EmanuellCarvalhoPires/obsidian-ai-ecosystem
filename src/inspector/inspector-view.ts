import { ItemView, setIcon, type WorkspaceLeaf } from "obsidian";
import { t } from "../i18n";
import type { ActivityEntry } from "../types";
import { distinctValues, filterEntries, formatDuration, formatTime, statusClass, type LiveLogger } from "./live-logger";

export const INSPECTOR_VIEW_TYPE = "ai-ecosystem-inspector";

const RENDER_DELAY_MS = 100;

export interface InspectorViewDeps {
  logger: LiveLogger;
  isRedactionLimited: () => boolean;
}

export class InspectorView extends ItemView {
  private readonly deps: InspectorViewDeps;
  private unsubscribe?: () => void;
  private renderTimer: number | undefined;

  private paused = false;
  /** Snapshot of the entries while paused (the logger keeps recording). */
  private frozen: ActivityEntry[] | undefined;
  private moduleFilter = "";
  private clientFilter = "";
  private query = "";
  private selectedId: string | undefined;
  private detailsSignature = "";
  private sectionTexts: string[] = [];

  private bannerEl!: HTMLElement;
  private liveEl!: HTMLElement;
  private moduleSelect!: HTMLSelectElement;
  private clientSelect!: HTMLSelectElement;
  private pauseBtn!: HTMLButtonElement;
  private tbody!: HTMLElement;
  private emptyEl!: HTMLElement;
  private detailsEl!: HTMLElement;
  private moduleOptions = "";
  private clientOptions = "";

  constructor(leaf: WorkspaceLeaf, deps: InspectorViewDeps) {
    super(leaf);
    this.deps = deps;
  }

  getViewType(): string {
    return INSPECTOR_VIEW_TYPE;
  }

  getDisplayText(): string {
    return t("inspector.title");
  }

  getIcon(): string {
    return "activity";
  }

  async onOpen(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass("aie-inspector");

    this.bannerEl = root.createDiv({ cls: "aie-inspector-banner" });
    this.buildToolbar(root);

    const tableWrap = root.createDiv({ cls: "aie-inspector-table-wrap" });
    const table = tableWrap.createEl("table", { cls: "aie-inspector-table" });
    const headRow = table.createEl("thead").createEl("tr");
    for (const key of ["colTime", "colType", "colTarget", "colModule", "colClient", "colStatus", "colDuration"]) {
      headRow.createEl("th", { text: t(`inspector.${key}`) });
    }
    this.tbody = table.createEl("tbody");
    this.emptyEl = tableWrap.createDiv({ cls: "aie-inspector-empty" });

    this.registerDomEvent(this.tbody, "click", (evt) => this.onRowActivate(evt));
    this.registerDomEvent(this.tbody, "keydown", (evt) => {
      if (evt.key === "Enter" || evt.key === " ") {
        evt.preventDefault();
        this.onRowActivate(evt);
      }
    });

    this.detailsEl = root.createDiv({ cls: "aie-inspector-details" });
    this.registerDomEvent(this.detailsEl, "click", (evt) => this.onDetailsClick(evt));

    this.unsubscribe = this.deps.logger.subscribe((e) => {
      if (e.type === "cleared") this.frozen = this.frozen ? [] : undefined;
      if (e.type === "cleared") this.selectedId = undefined;
      this.scheduleRender();
    });
    this.render();
    return Promise.resolve();
  }

  onClose(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    if (this.renderTimer !== undefined) window.clearTimeout(this.renderTimer);
    this.renderTimer = undefined;
    return Promise.resolve();
  }

  private buildToolbar(root: HTMLElement): void {
    const bar = root.createDiv({ cls: "aie-inspector-toolbar" });
    this.liveEl = bar.createDiv({ cls: "aie-inspector-live" });

    const modGroup = bar.createDiv({ cls: "aie-inspector-field" });
    modGroup.createEl("label", { text: t("inspector.module") });
    this.moduleSelect = modGroup.createEl("select", { cls: "dropdown", attr: { "aria-label": t("inspector.module") } });
    this.registerDomEvent(this.moduleSelect, "change", () => {
      this.moduleFilter = this.moduleSelect.value;
      this.render();
    });

    const cliGroup = bar.createDiv({ cls: "aie-inspector-field" });
    cliGroup.createEl("label", { text: t("inspector.client") });
    this.clientSelect = cliGroup.createEl("select", { cls: "dropdown", attr: { "aria-label": t("inspector.client") } });
    this.registerDomEvent(this.clientSelect, "change", () => {
      this.clientFilter = this.clientSelect.value;
      this.render();
    });

    const search = bar.createEl("input", {
      cls: "aie-inspector-search",
      type: "search",
      attr: { placeholder: t("inspector.searchPlaceholder"), "aria-label": t("inspector.search") },
    });
    this.registerDomEvent(search, "input", () => {
      this.query = search.value;
      this.render();
    });

    const clearBtn = bar.createEl("button", { cls: "aie-inspector-btn", attr: { "aria-label": t("inspector.clear") } });
    setIcon(clearBtn.createSpan({ cls: "aie-icon" }), "trash-2");
    clearBtn.createSpan({ text: t("inspector.clear") });
    this.registerDomEvent(clearBtn, "click", () => this.deps.logger.clear());

    this.pauseBtn = bar.createEl("button", { cls: "aie-inspector-btn" });
    this.registerDomEvent(this.pauseBtn, "click", () => {
      this.paused = !this.paused;
      this.frozen = this.paused ? [...this.deps.logger.entries()] : undefined;
      this.render();
    });

    const isTab = this.leaf.getRoot() === this.app.workspace.rootSplit;
    const toggleLayoutBtn = bar.createEl("button", {
      cls: "aie-inspector-btn aie-inspector-toggle-layout",
      attr: { "aria-label": isTab ? t("inspector.openSidebar") : t("inspector.openTab") },
    });
    setIcon(toggleLayoutBtn.createSpan({ cls: "aie-icon" }), isTab ? "sidebar" : "maximize-2");
    toggleLayoutBtn.createSpan({ text: isTab ? t("inspector.openSidebar") : t("inspector.openTab") });
    this.registerDomEvent(toggleLayoutBtn, "click", () => {
      const { workspace } = this.app;
      const currentlyTab = this.leaf.getRoot() === workspace.rootSplit;
      const targetLeaf = currentlyTab ? workspace.getRightLeaf(false) : workspace.getLeaf("tab");
      void targetLeaf.setViewState({ type: INSPECTOR_VIEW_TYPE, active: true }).then(() => {
        void workspace.revealLeaf(targetLeaf);
      });
    });
  }

  private scheduleRender(): void {
    if (this.renderTimer !== undefined) return;
    this.renderTimer = window.setTimeout(() => {
      this.renderTimer = undefined;
      this.render();
    }, RENDER_DELAY_MS);
  }

  private source(): readonly ActivityEntry[] {
    return this.frozen ?? this.deps.logger.entries();
  }

  private render(): void {
    this.renderBanner();
    this.renderToolbarState();
    const all = this.source();
    this.syncSelect(this.moduleSelect, distinctValues(all, (e) => e.moduleId), "moduleOptions", this.moduleFilter);
    this.syncSelect(this.clientSelect, distinctValues(all, (e) => e.client), "clientOptions", this.clientFilter);

    const rows = filterEntries(all, {
      moduleId: this.moduleFilter,
      client: this.clientFilter,
      query: this.query,
    }).reverse();
    this.renderRows(rows, all.length === 0);
    this.renderDetails(all);
  }

  private renderBanner(): void {
    const limited = this.deps.isRedactionLimited();
    this.bannerEl.toggleClass("aie-hidden", !limited);
    if (!limited) {
      this.bannerEl.empty();
      return;
    }
    if (this.bannerEl.childElementCount > 0) return;
    setIcon(this.bannerEl.createSpan({ cls: "aie-icon" }), "alert-triangle");
    this.bannerEl.createSpan({ text: t("inspector.limitedBanner") });
  }

  private renderToolbarState(): void {
    this.liveEl.empty();
    this.liveEl.toggleClass("is-paused", this.paused);
    setIcon(this.liveEl.createSpan({ cls: "aie-icon" }), this.paused ? "pause" : "radio");
    this.liveEl.createSpan({ text: this.paused ? t("inspector.paused") : t("inspector.live") });

    this.pauseBtn.empty();
    const label = this.paused ? t("inspector.resume") : t("inspector.pause");
    this.pauseBtn.setAttr("aria-label", label);
    setIcon(this.pauseBtn.createSpan({ cls: "aie-icon" }), this.paused ? "play" : "pause");
    this.pauseBtn.createSpan({ text: label });
  }

  private syncSelect(
    select: HTMLSelectElement,
    values: string[],
    cache: "moduleOptions" | "clientOptions",
    current: string,
  ): void {
    const signature = values.join("\n");
    if (this[cache] !== signature || select.options.length === 0) {
      this[cache] = signature;
      select.empty();
      select.createEl("option", { value: "", text: t("inspector.all") });
      for (const v of values) select.createEl("option", { value: v, text: v });
    }
    select.value = current;
  }

  private renderRows(rows: ActivityEntry[], noEntries: boolean): void {
    this.tbody.empty();
    this.emptyEl.toggleClass("aie-hidden", rows.length > 0);
    this.emptyEl.setText(rows.length > 0 ? "" : noEntries ? t("inspector.empty") : t("inspector.emptyFiltered"));

    for (const entry of rows) {
      const tr = this.tbody.createEl("tr", {
        cls: "aie-inspector-row",
        attr: { tabindex: "0", "data-id": entry.id },
      });
      tr.toggleClass("is-selected", entry.id === this.selectedId);
      tr.createEl("td", { text: formatTime(entry.time), cls: "aie-col-time" });
      tr.createEl("td", { text: entry.method, cls: "aie-col-type" });
      tr.createEl("td", { text: entry.target, cls: "aie-col-target", attr: { title: entry.target } });
      tr.createEl("td", { text: entry.moduleId || "-", cls: "aie-col-module" });
      tr.createEl("td", { text: entry.client || "-", cls: "aie-col-client" });
      this.renderStatusCell(tr.createEl("td", { cls: "aie-col-status" }), entry);
      tr.createEl("td", { text: formatDuration(entry), cls: "aie-col-duration" });
    }
  }

  private renderStatusCell(td: HTMLElement, entry: ActivityEntry): void {
    const kind = statusClass(entry);
    const badge = td.createSpan({ cls: ["aie-badge", `aie-badge-${kind}`] });
    if (entry.running) {
      setIcon(badge.createSpan({ cls: ["aie-icon", "aie-spin"] }), "loader-2");
      badge.createSpan({ text: t("inspector.running") });
    } else {
      badge.setText(String(entry.status));
    }
    if (entry.alert) {
      const alert = td.createSpan({ cls: "aie-badge aie-badge-alert", attr: { "aria-label": t("inspector.alertTooltip") } });
      setIcon(alert, "shield-alert");
    }
  }

  private onRowActivate(evt: Event): void {
    const target = evt.target;
    if (!(target instanceof Element)) return;
    const tr = target.closest("tr");
    const id = tr?.getAttribute("data-id");
    if (!id) return;
    this.selectedId = id;
    this.detailsSignature = "";
    this.render();
  }

  private renderDetails(all: readonly ActivityEntry[]): void {
    const entry = this.selectedId ? all.find((e) => e.id === this.selectedId) : undefined;
    if (!entry) {
      if (this.selectedId) this.selectedId = undefined;
      this.detailsSignature = "";
      this.detailsEl.empty();
      this.detailsEl.addClass("aie-hidden");
      return;
    }
    const signature = [entry.status, entry.running, entry.durationMs, entry.output.length, entry.response.length].join("|") + entry.id;
    if (signature === this.detailsSignature) return;
    this.detailsSignature = signature;

    const el = this.detailsEl;
    el.empty();
    el.removeClass("aie-hidden");
    this.sectionTexts = [];

    const head = el.createDiv({ cls: "aie-details-head" });
    head.createEl("strong", { text: t("inspector.details") });
    const close = head.createEl("button", {
      cls: "aie-inspector-btn aie-icon-btn",
      attr: { "aria-label": t("inspector.close"), "data-action": "close" },
    });
    setIcon(close, "x");

    const meta = el.createDiv({ cls: "aie-details-meta" });
    const fields: Array<[string, string]> = [
      [t("inspector.colType"), entry.method],
      [t("inspector.colTarget"), entry.target],
      [t("inspector.colModule"), entry.moduleId || "-"],
      [t("inspector.colClient"), entry.client || "-"],
      [t("inspector.colStatus"), entry.running ? t("inspector.running") : String(entry.status)],
      [t("inspector.colDuration"), formatDuration(entry) || "-"],
      [t("inspector.colTime"), formatTime(entry.time)],
    ];
    for (const [label, value] of fields) {
      const item = meta.createDiv({ cls: "aie-details-item" });
      item.createSpan({ text: label, cls: "aie-details-label" });
      item.createSpan({ text: value, cls: "aie-details-value" });
    }

    const headers = Object.entries(entry.requestHeaders)
      .map(([k, v]) => `${k}: ${v}`)
      .join("\n");
    this.renderSection(el, t("inspector.headers"), headers);
    this.renderSection(el, t("inspector.payload"), entry.payload);
    this.renderSection(el, t("inspector.response"), entry.response);
    if (entry.kind === "script" || entry.output) this.renderSection(el, t("inspector.output"), entry.output);
  }

  private onDetailsClick(evt: Event): void {
    const target = evt.target;
    if (!(target instanceof Element)) return;
    const btn = target.closest("button[data-action]");
    const action = btn?.getAttribute("data-action");
    if (action === "close") {
      this.selectedId = undefined;
      this.render();
    } else if (action === "copy") {
      const text = this.sectionTexts[Number(btn?.getAttribute("data-section"))] ?? "";
      void navigator.clipboard.writeText(text).catch(() => undefined);
    }
  }

  private renderSection(parent: HTMLElement, title: string, content: string): void {
    const section = parent.createDiv({ cls: "aie-details-section" });
    const head = section.createDiv({ cls: "aie-details-section-head" });
    head.createSpan({ text: title });
    const copy = head.createEl("button", {
      cls: "aie-inspector-btn aie-icon-btn",
      attr: { "aria-label": `${t("inspector.copy")}: ${title}`, "data-action": "copy", "data-section": String(this.sectionTexts.length) },
    });
    this.sectionTexts.push(content);
    setIcon(copy, "copy");
    const pre = section.createEl("pre", { cls: "aie-details-pre" });
    if (content) pre.setText(content);
    else pre.createSpan({ text: t("inspector.noData"), cls: "aie-muted" });
  }
}
