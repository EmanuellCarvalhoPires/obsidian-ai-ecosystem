import { describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import { HttpError, InstallerService } from "../../src/catalog/installer-service";
import type { CatalogEntry } from "../../src/types";

const entry: CatalogEntry = {
  id: "ai-templates",
  repo: "EmanuellCarvalhoPires/obsidian-ai-templates",
  name: "AI Templates",
  description: { en: "e", pt: "p" },
  icon: "file-spreadsheet",
  minEcosystemVersion: "1.0.0",
};
const manifest = { id: "ai-templates", name: "AI Templates", version: "1.2.0", minAppVersion: "1.5.0" };
const REL = "https://api.github.com/repos/EmanuellCarvalhoPires/obsidian-ai-templates/releases/latest";
const BASE = "https://github.com/EmanuellCarvalhoPires/obsidian-ai-templates/releases/download/1.2.0";

type Fn = ReturnType<typeof vi.fn>;

interface Opts {
  plugins?: Record<string, unknown>;
  noPlugins?: boolean;
  manifestOverride?: Record<string, unknown>;
  releaseError?: unknown;
  texts?: Record<string, string>;
  ecosystemVersion?: string;
}

function setup(o: Opts = {}) {
  const manifests: Record<string, { id: string; version: string }> = {};
  const enabled = new Set<string>();
  const plugins: Record<string, unknown> = o.plugins ?? {
    manifests,
    enabledPlugins: enabled,
    isEnabled: () => true,
    installPlugin: vi.fn(async () => {
      manifests["ai-templates"] = { id: "ai-templates", version: "1.2.0" };
    }),
    loadManifests: vi.fn(async () => {}),
    enablePluginAndSave: vi.fn(async (id: string) => {
      enabled.add(id);
      return true;
    }),
    disablePlugin: vi.fn(async (id: string) => {
      enabled.delete(id);
    }),
  };
  const adapter = { mkdir: vi.fn(async () => {}), write: vi.fn(async () => {}) };
  const app = {
    plugins: o.noPlugins ? undefined : plugins,
    vault: { configDir: ".obsidian-test", adapter },
  } as unknown as App;
  const fetchJson = vi.fn(async (url: string) => {
    if (url === REL) {
      if (o.releaseError) throw o.releaseError;
      return { tag_name: "1.2.0" };
    }
    if (url === `${BASE}/manifest.json`) return { ...manifest, ...o.manifestOverride };
    throw new Error("unexpected " + url);
  });
  const texts = o.texts ?? {
    "main.js": "code",
    "manifest.json": JSON.stringify(manifest),
    "styles.css": "css",
  };
  const fetchText = vi.fn(async (url: string) => {
    const v = texts[url.slice(BASE.length + 1)];
    if (v === undefined) throw new HttpError(404);
    return v;
  });
  const openUrl = vi.fn();
  const svc = new InstallerService({
    app,
    ecosystemVersion: o.ecosystemVersion ?? "1.0.0",
    obsidianVersion: "1.14.4",
    isRegistered: (id) => id === "registered",
    fetchJson,
    fetchText,
    openUrl,
  });
  return {
    svc,
    plugins: plugins as Record<string, Fn>,
    manifests,
    enabled,
    adapter,
    fetchJson,
    openUrl,
  };
}

describe("getLatestRelease", () => {
  it("parses the latest release", async () => {
    const { svc } = setup();
    expect(await svc.getLatestRelease(entry)).toEqual({ version: "1.2.0", manifest });
  });
  it("reports 404 as no release", async () => {
    const { svc } = setup({ releaseError: new HttpError(404) });
    expect(await svc.getLatestRelease(entry)).toEqual({ error: "No release published yet" });
  });
  it("rejects a manifest id mismatch", async () => {
    const { svc } = setup({ manifestOverride: { id: "other" } });
    expect(await svc.getLatestRelease(entry)).toHaveProperty("error");
  });
  it("rejects a minAppVersion above the running Obsidian", async () => {
    const { svc } = setup({ manifestOverride: { minAppVersion: "9.0.0" } });
    const r = await svc.getLatestRelease(entry);
    expect("error" in r && r.error).toMatch(/9\.0\.0/);
  });
  it("caches for 10 minutes unless forced", async () => {
    const { svc, fetchJson } = setup();
    await svc.getLatestRelease(entry);
    await svc.getLatestRelease(entry);
    expect(fetchJson).toHaveBeenCalledTimes(2);
    await svc.getLatestRelease(entry, true);
    expect(fetchJson).toHaveBeenCalledTimes(4);
  });
});

describe("getState", () => {
  it("covers every state", () => {
    const { svc, manifests, enabled } = setup();
    expect(svc.getState(entry, "1.2.0")).toEqual({ kind: "not-installed", latestVersion: "1.2.0" });
    manifests["ai-templates"] = { id: "ai-templates", version: "1.0.0" };
    expect(svc.getState(entry)).toMatchObject({ kind: "installed-disabled", installedVersion: "1.0.0" });
    expect(svc.getState(entry, "1.2.0")).toMatchObject({ kind: "update-available", enabled: false });
    enabled.add("ai-templates");
    expect(svc.getState(entry, "1.0.0")).toMatchObject({ kind: "active", registered: false });
    expect(svc.getState(entry, "1.2.0")).toMatchObject({ kind: "update-available", enabled: true });
    manifests["registered"] = { id: "registered", version: "1.0.0" };
    enabled.add("registered");
    expect(svc.getState({ ...entry, id: "registered" })).toMatchObject({ kind: "active", registered: true });
  });
  it("is unavailable in restricted mode", () => {
    const { svc, plugins } = setup();
    plugins.isEnabled = (() => false) as never;
    expect(svc.getState(entry)).toMatchObject({ kind: "unavailable" });
  });
  it("is unavailable when the ecosystem is too old", () => {
    const { svc } = setup({ ecosystemVersion: "0.9.0" });
    expect(svc.getState(entry)).toEqual({ kind: "unavailable", reason: "Requires AI Ecosystem 1.0.0" });
  });
  it("reports installing during an install", async () => {
    const { svc } = setup();
    const p = svc.install(entry);
    expect(svc.getState(entry)).toEqual({ kind: "installing" });
    await p;
    expect(svc.getState(entry).kind).not.toBe("installing");
  });
});

describe("install", () => {
  it("uses the internal routine then enables", async () => {
    const { svc, plugins, adapter } = setup();
    expect(await svc.install(entry)).toEqual({ ok: true, method: "internal" });
    expect(plugins.installPlugin).toHaveBeenCalledWith(entry.repo, "1.2.0", manifest);
    expect(plugins.enablePluginAndSave).toHaveBeenCalledWith("ai-templates");
    expect(adapter.write).not.toHaveBeenCalled();
  });
  it("falls back when the internal routine is missing", async () => {
    const { svc, plugins, adapter } = setup();
    delete plugins.installPlugin;
    expect(await svc.install(entry)).toEqual({ ok: true, method: "fallback" });
    expect(adapter.mkdir).toHaveBeenCalledWith(".obsidian-test/plugins/ai-templates");
    const written = adapter.write.mock.calls.map((c) => (c as unknown[])[0]);
    expect(written).toEqual([
      ".obsidian-test/plugins/ai-templates/main.js",
      ".obsidian-test/plugins/ai-templates/manifest.json",
      ".obsidian-test/plugins/ai-templates/styles.css",
    ]);
    expect(plugins.loadManifests).toHaveBeenCalled();
    expect(plugins.enablePluginAndSave).toHaveBeenCalled();
  });
  it("skips styles.css when absent", async () => {
    const { svc, plugins, adapter } = setup({
      texts: { "main.js": "code", "manifest.json": JSON.stringify(manifest) },
    });
    delete plugins.installPlugin;
    expect(await svc.install(entry)).toMatchObject({ ok: true, method: "fallback" });
    expect(adapter.write).toHaveBeenCalledTimes(2);
  });
  it("falls back when the internal routine throws", async () => {
    const { svc, plugins } = setup();
    plugins.installPlugin = vi.fn().mockRejectedValue(new Error("boom"));
    expect(await svc.install(entry)).toEqual({ ok: true, method: "fallback" });
  });
  it("opens the store page when both fail", async () => {
    const { svc, plugins, openUrl } = setup({ texts: {} });
    plugins.installPlugin = vi.fn().mockRejectedValue(new Error("boom"));
    const r = await svc.install(entry);
    expect(r.ok).toBe(false);
    expect(openUrl).toHaveBeenCalledWith("obsidian://show-plugin?id=ai-templates");
  });
  it("does not open the store page when there is no release", async () => {
    const { svc, openUrl } = setup({ releaseError: new HttpError(404) });
    expect(await svc.install(entry)).toEqual({ ok: false, method: "store-page", error: "No release published yet" });
    expect(openUrl).not.toHaveBeenCalled();
  });
  it("opens the store page when the release lookup fails for another reason", async () => {
    const { svc, openUrl } = setup({ releaseError: new HttpError(403) });
    const r = await svc.install(entry);
    expect(r.ok).toBe(false);
    expect(openUrl).toHaveBeenCalledWith("obsidian://show-plugin?id=ai-templates");
  });
  it("refuses a repository of another owner", async () => {
    const { svc, plugins, fetchJson } = setup();
    const r = await svc.install({ ...entry, repo: "evil/obsidian-ai-templates" });
    expect(r.ok).toBe(false);
    expect(plugins.installPlugin).not.toHaveBeenCalled();
    expect(fetchJson).not.toHaveBeenCalled();
  });
});

describe("update and enable", () => {
  it("re-enables a plugin that was enabled", async () => {
    const { svc, plugins, manifests, enabled } = setup();
    manifests["ai-templates"] = { id: "ai-templates", version: "1.0.0" };
    enabled.add("ai-templates");
    expect(await svc.update(entry)).toEqual({ ok: true, method: "internal" });
    expect(plugins.disablePlugin).toHaveBeenCalledWith("ai-templates");
    expect(plugins.enablePluginAndSave).toHaveBeenCalledWith("ai-templates");
  });
  it("does not enable a disabled plugin on update", async () => {
    const { svc, plugins, manifests } = setup();
    manifests["ai-templates"] = { id: "ai-templates", version: "1.0.0" };
    await svc.update(entry);
    expect(plugins.enablePluginAndSave).not.toHaveBeenCalled();
  });
  it("enable uses enablePluginAndSave, else enablePlugin", async () => {
    const a = setup();
    expect(await a.svc.enable(entry)).toEqual({ ok: true });
    expect(a.plugins.enablePluginAndSave).toHaveBeenCalled();
    const b = setup({ plugins: { enablePlugin: vi.fn(async () => {}) } });
    expect(await b.svc.enable(entry)).toEqual({ ok: true });
    expect(b.plugins.enablePlugin).toHaveBeenCalledWith("ai-templates");
    const c = setup({ noPlugins: true });
    expect((await c.svc.enable(entry)).ok).toBe(false);
  });
  it("opens the plugin settings guarded", () => {
    const { svc } = setup();
    expect(() => svc.openPluginSettings("ai-templates")).not.toThrow();
  });
});
