// The "MCP packages" block under the catalog cards: lists the packages of the GitHub repo and
// downloads or removes them. The state lives here, so a redraw of the catalog keeps it.

import { setIcon } from "obsidian";
import type { App } from "obsidian";
import { t } from "../i18n";
import { appForEntry, groupCatalogEntries } from "../mcp-packages/catalog";
import type {
  McpCatalog,
  McpCatalogEntry,
  McpCatalogGroup,
  McpPackageFile,
  McpPackageManifest,
} from "../mcp-packages/catalog";
import { defaultLogoFor } from "../mcp-packages/default-logos";
import type { McpPackageService } from "../mcp-packages/package-service";
import { McpDeleteModal } from "./mcp-delete-modal";

export interface McpPackagesSectionDeps {
  app: App;
  service: McpPackageService;
  /** Whether Environment Keys is active, which the downloaded tools need to run. */
  isEnvKeysActive: () => boolean;
}

/** Progress and feedback of one row (a package or a single tool). */
interface TaskState {
  busy: boolean;
  /** 0 to 1 while downloading. Undefined hides the bar. */
  progress?: number;
  status?: string;
  error?: boolean;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function toolKey(entry: McpCatalogEntry, file: McpPackageFile): string {
  return `tool:${entry.id}:${file.path}`;
}

export class McpPackagesSection {
  private container: HTMLElement | undefined;
  /** Elements of the last draw, removed before the next one. */
  private nodes: HTMLElement[] = [];
  /** Progress bars of the last draw, by row key. */
  private readonly bars = new Map<string, HTMLElement>();
  private started = false;
  /** Bumped on dispose: work started before it does not draw any more. */
  private token = 0;
  private catalog: McpCatalog | undefined;
  private error: string | undefined;
  private loading = true;
  private readonly expanded = new Set<string>();
  private readonly toolsLoading = new Set<string>();
  private readonly toolsErrors = new Map<string, string>();
  /** Manifests by entry id, filled on demand. */
  private readonly manifests = new Map<string, McpPackageManifest>();
  private readonly tasks = new Map<string, TaskState>();

  constructor(private readonly deps: McpPackagesSectionDeps) {}

  /** Draws the section into the container. The first call starts loading the catalog. */
  mount(container: HTMLElement): void {
    this.container = container;
    if (this.started) {
      this.draw();
      return;
    }
    this.started = true;
    void this.load();
  }

  dispose(): void {
    this.token++;
    this.container = undefined;
    this.clearNodes();
  }

  private async load(): Promise<void> {
    const token = this.token;
    this.loading = true;
    this.error = undefined;
    this.draw();
    let catalog: McpCatalog | undefined;
    let error: string | undefined;
    try {
      catalog = await this.deps.service.fetchCatalog();
    } catch (err) {
      error = t("catalog.mcp.error", { error: errorMessage(err) });
    }
    if (token !== this.token) return;
    this.catalog = catalog;
    this.error = error;
    this.loading = false;
    this.draw();
  }

  private draw(): void {
    const container = this.container;
    if (!container) return;
    this.clearNodes();
    const divider = container.createDiv({ cls: "aie-mcp-divider" });
    const section = container.createDiv({ cls: "aie-mcp-section" });
    this.nodes = [divider, section];

    section.createEl("h3", { text: t("catalog.mcp.title") });
    if (!this.deps.isEnvKeysActive()) {
      const notice = section.createEl("p", { cls: "aie-catalog-note" });
      setIcon(notice.createSpan(), "info");
      notice.createSpan({ text: t("catalog.mcp.needsEnvKeys") });
    }
    this.renderBody(section);
  }

  private clearNodes(): void {
    for (const node of this.nodes) node.remove();
    this.nodes = [];
    this.bars.clear();
  }

  private renderBody(section: HTMLElement): void {
    if (this.loading) {
      section.createDiv({ cls: "aie-mcp-status", text: t("catalog.mcp.loading") });
      return;
    }
    if (this.error) {
      section.createDiv({ cls: "aie-mcp-status aie-mcp-status-error", text: this.error });
      const actions = section.createDiv({ cls: "aie-mcp-actions" });
      this.actionButton(actions, "refresh-cw", t("catalog.mcp.retry"), () => void this.load());
      return;
    }
    if (!this.catalog || this.catalog.packages.length === 0) {
      section.createDiv({ cls: "aie-mcp-status", text: t("catalog.mcp.empty") });
      return;
    }
    this.renderApps(section, this.catalog);
  }

