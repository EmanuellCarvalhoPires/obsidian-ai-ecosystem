// Modal that inspects all tools and requests of an MCP package directly from its SQLite .db,
// providing search, method filters, 50-items-per-page pagination, and an expandable property inspector for every record.

import { Modal, setIcon } from "obsidian";
import type { App } from "obsidian";
import { t } from "../i18n";
import type { McpCatalogGroup } from "../mcp-packages/catalog";
import { defaultLogoFor } from "../mcp-packages/default-logos";
import type { RawToolRecord } from "../mcp-packages/package-db";
import type { McpPackageService } from "../mcp-packages/package-service";

export class McpPackageToolsModal extends Modal {
  private filterText = "";
  private selectedMethod = "all";
  private tools: RawToolRecord[] = [];
  private expandedIds = new Set<string>();
  private listEl: HTMLElement | undefined;
  private countEl: HTMLElement | undefined;
  private methodPillsContainer: HTMLElement | undefined;
  private paginationEl: HTMLElement | undefined;

  private currentPage = 1;
  private readonly pageSize = 50;

  constructor(
    app: App,
    private readonly group: McpCatalogGroup,
    private readonly service: McpPackageService,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl, group, service } = this;
    this.modalEl.addClass("aie-tools-modal-dialog");
    contentEl.addClass("aie-tools-modal");

    this.tools = service.getRawToolsForGroup(group);

    // Header in Obsidian modal title
    this.setupTitle();

    const isInstalled = group.entries.some((e) => service.isInstalled(e.id));
    if (!isInstalled) {
      contentEl.createDiv({
        cls: "aie-mcp-status aie-mcp-status-error",
        text: t("catalog.mcp.toolsModalNotInstalled"),
      });
      return;
    }

    if (this.tools.length === 0) {
      contentEl.createDiv({
        cls: "aie-mcp-status",
        text: t("catalog.mcp.toolsModalEmpty"),
      });
      return;
    }

    // Build Toolbar
    this.buildToolbar(contentEl);

    // List container
    this.listEl = contentEl.createDiv({ cls: "aie-tools-list" });

    // Pagination footer
    this.paginationEl = contentEl.createDiv({ cls: "aie-tools-pagination" });

    this.renderList();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private setupTitle(): void {
    this.titleEl.empty();
    this.titleEl.addClass("aie-tools-modal-title-wrapper");

    const logo = defaultLogoFor(this.group.logo);
    if (logo) {
      this.titleEl.createEl("img", {
        cls: "aie-tools-modal-header-logo",
        attr: { src: logo, alt: "" },
      });
    } else {
      setIcon(this.titleEl.createSpan({ cls: "aie-tools-modal-header-logo-fallback" }), "package");
    }

    const titleText = this.titleEl.createDiv({ cls: "aie-tools-modal-header-text" });
    titleText.createSpan({ cls: "aie-tools-modal-header-name", text: this.group.name });
    titleText.createSpan({
      cls: "aie-tools-header-count-pill",
      text: t("catalog.mcp.toolsModalCountBadge", { n: this.tools.length }),
    });
  }

