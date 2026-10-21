import { Setting } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import type { HooksStatus } from "../../src/hooks/hook-manager";
import { AIEcosystemSettingTab } from "../../src/settings/settings-tab";
import type { SettingsHost } from "../../src/settings/settings-tab";
import { buildClaudeCommand, buildJsonConfig } from "../../src/settings/modals";
import { normalizeSettings, readSetting } from "../../src/settings/settings-store";

const EMOJI = /\p{Extended_Pictographic}/u;

const hooksStatus: HooksStatus = {
  node: { available: true, version: "v22.5.0", checked: true },
  settingsFile: "settings.local.json",
  settingsPath: "C:/Cofre/.claude/settings.local.json",
  coreInstalled: true,
  modules: [
    {
      id: "ai-scripts",
      name: "AI Scripts",
      registered: true,
      estado: "configurado",
      origem: "legado",
      mode: "bloquear",
      hasProtection: true,
      installed: [],
      setupHook: false,
    },
  ],
};

function makeHost(): SettingsHost {
  const settings = normalizeSettings({
    clients: [{ id: "c1", name: "Claude Code", tokenHash: "a".repeat(64), hint: "aie_1234", createdAt: "2026-10-19T10:00:00.000Z" }],
    scripts: { allowedFolders: ["Scripts"] },
  });
  return {
    settings,
    saveSettings: async () => undefined,
    getServerStatus: () => ({ running: true, port: 27150, usingAlternativePort: false }),
    restartServer: async () => undefined,
    scheduleServerRestart: () => undefined,
    copyMcpUrl: () => undefined,
    listModules: () => [],
    listServices: () => [],
    createClient: async () => {
      throw new Error("not used");
    },
    revokeClient: async () => undefined,
    onInterpretersChanged: () => undefined,
    openInspector: async () => undefined,
    openCatalog: async () => undefined,
    getHooksStatus: () => hooksStatus,
    planHookInstall: async () => ({ settingsPath: hooksStatus.settingsPath, entries: [], node: { available: true } }),
    installHooks: async () => ({ ok: true, changed: true }),
    removeHooks: () => ({ ok: true, changed: true }),
    setHookMode: () => undefined,
    useSettingsFile: () => ({ ok: true, changed: false }),
    listScreens: () => [{ slug: "cadastro_cliente", titulo: "Customer form", campos: [{ id: "nome", tipo: "texto", rotulo: "Name" }] }],
    previewScreen: () => undefined,
    removeScreen: () => true,
  };
}

interface RenderedSetting {
  heading: boolean;
  name: string;
  desc: string;
}

function renderTab(tab: AIEcosystemSettingTab): RenderedSetting[] {
  (globalThis as Record<string, unknown>).createSpan = () => ({});
  const makeContainer = (): Record<string, unknown> => ({
    empty: () => undefined,
    isShown: () => true,
    createDiv: () => makeContainer(),
    createSpan: () => ({ setAttribute: () => undefined }),
  });
  tab.containerEl = makeContainer() as never;

  const rendered: RenderedSetting[] = [];
  const currentMap = new WeakMap<Setting, RenderedSetting>();
  const getEntry = (s: Setting): RenderedSetting => {
    let entry = currentMap.get(s);
    if (!entry) {
      entry = { heading: false, name: "", desc: "" };
      currentMap.set(s, entry);
      rendered.push(entry);
      (s as unknown as Record<string, unknown>).nameEl = {
        prepend: () => undefined,
        createSpan: () => ({ setAttribute: () => undefined }),
      };
    }
    return entry;
  };

  const setHeadingSpy = vi.spyOn(Setting.prototype, "setHeading").mockImplementation(function (this: Setting) {
    getEntry(this).heading = true;
    return this;
  });
  const setNameSpy = vi.spyOn(Setting.prototype, "setName").mockImplementation(function (this: Setting, name: string | DocumentFragment) {
    getEntry(this).name = typeof name === "string" ? name : "[fragment]";
    return this;
  });
  const setDescSpy = vi.spyOn(Setting.prototype, "setDesc").mockImplementation(function (this: Setting, desc: string | DocumentFragment) {
    getEntry(this).desc = typeof desc === "string" ? desc : "[fragment]";
    return this;
  });

  try {
    tab.display();
  } finally {
    setHeadingSpy.mockRestore();
    setNameSpy.mockRestore();
    setDescSpy.mockRestore();
  }
  return rendered;
}

