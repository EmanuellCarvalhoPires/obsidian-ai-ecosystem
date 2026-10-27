import * as fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ScriptEngine } from "../../src/runner/script-engine";
import { clipOutput, createScriptRoutes, createScriptTools, inferLanguage, listAllowedScripts } from "../../src/runner/script-tools";
import type { ScriptsLookup } from "../../src/runner/script-tools";
import type { HubCallContext, HubRequest, ScriptSettings } from "../../src/types";
import { makeVault, nodeDetector, recordingSink, redactTopSecret, removeVault, settings, writeFile } from "./helpers";
import type { RecordedActivity } from "./helpers";

let vault: string;
let current: ScriptSettings;
let declared: string[];
let rec: RecordedActivity;

const ctx: HubCallContext = { client: { id: "c1", name: "Claude Code" }, moduleId: "ai-ecosystem" };

function deps(getScriptsService?: () => ScriptsLookup | undefined) {
  const engine = new ScriptEngine({
    vaultBasePath: vault,
    getSettings: () => current,
    getDeclaredScripts: () => declared,
    getSecrets: () => undefined,
    redact: redactTopSecret,
    activity: rec.sink,
    isRegisteredModule: (id) => id === "ai-ecosystem",
    detector: nodeDetector(),
  });
  return { engine, vaultBasePath: vault, getSettings: () => current, getDeclaredScripts: () => declared, getScriptsService };
}

function tool(name: string, getScriptsService?: () => ScriptsLookup | undefined) {
  const t = createScriptTools(deps(getScriptsService)).find((x) => x.name === name);
  if (!t) throw new Error("missing tool " + name);
  return t;
}

beforeEach(() => {
  vault = makeVault();
  current = settings();
  declared = [];
  rec = recordingSink();
});

afterEach(() => removeVault(vault));

describe("inferLanguage", () => {
  it("maps extensions", () => {
    expect(inferLanguage("a/b.PY")).toBe("python");
    expect(inferLanguage("x.js")).toBe("node");
    expect(inferLanguage("x.mjs")).toBe("node");
    expect(inferLanguage("x.cjs")).toBe("node");
    expect(inferLanguage("x.sh")).toBe("bash");
    expect(inferLanguage("x.ps1")).toBe("powershell");
    expect(inferLanguage("x.txt")).toBeUndefined();
    expect(inferLanguage("noext")).toBeUndefined();
  });
});

describe("listAllowedScripts", () => {
  it("walks allowed folders, adds declared scripts, and skips noise", async () => {
    writeFile(vault, "Scripts/b.py", "");
    writeFile(vault, "Scripts/a.js", "");
    writeFile(vault, "Scripts/readme.md", "");
    writeFile(vault, "Scripts/sub/deep.sh", "");
    writeFile(vault, "Scripts/.hidden/x.py", "");
    writeFile(vault, "Scripts/node_modules/pkg/x.js", "");
    writeFile(vault, "Scripts2/nope.py", "");
    writeFile(vault, "Notes/declared.ps1", "");
    const list = await listAllowedScripts(vault, ["Scripts/", "Missing"], ["Notes/declared.ps1", "Notes/missing.py", "Notes/readme.md", "Scripts/a.js"]);
    expect(list).toEqual([
      { path: "Notes/declared.ps1", language: "powershell" },
      { path: "Scripts/a.js", language: "node" },
      { path: "Scripts/b.py", language: "python" },
      { path: "Scripts/sub/deep.sh", language: "bash" },
    ]);
  });

  it("limits depth and file count", async () => {
    writeFile(vault, "S/1/2/3/4/5/6/ok.py", "");
    writeFile(vault, "S/1/2/3/4/5/6/7/too-deep.py", "");
    const depth = await listAllowedScripts(vault, ["S"], []);
    expect(depth.map((s) => s.path)).toEqual(["S/1/2/3/4/5/6/ok.py"]);
    for (let i = 0; i < 520; i++) writeFile(vault, `Many/f${String(i).padStart(4, "0")}.py`, "");
    expect(await listAllowedScripts(vault, ["Many"], [])).toHaveLength(500);
  });

  it("ignores traversal in the folder list", async () => {
    writeFile(vault, "Scripts/a.py", "");
    expect(await listAllowedScripts(vault, ["..", "../x", "/", ""], [])).toEqual([]);
  });
});

