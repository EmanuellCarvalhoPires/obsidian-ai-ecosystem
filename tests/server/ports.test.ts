import { afterEach, describe, expect, it } from "vitest";
import {
  classifyHealth,
  findProcessName,
  parseLsofName,
  parseNetstatPid,
  parseTasklistName,
  probePortOwner,
} from "../../src/server/port-owner";
import { ServerHost } from "../../src/server/server-host";
import type { ServerStatus } from "../../src/types";
import { FakeActivity, FakeRegistry, dummyServer } from "./helpers";

type Dummy = Awaited<ReturnType<typeof dummyServer>>;
const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const fn of cleanup.splice(0)) await fn();
});

function track(dummy: Dummy): Dummy {
  cleanup.push(dummy.close);
  return dummy;
}

/** Answers like Environment Keys 1.x: /v1/health is public, everything else is 401. */
function ekV1(): Promise<Dummy> {
  return dummyServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/v1/health") {
      res.end(JSON.stringify({ ok: true, name: "environment-variables", version: "1.11.1", vault: { id: "v", name: "Old Vault" } }));
    } else {
      res.statusCode = 401;
      res.end(JSON.stringify({ ok: false, error: { code: "unauthorized" } }));
    }
  }).then(track);
}

function makeHost(port: number, alternativePort: number, extra: Record<string, unknown> = {}, onStatusChange?: (s: ServerStatus) => void) {
  const host = new ServerHost({
    port,
    alternativePort,
    registry: new FakeRegistry(),
    auth: { authenticate: () => undefined },
    activity: new FakeActivity(),
    version: "1.0.0",
    apiVersion: 1,
    getMcpInstructions: () => "",
    onStatusChange,
    ...extra,
  });
  cleanup.push(() => host.stop());
  return host;
}

describe("probePortOwner", () => {
  it("recognizes Environment Keys 1.x through /v1/health", async () => {
    const owner = await ekV1();
    expect(await probePortOwner(owner.port)).toEqual({
      port: owner.port,
      owner: "environment-keys-1",
      ownerVersion: "1.11.1",
      ownerVault: "Old Vault",
    });
  });

  it("recognizes another AI Ecosystem and a transition-mode Environment Keys", async () => {
    const eco = track(
      await dummyServer((_req, res) => {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ ok: true, app: "ai-ecosystem", version: "0.1.0", vault: "Other vault" }));
      }),
    );
    expect(await probePortOwner(eco.port)).toMatchObject({ owner: "ai-ecosystem", ownerVersion: "0.1.0", ownerVault: "Other vault" });

    const transition = track(
      await dummyServer((_req, res) => {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ name: "environment-variables", version: "2.0.0", mode: "transition" }));
      }),
    );
    expect(await probePortOwner(transition.port)).toMatchObject({ owner: "environment-keys-transition", ownerVersion: "2.0.0" });
  });

  it("classifies unknown HTTP servers as other and closed ports as unknown", async () => {
    const other = track(await dummyServer((_req, res) => res.end("<html>hi</html>")));
    expect(await probePortOwner(other.port)).toMatchObject({ port: other.port, owner: "other" });

    const closed = await dummyServer((_req, res) => res.end());
    const port = closed.port;
    await closed.close();
    expect(await probePortOwner(port, 500)).toMatchObject({ port, owner: "unknown" });
  });

  it("times out on a server that never answers", async () => {
    const silent = track(await dummyServer(() => undefined));
    const started = Date.now();
    const result = await probePortOwner(silent.port, 200);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(result.owner).toBe("unknown");
  });
});

