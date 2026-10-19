import { requestUrl, type App } from "obsidian";
import type { CatalogEntry, ModuleInstallState } from "../types";
import { isAllowedRepo } from "./catalog-service";
import { compareVersions, isAtLeast } from "./semver";

export interface PluginManifestLike {
  id: string;
  name?: string;
  version: string;
  minAppVersion?: string;
  [key: string]: unknown;
}

export type LatestRelease = { version: string; manifest: PluginManifestLike } | { error: string };

export type InstallResult =
  | { ok: true; method: "internal" | "fallback" }
  | { ok: false; method: "store-page"; error: string };

export class HttpError extends Error {
  constructor(public readonly status: number) {
    super(`HTTP ${status}`);
  }
}

/** The undocumented part of app.plugins used here. Every member is checked at run time. */
interface PluginsInternal {
  manifests?: Record<string, PluginManifestLike | undefined>;
  enabledPlugins?: Set<string>;
  isEnabled?: () => boolean;
  installPlugin?: (repo: string, version: string, manifest: PluginManifestLike) => Promise<void>;
  loadManifests?: () => Promise<void>;
  enablePluginAndSave?: (id: string) => Promise<boolean>;
  enablePlugin?: (id: string) => Promise<void>;
  disablePlugin?: (id: string) => Promise<void>;
}

interface SettingInternal {
  open?: () => void;
  openTabById?: (id: string) => void;
}

const RELEASE_TTL_MS = 10 * 60 * 1000;
const NO_RELEASE = "No release published yet";

async function defaultFetchText(url: string): Promise<string> {
  const res = await requestUrl({ url, throw: false });
  if (res.status >= 400) throw new HttpError(res.status);
  return res.text;
}

