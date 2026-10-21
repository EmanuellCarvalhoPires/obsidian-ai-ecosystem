import { describe, expect, it } from "vitest";
import { validateRun } from "../../src/runner/script-policy";
import type { PolicyContext } from "../../src/runner/script-policy";
import type { HubScriptOptions } from "../../src/types";
import { settings } from "./helpers";

const caller = { moduleId: "ai-ecosystem" };

function ctx(over: Partial<PolicyContext> = {}, platform: NodeJS.Platform = "linux"): PolicyContext {
  const vault = platform === "win32" ? "C:\\vault" : "/vault";
  return {
    vaultBasePath: vault,
    settings: settings(),
    declaredScripts: [],
    isRegisteredModule: (id) => id === "ai-ecosystem",
    secretsAvailable: true,
    secretsLocked: false,
    fileExists: () => true,
    realpath: (p) => p,
    platform,
    ...over,
  };
}

function opts(over: Partial<HubScriptOptions> = {}): HubScriptOptions {
  return { language: "python", scriptPath: "Scripts/a.py", ...over };
}

function code(options: HubScriptOptions, c: PolicyContext): string | undefined {
  const r = validateRun(options, caller, c);
  return r.ok ? undefined : r.code;
}

describe("validateRun: caller and shape", () => {
  it("refuses unregistered callers", () => {
    const r = validateRun(opts(), { moduleId: "evil" }, ctx());
    expect(r).toMatchObject({ ok: false, code: "caller-not-registered" });
  });

  it("accepts an allowed script", () => {
    const r = validateRun(opts({ args: ["x"] }), caller, ctx());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.plan.scriptAbsPath).toBe("/vault/Scripts/a.py");
      expect(r.plan.displayTarget).toBe("Scripts/a.py");
      expect(r.plan.cwdAbs).toBe("/vault");
      expect(r.plan.unrestricted).toBe(false);
      expect(r.plan.args).toEqual(["x"]);
    }
  });

  it("validates language, args, env and stdin", () => {
    expect(code(opts({ language: "ruby" as never }), ctx())).toBe("invalid-language");
    expect(code(opts({ args: [1 as never] }), ctx())).toBe("invalid-args");
    expect(code(opts({ env: { "1BAD": "x" } }), ctx())).toBe("invalid-env");
    expect(code(opts({ env: { "A-B": "x" } }), ctx())).toBe("invalid-env");
    expect(code(opts({ env: { A: 1 as never } }), ctx())).toBe("invalid-env");
    expect(code(opts({ env: { GOOD_1: "x" } }), ctx())).toBeUndefined();
    expect(code(opts({ stdin: 123 as never }), ctx())).toBe("invalid-stdin");
    expect(code(opts({ stdin: "hello" }), ctx())).toBeUndefined();
  });

  it("refuses interpreter-hijacking env keys only while restricted", () => {
    expect(code(opts({ env: { NODE_OPTIONS: "--require x" } }), ctx())).toBe("env-key-refused");
    expect(code(opts({ env: { path: "x" } }), ctx())).toBe("env-key-refused");
    const open = ctx({ settings: settings({ restrictionsDisabled: true }) });
    expect(code(opts({ env: { NODE_OPTIONS: "--x" } }), open)).toBeUndefined();
  });
});