  private renderApps(parent: HTMLElement, catalog: McpCatalog): void {
    const apps = new Map<string, McpCatalogGroup[]>();
    for (const group of groupCatalogEntries(catalog.packages)) {
      const name = appForEntry(group.entries[0])?.name ?? t("catalog.mcp.otherApp");
      const list = apps.get(name) ?? [];
      list.push(group);
      apps.set(name, list);
    }
    for (const [name, groups] of apps) {
      const app = parent.createDiv({ cls: "aie-mcp-app" });
      app.createEl("h4", { cls: "aie-mcp-app-title", text: name });
      const grid = app.createDiv({ cls: "aie-mcp-grid" });
      for (const group of groups) this.renderGroup(grid, group);
    }
  }

  private renderGroup(parent: HTMLElement, group: McpCatalogGroup): void {
    const task = this.task(group.id);
    const expanded = this.expanded.has(group.id);
    const installed = group.entries.every((entry) => this.deps.service.isInstalled(entry.id));

    const row = parent.createDiv({ cls: "aie-mcp-card" });
    const head = row.createDiv({ cls: "aie-mcp-card-head" });

    const info = head.createDiv({ cls: "aie-mcp-card-info" });
    const logo = defaultLogoFor(group.logo);
    if (logo) info.createEl("img", { cls: "aie-mcp-logo", attr: { src: logo, alt: "" } });
    else setIcon(info.createSpan({ cls: "aie-mcp-logo-fallback" }), "package");

    const titles = info.createDiv({ cls: "aie-mcp-card-titles" });
    titles.createSpan({ cls: "aie-mcp-name", text: group.name });
    titles.createSpan({ cls: "aie-mcp-meta", text: t("catalog.mcp.toolCount", { n: group.toolCount }) });

    const actions = head.createDiv({ cls: "aie-mcp-card-actions" });
    const toggle = actions.createEl("button", {
      cls: "clickable-icon aie-catalog-btn",
      attr: { "aria-label": t(expanded ? "catalog.mcp.hideTools" : "catalog.mcp.showTools") },
    });
    setIcon(toggle, expanded ? "list-x" : "list");
    toggle.addEventListener("click", () => this.toggleTools(group));

    const action = this.actionButton(
      actions,
      installed ? "trash-2" : "download",
      t(installed ? "catalog.mcp.delete" : "catalog.mcp.download"),
      () => {
        if (installed) void this.askDelete(group);
        else void this.download(group);
      },
    );
    action.addClass(installed ? "mod-warning" : "mod-cta");
    action.disabled = task.busy;

    this.renderProgress(row, group.id, task);
    if (expanded) this.renderTools(row, group);
  }

  private renderProgress(parent: HTMLElement, key: string, task: TaskState): void {
    const progress = parent.createDiv({ cls: "aie-mcp-progress" });
    if (task.progress === undefined) progress.hide();
    const bar = progress.createDiv({ cls: "aie-mcp-progress-bar" });
    bar.setCssProps({ width: `${Math.round((task.progress ?? 0) * 100)}%` });
    this.bars.set(key, bar);
    parent.createDiv({
      cls: task.error ? "aie-mcp-status aie-mcp-status-error" : "aie-mcp-status",
      text: task.status ?? "",
    });
  }

  private renderTools(parent: HTMLElement, group: McpCatalogGroup): void {
    const tools = parent.createDiv({ cls: "aie-mcp-tools" });
    if (this.toolsLoading.has(group.id)) {
      tools.createDiv({ cls: "aie-mcp-status", text: t("catalog.mcp.loadingTools") });
      return;
    }
    const error = this.toolsErrors.get(group.id);
    if (error) {
      tools.createDiv({ cls: "aie-mcp-status aie-mcp-status-error", text: error });
      return;
    }
    for (const entry of group.entries) {
      const manifest = this.manifests.get(entry.id);
      if (!manifest) continue;
      for (const file of manifest.files) {
        if (file.kind === "tool") this.renderTool(tools, group, entry, manifest, file);
      }
    }
  }

  private renderTool(
    parent: HTMLElement,
    group: McpCatalogGroup,
    entry: McpCatalogEntry,
    manifest: McpPackageManifest,
    file: McpPackageFile,
  ): void {
    const key = toolKey(entry, file);
    const task = this.task(key);
    const line = parent.createDiv({ cls: "aie-mcp-actions" });
    line.createSpan({ text: file.title ?? file.name ?? file.path });
    if (file.writes) line.createSpan({ cls: "aie-mcp-badge", text: t("catalog.mcp.writes") });
    const button = this.actionButton(line, "download", t("catalog.mcp.download"), () =>
      this.downloadTool(entry, manifest, file),
    );
    button.disabled = task.busy || this.task(group.id).busy;
    this.renderProgress(parent, key, task);
  }

  private toggleTools(group: McpCatalogGroup): void {
    if (this.expanded.delete(group.id)) {
      this.draw();
      return;
    }
    this.expanded.add(group.id);
    void this.loadTools(group);
  }