describe("settings tab (imperative display)", () => {
  const host = makeHost();
  const tab = new AIEcosystemSettingTab({} as never, {} as never, host);
  const rendered = renderTab(tab);

  it("does not define getSettingDefinitions (avoids Obsidian 1.13+ experimental settings freeze)", () => {
    expect("getSettingDefinitions" in tab).toBe(false);
  });

  it("renders the sections in order", () => {
    const headings = rendered.filter((r) => r.heading).map((r) => r.name);
    expect(headings).toEqual(["Server", "Clients", "Scripts", "Allowed script folders", "Danger zone", "Inspector", "Modules", "Claude Code hooks", "Screens", "Services"]);
  });

  it("only binds control keys the store can read", () => {
    const keys = [
      "port",
      "alternativePort",
      "scripts.maxTimeoutSeconds",
      "scripts.interpreter.python",
      "scripts.interpreter.node",
      "scripts.interpreter.bash",
      "scripts.interpreter.powershell",
      "inspector.maxEntries",
      "screens.maxScreens",
    ];
    for (const key of keys) expect(readSetting(host.settings, key), key).not.toBeUndefined();
    for (const key of keys) expect(tab.getControlValue(key)).toEqual(readSetting(host.settings, key));
  });

  it("lists the stored clients and folders", () => {
    const names = rendered.map((r) => r.name);
    expect(names).toContain("Claude Code");
    expect(names).toContain("Scripts");
  });

  it("lists the saved screens with their tool name", () => {
    const row = rendered.find((r) => r.name === "Customer form");
    expect(row?.desc).toBe("tela_cadastro_cliente - 1 fields");
    expect(rendered.map((r) => r.name)).toContain("Maximum screens");
  });

  it("lists one row per module in the hooks section", () => {
    const row = rendered.find((r) => r.name === "AI Scripts");
    expect(row?.desc).toBe("Existing module, hooks removed or unavailable. Hooks not installed");
  });

  it("contains no emoji", () => {
    expect(EMOJI.test(JSON.stringify(rendered))).toBe(false);
  });

  it("applies control values: restarts the server on a port change and saves", async () => {
    const calls: string[] = [];
    const h = makeHost();
    h.saveSettings = async () => {
      calls.push("save");
    };
    h.scheduleServerRestart = () => {
      calls.push("restart");
    };
    h.onInterpretersChanged = () => {
      calls.push("interpreters");
    };
    const t2 = new AIEcosystemSettingTab({} as never, {} as never, h);
    await t2.setControlValue("port", 28000);
    await t2.setControlValue("scripts.interpreter.node", "/usr/bin/node");
    await t2.setControlValue("inspector.maxEntries", 100);
    expect(calls).toEqual(["save", "restart", "save", "interpreters", "save"]);
    expect(h.settings.port).toBe(28000);
    expect(h.settings.scripts.interpreterPaths.node).toBe("/usr/bin/node");
  });
});

describe("client snippets", () => {
  it("builds the Claude Code command and the JSON config", () => {
    const url = "http://127.0.0.1:27150/mcp";
    expect(buildClaudeCommand(url, "aie_tok")).toBe(
      'claude mcp add --transport http ai-ecosystem http://127.0.0.1:27150/mcp --header "Authorization: Bearer aie_tok"',
    );
    expect(JSON.parse(buildJsonConfig(url, "aie_tok"))).toEqual({
      mcpServers: { "ai-ecosystem": { type: "http", url, headers: { Authorization: "Bearer aie_tok" } } },
    });
  });
});