describe("port owner parsing", () => {
  it("classifies health documents", () => {
    expect(classifyHealth({ foo: 1 })).toBeUndefined();
    expect(classifyHealth({ name: "environment-variables" })?.owner).toBe("environment-keys-1");
    expect(classifyHealth({ name: "ai-ecosystem", vault: { name: "V" } })).toMatchObject({ owner: "ai-ecosystem", ownerVault: "V" });
  });

  it("parses netstat, tasklist and lsof output", () => {
    const netstat = [
      "  Proto  Local Address          Foreign Address        State           PID",
      "  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1000",
      "  TCP    127.0.0.1:27150        0.0.0.0:0              LISTENING       4242",
      "  TCP    127.0.0.1:27150        127.0.0.1:50000        ESTABLISHED     4242",
    ].join("\r\n");
    expect(parseNetstatPid(netstat, 27150)).toBe("4242");
    expect(parseNetstatPid(netstat, 1)).toBeUndefined();
    expect(parseTasklistName('"node.exe","4242","Console","1","50,000 K"\r\n')).toBe("node.exe");
    expect(parseTasklistName("INFO: No tasks are running which match the specified criteria.")).toBeUndefined();
    expect(parseLsofName("COMMAND   PID USER   FD   TYPE\nnode    123 me    20u  IPv4 TCP 127.0.0.1:27150 (LISTEN)\n")).toBe("node");
    expect(parseLsofName("")).toBeUndefined();
  });

  it("findProcessName never throws", async () => {
    await expect(findProcessName(1)).resolves.toBeUndefined();
  });
});

describe("ServerHost port conflicts", () => {
  it("falls back to the alternative port next to Environment Keys 1.x", async () => {
    const owner = await ekV1();
    const changes: ServerStatus[] = [];
    const host = makeHost(owner.port, 0, {}, (s) => changes.push(s));
    const status = await host.start();
    expect(status.running).toBe(true);
    expect(status.usingAlternativePort).toBe(true);
    expect(status.port).not.toBe(owner.port);
    expect(status.conflict).toMatchObject({ port: owner.port, owner: "environment-keys-1", ownerVersion: "1.11.1" });
    expect(host.getStatus()).toEqual(status);
    expect(changes[changes.length - 1]).toEqual(status);
    const health = await fetch(`http://127.0.0.1:${status.port}/health`);
    expect(health.status).toBe(200);
  });

  it("waits for Environment Keys in transition mode to free the main port", async () => {
    const transition = await dummyServer((_req, res) => {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ name: "environment-variables", version: "2.0.0", mode: "transition" }));
    });
    setTimeout(() => void transition.close(), 400);
    const host = makeHost(transition.port, 0, { transitionWaitMs: 5000 });
    const started = Date.now();
    const status = await host.start();
    expect(status).toMatchObject({ running: true, port: transition.port, usingAlternativePort: false });
    expect(status.conflict).toBeUndefined();
    expect(Date.now() - started).toBeGreaterThanOrEqual(300);
  });

  it("uses the alternative port when the transition owner never leaves", async () => {
    const transition = track(
      await dummyServer((_req, res) => {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ name: "environment-variables", version: "2.0.0", mode: "transition" }));
      }),
    );
    const host = makeHost(transition.port, 0, { transitionWaitMs: 600 });
    const status = await host.start();
    expect(status).toMatchObject({ running: true, usingAlternativePort: true });
    expect(status.conflict?.owner).toBe("environment-keys-transition");
  });

  it("reports an error when the alternative port is busy too", async () => {
    const owner = await ekV1();
    const second = track(await dummyServer((_req, res) => res.end("x")));
    const host = makeHost(owner.port, second.port);
    const status = await host.start();
    expect(status.running).toBe(false);
    expect(status.port).toBe(owner.port);
    expect(status.error).toContain(String(second.port));
    expect(status.conflict?.owner).toBe("environment-keys-1");
  });

  it("uses an injected probe and treats a probe failure as unknown", async () => {
    const owner = track(await dummyServer((_req, res) => res.end("x")));
    const probed: number[] = [];
    const host = makeHost(owner.port, 0, {
      probe: async (port: number) => {
        probed.push(port);
        throw new Error("probe failed");
      },
    });
    const status = await host.start();
    expect(probed).toEqual([owner.port]);
    expect(status.conflict).toEqual({ port: owner.port, owner: "unknown" });
    expect(status.usingAlternativePort).toBe(true);
  });
});
