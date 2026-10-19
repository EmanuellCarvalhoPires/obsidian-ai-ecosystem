import { describe, expect, it } from "vitest";
import { BinaryDetector } from "../../src/runner/binary-detector";

type Which = Record<string, string | undefined>;

function make(opts: {
  platform: NodeJS.Platform;
  files?: string[];
  which?: Which;
  env?: NodeJS.ProcessEnv;
}): { detector: BinaryDetector; lookups: string[] } {
  const files = new Set(opts.files ?? []);
  const lookups: string[] = [];
  const detector = new BinaryDetector({
    platform: opts.platform,
    env: opts.env ?? {},
    exists: (p) => files.has(p),
    which: async (cmd) => {
      lookups.push(cmd);
      return opts.which?.[cmd];
    },
  });
  return { detector, lookups };
}

const ctx = { cwdAbs: "/vault/proj", vaultBasePath: "/vault" };
const wctx = { cwdAbs: "C:\\vault\\proj", vaultBasePath: "C:\\vault" };

describe("python", () => {
  it("prefers a venv in cwd, then .venv before venv", async () => {
    const { detector } = make({
      platform: "linux",
      files: ["/vault/proj/venv/bin/python", "/vault/.venv/bin/python"],
      which: { python3: "/usr/bin/python3" },
    });
    expect(await detector.resolve("python", ctx)).toEqual({ command: "/vault/proj/venv/bin/python", prefixArgs: [] });
  });

  it("falls back to the venv in the vault root, then PATH", async () => {
    const a = make({ platform: "linux", files: ["/vault/.venv/bin/python"], which: { python3: "/usr/bin/python3" } });
    expect(await a.detector.resolve("python", ctx)).toEqual({ command: "/vault/.venv/bin/python", prefixArgs: [] });
    const b = make({ platform: "linux", which: { python3: "/usr/bin/python3", python: "/usr/bin/python" } });
    expect(await b.detector.resolve("python", ctx)).toEqual({ command: "/usr/bin/python3", prefixArgs: [] });
    const c = make({ platform: "linux", which: { python: "/usr/bin/python" } });
    expect(await c.detector.resolve("python", ctx)).toEqual({ command: "/usr/bin/python", prefixArgs: [] });
  });

  it("uses Scripts\\python.exe on Windows", async () => {
    const venv = "C:\\vault\\proj\\.venv\\Scripts\\python.exe";
    const { detector } = make({ platform: "win32", files: [venv] });
    expect(await detector.resolve("python", wctx)).toEqual({ command: venv, prefixArgs: [] });
  });

  it("skips the WindowsApps stub when py is available", async () => {
    const stub = "C:\\Users\\me\\AppData\\Local\\Microsoft\\WindowsApps\\python.exe";
    const { detector } = make({ platform: "win32", which: { python: stub, py: "C:\\Windows\\py.exe" } });
    expect(await detector.resolve("python", wctx)).toEqual({ command: "C:\\Windows\\py.exe", prefixArgs: ["-3"] });
  });

  it("uses the stub only as a last resort", async () => {
    const stub = "C:\\Users\\me\\AppData\\Local\\Microsoft\\WindowsApps\\python.exe";
    const { detector } = make({ platform: "win32", which: { python: stub } });
    expect(await detector.resolve("python", wctx)).toEqual({ command: stub, prefixArgs: [] });
  });

  it("prefers a real python over py on Windows", async () => {
    const { detector } = make({ platform: "win32", which: { python: "C:\\Python312\\python.exe", py: "C:\\Windows\\py.exe" } });
    expect(await detector.resolve("python", wctx)).toEqual({ command: "C:\\Python312\\python.exe", prefixArgs: [] });
  });

  it("reports a missing interpreter", async () => {
    const { detector } = make({ platform: "linux" });
    expect(await detector.resolve("python", ctx)).toEqual({
      error: "Interpreter for python not found. Set its path in Settings > AI Ecosystem > Scripts.",
    });
  });
});

describe("node", () => {
  it("uses node from PATH and never process.execPath", async () => {
    const { detector, lookups } = make({ platform: "linux", which: { node: "/usr/bin/node" } });
    expect(await detector.resolve("node", ctx)).toEqual({ command: "/usr/bin/node", prefixArgs: [] });
    expect(lookups).toEqual(["node"]);
    const none = make({ platform: "linux" });
    expect("error" in (await none.detector.resolve("node", ctx))).toBe(true);
  });
});

