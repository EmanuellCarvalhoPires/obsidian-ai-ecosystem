import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../../src/types";
import { normalizeFolder, normalizeSettings, readSetting, writeSetting } from "../../src/settings/settings-store";

const HASH = "a".repeat(64);
const HASH2 = "b".repeat(64);

describe("normalizeSettings", () => {
  it("returns the defaults for garbage input", () => {
    for (const raw of [undefined, null, 42, "text", [], true]) {
      expect(normalizeSettings(raw)).toEqual(DEFAULT_SETTINGS);
    }
  });

  it("does not share objects with DEFAULT_SETTINGS", () => {
    const s = normalizeSettings(undefined);
    s.clients.push({ id: "x", name: "x", tokenHash: HASH, hint: "", createdAt: "" });
    s.scripts.allowedFolders.push("x");
    expect(DEFAULT_SETTINGS.clients).toHaveLength(0);
    expect(DEFAULT_SETTINGS.scripts.allowedFolders).toHaveLength(0);
  });

  it("fills missing fields of partial data with defaults", () => {
    const s = normalizeSettings({ port: 30000, scripts: { allowedFolders: ["Scripts"] } });
    expect(s.port).toBe(30000);
    expect(s.alternativePort).toBe(27160);
    expect(s.scripts).toEqual({ allowedFolders: ["Scripts"], restrictionsDisabled: false, maxTimeoutSeconds: 300, interpreterPaths: {} });
    expect(s.inspector.maxEntries).toBe(500);
    expect(s.screens.maxScreens).toBe(30);
  });

  it("accepts valid data unchanged", () => {
    const valid = {
      port: 28000,
      alternativePort: 28010,
      clients: [
        {
          id: "c1",
          name: "Claude Code",
          tokenHash: HASH,
          hint: "aie_12345",
          createdAt: "2026-10-19T10:00:00.000Z",
          lastUsedAt: "2026-10-19T11:00:00.000Z",
          importedFrom: "environment-variables",
        },
      ],
      importedClientsFrom: ["environment-variables"],
      scripts: {
        allowedFolders: ["Scripts", "Tools/Python"],
        restrictionsDisabled: true,
        maxTimeoutSeconds: 600,
        interpreterPaths: { python: "C:/Python/python.exe", node: "node" },
      },
      inspector: { maxEntries: 1000 },
      screens: { maxScreens: 12 },
      toolExposure: { modes: { "claude-code": "indexado", antigravity: "completo", other: "completo" }, fixedTools: ["git_status"] },
    };
    expect(normalizeSettings(valid)).toEqual(valid);
  });

  it("normalizes the tool exposure: unknown modes fall back to completo, tool names are cleaned", () => {
    expect(normalizeSettings({}).toolExposure).toEqual({
      modes: { "claude-code": "completo", antigravity: "completo", other: "completo" },
      fixedTools: [],
    });
    // Older versions saved the legacy aliases as fixed; they leave the list so the primary tools win.
    expect(normalizeSettings({ toolExposure: { fixedTools: ["search_notes", "get_section"] } }).toolExposure.fixedTools).toEqual(["get_section"]);
    const odd = normalizeSettings({ toolExposure: { modes: { "claude-code": "x", other: "indexado" }, fixedTools: ["a", "a", "bad name", 3, "b"] } });
    expect(odd.toolExposure).toEqual({ modes: { "claude-code": "completo", antigravity: "completo", other: "indexado" }, fixedTools: ["a", "b"] });
  });

  it("reads and writes the tool exposure controls and reports the effect", () => {
    const settings = normalizeSettings({});
    expect(readSetting(settings, "toolExposure.claude-code")).toBe("completo");
    expect(writeSetting(settings, "toolExposure.claude-code", "indexado")).toEqual(["tool-exposure"]);
    expect(writeSetting(settings, "toolExposure.claude-code", "indexado")).toEqual([]);
    expect(writeSetting(settings, "toolExposure.claude-code", "nope")).toEqual([]);
    expect(settings.toolExposure.modes["claude-code"]).toBe("indexado");
    expect(writeSetting(settings, "toolExposure.fixedTools", "search_notes, get_section telegram_ask_approval")).toEqual(["tool-exposure"]);
    expect(readSetting(settings, "toolExposure.fixedTools")).toBe("search_notes, get_section, telegram_ask_approval");
  });

  it("validates ports (integers from 1024 to 65535, port 0 refused)", () => {
    expect(normalizeSettings({ port: 0 }).port).toBe(27150);
    expect(normalizeSettings({ port: 80 }).port).toBe(27150);
    expect(normalizeSettings({ port: 70000 }).port).toBe(27150);
    expect(normalizeSettings({ port: 2715.5 }).port).toBe(27150);
    expect(normalizeSettings({ port: "27150" }).port).toBe(27150);
    expect(normalizeSettings({ port: 1024 }).port).toBe(1024);
    expect(normalizeSettings({ port: 65535 }).port).toBe(65535);
  });

  it("keeps the alternative port different from the port", () => {
    expect(normalizeSettings({ port: 30000, alternativePort: 30000 }).alternativePort).toBe(27160);
    expect(normalizeSettings({ port: 27160, alternativePort: 27160 })).toMatchObject({ port: 27160, alternativePort: 27161 });
    expect(normalizeSettings({ port: 27160 })).toMatchObject({ port: 27160, alternativePort: 27161 });
    expect(normalizeSettings({ port: 65535, alternativePort: 65535 }).alternativePort).toBe(27160);
    expect(normalizeSettings({ alternativePort: 12 }).alternativePort).toBe(27160);
  });

  it("keeps lastPort only when it is a valid port", () => {
    expect("lastPort" in normalizeSettings(undefined)).toBe(false);
    expect(normalizeSettings({ lastPort: 27163 }).lastPort).toBe(27163);
    expect(normalizeSettings({ lastPort: 80 }).lastPort).toBeUndefined();
    expect(normalizeSettings({ lastPort: 70000 }).lastPort).toBeUndefined();
    expect(normalizeSettings({ lastPort: 27163.5 }).lastPort).toBeUndefined();
    expect(normalizeSettings({ lastPort: "27163" }).lastPort).toBeUndefined();
  });

  it("keeps only clients with valid fields and drops duplicates", () => {
    const s = normalizeSettings({
      clients: [
        { id: "ok", name: "A", tokenHash: HASH, hint: "x", createdAt: "2026-01-01T00:00:00.000Z" },
        { id: "short", name: "B", tokenHash: "abc", hint: "", createdAt: "" },
        { id: "", name: "C", tokenHash: HASH2 },
        { id: "noname", name: "  ", tokenHash: HASH2 },
        { id: "ok", name: "dup id", tokenHash: HASH2 },
        { id: "dup-hash", name: "D", tokenHash: HASH.toUpperCase() },
        { id: "upper", name: "E", tokenHash: HASH2.toUpperCase() },
        "garbage",
        null,
        { id: 5, name: "F", tokenHash: HASH2 },
      ],
    });
    expect(s.clients.map((c) => c.id)).toEqual(["ok", "upper"]);
    expect(s.clients[1]?.tokenHash).toBe(HASH2);
    expect(s.clients[1]?.hint).toBe("");
    expect(typeof s.clients[1]?.createdAt).toBe("string");
  });

  it("normalizes allowed folders", () => {
    const s = normalizeSettings({
      scripts: { allowedFolders: ["Scripts/", "/Tools\\Python/", "./a//b", "Scripts", "../outside", "a/../b", "C:/Windows", "", "  ", 5, null, "ok"] },
    });
    expect(s.scripts.allowedFolders).toEqual(["Scripts", "Tools/Python", "a/b", "ok"]);
    expect(normalizeSettings({ scripts: { allowedFolders: "Scripts" } }).scripts.allowedFolders).toEqual([]);
  });

  it("clamps the timeout to 1..3600 and the inspector entries to 50..5000", () => {
    expect(normalizeSettings({ scripts: { maxTimeoutSeconds: 0 } }).scripts.maxTimeoutSeconds).toBe(1);
    expect(normalizeSettings({ scripts: { maxTimeoutSeconds: 99999 } }).scripts.maxTimeoutSeconds).toBe(3600);
    expect(normalizeSettings({ scripts: { maxTimeoutSeconds: 12.6 } }).scripts.maxTimeoutSeconds).toBe(13);
    expect(normalizeSettings({ scripts: { maxTimeoutSeconds: "300" } }).scripts.maxTimeoutSeconds).toBe(300);
    expect(normalizeSettings({ scripts: { maxTimeoutSeconds: NaN } }).scripts.maxTimeoutSeconds).toBe(300);
    expect(normalizeSettings({ inspector: { maxEntries: 5 } }).inspector.maxEntries).toBe(50);
    expect(normalizeSettings({ inspector: { maxEntries: 1e9 } }).inspector.maxEntries).toBe(5000);
    expect(normalizeSettings({ inspector: { maxEntries: "x" } }).inspector.maxEntries).toBe(500);
  });

  it("clamps the screen limit to 1..200 and defaults to 30", () => {
    expect(normalizeSettings({ screens: { maxScreens: 0 } }).screens.maxScreens).toBe(1);
    expect(normalizeSettings({ screens: { maxScreens: 9999 } }).screens.maxScreens).toBe(200);
    expect(normalizeSettings({ screens: { maxScreens: "x" } }).screens.maxScreens).toBe(30);
    expect(normalizeSettings({ screens: "x" }).screens.maxScreens).toBe(30);
    expect(normalizeSettings({ screens: { maxScreens: 45 } }).screens.maxScreens).toBe(45);
  });

  it("keeps only known interpreter languages with non-empty paths, and only true for restrictionsDisabled", () => {
    const s = normalizeSettings({
      scripts: { restrictionsDisabled: "yes", interpreterPaths: { python: " /usr/bin/python3 ", node: "", ruby: "ruby", bash: 5 } },
    });
    expect(s.scripts.interpreterPaths).toEqual({ python: "/usr/bin/python3" });
    expect(s.scripts.restrictionsDisabled).toBe(false);
  });

  it("dedupes importedClientsFrom and drops non-strings", () => {
    expect(normalizeSettings({ importedClientsFrom: ["a", "a", 3, "", "b"] }).importedClientsFrom).toEqual(["a", "b"]);
  });
});