describe("validateRun: restrictions on", () => {
  it("refuses inline code with the documented reason", () => {
    const r = validateRun(opts({ inlineCode: "print(1)" }), caller, ctx());
    expect(r).toEqual({
      ok: false,
      code: "inline-refused",
      reason:
        "Inline code is refused while the Script Engine restrictions are on. Turn them off in Settings > AI Ecosystem > Scripts.",
    });
  });

  it("refuses paths outside allowed folders and names the setting", () => {
    const r = validateRun(opts({ scriptPath: "Other/a.py" }), caller, ctx());
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("path-not-allowed");
      expect(r.reason).toContain("Allowed folders: Scripts");
      expect(r.reason).toContain("Settings > AI Ecosystem > Scripts");
    }
  });

  it("matches folders on a segment boundary", () => {
    expect(code(opts({ scriptPath: "Scripts2/x.py" }), ctx())).toBe("path-not-allowed");
    expect(code(opts({ scriptPath: "Scripts-old/x.py" }), ctx())).toBe("path-not-allowed");
    expect(code(opts({ scriptPath: "Scripts/sub/x.py" }), ctx())).toBeUndefined();
    expect(code(opts({ scriptPath: "Scripts/x.py" }), ctx({ settings: settings({ allowedFolders: ["Scripts/"] }) }))).toBeUndefined();
    expect(code(opts({ scriptPath: "Scripts/x.py" }), ctx({ settings: settings({ allowedFolders: ["./Scripts"] }) }))).toBeUndefined();
  });

  it("ignores empty and root-like allowed folders", () => {
    for (const f of ["", ".", "/", "..", "../x"]) {
      expect(code(opts({ scriptPath: "Any/x.py" }), ctx({ settings: settings({ allowedFolders: [f] }) }))).toBe("path-not-allowed");
    }
  });

  it("refuses traversal, absolute, drive, UNC and home paths", () => {
    const bad = [
      "../x.py",
      "Scripts/../../x.py",
      "Scripts/../../../etc/passwd.py",
      "/etc/x.py",
      "\\\\server\\share\\x.py",
      "C:\\x.py",
      "C:/x.py",
      "~/x.py",
      "Scripts/..\\..\\x.py",
    ];
    for (const scriptPath of bad) {
      expect(code(opts({ scriptPath }), ctx()), scriptPath).toBe("path-not-allowed");
    }
    // Encoded traversal is a literal (non-existent) folder name, never decoded.
    expect(code(opts({ scriptPath: "%2e%2e/x.py" }), ctx())).toBe("path-not-allowed");
    expect(code(opts({ scriptPath: "Scripts/%2e%2e/%2e%2e/x.py" }), ctx({ fileExists: () => false, dirExists: () => true }))).toBe("script-not-found");
    expect(code(opts({ scriptPath: "Scripts/a\u0000.py" }), ctx())).toBe("path-not-allowed");
  });

  it("refuses a symlink that escapes the vault", () => {
    const c = ctx({ realpath: (p) => (p === "/vault/Scripts/link.py" ? "/outside/x.py" : p) });
    const r = validateRun(opts({ scriptPath: "Scripts/link.py" }), caller, c);
    expect(r).toMatchObject({ ok: false, code: "path-not-allowed" });
  });

  it("refuses a symlink that leaves the allowed folder", () => {
    const c = ctx({ realpath: (p) => (p === "/vault/Scripts/link.py" ? "/vault/Secret/x.py" : p) });
    expect(code(opts({ scriptPath: "Scripts/link.py" }), c)).toBe("path-not-allowed");
  });

  it("allows declared scripts outside the folders", () => {
    const c = ctx({ declaredScripts: ["Notes/tools/run.py"] });
    expect(code(opts({ scriptPath: "Notes/tools/run.py" }), c)).toBeUndefined();
    expect(code(opts({ scriptPath: "Notes/tools/other.py" }), c)).toBe("path-not-allowed");
  });

  it("requires the extension to match the language", () => {
    expect(code(opts({ scriptPath: "Scripts/a.txt" }), ctx())).toBe("extension-mismatch");
    expect(code(opts({ scriptPath: "Scripts/a.py", language: "node" }), ctx())).toBe("extension-mismatch");
    expect(code(opts({ scriptPath: "Scripts/a.py", language: "bash" }), ctx())).toBe("extension-mismatch");
    for (const [language, file] of [
      ["python", "a.py"],
      ["node", "a.js"],
      ["node", "a.mjs"],
      ["node", "a.cjs"],
      ["bash", "a.sh"],
      ["powershell", "a.ps1"],
    ] as const) {
      expect(code(opts({ language, scriptPath: `Scripts/${file}` }), ctx()), file).toBeUndefined();
    }
  });

  it("reports missing scripts", () => {
    expect(code(opts(), ctx({ fileExists: () => false, dirExists: () => true }))).toBe("script-not-found");
  });

  it("keeps cwd inside the vault", () => {
    expect(code(opts({ cwd: "Scripts" }), ctx())).toBeUndefined();
    expect(code(opts({ cwd: "../elsewhere" }), ctx())).toBe("cwd-not-allowed");
    expect(code(opts({ cwd: "/tmp" }), ctx())).toBe("cwd-not-allowed");
    expect(code(opts({ cwd: "C:\\Windows" }), ctx())).toBe("cwd-not-allowed");
    const c = ctx({ realpath: (p) => (p === "/vault/Scripts/out" ? "/outside" : p) });
    expect(code(opts({ cwd: "Scripts/out" }), c)).toBe("cwd-not-allowed");
    const r = validateRun(opts({ cwd: "Scripts" }), caller, ctx());
    expect(r.ok && r.plan.cwdAbs).toBe("/vault/Scripts");
  });

  it("reports a missing cwd", () => {
    expect(code(opts({ cwd: "Nope" }), ctx({ dirExists: () => false }))).toBe("cwd-not-found");
  });
});