describe("bash", () => {
  const env = {
    ProgramFiles: "C:\\Program Files",
    "ProgramFiles(x86)": "C:\\Program Files (x86)",
    LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local",
  };

  it("prefers Git Bash over PATH (WSL) on Windows", async () => {
    const git = "C:\\Program Files\\Git\\bin\\bash.exe";
    const { detector } = make({ platform: "win32", env, files: [git], which: { bash: "C:\\Windows\\System32\\bash.exe" } });
    expect(await detector.resolve("bash", wctx)).toEqual({ command: git, prefixArgs: [] });
  });

  it("checks the x86 and per-user Git locations", async () => {
    const x86 = "C:\\Program Files (x86)\\Git\\bin\\bash.exe";
    expect(await make({ platform: "win32", env, files: [x86] }).detector.resolve("bash", wctx)).toEqual({
      command: x86,
      prefixArgs: [],
    });
    const local = "C:\\Users\\me\\AppData\\Local\\Programs\\Git\\bin\\bash.exe";
    expect(await make({ platform: "win32", env, files: [local] }).detector.resolve("bash", wctx)).toEqual({
      command: local,
      prefixArgs: [],
    });
  });

  it("falls back to bash on PATH on Windows", async () => {
    const { detector } = make({ platform: "win32", env, which: { bash: "C:\\Windows\\System32\\bash.exe" } });
    expect(await detector.resolve("bash", wctx)).toEqual({ command: "C:\\Windows\\System32\\bash.exe", prefixArgs: [] });
  });

  it("uses bash then sh on posix", async () => {
    expect(await make({ platform: "linux", which: { bash: "/bin/bash", sh: "/bin/sh" } }).detector.resolve("bash", ctx)).toEqual({
      command: "/bin/bash",
      prefixArgs: [],
    });
    expect(await make({ platform: "linux", which: { sh: "/bin/sh" } }).detector.resolve("bash", ctx)).toEqual({
      command: "/bin/sh",
      prefixArgs: [],
    });
  });
});

describe("powershell", () => {
  it("tries pwsh before powershell.exe on Windows", async () => {
    const both = make({ platform: "win32", which: { pwsh: "C:\\pwsh.exe", "powershell.exe": "C:\\ps.exe" } });
    expect(await both.detector.resolve("powershell", wctx)).toEqual({ command: "C:\\pwsh.exe", prefixArgs: [] });
    const legacy = make({ platform: "win32", which: { "powershell.exe": "C:\\ps.exe" } });
    expect(await legacy.detector.resolve("powershell", wctx)).toEqual({ command: "C:\\ps.exe", prefixArgs: [] });
  });

  it("only looks for pwsh on posix", async () => {
    const { detector, lookups } = make({ platform: "linux", which: { "powershell.exe": "/x" } });
    expect("error" in (await detector.resolve("powershell", ctx))).toBe(true);
    expect(lookups).toEqual(["pwsh"]);
  });
});

describe("override", () => {
  it("wins over detection when it exists", async () => {
    const { detector, lookups } = make({ platform: "linux", files: ["/opt/py/bin/python"], which: { python3: "/usr/bin/python3" } });
    expect(await detector.resolve("python", { ...ctx, override: "/opt/py/bin/python" })).toEqual({
      command: "/opt/py/bin/python",
      prefixArgs: [],
    });
    expect(lookups).toEqual([]);
  });

  it("accepts a bare command found on PATH and reports a broken path", async () => {
    const { detector } = make({ platform: "linux", which: { python3: "/usr/bin/python3" } });
    expect(await detector.resolve("python", { ...ctx, override: "python3" })).toEqual({ command: "/usr/bin/python3", prefixArgs: [] });
    const r = await detector.resolve("python", { ...ctx, override: "/nope/python" });
    expect("error" in r && r.error).toContain("/nope/python");
  });
});

describe("cache and args", () => {
  it("caches PATH lookups until cleared", async () => {
    const { detector, lookups } = make({ platform: "linux", which: { node: "/usr/bin/node" } });
    await detector.resolve("node", ctx);
    await detector.resolve("node", ctx);
    expect(lookups).toEqual(["node"]);
    detector.clearCache();
    await detector.resolve("node", ctx);
    expect(lookups).toEqual(["node", "node"]);
  });

  it("builds interpreter arguments", () => {
    const d = make({ platform: "linux" }).detector;
    expect(d.buildArgs("python", "/s.py", ["a"], ["-3"])).toEqual(["-3", "/s.py", "a"]);
    expect(d.buildArgs("node", "/s.js", ["a"], [])).toEqual(["/s.js", "a"]);
    expect(d.buildArgs("bash", "/s.sh", ["a"], [])).toEqual(["/s.sh", "a"]);
    expect(d.buildArgs("powershell", "/s.ps1", ["a"], [])).toEqual([
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      "/s.ps1",
      "a",
    ]);
  });

  it("gives bash forward slashes on Windows", () => {
    const d = make({ platform: "win32" }).detector;
    expect(d.buildArgs("bash", "C:\\vault\\Scripts\\a.sh", [], [])).toEqual(["C:/vault/Scripts/a.sh"]);
  });
});