describe("normalizeFolder", () => {
  it("handles good and bad paths", () => {
    expect(normalizeFolder("  Scripts/Sub/ ")).toBe("Scripts/Sub");
    expect(normalizeFolder("\\Scripts\\Sub")).toBe("Scripts/Sub");
    expect(normalizeFolder("/")).toBeUndefined();
    expect(normalizeFolder("..")).toBeUndefined();
    expect(normalizeFolder("D:\\x")).toBeUndefined();
    expect(normalizeFolder(undefined)).toBeUndefined();
  });
});

describe("lastPort and the port settings", () => {
  it("is cleared when the port or the alternative port changes, so an explicit choice wins", () => {
    const s = normalizeSettings({ lastPort: 27163 });
    expect(writeSetting(s, "port", 28000)).toEqual(["restart-server"]);
    expect(s.lastPort).toBeUndefined();

    s.lastPort = 27163;
    expect(writeSetting(s, "alternativePort", 28005)).toEqual(["restart-server"]);
    expect(s.lastPort).toBeUndefined();

    // An ignored change keeps it.
    s.lastPort = 27163;
    expect(writeSetting(s, "port", 80)).toEqual([]);
    expect(writeSetting(s, "port", s.port)).toEqual([]);
    expect(s.lastPort).toBe(27163);
  });
});

