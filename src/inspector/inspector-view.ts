import { ItemView, Notice, setIcon, setTooltip, type WorkspaceLeaf } from "obsidian";
import { t } from "../i18n";
import type { ActivityEntry } from "../types";
import {
  distinctValues,
  formatDuration,
  formatTime,
  statusClass,
  type LiveLogger,
} from "./live-logger";

export const INSPECTOR_VIEW_TYPE = "ai-ecosystem-inspector";

type StatusFilter = "all" | "running" | "problems";
const STATUS_FILTERS: StatusFilter[] = ["all", "running", "problems"];

interface Row {
  entry: ActivityEntry;
  el: HTMLDetailsElement;
  summary: HTMLElement;
  term: HTMLElement;
  prompt: HTMLElement;
}

export interface InspectorViewDeps {
  logger: LiveLogger;
  isRedactionLimited: () => boolean;
}

export class InspectorView extends ItemView {
  private readonly deps: InspectorViewDeps;
  private unsubscribe?: () => void;
  private renderTimer: number | undefined;

  private rows = new Map<string, Row>();
  private statusFilter: StatusFilter = "all";
  private moduleFilter = "";
  private clientFilter = "";
  private query = "";
  private autoOpen = false;
  private paused = false;
  private frozen: ActivityEntry[] | undefined;

  private bannerEl!: HTMLElement;
  private liveDot!: HTMLElement;
  private liveLabel!: HTMLElement;
  private filterButtons = new Map<StatusFilter, HTMLButtonElement>();
  private moduleSelect!: HTMLSelectElement;
  private clientSelect!: HTMLSelectElement;
  private searchInput!: HTMLInputElement;
  private pauseBtn!: HTMLButtonElement;
  private listEl!: HTMLElement;
  private emptyEl!: HTMLElement;

  private moduleOptionsSignature = "";
  private clientOptionsSignature = "";

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
    root.addClass("aie-act-view");

    this.buildHeader(root);
    this.buildToolbar(root);

    this.listEl = root.createDiv({ cls: "aie-act-list" });
    this.emptyEl = root.createDiv({ cls: "aie-act-empty" });
    this.emptyEl.createDiv({ text: t("inspector.empty"), cls: "aie-act-empty-title" });
    this.emptyEl.createDiv({ text: t("inspector.emptyFiltered"), cls: "aie-muted aie-act-empty-desc" });