async function defaultFetchJson(url: string): Promise<unknown> {
  return JSON.parse(await defaultFetchText(url)) as unknown;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export interface InstallerOptions {
  app: App;
  ecosystemVersion: string;
  obsidianVersion: string;
  isRegistered: (id: string) => boolean;
  fetchJson?: (url: string) => Promise<unknown>;
  fetchText?: (url: string) => Promise<string>;
  openUrl?: (url: string) => void;
}

export class InstallerService {
  private readonly app: App;
  private readonly ecosystemVersion: string;
  private readonly obsidianVersion: string;
  private readonly isRegistered: (id: string) => boolean;
  private readonly fetchJson: (url: string) => Promise<unknown>;
  private readonly fetchText: (url: string) => Promise<string>;
  private readonly openUrl: (url: string) => void;
  private readonly installing = new Set<string>();
  private readonly releaseCache = new Map<string, { at: number; result: LatestRelease }>();

  constructor(opts: InstallerOptions) {
    this.app = opts.app;
    this.ecosystemVersion = opts.ecosystemVersion;
    this.obsidianVersion = opts.obsidianVersion;
    this.isRegistered = opts.isRegistered;
    this.fetchJson = opts.fetchJson ?? defaultFetchJson;
    this.fetchText = opts.fetchText ?? defaultFetchText;
    this.openUrl = opts.openUrl ?? ((url) => void activeWindow.open(url));
  }

  private get plugins(): PluginsInternal {
    return (this.app as unknown as { plugins?: PluginsInternal }).plugins ?? {};
  }

  async getLatestRelease(entry: CatalogEntry, force = false): Promise<LatestRelease> {
    const cached = this.releaseCache.get(entry.id);
    if (!force && cached && Date.now() - cached.at < RELEASE_TTL_MS) return cached.result;
    const result = await this.fetchLatest(entry);
    this.releaseCache.set(entry.id, { at: Date.now(), result });
    return result;
  }

  private async fetchLatest(entry: CatalogEntry): Promise<LatestRelease> {
    if (!isAllowedRepo(entry.repo)) return { error: "Repository is not allowed" };
    try {
      const rel = (await this.fetchJson(`https://api.github.com/repos/${entry.repo}/releases/latest`)) as {
        tag_name?: unknown;
      } | null;
      const tag = typeof rel?.tag_name === "string" ? rel.tag_name : "";
      if (!tag) return { error: NO_RELEASE };
      const manifest = (await this.fetchJson(
        `https://github.com/${entry.repo}/releases/download/${tag}/manifest.json`,
      )) as PluginManifestLike | null;
      if (!manifest || typeof manifest !== "object" || typeof manifest.id !== "string") {
        return { error: "The release has no valid manifest.json" };
      }
      if (manifest.id !== entry.id) {
        return { error: `The release manifest id (${manifest.id}) does not match ${entry.id}` };
      }
      if (typeof manifest.version !== "string" || !manifest.version) {
        return { error: "The release manifest has no version" };
      }
      if (manifest.minAppVersion && !isAtLeast(this.obsidianVersion, manifest.minAppVersion)) {
        return { error: `Requires Obsidian ${manifest.minAppVersion} or newer` };
      }
      return { version: tag, manifest };
    } catch (err) {
      if (err instanceof HttpError && err.status === 404) return { error: NO_RELEASE };
      return { error: errorMessage(err) };
    }
  }

  getState(entry: CatalogEntry, latest?: string): ModuleInstallState {
    if (compareVersions(entry.minEcosystemVersion, this.ecosystemVersion) > 0) {
      return { kind: "unavailable", reason: `Requires AI Ecosystem ${entry.minEcosystemVersion}` };
    }
    const p = this.plugins;
    if (typeof p.isEnabled === "function" && !p.isEnabled()) {
      return { kind: "unavailable", reason: "Community plugins are turned off (restricted mode)" };
    }
    if (this.installing.has(entry.id)) return { kind: "installing" };
    const installed = p.manifests?.[entry.id];
    if (!installed) return { kind: "not-installed", latestVersion: latest };
    const installedVersion = installed.version;
    const enabled = p.enabledPlugins?.has(entry.id) ?? false;
    if (latest && compareVersions(latest, installedVersion) > 0) {
      return { kind: "update-available", installedVersion, latestVersion: latest, enabled };
    }
    if (enabled) {
      return { kind: "active", installedVersion, latestVersion: latest, registered: this.isRegistered(entry.id) };
    }
    return { kind: "installed-disabled", installedVersion, latestVersion: latest };
  }

  async install(entry: CatalogEntry): Promise<InstallResult> {
    return this.run(entry, "install");
  }

  async update(entry: CatalogEntry): Promise<InstallResult> {
    return this.run(entry, "update");
  }

  async enable(entry: CatalogEntry): Promise<{ ok: true } | { ok: false; error: string }> {
    if (!isAllowedRepo(entry.repo)) return { ok: false, error: "Repository is not allowed" };
    try {
      await this.enablePlugin(entry.id);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: errorMessage(err) };
    }
  }

  openStorePage(id: string): void {
    this.openUrl(`obsidian://show-plugin?id=${encodeURIComponent(id)}`);
  }

  openPluginSettings(id: string): void {
    const setting = (this.app as unknown as { setting?: SettingInternal }).setting;
    if (!setting) return;
    if (typeof setting.open === "function") setting.open();
    if (typeof setting.openTabById === "function") setting.openTabById(id);
  }

  private async run(entry: CatalogEntry, mode: "install" | "update"): Promise<InstallResult> {
    if (!isAllowedRepo(entry.repo)) {
      return { ok: false, method: "store-page", error: "Repository is not allowed" };
    }
    if (this.installing.has(entry.id)) {
      return { ok: false, method: "store-page", error: "Already installing" };
    }
    this.installing.add(entry.id);
    try {
      const latest = await this.getLatestRelease(entry, true);
      if ("error" in latest) {
        if (latest.error !== NO_RELEASE) this.openStorePage(entry.id);
        return { ok: false, method: "store-page", error: latest.error };
      }
      const wasEnabled = this.plugins.enabledPlugins?.has(entry.id) ?? false;
      let method: "internal" | "fallback" | undefined;
      let failure = "";
      try {
        if (await this.installInternal(entry, latest)) method = "internal";
      } catch (err) {
        failure = errorMessage(err);
      }
      if (!method) {
        try {
          await this.installFallback(entry, latest);
          method = "fallback";
        } catch (err) {
          failure = errorMessage(err) || failure;
        }
      }
      if (!method) {
        this.openStorePage(entry.id);
        return { ok: false, method: "store-page", error: failure || "Install failed" };
      }
      try {
        if (mode === "install") {
          await this.enablePlugin(entry.id);
        } else if (wasEnabled) {
          if (typeof this.plugins.disablePlugin === "function") await this.plugins.disablePlugin(entry.id);
          await this.enablePlugin(entry.id);
        }
      } catch {
        // The files are in place; the user can still click Enable.
      }
      return { ok: true, method };
    } finally {
      this.installing.delete(entry.id);
    }
  }

  private async installInternal(
    entry: CatalogEntry,
    latest: { version: string; manifest: PluginManifestLike },
  ): Promise<boolean> {
    const p = this.plugins;
    if (typeof p.installPlugin !== "function") return false;
    await p.installPlugin(entry.repo, latest.version, latest.manifest);
    if (typeof p.loadManifests === "function") await p.loadManifests();
    return p.manifests?.[entry.id]?.version === latest.manifest.version;
  }

  private async installFallback(
    entry: CatalogEntry,
    latest: { version: string; manifest: PluginManifestLike },
  ): Promise<void> {
    const base = `https://github.com/${entry.repo}/releases/download/${latest.version}`;
    const mainJs = await this.fetchText(`${base}/main.js`);
    const manifestText = await this.fetchText(`${base}/manifest.json`);
    if (!mainJs) throw new Error("main.js is empty");
    const manifest = JSON.parse(manifestText) as { id?: unknown };
    if (manifest.id !== entry.id) throw new Error("The downloaded manifest id does not match");
    let styles: string | undefined;
    try {
      styles = await this.fetchText(`${base}/styles.css`);
    } catch {
      styles = undefined;
    }
    const adapter = this.app.vault.adapter;
    const dir = `${this.app.vault.configDir}/plugins/${entry.id}`;
    await adapter.mkdir(dir);
    await adapter.write(`${dir}/main.js`, mainJs);
    await adapter.write(`${dir}/manifest.json`, manifestText);
    if (styles) await adapter.write(`${dir}/styles.css`, styles);
    if (typeof this.plugins.loadManifests === "function") await this.plugins.loadManifests();
  }

  private async enablePlugin(id: string): Promise<void> {
    const p = this.plugins;
    if (typeof p.enablePluginAndSave === "function") {
      await p.enablePluginAndSave(id);
    } else if (typeof p.enablePlugin === "function") {
      await p.enablePlugin(id);
    } else {
      throw new Error("This Obsidian version cannot enable plugins from here");
    }
  }
}