describe("readSetting / writeSetting", () => {
  it("reads and writes control values and reports the effects", () => {
    const s = normalizeSettings(undefined);
    expect(readSetting(s, "port")).toBe(27150);
    expect(writeSetting(s, "port", 28000)).toEqual(["restart-server"]);
    expect(s.port).toBe(28000);
    expect(writeSetting(s, "port", 28000)).toEqual([]);
    expect(writeSetting(s, "port", s.alternativePort)).toEqual([]);
    expect(writeSetting(s, "port", 80)).toEqual([]);
    expect(s.port).toBe(28000);
    expect(writeSetting(s, "alternativePort", 28001)).toEqual(["restart-server"]);
    expect(writeSetting(s, "scripts.maxTimeoutSeconds", 10_000)).toEqual([]);
    expect(s.scripts.maxTimeoutSeconds).toBe(3600);
    expect(writeSetting(s, "inspector.maxEntries", 100)).toEqual([]);
    expect(readSetting(s, "inspector.maxEntries")).toBe(100);
    expect(writeSetting(s, "screens.maxScreens", 500)).toEqual([]);
    expect(readSetting(s, "screens.maxScreens")).toBe(200);
  });

  it("sets and clears interpreter paths", () => {
    const s = normalizeSettings(undefined);
    expect(readSetting(s, "scripts.interpreter.python")).toBe("");
    expect(writeSetting(s, "scripts.interpreter.python", " /bin/python3 ")).toEqual(["interpreters"]);
    expect(s.scripts.interpreterPaths).toEqual({ python: "/bin/python3" });
    expect(writeSetting(s, "scripts.interpreter.python", "  ")).toEqual(["interpreters"]);
    expect(s.scripts.interpreterPaths).toEqual({});
    expect(writeSetting(s, "scripts.interpreter.ruby", "x")).toEqual([]);
    expect(readSetting(s, "nope")).toBeUndefined();
  });
});