    this.unsubscribe = this.deps.logger.subscribe((e) => {
      if (e.type === "cleared") {
        this.frozen = this.paused ? [] : undefined;
        this.rows.clear();
        this.listEl.empty();
      }
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
    this.rows.clear();
    return Promise.resolve();
  }

  // ---------- UI Building ----------

  private buildHeader(root: HTMLElement): void {
    const header = root.createDiv({ cls: "aie-act-header" });
    const top = header.createDiv({ cls: "aie-act-header-top" });
    top.createEl("h2", { text: t("inspector.title"), cls: "aie-act-heading" });

    const live = top.createDiv({ cls: "aie-act-live" });
    this.liveDot = live.createSpan({ cls: "aie-dot is-on" });
    this.liveLabel = live.createSpan({ text: t("inspector.live") });

    header.createDiv({ text: t("inspector.subtitle"), cls: "aie-muted" });
    header.createDiv({ text: t("inspector.memory"), cls: "aie-muted" });

    this.bannerEl = header.createDiv({ cls: "aie-inspector-banner aie-hidden" });
  }

  private buildToolbar(root: HTMLElement): void {
    const bar = root.createDiv({ cls: "aie-act-toolbar" });

    // Quick status filters (All / Running / Problems)
    const filtersGroup = bar.createDiv({ cls: "aie-act-filters", attr: { role: "group" } });
    for (const f of STATUS_FILTERS) {
      const btn = filtersGroup.createEl("button", {
        text: t(`inspector.filter${capitalize(f)}`),
        cls: "aie-act-btn",
        attr: { "aria-pressed": String(f === this.statusFilter) },
      });
      this.registerDomEvent(btn, "click", () => this.setStatusFilter(f));
      this.filterButtons.set(f, btn);
    }

    // Module dropdown filter
    const modGroup = bar.createDiv({ cls: "aie-act-field" });
    modGroup.createEl("label", { text: t("inspector.module") });
    this.moduleSelect = modGroup.createEl("select", { cls: "dropdown aie-act-select", attr: { "aria-label": t("inspector.module") } });
    this.registerDomEvent(this.moduleSelect, "change", () => {
      this.moduleFilter = this.moduleSelect.value;
      this.refreshVisibility();
    });

    // Client dropdown filter
    const cliGroup = bar.createDiv({ cls: "aie-act-field" });
    cliGroup.createEl("label", { text: t("inspector.client") });
    this.clientSelect = cliGroup.createEl("select", { cls: "dropdown aie-act-select", attr: { "aria-label": t("inspector.client") } });
    this.registerDomEvent(this.clientSelect, "change", () => {
      this.clientFilter = this.clientSelect.value;
      this.refreshVisibility();
    });

    // Search input
    this.searchInput = bar.createEl("input", {
      cls: "aie-act-search",
      type: "search",
      attr: { placeholder: t("inspector.searchPlaceholder"), "aria-label": t("inspector.search") },
    });
    this.registerDomEvent(this.searchInput, "input", () => {
      this.query = this.searchInput.value;
      this.refreshVisibility();
    });

    // Auto-open checkbox
    const autoLabel = bar.createEl("label", { cls: "aie-act-auto" });
    const autoCheck = autoLabel.createEl("input", { type: "checkbox" });
    autoCheck.checked = this.autoOpen;
    autoLabel.createSpan({ text: t("inspector.autoOpen") });
    setTooltip(autoLabel, t("inspector.autoOpenTip"));
    this.registerDomEvent(autoCheck, "change", () => {
      this.autoOpen = autoCheck.checked;
    });

    // Spacer
    const spacer = bar.createDiv({ cls: "aie-act-spacer" });
    spacer.setAttr("aria-hidden", "true");

    // Action buttons
    this.iconButton(bar, "chevrons-down", t("inspector.expandAll"), () => this.setAllOpen(true));
    this.iconButton(bar, "chevrons-up", t("inspector.collapseAll"), () => this.setAllOpen(false));

    this.pauseBtn = bar.createEl("button", { cls: "aie-act-btn", attr: { "aria-label": t("inspector.pause") } });
    setIcon(this.pauseBtn.createSpan({ cls: "aie-icon" }), "pause");
    this.pauseBtn.createSpan({ text: t("inspector.pause") });
    this.registerDomEvent(this.pauseBtn, "click", () => this.togglePause());

    const clearBtn = bar.createEl("button", { cls: "aie-act-btn", attr: { "aria-label": t("inspector.clearTip") } });
    setIcon(clearBtn.createSpan({ cls: "aie-icon" }), "trash-2");
    clearBtn.createSpan({ text: t("inspector.clear") });
    setTooltip(clearBtn, t("inspector.clearTip"));
    this.registerDomEvent(clearBtn, "click", () => this.deps.logger.clear());
  }

  private iconButton(parent: HTMLElement, icon: string, label: string, onClick: () => void): HTMLButtonElement {
    const btn = parent.createEl("button", { cls: "aie-act-btn aie-icon-btn", attr: { "aria-label": label } });
    setIcon(btn.createSpan({ cls: "aie-icon" }), icon);
    setTooltip(btn, label);
    this.registerDomEvent(btn, "click", onClick);
    return btn;
  }

  // ---------- State & Rendering ----------

  private scheduleRender(): void {
    if (this.renderTimer !== undefined) return;
    this.renderTimer = window.setTimeout(() => {
      this.renderTimer = undefined;
      this.render();
    }, 80);
  }

  private source(): readonly ActivityEntry[] {
    return this.frozen ?? this.deps.logger.entries();
  }

  private render(): void {
    this.renderBanner();
    this.renderLiveState();

    const all = this.source();
    this.syncSelect(this.moduleSelect, distinctValues(all, (e) => e.moduleId), "moduleOptionsSignature", this.moduleFilter);
    this.syncSelect(this.clientSelect, distinctValues(all, (e) => e.client), "clientOptionsSignature", this.clientFilter);

    // Sync rows: add missing, update existing
    const seenIds = new Set<string>();
    for (const entry of all) {
      seenIds.add(entry.id);
      const existing = this.rows.get(entry.id);
      if (existing) {
        existing.entry = entry;
        this.updateRow(existing);
      } else {
        this.addRow(entry, this.autoOpen);
      }
    }

    // Remove rows that were dropped by the ring buffer
    for (const [id, row] of [...this.rows.entries()]) {
      if (!seenIds.has(id)) {
        row.el.remove();
        this.rows.delete(id);
      }
    }

    this.refreshVisibility();
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

  private renderLiveState(): void {
    this.liveDot.toggleClass("is-on", !this.paused);
    this.liveDot.toggleClass("is-paused", this.paused);
    this.liveLabel.setText(this.paused ? t("inspector.paused") : t("inspector.live"));

    this.pauseBtn.empty();
    const label = this.paused ? t("inspector.resume") : t("inspector.pause");
    this.pauseBtn.setAttr("aria-label", label);
    setIcon(this.pauseBtn.createSpan({ cls: "aie-icon" }), this.paused ? "play" : "pause");
    this.pauseBtn.createSpan({ text: label });
  }

  private togglePause(): void {
    this.paused = !this.paused;
    this.frozen = this.paused ? [...this.deps.logger.entries()] : undefined;
    this.render();
  }

  private setStatusFilter(f: StatusFilter): void {
    this.statusFilter = f;
    for (const [filterKey, btn] of this.filterButtons) {
      btn.setAttr("aria-pressed", String(filterKey === f));
    }
    this.refreshVisibility();
  }

  private setAllOpen(open: boolean): void {
    for (const row of this.rows.values()) {
      if (!row.el.hasClass("aie-hidden")) row.el.open = open;
    }
  }

  private syncSelect(
    select: HTMLSelectElement,
    values: string[],
    cacheKey: "moduleOptionsSignature" | "clientOptionsSignature",
    current: string,
  ): void {
    const signature = values.join("\n");
    if (this[cacheKey] !== signature || select.options.length === 0) {
      this[cacheKey] = signature;
      select.empty();
      select.createEl("option", { value: "", text: t("inspector.all") });
      for (const v of values) select.createEl("option", { value: v, text: v });
    }
    select.value = current;
  }

  private addRow(entry: ActivityEntry, shouldOpen: boolean): void {
    const details = createEl("details", { cls: "aie-act" });
    details.setAttr("data-id", entry.id);
    if (shouldOpen) details.open = true;

    const summary = details.createEl("summary", { cls: "aie-act-summary" });
    const body = details.createDiv({ cls: "aie-act-body" });

    // Terminal container
    const term = body.createDiv({ cls: "aie-act-term" });
    const prompt = term.createDiv({ cls: "aie-act-prompt" });

    const row: Row = { entry, el: details, summary, term, prompt };
    this.rows.set(entry.id, row);

    // Copy formatted plain-text button
    const copyBtn = body.createEl("button", {
      cls: "aie-act-btn aie-act-copy",
      attr: { "aria-label": t("inspector.copy") },
    });
    setIcon(copyBtn.createSpan({ cls: "aie-icon" }), "copy");
    copyBtn.createSpan({ text: t("inspector.copy") });
    this.registerDomEvent(copyBtn, "click", (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      void navigator.clipboard.writeText(plainText(row.entry));
      new Notice(t("inspector.copied"));
    });

    // Insert at the top of the list
    if (this.listEl.firstChild) {
      this.listEl.insertBefore(details, this.listEl.firstChild);
    } else {
      this.listEl.appendChild(details);
    }

    this.updateRow(row);
  }

  private updateRow(row: Row): void {
    const { entry, summary, term, prompt } = row;
    summary.empty();

    // 1. Chevron
    const chevron = summary.createSpan({ cls: "aie-act-chevron" });
    setIcon(chevron, "chevron-right");

    // 2. Action / Tool Title
    const title = summary.createSpan({ cls: "aie-act-title" });
    title.createEl("code", { text: displayTool(entry), cls: "aie-act-tool" });

    // 3. Target / Endpoint
    summary.createSpan({ text: entry.target, cls: "aie-act-target", attr: { title: entry.target } });

    // 4. Chips (Module & Alerts)
    const chips = summary.createSpan({ cls: "aie-act-chips" });
    if (entry.moduleId) {
      const chip = chips.createSpan({ cls: "aie-act-chip" });
      setIcon(chip.createSpan({ cls: "aie-act-chip-icon" }), "box");
      chip.createSpan({ text: entry.moduleId });
    }
    if (entry.client) {
      const chip = chips.createSpan({ cls: "aie-act-chip" });
      chip.createSpan({ text: entry.client, cls: "aie-act-chip-client" });
    }
    if (entry.alert) {
      const alertChip = chips.createSpan({ cls: "aie-act-chip aie-chip-alert" });
      setIcon(alertChip.createSpan({ cls: "aie-act-chip-icon" }), "shield-alert");
      alertChip.createSpan({ text: "unrestricted" });
      setTooltip(alertChip, t("inspector.alertTooltip"));
    }

    // 5. Meta info (Status badge, Duration, Clock)
    const meta = summary.createSpan({ cls: "aie-act-meta" });
    const sClass = statusClass(entry);
    const statusBadge = meta.createSpan({ cls: `aie-act-status aie-act-status-${sClass}` });
    if (entry.running) {
      statusBadge.createSpan({ cls: "aie-act-spinner" });
      statusBadge.createSpan({ text: t("inspector.running") });
    } else {
      statusBadge.createSpan({ text: String(entry.status || 200) });
    }

    meta.createSpan({ text: formatDuration(entry) || "-", cls: "aie-act-duration aie-muted" });
    meta.createSpan({
      text: formatTime(entry.time),
      cls: "aie-act-clock aie-muted",
      attr: { title: `${new Date(entry.time).toLocaleString()} · ${entry.client || "unknown"}` },
    });

    // 6. Terminal Prompt
    prompt.empty();
    prompt.createSpan({ text: "$ ", cls: "aie-act-prompt-sign" });
    prompt.createSpan({ text: `${entry.method} ${entry.target}` });
    prompt.createSpan({ text: `  [${entry.client || "unknown"}]`, cls: "aie-act-prompt-client" });

    // 7. Terminal Content Lines
    // Keep existing lines by clearing everything after the prompt
    while (term.children.length > 1) {
      term.lastElementChild?.remove();
    }

    this.renderTerminalContent(term, entry);
  }

  private renderTerminalContent(term: HTMLElement, entry: ActivityEntry): void {
    const timeStr = formatTime(entry.time);

    // Initial step line
    this.appendTermLine(term, timeStr, "step", `Call initiated via ${entry.client || "client"}`);
    this.appendTermLine(term, timeStr, "info", `Module: ${entry.moduleId || "ai-ecosystem"} | Target: ${entry.target}`);

    // Headers
    const headers = Object.entries(entry.requestHeaders);
    if (headers.length > 0) {
      this.appendTermLine(term, timeStr, "info", "Request headers:");
      const pre = term.createEl("pre", { cls: "aie-act-data" });
      pre.setText(headers.map(([k, v]) => `${k}: ${v}`).join("\n"));
    }

    // Payload
    if (entry.payload) {
      this.appendTermLine(term, timeStr, "info", "Payload:");
      const pre = term.createEl("pre", { cls: "aie-act-data" });
      pre.setText(formatDataBlock(entry.payload));
    }

    // Output stream (e.g. script stdout/stderr)
    if (entry.output) {
      this.appendTermLine(term, timeStr, "info", "Process output:");
      const pre = term.createEl("pre", { cls: "aie-act-data aie-act-data-output" });
      pre.setText(entry.output);
    }

    // Response
    if (entry.response) {
      this.appendTermLine(term, timeStr, "info", "Response body:");
      const pre = term.createEl("pre", { cls: "aie-act-data" });
      pre.setText(formatDataBlock(entry.response));
    }

    // Final result
    if (entry.running) {
      this.appendTermLine(term, timeStr, "step", "Processing request...");
    } else {
      const isOk = entry.status >= 200 && entry.status < 400;
      const tag = isOk ? "ok" : "error";
      const dur = formatDuration(entry) || `${entry.durationMs} ms`;
      this.appendTermLine(term, timeStr, tag, `Completed with status ${entry.status} in ${dur}`);
    }
  }

  private appendTermLine(term: HTMLElement, time: string, tag: "info" | "step" | "ok" | "warn" | "error", message: string): void {
    const line = term.createDiv({ cls: `aie-act-line aie-act-${tag}` });
    line.createSpan({ text: time, cls: "aie-act-time" });
    line.createSpan({ text: tag.padEnd(5), cls: "aie-act-tag" });
    line.createSpan({ text: message, cls: "aie-act-msg" });
  }

  private refreshVisibility(): void {
    const all = this.source();
    let visibleCount = 0;

    for (const [id, row] of this.rows) {
      const entry = all.find((e) => e.id === id);
      if (!entry) {
        row.el.addClass("aie-hidden");
        continue;
      }

      const matchesStatus =
        this.statusFilter === "all"
          ? true
          : this.statusFilter === "running"
          ? entry.running
          : !entry.running && (entry.status >= 400 || entry.status === 0);

      const matchesModule = !this.moduleFilter || entry.moduleId === this.moduleFilter;
      const matchesClient = !this.clientFilter || entry.client === this.clientFilter;

      let matchesSearch = true;
      if (this.query.trim()) {
        const q = this.query.trim().toLowerCase();
        const hay = [entry.method, entry.target, entry.moduleId, entry.client, String(entry.status), entry.payload, entry.response, entry.output]
          .join(" ")
          .toLowerCase();
        matchesSearch = hay.includes(q);
      }

      const visible = matchesStatus && matchesModule && matchesClient && matchesSearch;
      row.el.toggleClass("aie-hidden", !visible);
      if (visible) visibleCount++;
    }

    const hasAny = all.length > 0;
    this.emptyEl.toggleClass("aie-hidden", visibleCount > 0);
    if (visibleCount === 0) {
      const titleEl = this.emptyEl.querySelector(".aie-act-empty-title");
      const descEl = this.emptyEl.querySelector(".aie-act-empty-desc");
      if (titleEl) titleEl.textContent = hasAny ? t("inspector.emptyFiltered") : t("inspector.empty");
      if (descEl) descEl.textContent = hasAny ? t("inspector.search") : t("inspector.subtitle");
    }
  }
}

// ---------- Helper functions ----------

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function displayTool(entry: ActivityEntry): string {
  if (entry.kind === "script") return `Script ${entry.method}`;
  if (entry.method === "MCP Tool Call") return entry.target;
  return entry.method;
}

function formatDataBlock(raw: string): string {
  if (!raw) return "";
  try {
    const parsed: unknown = JSON.parse(raw);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return raw;
  }
}

function plainText(e: ActivityEntry): string {
  const time = formatTime(e.time);
  const dur = formatDuration(e) || `${e.durationMs} ms`;
  const lines: string[] = [
    `$ ${e.method} ${e.target}  [${e.client || "unknown"}]`,
    `${time}  step   Request received from ${e.client || "client"}`,
    `${time}  info   Module: ${e.moduleId || "ai-ecosystem"} | Target: ${e.target}`,
  ];

  const headers = Object.entries(e.requestHeaders);
  if (headers.length > 0) {
    lines.push(`${time}  info   Headers:`);
    for (const [k, v] of headers) lines.push(`    ${k}: ${v}`);
  }

  if (e.payload) {
    lines.push(`${time}  info   Payload:`);
    lines.push(...formatDataBlock(e.payload).split("\n").map((l) => `    ${l}`));
  }

  if (e.output) {
    lines.push(`${time}  info   Process output:`);
    lines.push(...e.output.split("\n").map((l) => `    ${l}`));
  }

  if (e.response) {
    lines.push(`${time}  info   Response body:`);
    lines.push(...formatDataBlock(e.response).split("\n").map((l) => `    ${l}`));
  }

  const isOk = e.status >= 200 && e.status < 400;
  lines.push(`${time}  ${isOk ? "ok   " : "error"}  Completed with status ${e.status} in ${dur}`);
  return lines.join("\n");
}
