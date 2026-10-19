import { afterEach, describe, expect, it } from "vitest";
import { conflictMessage } from "../../src/core/notices";
import { Ecosystem } from "../../src/core/ecosystem";
import { normalizeSettings } from "../../src/settings/settings-store";
import type { ServerStatus } from "../../src/types";
import { dummyServer } from "../server/helpers";

let eco: Ecosystem | undefined;
let close: (() => Promise<void>) | undefined;

afterEach(async () => {
  await eco?.unload();
  await close?.();
  eco = undefined;
  close = undefined;
});

function makeEcosystem(port: number, extra: { transitionWaitMs?: number } = {}): { eco: Ecosystem; statuses: ServerStatus[] } {
  const settings = normalizeSettings(undefined);
  settings.port = port;
  settings.alternativePort = 0;
  const statuses: ServerStatus[] = [];
  const ecosystem = new Ecosystem({
    vaultBasePath: ".",
    vaultName: "TestVault",
    version: "1.0.0",
    getSettings: () => settings,
    trigger: () => undefined,
    getDeclaredScripts: () => [],
    importClients: async () => 0,
    onStatusChange: (status) => statuses.push(status),
    serverOptions: { transitionWaitMs: extra.transitionWaitMs },
  });
  return { eco: ecosystem, statuses };
}

describe("port conflicts", () => {
  it("runs on the alternative port when Environment Keys 1.x holds the main port, and explains it", async () => {
    const dummy = await dummyServer((_req, res) => {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ name: "environment-variables", version: "1.11.0" }));
    });
    close = dummy.close;
    const made = makeEcosystem(dummy.port);
    eco = made.eco;

    const status = await eco.start();
    expect(status).toMatchObject({ running: true, usingAlternativePort: true });
    expect(status.port).not.toBe(dummy.port);
    expect(status.conflict).toMatchObject({ port: dummy.port, owner: "environment-keys-1", ownerVersion: "1.11.0" });
    expect(conflictMessage(status)).toBe(
      `Port ${dummy.port} is used by Environment Keys 1.x. Update Environment Keys to 2.0. AI Ecosystem is using port ${status.port} for now.`,
    );
    // The status changes were reported to the Obsidian side.
    expect(made.statuses.at(-1)).toMatchObject({ running: true, usingAlternativePort: true });
    expect((await fetch(`http://127.0.0.1:${status.port}/health`)).status).toBe(200);
  });

  it("takes the main port when Environment Keys 2.x in transition mode releases it", async () => {
    const dummy = await dummyServer((_req, res) => {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ name: "environment-variables", version: "2.0.0", mode: "transition" }));
    });
    const made = makeEcosystem(dummy.port, { transitionWaitMs: 8000 });
    eco = made.eco;

    const started = eco.start();
    // Environment Keys frees the port when it hears the ready event.
    setTimeout(() => void dummy.close(), 300);
    const status = await started;
    expect(status).toMatchObject({ running: true, port: dummy.port, usingAlternativePort: false });
    expect(conflictMessage(status)).toBeUndefined();
  });
});