  private buildToolbar(parent: HTMLElement): void {
    const toolbar = parent.createDiv({ cls: "aie-tools-toolbar" });

    // Primary row: Search input + method chips
    const primaryRow = toolbar.createDiv({ cls: "aie-tools-toolbar-row" });

    const searchWrap = primaryRow.createDiv({ cls: "aie-tools-search-wrap" });
    setIcon(searchWrap.createSpan({ cls: "aie-tools-search-icon" }), "search");
    const input = searchWrap.createEl("input", {
      type: "search",
      cls: "aie-tools-search-input",
      attr: { placeholder: t("catalog.mcp.toolsModalFilter"), spellcheck: "false" },
    });
    input.addEventListener("input", () => {
      this.filterText = input.value.trim().toLowerCase();
      this.currentPage = 1;
      this.renderList();
    });

    // Method filter chips
    const methods = this.availableMethods();
    if (methods.length > 0) {
      this.methodPillsContainer = primaryRow.createDiv({ cls: "aie-tools-method-filters" });
      this.renderMethodPills();
    }

    // Secondary row: summary count + bulk actions
    const subRow = toolbar.createDiv({ cls: "aie-tools-toolbar-subrow" });
    this.countEl = subRow.createSpan({ cls: "aie-tools-counter" });

    const actions = subRow.createDiv({ cls: "aie-tools-actions" });

    const expandAllBtn = actions.createEl("button", {
      cls: "aie-tool-btn",
    });
    setIcon(expandAllBtn.createSpan(), "chevrons-down-up");
    expandAllBtn.createSpan({ text: t("catalog.mcp.toolsModalExpandAll") });
    expandAllBtn.addEventListener("click", () => {
      const pageItems = this.currentPageItems(this.filteredTools());
      for (const tool of pageItems) {
        this.expandedIds.add(tool.id);
      }
      this.renderList();
    });

    const collapseAllBtn = actions.createEl("button", {
      cls: "aie-tool-btn",
    });
    setIcon(collapseAllBtn.createSpan(), "chevrons-up-down");
    collapseAllBtn.createSpan({ text: t("catalog.mcp.toolsModalCollapseAll") });
    collapseAllBtn.addEventListener("click", () => {
      this.expandedIds.clear();
      this.renderList();
    });
  }

  private availableMethods(): string[] {
    const set = new Set<string>();
    for (const t of this.tools) {
      if (t.method) {
        set.add(t.method.toUpperCase());
      }
    }
    const order = ["GET", "POST", "PUT", "PATCH", "DELETE"];
    return Array.from(set).sort((a, b) => {
      const ia = order.indexOf(a);
      const ib = order.indexOf(b);
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1;
      if (ib !== -1) return 1;
      return a.localeCompare(b);
    });
  }

  private renderMethodPills(): void {
    if (!this.methodPillsContainer) return;
    this.methodPillsContainer.empty();

    const allBtn = this.methodPillsContainer.createEl("button", {
      cls: `aie-method-pill ${this.selectedMethod === "all" ? "is-active" : ""}`,
      text: t("catalog.mcp.toolsModalAll"),
    });
    allBtn.addEventListener("click", () => {
      this.selectedMethod = "all";
      this.currentPage = 1;
      this.renderMethodPills();
      this.renderList();
    });

    for (const m of this.availableMethods()) {
      const count = this.tools.filter((t) => t.method?.toUpperCase() === m).length;
      const btn = this.methodPillsContainer.createEl("button", {
        cls: `aie-method-pill mod-${m.toLowerCase()} ${this.selectedMethod === m ? "is-active" : ""}`,
      });
      btn.createSpan({ cls: "aie-method-pill-label", text: m });
      btn.createSpan({ cls: "aie-method-pill-count", text: String(count) });
      btn.addEventListener("click", () => {
        this.selectedMethod = this.selectedMethod === m ? "all" : m;
        this.currentPage = 1;
        this.renderMethodPills();
        this.renderList();
      });
    }
  }

  private filteredTools(): RawToolRecord[] {
    let result = this.tools;

    if (this.selectedMethod !== "all") {
      result = result.filter((t) => t.method?.toUpperCase() === this.selectedMethod);
    }

    if (this.filterText) {
      const q = this.filterText;
      result = result.filter((t) => {
        if (t.id.toLowerCase().includes(q)) return true;
        if (t.title.toLowerCase().includes(q)) return true;
        if (t.method && t.method.toLowerCase().includes(q)) return true;
        if (t.path && t.path.toLowerCase().includes(q)) return true;
        if (t.description && t.description.toLowerCase().includes(q)) return true;
        return false;
      });
    }

    return result;
  }

  private currentPageItems(filtered: RawToolRecord[]): RawToolRecord[] {
    const start = (this.currentPage - 1) * this.pageSize;
    return filtered.slice(start, start + this.pageSize);
  }

