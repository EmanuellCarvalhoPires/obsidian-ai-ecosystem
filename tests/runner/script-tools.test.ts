import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ScriptEngine } from "../../src/runner/script-engine";
import { createScriptRoutes, createScriptTools, inferLanguage, listAllowedScripts } from "../../src/runner/script-tools";
import type { HubCallContext, HubRequest, ScriptSettings } from "../../src/types";
import { makeVault, nodeDetector, recordingSink, redactTopSecret, removeVault, settings, writeFile } from "./helpers";
import type { RecordedActivity } from "./helpers";

let vault: string;
let current: ScriptSettings;
let declared: string[];
let rec: RecordedActivity;

const ctx: HubCallContext = { client: { id: "c1", name: "Claude Code" }, moduleId: "ai-ecosystem" };

function deps() {
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
  return { engine, vaultBasePath: vault, getSettings: () => current, getDeclaredScripts: () => declared };
}

function tool(name: string) {
  const t = createScriptTools(deps()).find((x) => x.name === name);
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
  it("lists scripts with structured content", async () => {
    writeFile(vault, "Scripts/a.js", "");
    const t = tool("ecosystem_list_scripts");
    expect(t.annotations?.readOnlyHint).toBe(true);
    const res = await t.handler({}, ctx);
    expect(res.isError).toBeUndefined();
    expect(res.structuredContent).toEqual({ scripts: [{ path: "Scripts/a.js", language: "node" }], restrictionsOn: true });
    expect(res.content[0]).toEqual({ type: "text", text: "Scripts/a.js (node)" });
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
    expect(Object.keys(props).sort()).toEqual(["args", "code", "cwd", "env", "language", "path", "timeoutSeconds"]);
    expect(t.description).toMatch(/restrictions/i);
  });

  it("runs a script, infers the language and reports the result", async () => {
    writeFile(vault, "Scripts/a.js", `console.log("hi " + process.argv[2]); console.error("warn TOPSECRET");`);
    const res = await tool("ecosystem_run_script").handler({ path: "Scripts/a.js", args: ["there"] }, ctx);
    expect(res.isError).toBe(false);
    const text = (res.content[0] as { text: string }).text;
    expect(text).toContain("Exit code: 0");
    expect(text).toContain("hi there");
    expect(text).toContain("warn ***");
    expect(res.structuredContent).toMatchObject({ exitCode: 0, killed: false, stdout: "hi there\n", stderr: "warn ***\n" });
    expect(rec.begins[0]).toMatchObject({ moduleId: "ai-ecosystem", client: "Claude Code" });
  });

  it("flags a non-zero exit as an error", async () => {
    writeFile(vault, "Scripts/f.js", `process.exit(4)`);
    const res = await tool("ecosystem_run_script").handler({ path: "Scripts/f.js" }, ctx);
    expect(res.isError).toBe(true);
    expect(res.structuredContent?.exitCode).toBe(4);
  });

  it("truncates long output for the agent", async () => {
    writeFile(vault, "Scripts/big.js", `process.stdout.write("a".repeat(50000) + "END")`);
    const res = await tool("ecosystem_run_script").handler({ path: "Scripts/big.js" }, ctx);
    const stdout = res.structuredContent?.stdout as string;
    expect(stdout.length).toBeLessThan(20_100);
    expect(stdout.endsWith("END")).toBe(true);
    expect(stdout).toContain("earlier characters omitted");
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
  });

  it("runs inline code when the restrictions are off", async () => {
    current = settings({ restrictionsDisabled: true });
    const res = await tool("ecosystem_run_script").handler({ code: "console.log(6*7)", language: "node" }, ctx);
    expect(res.isError).toBe(false);
    expect(res.structuredContent?.stdout).toBe("42\n");
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
    expect(res.body).toMatchObject({ exitCode: 0, killed: false, stdout: "route\n", stderr: "" });
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