describe("validateRun: case sensitivity", () => {
  it("is case-insensitive only on win32", () => {
    const win = ctx({ settings: settings({ allowedFolders: ["scripts"] }) }, "win32");
    expect(code(opts({ scriptPath: "Scripts\\A.py" }), win)).toBeUndefined();
    expect(code(opts({ scriptPath: "SCRIPTS/a.py" }), win)).toBeUndefined();
    const posix = ctx({ settings: settings({ allowedFolders: ["scripts"] }) }, "linux");
    expect(code(opts({ scriptPath: "Scripts/a.py" }), posix)).toBe("path-not-allowed");
    expect(code(opts({ scriptPath: "scripts/a.py" }), posix)).toBeUndefined();
  });

  it("compares declared scripts the same way", () => {
    const win = ctx({ declaredScripts: ["Notes/Run.PY"] }, "win32");
    expect(code(opts({ scriptPath: "notes/run.py" }), win)).toBeUndefined();
    const posix = ctx({ declaredScripts: ["Notes/Run.py"] }, "linux");
    expect(code(opts({ scriptPath: "notes/run.py" }), posix)).toBe("path-not-allowed");
  });

  it("handles backslash paths and win32 traversal", () => {
    const win = ctx({}, "win32");
    expect(code(opts({ scriptPath: "Scripts\\sub\\a.py" }), win)).toBeUndefined();
    expect(code(opts({ scriptPath: "Scripts\\..\\..\\a.py" }), win)).toBe("path-not-allowed");
    const r = validateRun(opts({ scriptPath: "Scripts\\sub\\a.py" }), caller, win);
    expect(r.ok && r.plan.displayTarget).toBe("Scripts/sub/a.py");
  });
});

describe("validateRun: timeout", () => {
  const timeout = (t: number | undefined, max = 300): number | undefined => {
    const r = validateRun(opts({ timeoutSeconds: t }), caller, ctx({ settings: settings({ maxTimeoutSeconds: max }) }));
    return r.ok ? r.plan.timeoutMs : undefined;
  };

  it("defaults to the maximum and clamps to [1, max]", () => {
    expect(timeout(undefined)).toBe(300_000);
    expect(timeout(10)).toBe(10_000);
    expect(timeout(0)).toBe(1000);
    expect(timeout(-5)).toBe(1000);
    expect(timeout(9999)).toBe(300_000);
    expect(timeout(Number.NaN)).toBe(300_000);
    expect(timeout(undefined, 60)).toBe(60_000);
  });
});

describe("validateRun: secrets", () => {
  const env = { TOKEN: "{{secret:TOKEN}}" };

  it("flags placeholders", () => {
    const r = validateRun(opts({ env }), caller, ctx());
    expect(r.ok && r.plan.needsSecrets).toBe(true);
    for (const v of ["{{basic:A}}", "{{bearer:A}}"]) {
      const x = validateRun(opts({ env: { A: v } }), caller, ctx());
      expect(x.ok && x.plan.needsSecrets).toBe(true);
    }
    const plain = validateRun(opts({ env: { A: "x" } }), caller, ctx());
    expect(plain.ok && plain.plan.needsSecrets).toBe(false);
  });

  it("refuses without the Environment Keys plugin", () => {
    const r = validateRun(opts({ env }), caller, ctx({ secretsAvailable: false }));
    expect(r).toEqual({
      ok: false,
      code: "secrets-unavailable",
      reason: "Environment variables and arguments with {{secret:...}} placeholders need the Environment Keys plugin.",
    });
  });

  it("also needs the Environment Keys plugin for placeholders in args", () => {
    const r = validateRun(opts({ args: ["{{secret:A}}"] }), caller, ctx({ secretsAvailable: false }));
    expect(r).toMatchObject({ ok: false, code: "secrets-unavailable" });
  });

  it("refuses while the vault is locked", () => {
    const r = validateRun(opts({ env }), caller, ctx({ secretsLocked: true }));
    expect(r).toMatchObject({ ok: false, code: "secrets-locked" });
    expect(!r.ok && r.reason).toMatch(/unlock/i);
  });
});

describe("validateRun: restrictions off", () => {
  const open = (over: Partial<PolicyContext> = {}): PolicyContext =>
    ctx({ settings: settings({ restrictionsDisabled: true, allowedFolders: [] }), ...over });

  it("accepts inline code and flags unrestricted", () => {
    const r = validateRun(opts({ inlineCode: "print(1)", scriptPath: "" }), caller, open());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.plan.inlineCode).toBe("print(1)");
      expect(r.plan.scriptAbsPath).toBeUndefined();
      expect(r.plan.unrestricted).toBe(true);
      expect(r.plan.displayTarget).toBe("inline (python)");
    }
  });

  it("rejects empty inline code", () => {
    expect(code(opts({ inlineCode: "  " }), open())).toBe("invalid-code");
  });

  it("accepts absolute paths and any cwd without allowed folders or extension checks", () => {
    const r = validateRun(opts({ scriptPath: "/opt/tools/x.txt", cwd: "/tmp" }), caller, open());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.plan.scriptAbsPath).toBe("/opt/tools/x.txt");
      expect(r.plan.cwdAbs).toBe("/tmp");
      expect(r.plan.unrestricted).toBe(true);
    }
    const win = validateRun(opts({ scriptPath: "D:\\tools\\x.py" }), caller, open({ vaultBasePath: "C:\\vault", platform: "win32" }));
    expect(win.ok && win.plan.scriptAbsPath).toBe("D:\\tools\\x.py");
  });

  it("still requires the caller to be registered and the file to exist", () => {
    expect(validateRun(opts(), { moduleId: "x" }, open()).ok).toBe(false);
    expect(code(opts(), open({ fileExists: () => false, dirExists: () => true }))).toBe("script-not-found");
  });
});