  private renderList(): void {
    const listEl = this.listEl;
    if (!listEl) return;
    listEl.empty();

    const filtered = this.filteredTools();
    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / this.pageSize));

    if (this.currentPage > totalPages) {
      this.currentPage = totalPages;
    }

    const startIdx = total === 0 ? 0 : (this.currentPage - 1) * this.pageSize + 1;
    const endIdx = Math.min(this.currentPage * this.pageSize, total);

    if (this.countEl) {
      if (total === 0) {
        this.countEl.setText(t("catalog.mcp.toolsModalShowing", { shown: 0, total: this.tools.length }));
      } else {
        this.countEl.setText(
          t("catalog.mcp.toolsModalShowingRange", {
            start: startIdx,
            end: endIdx,
            total,
          }),
        );
      }
    }

    if (total === 0) {
      const emptyBox = listEl.createDiv({ cls: "aie-tools-empty" });
      setIcon(emptyBox.createSpan({ cls: "aie-tools-empty-icon" }), "search-x");
      emptyBox.createSpan({ text: t("catalog.mcp.toolsModalEmpty") });
      this.renderPagination(0, 1);
      return;
    }

    const pageItems = this.currentPageItems(filtered);
    for (const tool of pageItems) {
      this.renderToolCard(listEl, tool);
    }

    this.renderPagination(total, totalPages);
  }

  private renderPagination(totalItems: number, totalPages: number): void {
    if (!this.paginationEl) return;
    this.paginationEl.empty();

    if (totalPages <= 1) {
      this.paginationEl.hide();
      return;
    }

    this.paginationEl.show();

    // Left info
    const info = this.paginationEl.createDiv({ cls: "aie-pagination-info" });
    info.createSpan({
      text: t("catalog.mcp.toolsModalPageInfo", {
        page: this.currentPage,
        total: totalPages,
      }),
    });

    // Right navigation controls
    const controls = this.paginationEl.createDiv({ cls: "aie-pagination-controls" });

    // First page
    const firstBtn = controls.createEl("button", {
      cls: "aie-pagination-btn",
      attr: { "aria-label": t("catalog.mcp.toolsModalFirstPage") },
    });
    setIcon(firstBtn.createSpan(), "chevrons-left");
    firstBtn.disabled = this.currentPage === 1;
    firstBtn.addEventListener("click", () => this.goToPage(1));

    // Prev page
    const prevBtn = controls.createEl("button", {
      cls: "aie-pagination-btn",
      attr: { "aria-label": t("catalog.mcp.toolsModalPrevPage") },
    });
    setIcon(prevBtn.createSpan(), "chevron-left");
    prevBtn.createSpan({ text: t("catalog.mcp.toolsModalPrevPage") });
    prevBtn.disabled = this.currentPage === 1;
    prevBtn.addEventListener("click", () => this.goToPage(this.currentPage - 1));

    // Page number pills
    const pagesContainer = controls.createDiv({ cls: "aie-pagination-pages" });
    const maxButtons = 5;
    let startPage = Math.max(1, this.currentPage - Math.floor(maxButtons / 2));
    let endPage = startPage + maxButtons - 1;
    if (endPage > totalPages) {
      endPage = totalPages;
      startPage = Math.max(1, endPage - maxButtons + 1);
    }

    for (let p = startPage; p <= endPage; p++) {
      const pageBtn = pagesContainer.createEl("button", {
        cls: `aie-page-pill ${p === this.currentPage ? "is-active" : ""}`,
        text: String(p),
      });
      pageBtn.addEventListener("click", () => this.goToPage(p));
    }

    // Next page
    const nextBtn = controls.createEl("button", {
      cls: "aie-pagination-btn",
      attr: { "aria-label": t("catalog.mcp.toolsModalNextPage") },
    });
    nextBtn.createSpan({ text: t("catalog.mcp.toolsModalNextPage") });
    setIcon(nextBtn.createSpan(), "chevron-right");
    nextBtn.disabled = this.currentPage === totalPages;
    nextBtn.addEventListener("click", () => this.goToPage(this.currentPage + 1));

    // Last page
    const lastBtn = controls.createEl("button", {
      cls: "aie-pagination-btn",
      attr: { "aria-label": t("catalog.mcp.toolsModalLastPage") },
    });
    setIcon(lastBtn.createSpan(), "chevrons-right");
    lastBtn.disabled = this.currentPage === totalPages;
    lastBtn.addEventListener("click", () => this.goToPage(totalPages));
  }

  private goToPage(page: number): void {
    this.currentPage = page;
    this.renderList();
    if (this.listEl) {
      this.listEl.scrollTop = 0;
    }
  }

  private renderToolCard(parent: HTMLElement, tool: RawToolRecord): void {
    const isExpanded = this.expandedIds.has(tool.id);
    const card = parent.createDiv({ cls: `aie-tool-card ${isExpanded ? "is-expanded" : ""}` });

    // Clickable header row
    const row = card.createDiv({ cls: "aie-tool-row clickable" });

    // Left block: Chevron + Method badge + Title + Route
    const left = row.createDiv({ cls: "aie-tool-row-left" });

    const chevron = left.createSpan({ cls: "aie-tool-chevron" });
    setIcon(chevron, "chevron-right");

    if (tool.method) {
      const method = tool.method.toUpperCase();
      left.createSpan({
        cls: `aie-method-badge aie-method-${method.toLowerCase()}`,
        text: method,
      });
    } else {
      left.createSpan({
        cls: "aie-method-badge aie-method-tool",
        text: "TOOL",
      });
    }

    left.createSpan({ cls: "aie-tool-title", text: tool.title });

    if (tool.path) {
      left.createEl("code", { cls: "aie-tool-path", text: tool.path });
    }

    // Right block: Writes badge + ID pill
    const right = row.createDiv({ cls: "aie-tool-row-right" });

    const writes =
      tool.raw.writes_data === 1 ||
      (typeof tool.raw.tags === "string" && tool.raw.tags.includes("write"));
    if (writes) {
      const writesBadge = right.createSpan({ cls: "aie-tool-writes-badge" });
      setIcon(writesBadge.createSpan(), "edit");
      writesBadge.createSpan({ text: t("catalog.mcp.writes") });
    }

    right.createEl("code", { cls: "aie-tool-id-pill", text: tool.id });

    row.addEventListener("click", () => {
      if (this.expandedIds.has(tool.id)) {
        this.expandedIds.delete(tool.id);
      } else {
        this.expandedIds.add(tool.id);
      }
      this.renderList();
    });

    if (isExpanded) {
      this.renderToolDetails(card, tool);
    }
  }

  private renderToolDetails(parent: HTMLElement, tool: RawToolRecord): void {
    const details = parent.createDiv({ cls: "aie-tool-details" });

    // If description exists, show callout
    if (tool.description) {
      const descBox = details.createDiv({ cls: "aie-tool-desc-box" });
      descBox.createDiv({ cls: "aie-tool-desc-text", text: tool.description });
    }

    // Meta bar: Table, category, doc link
    const metaBar = details.createDiv({ cls: "aie-tool-meta-bar" });
    const tableBadge = metaBar.createDiv({ cls: "aie-tool-meta-item" });
    tableBadge.createSpan({ cls: "aie-tool-meta-label", text: t("catalog.mcp.toolsModalTable") + ":" });
    tableBadge.createEl("code", { cls: "aie-tool-meta-code", text: tool.table });

    const docUrl = (tool.raw.doc_url as string | undefined) || (tool.linkedRequest?.doc_url as string | undefined);
    if (docUrl) {
      const docLink = metaBar.createEl("a", {
        cls: "aie-tool-doc-btn",
        attr: { href: docUrl, target: "_blank", rel: "noopener" },
      });
      setIcon(docLink.createSpan(), "external-link");
      docLink.createSpan({ text: t("catalog.mcp.toolsModalDocLink") });
    }

    // Property inspector table
    const tableWrap = details.createDiv({ cls: "aie-tool-table-wrap" });
    this.renderPropsTable(tableWrap, tool.raw);

    // If linked request row exists, show second section
    if (tool.linkedRequest) {
      const linkedSection = details.createDiv({ cls: "aie-tool-linked-section" });
      const linkedTitle = linkedSection.createDiv({ cls: "aie-tool-section-title" });
      setIcon(linkedTitle.createSpan(), "link");
      linkedTitle.createSpan({ text: t("catalog.mcp.toolsModalLinkedRequest") });
      const linkedTableWrap = linkedSection.createDiv({ cls: "aie-tool-table-wrap" });
      this.renderPropsTable(linkedTableWrap, tool.linkedRequest);
    }
  }

  private renderPropsTable(parent: HTMLElement, data: Record<string, unknown>): void {
    const table = parent.createEl("table", { cls: "aie-tool-table" });
    const tbody = table.createEl("tbody");

    for (const [key, value] of Object.entries(data)) {
      const tr = tbody.createEl("tr");
      tr.createEl("th", { cls: "aie-prop-th", text: key });
      const td = tr.createEl("td", { cls: "aie-prop-td" });
      this.renderPropValue(td, key, value);
    }
  }

  private renderPropValue(parent: HTMLElement, key: string, value: unknown): void {
    if (value === null || value === undefined || value === "") {
      parent.createSpan({ cls: "aie-val-empty", text: "—" });
      return;
    }

    if (typeof value === "string") {
      const trimmed = value.trim();

      // Check if it's tags array
      if (key === "tags" && trimmed.startsWith("[") && trimmed.endsWith("]")) {
        try {
          const parsed: unknown = JSON.parse(trimmed);
          if (Array.isArray(parsed)) {
            const tagsWrap = parent.createDiv({ cls: "aie-tags-wrap" });
            for (const tag of parsed) {
              tagsWrap.createSpan({ cls: "aie-tag-chip", text: String(tag) });
            }
            return;
          }
        } catch {
          // fall through
        }
      }

      // Check if JSON schema or object
      if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
        try {
          const parsed: unknown = JSON.parse(trimmed);
          this.renderJsonBlock(parent, JSON.stringify(parsed, null, 2));
          return;
        } catch {
          // fall through to text
        }
      }

      // URL
      if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
        const link = parent.createEl("a", {
          cls: "aie-val-url",
          attr: { href: trimmed, target: "_blank", rel: "noopener" },
        });
        link.createSpan({ text: trimmed });
        setIcon(link.createSpan({ cls: "aie-link-icon" }), "external-link");
        return;
      }

      // Multiline text
      if (trimmed.includes("\n")) {
        parent.createDiv({ cls: "aie-val-multiline", text: trimmed });
        return;
      }

      parent.createSpan({ cls: "aie-val-plain", text: trimmed });
      return;
    }

    if (typeof value === "boolean") {
      parent.createSpan({
        cls: `aie-val-bool ${value ? "is-true" : "is-false"}`,
        text: value ? "true" : "false",
      });
      return;
    }

    if (typeof value === "number") {
      parent.createEl("code", { cls: "aie-val-num", text: String(value) });
      return;
    }

    this.renderJsonBlock(parent, JSON.stringify(value, null, 2));
  }

  private renderJsonBlock(parent: HTMLElement, jsonString: string): void {
    const wrap = parent.createDiv({ cls: "aie-json-block" });
    const header = wrap.createDiv({ cls: "aie-json-header" });
    header.createSpan({ cls: "aie-json-label", text: "JSON" });

    const copyBtn = header.createEl("button", {
      cls: "aie-json-copy-btn",
    });
    setIcon(copyBtn.createSpan(), "copy");
    const copyLabel = copyBtn.createSpan({ text: t("catalog.mcp.toolsModalCopyJson") });

    copyBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      void navigator.clipboard.writeText(jsonString);
      copyLabel.setText(t("catalog.mcp.toolsModalCopied"));
      copyBtn.addClass("is-copied");
      window.setTimeout(() => {
        copyLabel.setText(t("catalog.mcp.toolsModalCopyJson"));
        copyBtn.removeClass("is-copied");
      }, 1800);
    });

    const pre = wrap.createEl("pre", { cls: "aie-json-pre" });
    pre.createEl("code", { text: jsonString });
  }
}