  private async loadTools(group: McpCatalogGroup): Promise<void> {
    const token = this.token;
    this.toolsLoading.add(group.id);
    this.toolsErrors.delete(group.id);
    this.draw();
    let error: string | undefined;
    try {
      for (const entry of group.entries) await this.manifestFor(entry);
    } catch (err) {
      error = t("catalog.mcp.toolsError", { error: errorMessage(err) });
    }
    if (token !== this.token) return;
    this.toolsLoading.delete(group.id);
    if (error) this.toolsErrors.set(group.id, error);
    this.draw();
  }

  /** The package manifest, from the cache or from the repo. */
  private async manifestFor(entry: McpCatalogEntry): Promise<McpPackageManifest> {
    const cached = this.manifests.get(entry.id);
    if (cached) return cached;
    const manifest = await this.deps.service.fetchManifest(entry);
    this.manifests.set(entry.id, manifest);
    return manifest;
  }

  private download(group: McpCatalogGroup): void {
    void this.run(
      group.id,
      async () => {
        const work: Array<{ entry: McpCatalogEntry; manifest: McpPackageManifest }> = [];
        for (const entry of group.entries) work.push({ entry, manifest: await this.manifestFor(entry) });
        const total = work.reduce((sum, item) => sum + item.manifest.files.length, 0);
        let written = 0;
        let skipped = 0;
        let before = 0;
        for (const { entry, manifest } of work) {
          // Progress of all entries counts as one bar: this entry starts after the ones before it.
          const offset = before;
          const result = await this.deps.service.install(entry, manifest, "all", (done) =>
            this.setProgress(group.id, (offset + done) / Math.max(total, 1)),
          );
          written += result.written;
          skipped += result.skipped;
          before += manifest.files.length;
        }
        return t("catalog.mcp.installed", { written, skipped });
      },
      true,
    );
  }

  private downloadTool(entry: McpCatalogEntry, manifest: McpPackageManifest, file: McpPackageFile): void {
    const key = toolKey(entry, file);
    void this.run(
      key,
      async () => {
        const result = await this.deps.service.install(entry, manifest, { toolPath: file.path }, (done, total) =>
          this.setProgress(key, total > 0 ? done / total : 1),
        );
        return t("catalog.mcp.installed", { written: result.written, skipped: result.skipped });
      },
      true,
    );
  }

  private async askDelete(group: McpCatalogGroup): Promise<void> {
    if (this.task(group.id).busy) return;
    const token = this.token;
    let noteCount = 0;
    for (const entry of group.entries) {
      try {
        const manifest = await this.manifestFor(entry);
        noteCount += manifest.files.filter((file) => file.kind !== "database").length;
      } catch {
        // Without its manifest the package is removed, and its notes are not counted.
      }
    }
    if (token !== this.token) return;
    new McpDeleteModal(this.deps.app, {
      name: group.name,
      noteCount,
      onConfirm: (deleteNotes) => void this.remove(group, deleteNotes),
    }).open();
  }

  private remove(group: McpCatalogGroup, deleteNotes: boolean): Promise<void> {
    return this.run(group.id, async () => {
      for (const entry of group.entries) {
        await this.deps.service.remove(entry, this.manifests.get(entry.id), deleteNotes);
      }
      return t("catalog.mcp.deleted");
    });
  }

  /** Runs one busy job on a row and shows its status, or its error, when it ends. */
  private async run(key: string, job: () => Promise<string>, withProgress = false): Promise<void> {
    if (this.task(key).busy) return;
    const token = this.token;
    this.patch(key, { busy: true, progress: withProgress ? 0 : undefined, status: undefined, error: false });
    let status: string;
    let error = false;
    try {
      status = await job();
    } catch (err) {
      status = errorMessage(err);
      error = true;
    }
    if (token !== this.token) return;
    this.patch(key, { busy: false, progress: undefined, status, error });
  }

  private actionButton(parent: HTMLElement, icon: string, label: string, onClick: () => void): HTMLButtonElement {
    const button = parent.createEl("button", { cls: "aie-catalog-btn" });
    setIcon(button.createSpan(), icon);
    button.createSpan({ text: label });
    button.addEventListener("click", onClick);
    return button;
  }

  private task(key: string): TaskState {
    let state = this.tasks.get(key);
    if (!state) {
      state = { busy: false };
      this.tasks.set(key, state);
    }
    return state;
  }

  private patch(key: string, changes: Partial<TaskState>): void {
    Object.assign(this.task(key), changes);
    this.draw();
  }

  /** Moves a running bar without redrawing the section. */
  private setProgress(key: string, ratio: number): void {
    this.task(key).progress = ratio;
    this.bars.get(key)?.setCssProps({ width: `${Math.round(ratio * 100)}%` });
  }
}
