import { afterEach, describe, expect, it } from "vitest";
import { ConflictNotifier, conflictMessage, mcpUrl, presentServer, statusBarText } from "../../src/core/notices";
import { setLanguage } from "../../src/i18n";
import type { ServerStatus } from "../../src/types";

afterEach(() => setLanguage(undefined));

const running: ServerStatus = { running: true, port: 27150, usingAlternativePort: false };

function onAlternative(conflict: ServerStatus["conflict"]): ServerStatus {
  return { running: true, port: 27160, usingAlternativePort: true, conflict };
}

describe("conflictMessage", () => {
  it("has no message when the server runs on the configured port", () => {
    expect(conflictMessage(running)).toBeUndefined();
    expect(conflictMessage({ running: false, port: 27150, usingAlternativePort: false })).toBeUndefined();
  });

  it("explains an Environment Keys 1.x conflict", () => {
    const status = onAlternative({ port: 27150, owner: "environment-keys-1", ownerVersion: "1.11.0" });
    expect(conflictMessage(status)).toBe(
      "Port 27150 is used by Environment Keys 1.x. Update Environment Keys to 2.0. AI Ecosystem is using port 27160 for now.",
    );
    setLanguage("pt");
    expect(conflictMessage(status)).toContain("A porta 27150 está sendo usada pelo Environment Keys 1.x.");
    expect(conflictMessage(status)).toContain("27160");
  });

  it("names the process of another program when known", () => {
    const message = conflictMessage(onAlternative({ port: 27150, owner: "other", processName: "node.exe" }));
    expect(message).toContain("Port 27150 is used by node.exe.");
    expect(message).toContain("alternative port 27160");
    expect(message).toContain("change the port in the settings");
  });

  it("covers an unknown owner without a process name", () => {
    expect(conflictMessage(onAlternative({ port: 27150, owner: "unknown" }))).toContain("used by another program");
  });

  it("names the vault of another AI Ecosystem", () => {
    expect(conflictMessage(onAlternative({ port: 27150, owner: "ai-ecosystem", ownerVault: "Work" }))).toContain("the vault Work");
    expect(conflictMessage(onAlternative({ port: 27150, owner: "ai-ecosystem" }))).toContain("another vault");
  });

  it("reports a failed start", () => {
    const status: ServerStatus = { running: false, port: 27150, usingAlternativePort: false, error: "Port 27150 is in use and the alternative port 27160 is not available (x)." };
    expect(conflictMessage(status)).toContain("could not start its server");
    expect(conflictMessage(status)).toContain("alternative port 27160 is not available");
  });
});

describe("presentServer and statusBarText", () => {
  it("shows the running, alternative, waiting, conflict and stopped states", () => {
    expect(presentServer(running)).toMatchObject({ state: "running", icon: "circle-check", title: "Running on 127.0.0.1:27150" });
    expect(statusBarText(running)).toBe("AI Ecosystem: 127.0.0.1:27150");

    const alt = onAlternative({ port: 27150, owner: "environment-keys-1" });
    expect(presentServer(alt)).toMatchObject({ state: "alternative", icon: "alert-triangle" });
    expect(presentServer(alt).detail).toContain("Environment Keys 1.x");
    expect(statusBarText(alt)).toBe("AI Ecosystem: 127.0.0.1:27160 (alternative)");

    const waiting: ServerStatus = { running: false, port: 27150, usingAlternativePort: false, conflict: { port: 27150, owner: "environment-keys-transition" } };
    expect(presentServer(waiting)).toMatchObject({ state: "waiting", icon: "loader" });

    const failed: ServerStatus = { running: false, port: 27150, usingAlternativePort: false, error: "busy", conflict: { port: 27150, owner: "other" } };
    expect(presentServer(failed)).toMatchObject({ state: "conflict", icon: "alert-triangle", detail: "busy" });
    expect(statusBarText(failed)).toBe("AI Ecosystem: port conflict");

    const stopped: ServerStatus = { running: false, port: 27150, usingAlternativePort: false };
    expect(presentServer(stopped)).toMatchObject({ state: "stopped", icon: "circle-x" });
    expect(presentServer({ ...stopped, error: "boom" })).toMatchObject({ state: "stopped", detail: "boom" });
    expect(statusBarText(stopped)).toBe("AI Ecosystem: stopped");
  });

  it("builds the MCP URL", () => {
    expect(mcpUrl(27160)).toBe("http://127.0.0.1:27160/mcp");
  });
});

describe("ConflictNotifier", () => {
  it("shows each distinct conflict once", () => {
    const shown: string[] = [];
    const notifier = new ConflictNotifier((m) => shown.push(m));
    const envKeys = onAlternative({ port: 27150, owner: "environment-keys-1" });

    expect(notifier.notify(running)).toBe(false);
    expect(notifier.notify(envKeys)).toBe(true);
    expect(notifier.notify({ ...envKeys, conflict: { ...envKeys.conflict!, ownerVersion: "1.12.0" } })).toBe(false);
    expect(notifier.notify(envKeys)).toBe(false);
    expect(shown).toHaveLength(1);

    expect(notifier.notify(onAlternative({ port: 27150, owner: "other", processName: "node.exe" }))).toBe(true);
    expect(notifier.notify({ running: false, port: 27150, usingAlternativePort: false, error: "boom" })).toBe(true);
    expect(notifier.notify({ running: false, port: 27150, usingAlternativePort: false, error: "boom" })).toBe(false);
    expect(shown).toHaveLength(3);
  });
});
