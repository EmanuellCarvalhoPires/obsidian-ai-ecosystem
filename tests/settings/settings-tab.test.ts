import { describe, expect, it } from "vitest";
import { AIEcosystemSettingTab } from "../../src/settings/settings-tab";
import type { SettingsHost } from "../../src/settings/settings-tab";
import { buildClaudeCommand, buildJsonConfig } from "../../src/settings/modals";
import { normalizeSettings, readSetting } from "../../src/settings/settings-store";

const EMOJI = /\p{Extended_Pictographic}/u;

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
  };
}

describe("settings tab definitions", () => {
  const host = makeHost();
  const tab = new AIEcosystemSettingTab({} as never, {} as never, host);
  const definitions = tab.getSettingDefinitions();

  it("has the five sections in order", () => {
    const headings = definitions.map((d) => ("heading" in d ? d.heading : undefined)).filter((h) => h !== undefined);
    expect(headings).toEqual(["Server", "Clients", "Scripts", "Allowed script folders", "Danger zone", "Inspector", "Modules", "Services"]);
  });

  it("only binds control keys the store can read", () => {
    const keys: string[] = [];
    const collect = (items: unknown[]): void => {
      for (const item of items) {
        const def = item as { control?: { key: string }; items?: unknown[] };
        if (def.control) keys.push(def.control.key);
        if (def.items) collect(def.items);
      }
    };
    collect(definitions);
    expect(keys).toEqual([
      "port",
      "alternativePort",
      "scripts.maxTimeoutSeconds",
      "scripts.interpreter.python",
      "scripts.interpreter.node",
      "scripts.interpreter.bash",
      "scripts.interpreter.powershell",
      "inspector.maxEntries",
    ]);
    for (const key of keys) expect(readSetting(host.settings, key), key).not.toBeUndefined();
    for (const key of keys) expect(tab.getControlValue(key)).toEqual(readSetting(host.settings, key));
  });

  it("lists the stored clients and folders", () => {
    const clients = definitions.find((d) => "heading" in d && d.heading === "Clients") as { items: Array<{ name: string }> };
    expect(clients.items.map((i) => i.name)).toEqual(["Claude Code"]);
    const folders = definitions.find((d) => "heading" in d && d.heading === "Allowed script folders") as { items: Array<{ name: string }> };
    expect(folders.items.map((i) => i.name)).toEqual(["Scripts"]);
  });

  it("contains no emoji", () => {
    expect(EMOJI.test(JSON.stringify(definitions))).toBe(false);
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
