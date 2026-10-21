import * as net from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  classifyHealth,
  findProcessName,
  parseLsofName,
  parseNetstatPid,
  parseTasklistName,
  probePortOwner,
} from "../../src/server/port-owner";
import { LISTEN_HOST, PORT_SCAN_ATTEMPTS, ServerHost, scanPorts } from "../../src/server/server-host";
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

// ---------------------------------------------------------------------------
// Automatic port search
// ---------------------------------------------------------------------------

/** Holds a port with a plain TCP listener (busy for the host, no HTTP answer). */
function occupy(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    // Drops every connection at once, so the owner probe does not wait.
    const server = net.createServer((socket) => socket.destroy());
    server.once("error", reject);
    server.listen(port, LISTEN_HOST, () => {
      cleanup.push(() => new Promise<void>((done) => server.close(() => done())));
      resolve();
    });
  });
}

/** Finds `count` free consecutive ports (high range, random base) and returns the first. */
async function freeBlock(count: number): Promise<number> {
  for (let attempt = 0; attempt < 50; attempt++) {
    const base = 30000 + Math.floor(Math.random() * 25000);
    const probes: net.Server[] = [];
    let ok = true;
    for (let i = 0; i < count && ok; i++) {
      const server = net.createServer();
      ok = await new Promise<boolean>((resolve) => {
        server.once("error", () => resolve(false));
        server.listen(base + i, LISTEN_HOST, () => resolve(true));
      });
      if (ok) probes.push(server);
    }
    await Promise.all(probes.map((s) => new Promise<void>((done) => s.close(() => done()))));
    if (ok) return base;
  }
  throw new Error("no free port block found");
}

describe("ServerHost automatic port search", () => {
  it("scanPorts walks upwards from the alternative port, skipping the main port and stopping at 65535", () => {
    expect(scanPorts(27150, 27160)).toEqual(Array.from({ length: PORT_SCAN_ATTEMPTS }, (_, i) => 27160 + i));
    expect(scanPorts(27162, 27160).slice(0, 4)).toEqual([27160, 27161, 27163, 27164]);
    expect(scanPorts(27162, 27160)).toHaveLength(PORT_SCAN_ATTEMPTS);
    expect(scanPorts(27150, 65533)).toEqual([65533, 65534, 65535]);
    expect(scanPorts(27150, 0)).toEqual([0]);
  });

  it("uses the alternative port when the main port is busy", async () => {
    const base = await freeBlock(2);
    await occupy(base);
    const status = await makeHost(base, base + 1).start();
    expect(status).toMatchObject({ running: true, port: base + 1, usingAlternativePort: true, configuredPort: base });
    expect(status.conflict).toMatchObject({ port: base, owner: "unknown" });
    expect(status.previousPort).toBeUndefined();
  });

  it("uses the next consecutive port when the main and the alternative ports are busy", async () => {
    const base = await freeBlock(3);
    await occupy(base);
    await occupy(base + 1);
    const status = await makeHost(base, base + 1).start();
    expect(status).toMatchObject({ running: true, port: base + 2, usingAlternativePort: true });
    expect((await fetch(`http://127.0.0.1:${status.port}/health`)).status).toBe(200);
  });

  it("skips many busy ports, up to the limit, and takes the next free one", async () => {
    const base = await freeBlock(PORT_SCAN_ATTEMPTS + 1);
    // main = base, alternative = base + 1; busy: base .. base + 19 (the main port and 19 scanned ports); the 20th scanned is free.
    for (let i = 0; i < PORT_SCAN_ATTEMPTS; i++) await occupy(base + i);
    const probed: number[] = [];
    const status = await makeHost(base, base + 1, {
      probe: async (port: number) => {
        probed.push(port);
        return { port, owner: "other" as const };
      },
    }).start();
    expect(status).toMatchObject({ running: true, port: base + PORT_SCAN_ATTEMPTS, usingAlternativePort: true });
    // Only the main port is probed, to keep start-up fast.
    expect(probed).toEqual([base]);
  });

  it("fails with the range tried when every port of the scan is busy", async () => {
    const base = await freeBlock(PORT_SCAN_ATTEMPTS + 1);
    for (let i = 0; i < PORT_SCAN_ATTEMPTS + 1; i++) await occupy(base + i);
    const status = await makeHost(base, base + 1, { probe: async (port: number) => ({ port, owner: "environment-keys-1" as const }) }).start();
    expect(status.running).toBe(false);
    expect(status.usingAlternativePort).toBe(false);
    expect(status.port).toBe(base);
    expect(status.error).toContain(`${base + 1}-${base + PORT_SCAN_ATTEMPTS}`);
    expect(status.conflict).toMatchObject({ port: base, owner: "environment-keys-1" });
  });

  it("tries lastPort first, even when the main port is free, and reports the port it kept", async () => {
    const base = await freeBlock(4);
    const status = await makeHost(base, base + 1, { lastPort: base + 3 }).start();
    expect(status).toMatchObject({ running: true, port: base + 3, usingAlternativePort: true, configuredPort: base });
    expect(status.conflict).toBeUndefined();
    expect(status.previousPort).toBeUndefined();
  });

  it("skips lastPort when it is busy and tells the clients that the port changed", async () => {
    const base = await freeBlock(4);
    await occupy(base + 3);
    const status = await makeHost(base, base + 1, { lastPort: base + 3 }).start();
    expect(status).toMatchObject({ running: true, port: base, usingAlternativePort: false, previousPort: base + 3 });
  });

  it("ignores a lastPort equal to the main port", async () => {
    const base = await freeBlock(2);
    const status = await makeHost(base, base + 1, { lastPort: base }).start();
    expect(status).toMatchObject({ running: true, port: base, usingAlternativePort: false });
    expect(status.previousPort).toBeUndefined();
  });

  it("does not fail on a refused port (EACCES), and fails on any other listen error", async () => {
    const base = await freeBlock(2);
    const proto = ServerHost.prototype as unknown as { listen: (port: number) => Promise<unknown> };
    const original = proto.listen;
    const calls: number[] = [];
    proto.listen = function (this: ServerHost, port: number) {
      calls.push(port);
      if (port === base) return Promise.resolve({ ok: false, error: Object.assign(new Error("denied"), { code: "EACCES" }) });
      if (port === base + 1) return Promise.resolve({ ok: false, error: Object.assign(new Error("boom"), { code: "EINVAL" }) });
      return original.call(this, port);
    };
    try {
      const status = await makeHost(base, base + 1, { probe: async (port: number) => ({ port, owner: "unknown" as const }) }).start();
      expect(calls).toEqual([base, base + 1]);
      expect(status.running).toBe(false);
      expect(status.error).toContain(`Could not listen on port ${base + 1}: boom`);
    } finally {
      proto.listen = original;
    }
  });
});
