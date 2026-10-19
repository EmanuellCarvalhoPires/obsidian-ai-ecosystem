import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BinaryDetector } from "../../src/runner/binary-detector";
import { ScriptEngine, ScriptRefusedError } from "../../src/runner/script-engine";
import type { ScriptSettings, SecretVaultService } from "../../src/types";
import {
  fakeSecrets,
  makeVault,
  nodeDetector,
  recordingSink,
  redactTopSecret,
  removeVault,
  settings,
  writeFile,
} from "./helpers";
import type { RecordedActivity } from "./helpers";

const caller = { moduleId: "test-module" };

let vault: string;
let rec: RecordedActivity;
let current: ScriptSettings;
let secrets: SecretVaultService | undefined;
let tempDir: string;
let detector: BinaryDetector;

function engine(): ScriptEngine {
  return new ScriptEngine({
    vaultBasePath: vault,
    getSettings: () => current,
    getDeclaredScripts: () => [],
    getSecrets: () => secrets,
    redact: redactTopSecret,
    activity: rec.sink,
    isRegisteredModule: (id) => id === "test-module" || id === "ai-ecosystem",
    detector,
    tempDir,
  });
}

beforeEach(() => {
  vault = makeVault();
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "aie-tmp-"));
  rec = recordingSink();
  current = settings();
  secrets = undefined;
  detector = nodeDetector();
});