describe("ecosystem_list_scripts", () => {
  it("lists only the paths, one per line, with structured content", async () => {
    writeFile(vault, "Scripts/a.js", "");
    writeFile(vault, "Scripts/b.py", "");
    const t = tool("ecosystem_list_scripts");
    expect(t.annotations?.readOnlyHint).toBe(true);
    const res = await t.handler({}, ctx);
    expect(res.isError).toBeUndefined();
    expect(res.structuredContent).toEqual({ scripts: ["Scripts/a.js", "Scripts/b.py"], restrictionsOn: true });
    expect(res.content[0]).toEqual({ type: "text", text: "Scripts/a.js\nScripts/b.py" });
    current = settings({ restrictionsDisabled: true });
    expect((await t.handler({}, ctx)).structuredContent?.restrictionsOn).toBe(false);
  });

  it("explains when nothing is available", async () => {
    current = settings({ allowedFolders: [] });
    const res = await tool("ecosystem_list_scripts").handler({}, ctx);
    expect(res.content[0]).toMatchObject({ type: "text" });
    expect((res.content[0] as { text: string }).text).toContain("Allowed folders");
  });
});

describe("ecosystem_run_script", () => {
  it("has a schema agents can use", () => {
    const t = tool("ecosystem_run_script");
    const props = (t.inputSchema as { properties: Record<string, unknown> }).properties;
    expect(Object.keys(props).sort()).toEqual(["args", "code", "cwd", "env", "language", "max_chars", "path", "script_id", "timeoutSeconds"]);
    expect(t.description.length).toBeLessThanOrEqual(300);
    expect(t.description).toContain("script_id");
    const described = props as Record<string, { description: string }>;
    expect(described.env.description).toContain("placeholders");
    expect(described.code.description).toContain("restrictions");
  });

  it("runs the file that AI Scripts registered for a script_id", async () => {
    writeFile(vault, "Scripts/hello.js", `console.log("oi")`);
    const service = { listScripts: () => [{ scriptId: "hello", scriptPath: "Scripts/hello.js" }] };
    const res = await tool("ecosystem_run_script", () => service).handler({ script_id: "hello" }, ctx);
    expect(res.isError).toBe(false);
    expect((res.content[0] as { text: string }).text).toContain("oi");
  });

  it("replies with list_ai_scripts and path when the script_id is unknown", async () => {
    const service = { listScripts: () => [{ scriptId: "other", scriptPath: "Scripts/other.js" }] };
    const res = await tool("ecosystem_run_script", () => service).handler({ script_id: "nope" }, ctx);
    expect(res.isError).toBe(true);
    const text = (res.content[0] as { text: string }).text;
    expect(text).toContain("not registered in AI Scripts");
    expect(text).toContain("list_ai_scripts");
    expect(text).toContain("path");
  });

  it("treats malformed items from AI Scripts as unregistered", async () => {
    const service = { listScripts: () => [null, "hello", { scriptId: 5, scriptPath: "Scripts/x.js" }] as unknown[] };
    const res = await tool("ecosystem_run_script", () => service).handler({ script_id: "hello" }, ctx);
    expect(res.isError).toBe(true);
    expect((res.content[0] as { text: string }).text).toContain("not registered in AI Scripts");
  });

  it("says AI Scripts is not available when there is no service", async () => {
    const res = await tool("ecosystem_run_script").handler({ script_id: "hello" }, ctx);
    expect(res.isError).toBe(true);
    expect((res.content[0] as { text: string }).text).toContain("AI Scripts is not available");
  });

  it("says AI Scripts is not available when listing its scripts throws", async () => {
    const service = {
      listScripts: () => {
        throw new Error("boom");
      },
    };
    const res = await tool("ecosystem_run_script", () => service).handler({ script_id: "hello" }, ctx);
    expect(res.isError).toBe(true);
    expect((res.content[0] as { text: string }).text).toContain("AI Scripts is not available");
  });

  it("points a script without a file to run_ai_script", async () => {
    const service = { listScripts: () => [{ scriptId: "note-only" }] };
    const res = await tool("ecosystem_run_script", () => service).handler({ script_id: "note-only" }, ctx);
    expect(res.isError).toBe(true);
    expect((res.content[0] as { text: string }).text).toContain("run_ai_script");
  });

  it("refuses path and script_id together", async () => {
    const service = { listScripts: () => [{ scriptId: "hello", scriptPath: "Scripts/hello.js" }] };
    const res = await tool("ecosystem_run_script", () => service).handler({ path: "Scripts/a.js", script_id: "hello" }, ctx);
    expect(res.isError).toBe(true);
    expect((res.content[0] as { text: string }).text).toContain("Give path or script_id, not both.");
  });

  it("asks for path or script_id when neither comes", async () => {
    const res = await tool("ecosystem_run_script").handler({ args: ["x"] }, ctx);
    expect(res.isError).toBe(true);
    expect((res.content[0] as { text: string }).text).toContain("script_id");
  });

  it("lets the engine refuse a script_id that resolves outside the allowed folders", async () => {
    writeFile(vault, "Other/x.js", `console.log("never")`);
    const service = { listScripts: () => [{ scriptId: "outside", scriptPath: "Other/x.js" }] };
    const res = await tool("ecosystem_run_script", () => service).handler({ script_id: "outside" }, ctx);
    expect(res.isError).toBe(true);
    expect((res.content[0] as { text: string }).text).toContain("Script refused");
    expect(res.structuredContent).toMatchObject({ refused: "path-not-allowed" });
  });

  it("runs a script, infers the language and reports the result", async () => {
    writeFile(vault, "Scripts/a.js", `console.log("hi " + process.argv[2]); console.error("warn TOPSECRET");`);
    const res = await tool("ecosystem_run_script").handler({ path: "Scripts/a.js", args: ["there"] }, ctx);
    expect(res.isError).toBe(false);
    const text = (res.content[0] as { text: string }).text;
    expect(text).toContain("Exit code: 0");
    expect(text).toContain("hi there");
    expect(text).toContain("warn ***");
    expect(res.structuredContent).toMatchObject({ exitCode: 0, killed: false, truncated: false });
    expect(res.structuredContent).not.toHaveProperty("stdout");
    expect(res.structuredContent).not.toHaveProperty("stderr");
    expect(rec.begins[0]).toMatchObject({ moduleId: "ai-ecosystem", client: "Claude Code" });
  });

  it("flags a non-zero exit as an error", async () => {
    writeFile(vault, "Scripts/f.js", `process.exit(4)`);
    const res = await tool("ecosystem_run_script").handler({ path: "Scripts/f.js" }, ctx);
    expect(res.isError).toBe(true);
    expect(res.structuredContent?.exitCode).toBe(4);
  });

  it("truncates long output for the agent and saves the full text to a file", async () => {
    writeFile(vault, "Scripts/big.js", `process.stdout.write("a".repeat(50000) + "END")`);
    const res = await tool("ecosystem_run_script").handler({ path: "Scripts/big.js" }, ctx);
    const text = (res.content[0] as { text: string }).text;
    expect(text).toContain("characters omitted");
    expect(text).toContain("full output in");
    const shown = text.slice(text.indexOf("stdout:\n"), text.indexOf("\n\nstderr:"));
    expect(shown.endsWith("END")).toBe(true);
    expect(res.structuredContent?.truncated).toBe(true);
    expect(res.structuredContent).not.toHaveProperty("stdout");
    const file = res.structuredContent?.stdout_file as string;
    try {
      expect(fs.readFileSync(file, "utf8")).toBe("a".repeat(50000) + "END");
    } finally {
      fs.rmSync(file, { force: true });
    }
  });

  it("caps each stream at 4000 characters by default, with the file path in the marker", async () => {
    writeFile(vault, "Scripts/ten.js", `process.stdout.write("x".repeat(10000))`);
    const res = await tool("ecosystem_run_script").handler({ path: "Scripts/ten.js" }, ctx);
    const text = (res.content[0] as { text: string }).text;
    const file = res.structuredContent?.stdout_file as string;
    try {
      const marker = /\n\[\.\.\. \d+ characters omitted; full output in (.+?) \.\.\.\]\n/.exec(text);
      expect(marker).not.toBeNull();
      expect(marker![1]).toBe(file);
      expect(fs.existsSync(file)).toBe(true);
      expect(fs.readFileSync(file, "utf8")).toHaveLength(10000);
      const section = text.slice(text.indexOf("stdout:\n") + "stdout:\n".length, text.indexOf("\n\nstderr:"));
      expect(section).toContain("6000 characters omitted");
      expect(section.length).toBeLessThanOrEqual(4000 + marker![0].length);
      expect(section.startsWith("x".repeat(1000))).toBe(true);
    } finally {
      fs.rmSync(file, { force: true });
    }
  });

  it("honours max_chars", async () => {
    writeFile(vault, "Scripts/ten2.js", `process.stdout.write("y".repeat(10000))`);
    const res = await tool("ecosystem_run_script").handler({ path: "Scripts/ten2.js", max_chars: 100 }, ctx);
    const text = (res.content[0] as { text: string }).text;
    const section = text.slice(text.indexOf("stdout:\n") + "stdout:\n".length, text.indexOf("\n\nstderr:"));
    const marker = /\n\[\.\.\. \d+ characters omitted; full output in .+? \.\.\.\]\n/.exec(section);
    expect(marker).not.toBeNull();
    expect(section.length - marker![0].length).toBe(100);
    const file = res.structuredContent?.stdout_file as string;
    fs.rmSync(file, { force: true });
  });

  it("passes short output intact, without a marker or a file", async () => {
    writeFile(vault, "Scripts/ok.js", `process.stdout.write("ok")`);
    const res = await tool("ecosystem_run_script").handler({ path: "Scripts/ok.js" }, ctx);
    const text = (res.content[0] as { text: string }).text;
    expect(text).toContain("ok");
    expect(text).not.toContain("characters omitted");
    expect(res.structuredContent?.truncated).toBe(false);
    expect(res.structuredContent).not.toHaveProperty("stdout_file");
    expect(res.structuredContent).not.toHaveProperty("stdout");
    expect(res.structuredContent).not.toHaveProperty("stderr");
  });

  it("rejects max_chars below 1", async () => {
    writeFile(vault, "Scripts/zero.js", `console.log("z")`);
    const res = await tool("ecosystem_run_script").handler({ path: "Scripts/zero.js", max_chars: 0 }, ctx);
    expect(res.isError).toBe(true);
    expect((res.content[0] as { text: string }).text).toContain("max_chars must be a positive integer.");
  });

  it("clipOutput keeps a quarter of the head and the rest from the end", () => {
    const clipped = clipOutput("0123456789".repeat(10), 20, "out");
    expect(clipped.omitted).toBe(80);
    expect(clipped.text.startsWith("01234")).toBe(true);
    expect(clipped.text.endsWith("0123456789")).toBe(true);
    if (clipped.file) fs.rmSync(clipped.file, { force: true });
  });

  it("reports refusals as tool errors", async () => {
    writeFile(vault, "Other/x.js", "");
    const t = tool("ecosystem_run_script");
    const outside = await t.handler({ path: "Other/x.js" }, ctx);
    expect(outside.isError).toBe(true);
    expect(outside.structuredContent).toMatchObject({ refused: "path-not-allowed" });
    const inline = await t.handler({ code: "console.log(1)", language: "node" }, ctx);
    expect(inline.isError).toBe(true);
    expect((inline.content[0] as { text: string }).text).toContain("Inline code is refused");
    expect(rec.logs.map((l) => l.status)).toEqual([403, 403]);
    // The refusal starts with the engine's message and carries the rules that apply.
    const refusal = (outside.content[0] as { text: string }).text;
    expect(refusal.startsWith("Script refused (")).toBe(true);
    expect(refusal).toContain("allowed script folders");
  });

  it("runs inline code when the restrictions are off", async () => {
    current = settings({ restrictionsDisabled: true });
    const res = await tool("ecosystem_run_script").handler({ code: "console.log(6*7)", language: "node" }, ctx);
    expect(res.isError).toBe(false);
    expect((res.content[0] as { text: string }).text).toContain("stdout:\n42\n");
  });

  it("validates its arguments", async () => {
    const t = tool("ecosystem_run_script");
    const bad: Array<Record<string, unknown>> = [
      {},
      { path: "Scripts/x.txt" },
      { code: "1" },
      { path: "Scripts/a.js", args: "nope" },
      { path: "Scripts/a.js", args: [1] },
      { path: "Scripts/a.js", env: { A: 1 } },
      { path: "Scripts/a.js", timeoutSeconds: "5" },
      { path: "Scripts/a.js", language: "ruby" },
    ];
    for (const args of bad) {
      const res = await t.handler(args, ctx);
      expect(res.isError, JSON.stringify(args)).toBe(true);
      expect((res.content[0] as { text: string }).text).toContain("Invalid arguments");
    }
  });

  it("kills the script when the call is aborted", async () => {
    writeFile(vault, "Scripts/sleep.js", `setTimeout(function () {}, 30000);`);
    const controller = new AbortController();
    const t = tool("ecosystem_run_script");
    const started = Date.now();
    const pending = t.handler({ path: "Scripts/sleep.js" }, { ...ctx, signal: controller.signal });
    setTimeout(() => controller.abort(), 300);
    const res = await pending;
    expect(Date.now() - started).toBeLessThan(10000);
    expect(res.structuredContent).toMatchObject({ killed: true });
    expect((res.content[0] as { text: string }).text).toContain("Killed: yes");
  }, 15000);
});