afterEach(() => {
  removeVault(vault);
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("ScriptEngine: running files", () => {
  it("returns exit code, stdout, stderr, args and cwd", async () => {
    writeFile(
      vault,
      "Scripts/a.js",
      `console.log("out:" + process.argv.slice(2).join("|"));
console.log("cwd:" + process.cwd());
console.error("err");
process.exit(3);`,
    );
    const result = await engine().run(
      { language: "node", scriptPath: "Scripts/a.js", args: ["one", "two words", 'q"uote'], cwd: "Scripts" },
      caller,
    );
    expect(result.exitCode).toBe(3);
    expect(result.killed).toBe(false);
    expect(result.stdout).toContain("out:one|two words|q\"uote");
    expect(fs.realpathSync(result.stdout.match(/cwd:(.*)/)![1].trim())).toBe(fs.realpathSync(path.join(vault, "Scripts")));
    expect(result.stderr.trim()).toBe("err");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("passes plain env to the child and never lists values in the activity", async () => {
    writeFile(vault, "Scripts/env.js", `console.log(process.env.AIE_PLAIN);`);
    const result = await engine().run(
      { language: "node", scriptPath: "Scripts/env.js", env: { AIE_PLAIN: "visible-value" } },
      caller,
    );
    expect(result.stdout.trim()).toBe("visible-value");
    expect(JSON.stringify(rec.begins[0].payload)).not.toContain("visible-value");
    expect((rec.begins[0].payload as { envKeys: string[] }).envKeys).toEqual(["AIE_PLAIN"]);
  });

  it("records activity begin and end", async () => {
    writeFile(vault, "Scripts/ok.js", `console.log("hello");`);
    await engine().run({ language: "node", scriptPath: "Scripts/ok.js", args: ["x"] }, { moduleId: "test-module", client: { id: "c1", name: "Claude Code" } });
    expect(rec.begins).toHaveLength(1);
    expect(rec.begins[0]).toMatchObject({
      kind: "script",
      method: "Script",
      target: "Scripts/ok.js",
      moduleId: "test-module",
      client: "Claude Code",
      alert: false,
    });
    expect(rec.begins[0].payload).toMatchObject({ language: "node", args: ["x"], timeoutSeconds: 300 });
    expect(rec.ends).toHaveLength(1);
    expect(rec.ends[0]).toMatchObject({ status: 200, response: { exitCode: 0, killed: false } });
    expect(rec.output.some((o) => o.stream === "stdout" && o.chunk.includes("hello"))).toBe(true);
  });

  it("uses module:<id> as client when no client is set and 500 for failures", async () => {
    writeFile(vault, "Scripts/fail.js", `process.exit(1)`);
    await engine().run({ language: "node", scriptPath: "Scripts/fail.js" }, caller);
    expect(rec.begins[0].client).toBe("module:test-module");
    expect(rec.ends[0].status).toBe(500);
  });

  it("maps a null exit code to -1", async () => {
    writeFile(vault, "Scripts/sig.js", `process.kill(process.pid, "SIGKILL"); setInterval(() => {}, 1000);`);
    const result = await engine().run({ language: "node", scriptPath: "Scripts/sig.js" }, caller);
    expect(result.exitCode).not.toBe(0);
  });
});

describe("ScriptEngine: redaction and streaming", () => {
  it("redacts streamed and final output, even when a secret is split across chunks", async () => {
    writeFile(
      vault,
      "Scripts/leak.js",
      `process.stdout.write("key=TOP");
setTimeout(() => { process.stdout.write("SECRET\\nsecond TOPSECRET line\\n"); process.stderr.write("e:TOPSECRET\\n"); }, 150);`,
    );
    const out: string[] = [];
    const err: string[] = [];
    const result = await engine().run(
      { language: "node", scriptPath: "Scripts/leak.js", onStdout: (d) => out.push(d), onStderr: (d) => err.push(d) },
      caller,
    );
    expect(result.stdout).toBe("key=***\nsecond *** line\n");
    expect(result.stderr).toBe("e:***\n");
    expect(out.join("")).toBe("key=***\nsecond *** line\n");
    expect(out.join("")).not.toContain("TOPSECRET");
    expect(err.join("")).toBe("e:***\n");
    expect(rec.output.map((o) => o.chunk).join("")).not.toContain("TOPSECRET");
    expect(rec.output.map((o) => o.chunk).join("")).toContain("key=***");
    expect(out[0]).toBe("key=***\n");
  });

  it("flushes a trailing line without newline on exit", async () => {
    writeFile(vault, "Scripts/tail.js", `process.stdout.write("no newline TOPSECRET");`);
    const out: string[] = [];
    const result = await engine().run({ language: "node", scriptPath: "Scripts/tail.js", onStdout: (d) => out.push(d) }, caller);
    expect(out).toEqual(["no newline ***"]);
    expect(result.stdout).toBe("no newline ***");
  });

  it("keeps only the last 1 MB of huge output", async () => {
    writeFile(
      vault,
      "Scripts/big.js",
      `const line = "x".repeat(99) + "\\n"; for (let i = 0; i < 30000; i++) process.stdout.write(line); process.stdout.write("THE END\\n");`,
    );
    const result = await engine().run({ language: "node", scriptPath: "Scripts/big.js" }, caller);
    expect(result.stdout.startsWith("[output truncated]\n")).toBe(true);
    expect(result.stdout.length).toBeLessThanOrEqual(1024 * 1024 + "[output truncated]\n".length);
    expect(result.stdout.endsWith("THE END\n")).toBe(true);
  });

  it("survives a throwing output listener", async () => {
    writeFile(vault, "Scripts/l.js", `console.log("a"); console.log("b");`);
    const result = await engine().run(
      {
        language: "node",
        scriptPath: "Scripts/l.js",
        onStdout: () => {
          throw new Error("boom");
        },
      },
      caller,
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("a\nb\n");
  });
});

describe("ScriptEngine: timeout and kill", () => {
  const forever = `console.log("started"); setInterval(() => {}, 1000);`;

  it("kills a script that exceeds the timeout", async () => {
    writeFile(vault, "Scripts/forever.js", forever);
    const started = Date.now();
    const result = await engine().run({ language: "node", scriptPath: "Scripts/forever.js", timeoutSeconds: 1 }, caller);
    expect(result.killed).toBe(true);
    expect(result.exitCode).not.toBe(0);
    expect(result.stdout).toContain("started");
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(rec.ends[0].status).toBe(408);
    expect(engine().runningCount()).toBe(0);
  });

  it("clamps the requested timeout to the setting", async () => {
    current = settings({ maxTimeoutSeconds: 1 });
    writeFile(vault, "Scripts/forever.js", forever);
    const result = await engine().run({ language: "node", scriptPath: "Scripts/forever.js", timeoutSeconds: 120 }, caller);
    expect(result.killed).toBe(true);
    expect((rec.begins[0].payload as { timeoutSeconds: number }).timeoutSeconds).toBe(1);
  });

  it("killAll stops every running child", async () => {
    writeFile(vault, "Scripts/forever.js", forever);
    const eng = engine();
    const runs = [
      eng.run({ language: "node", scriptPath: "Scripts/forever.js" }, caller),
      eng.run({ language: "node", scriptPath: "Scripts/forever.js" }, caller),
    ];
    const deadline = Date.now() + 10_000;
    while (eng.runningCount() < 2 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25));
    expect(eng.runningCount()).toBe(2);
    eng.killAll();
    const results = await Promise.all(runs);
    expect(results.every((r) => r.killed)).toBe(true);
    expect(eng.runningCount()).toBe(0);
  });

  it("writes stdin to the subprocess and closes it", async () => {
    writeFile(
      vault,
      "Scripts/stdin.js",
      `let data = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { data += chunk; });
process.stdin.on("end", () => { console.log("received:" + data); });`,
    );
    const result = await engine().run(
      { language: "node", scriptPath: "Scripts/stdin.js", stdin: '{"hello":"world"}' },
      caller,
    );
    expect(result.exitCode).toBe(0);
    expect(result.killed).toBe(false);
    expect(result.stdout.trim()).toBe('received:{"hello":"world"}');
  });

  it("kills a running script when signal is aborted", async () => {
    writeFile(vault, "Scripts/forever.js", forever);
    const eng = engine();
    const controller = new AbortController();
    const runPromise = eng.run(
      { language: "node", scriptPath: "Scripts/forever.js", signal: controller.signal },
      caller,
    );
    const deadline = Date.now() + 10_000;
    while (eng.runningCount() < 1 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25));
    expect(eng.runningCount()).toBe(1);
    controller.abort();
    const result = await runPromise;
    expect(result.killed).toBe(true);
    expect(rec.ends[0].status).toBe(408);
    expect(eng.runningCount()).toBe(0);
  });

  it("finishes immediately as killed when signal is already aborted before spawn", async () => {
    writeFile(vault, "Scripts/forever.js", forever);
    const controller = new AbortController();
    controller.abort();
    const result = await engine().run(
      { language: "node", scriptPath: "Scripts/forever.js", signal: controller.signal },
      caller,
    );
    expect(result.killed).toBe(true);
    expect(result.exitCode).toBe(-1);
    expect(rec.ends[0].status).toBe(408);
  });
});

describe("ScriptEngine: secrets", () => {
  it("resolves placeholders through spawnWithSecrets and redacts the output", async () => {
    const fake = fakeSecrets();
    secrets = fake;
    writeFile(vault, "Scripts/s.js", `console.log("got " + process.env.MY_KEY); console.error(process.env.MY_KEY); console.log(process.env.PLAIN);`);
    const out: string[] = [];
    const result = await engine().run(
      {
        language: "node",
        scriptPath: "Scripts/s.js",
        env: { MY_KEY: "{{secret:API_KEY}}", PLAIN: "p" },
        onStdout: (d) => out.push(d),
      },
      caller,
    );
    expect(fake.calls).toEqual(["test-module"]);
    expect(result.stdout).toBe("got ***\np\n");
    expect(result.stderr).toContain("***");
    expect(result.stderr).not.toContain("TOPSECRET");
    expect(out.join("")).not.toContain("TOPSECRET");
    const payload = JSON.stringify(rec.begins[0].payload);
    expect(payload).not.toContain("TOPSECRET");
    expect(payload).not.toContain("API_KEY");
    expect((rec.begins[0].payload as { envKeys: string[] }).envKeys).toEqual(["MY_KEY", "PLAIN"]);
    expect(JSON.stringify(rec.ends)).not.toContain("TOPSECRET");
  });

  it("refuses with secrets-unavailable and secrets-locked", async () => {
    writeFile(vault, "Scripts/s.js", `console.log(1)`);
    const run = () =>
      engine().run({ language: "node", scriptPath: "Scripts/s.js", env: { K: "{{secret:A}}" } }, caller);
    await expect(run()).rejects.toMatchObject({ code: "secrets-unavailable" });
    secrets = fakeSecrets(true);
    await expect(run()).rejects.toMatchObject({ code: "secrets-locked" });
  });

  it("turns a spawnWithSecrets rejection into secrets-refused (redacted)", async () => {
    secrets = {
      isLocked: () => false,
      redact: redactTopSecret,
      spawnWithSecrets: async () => {
        throw new Error("Unknown secret TOPSECRET");
      },
    };
    writeFile(vault, "Scripts/s.js", `console.log(1)`);
    const err = await engine()
      .run({ language: "node", scriptPath: "Scripts/s.js", env: { K: "{{secret:A}}" } }, caller)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ScriptRefusedError);
    expect((err as ScriptRefusedError).code).toBe("secrets-refused");
    expect((err as ScriptRefusedError).message).toBe("Unknown secret ***");
    expect(rec.ends[0].status).toBe(403);
  });
});

describe("ScriptEngine: inline code and refusals", () => {
  it("refuses inline code while restricted and logs 403", async () => {
    const err = await engine()
      .run({ language: "node", scriptPath: "", inlineCode: "console.log(1)" }, caller)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ScriptRefusedError);
    expect((err as ScriptRefusedError).code).toBe("inline-refused");
    expect((err as ScriptRefusedError).message).toBe(
      "Inline code is refused while the Script Engine restrictions are on. Turn them off in Settings > AI Ecosystem > Scripts.",
    );
    expect(rec.logs).toHaveLength(1);
    expect(rec.logs[0]).toMatchObject({
      kind: "script",
      method: "Script",
      status: 403,
      moduleId: "test-module",
      response: { refused: "inline-refused" },
    });
    expect(rec.begins).toHaveLength(0);
  });

  it("logs other policy refusals (outside the allowed folders, unknown caller)", async () => {
    writeFile(vault, "Other/x.js", `console.log(1)`);
    await expect(engine().run({ language: "node", scriptPath: "Other/x.js" }, caller)).rejects.toMatchObject({ code: "path-not-allowed" });
    await expect(engine().run({ language: "node", scriptPath: "Scripts/x.js" }, { moduleId: "stranger" })).rejects.toMatchObject({
      code: "caller-not-registered",
    });
    expect(rec.logs.map((l) => l.status)).toEqual([403, 403]);
    expect(rec.logs[1].client).toBe("module:stranger");
  });

  it("runs inline code with the restrictions off, flags it, and removes the temp file", async () => {
    current = settings({ restrictionsDisabled: true, allowedFolders: [] });
    const result = await engine().run(
      { language: "node", scriptPath: "", inlineCode: `console.log("inline " + process.argv.slice(2).join(","))`, args: ["a", "b"] },
      caller,
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("inline a,b");
    expect(rec.begins[0]).toMatchObject({ alert: true, target: "inline (node)" });
    expect(fs.readdirSync(tempDir)).toEqual([]);
  });

  it("removes the inline temp file even when the script fails", async () => {
    current = settings({ restrictionsDisabled: true });
    const result = await engine().run({ language: "node", scriptPath: "", inlineCode: "process.exit(7)" }, caller);
    expect(result.exitCode).toBe(7);
    expect(fs.readdirSync(tempDir)).toEqual([]);
  });

  it("runs an absolute script outside the vault with the restrictions off", async () => {
    current = settings({ restrictionsDisabled: true, allowedFolders: [] });
    const outside = path.join(tempDir, "outside.js");
    fs.writeFileSync(outside, `console.log("outside")`);
    const result = await engine().run({ language: "node", scriptPath: outside }, caller);
    expect(result.stdout.trim()).toBe("outside");
    expect(rec.begins[0].alert).toBe(true);
  });
});

describe("ScriptEngine: interpreter problems", () => {
  it("throws interpreter-not-found when the detector finds nothing", async () => {
    detector = new BinaryDetector({ which: async () => undefined });
    writeFile(vault, "Scripts/a.js", `console.log(1)`);
    await expect(engine().run({ language: "node", scriptPath: "Scripts/a.js" }, caller)).rejects.toMatchObject({
      code: "interpreter-not-found",
    });
    expect(rec.logs).toHaveLength(1);
    expect(rec.begins).toHaveLength(0);
  });

  it("throws interpreter-not-found on spawn ENOENT and ends the activity", async () => {
    detector = new BinaryDetector({ which: async () => path.join(tempDir, "no-such-binary") });
    writeFile(vault, "Scripts/a.js", `console.log(1)`);
    await expect(engine().run({ language: "node", scriptPath: "Scripts/a.js" }, caller)).rejects.toMatchObject({
      code: "interpreter-not-found",
    });
    expect(rec.ends).toHaveLength(1);
    expect(rec.ends[0].status).toBe(500);
    expect(engine().runningCount()).toBe(0);
  });

  it("uses the interpreter path from the settings", async () => {
    detector = new BinaryDetector({ which: async () => undefined });
    current = settings({ interpreterPaths: { node: process.execPath } });
    writeFile(vault, "Scripts/a.js", `console.log("override")`);
    const result = await engine().run({ language: "node", scriptPath: "Scripts/a.js" }, caller);
    expect(result.stdout.trim()).toBe("override");
  });
});