describe("script routes", () => {
  function req(over: Partial<HubRequest>): HubRequest {
    return {
      method: "GET",
      path: "/scripts",
      fullPath: "/api/v1/ai-ecosystem/scripts",
      params: {},
      query: {},
      headers: {},
      body: "",
      rawBody: "",
      client: ctx.client,
      ...over,
    };
  }
  const route = (method: string, path: string) => {
    const r = createScriptRoutes(deps()).find((x) => x.method === method && x.path === path);
    if (!r) throw new Error("missing route");
    return r;
  };

  it("GET /scripts lists", async () => {
    writeFile(vault, "Scripts/a.py", "");
    const res = await route("GET", "/scripts").handler(req({}));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ scripts: [{ path: "Scripts/a.py", language: "python" }], restrictionsOn: true });
  });

  it("POST /scripts/run returns 200 with the result", async () => {
    writeFile(vault, "Scripts/a.js", `console.log("route")`);
    const res = await route("POST", "/scripts/run").handler(req({ method: "POST", body: { path: "Scripts/a.js" } }));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ exitCode: 0, killed: false, stdout: "route\n", stderr: "", truncated: false });
    expect(res.body).not.toHaveProperty("stdout_file");
  });

  it("POST /scripts/run cuts long stdout to 4000 characters and saves the full text", async () => {
    writeFile(vault, "Scripts/ten-route.js", `process.stdout.write("x".repeat(10000))`);
    const res = await route("POST", "/scripts/run").handler(req({ method: "POST", body: { path: "Scripts/ten-route.js" } }));
    expect(res.status).toBe(200);
    const body = res.body as { stdout: string; truncated: boolean; stdout_file: string };
    expect(body.truncated).toBe(true);
    expect(body.stdout).toContain("characters omitted; full output in");
    const marker = /\n\[\.\.\. \d+ characters omitted; full output in (.+?) \.\.\.\]\n/.exec(body.stdout);
    expect(marker).not.toBeNull();
    expect(marker![1]).toBe(body.stdout_file);
    expect(body.stdout.length - marker![0].length).toBeLessThanOrEqual(4000);
    expect(fs.existsSync(body.stdout_file)).toBe(true);
    try {
      expect(fs.readFileSync(body.stdout_file, "utf8")).toBe("x".repeat(10000));
    } finally {
      fs.rmSync(body.stdout_file, { force: true });
    }
  });

  it("POST /scripts/run honours max_chars", async () => {
    writeFile(vault, "Scripts/fifty.js", `process.stdout.write("y".repeat(10000))`);
    const res = await route("POST", "/scripts/run").handler(req({ method: "POST", body: { path: "Scripts/fifty.js", max_chars: 50 } }));
    expect(res.status).toBe(200);
    const body = res.body as { stdout: string; truncated: boolean; stdout_file?: string };
    expect(body.truncated).toBe(true);
    const marker = /\n\[\.\.\. \d+ characters omitted; full output in .+? \.\.\.\]\n/.exec(body.stdout);
    expect(marker).not.toBeNull();
    expect(body.stdout.length - marker![0].length).toBe(50);
    if (body.stdout_file) fs.rmSync(body.stdout_file, { force: true });
  });

  it("POST /scripts/run answers 400 for max_chars 0", async () => {
    writeFile(vault, "Scripts/zero-route.js", `console.log("z")`);
    const res = await route("POST", "/scripts/run").handler(req({ method: "POST", body: { path: "Scripts/zero-route.js", max_chars: 0 } }));
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: { code: "invalid-request" } });
  });

  it("POST /scripts/run answers 403 on refusal and 400 on bad bodies", async () => {
    const run = route("POST", "/scripts/run");
    const refused = await run.handler(req({ method: "POST", body: { code: "1", language: "node" } }));
    expect(refused.status).toBe(403);
    expect(refused.body).toMatchObject({ error: { code: "inline-refused" } });
    const bad = await run.handler(req({ method: "POST", body: "not json" }));
    expect(bad.status).toBe(400);
    expect(bad.body).toMatchObject({ error: { code: "invalid-request" } });
  });
});
