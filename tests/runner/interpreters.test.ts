import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BinaryDetector } from "../../src/runner/binary-detector";
import { ScriptEngine } from "../../src/runner/script-engine";
import type { ScriptLanguage } from "../../src/types";
import { makeVault, recordingSink, removeVault, settings, writeFile } from "./helpers";

// Smoke tests with the real interpreters found on this machine. Each one is skipped when the
// interpreter is not installed, so the suite also passes on bare CI images.

const detector = new BinaryDetector();
const cases: Array<{ language: ScriptLanguage; file: string; source: string }> = [
  { language: "python", file: "Scripts/hi.py", source: "import sys\nprint('py:' + ','.join(sys.argv[1:]))\n" },
  { language: "bash", file: "Scripts/hi.sh", source: 'echo "sh:$1,$2"\n' },
  { language: "powershell", file: "Scripts/hi.ps1", source: 'Write-Output ("ps:" + ($args -join ","))\n' },
];

const available = new Map<ScriptLanguage, boolean>();

describe("real interpreters", () => {
  let vault: string;

  beforeEach(async () => {
    vault = makeVault();
    for (const c of cases) {
      if (!available.has(c.language)) {
        const r = await detector.resolve(c.language, { cwdAbs: vault, vaultBasePath: vault });
        available.set(c.language, !("error" in r));
      }
    }
  });

  afterEach(() => removeVault(vault));

  for (const c of cases) {
    it(`runs a ${c.language} script with arguments`, async (ctx) => {
      if (!available.get(c.language)) return ctx.skip();
      writeFile(vault, c.file, c.source);
      const engine = new ScriptEngine({
        vaultBasePath: vault,
        getSettings: () => settings(),
        getDeclaredScripts: () => [],
        getSecrets: () => undefined,
        redact: (t) => t,
        activity: recordingSink().sink,
        isRegisteredModule: () => true,
        detector,
      });
      const result = await engine.run({ language: c.language, scriptPath: c.file, args: ["a", "b"] }, { moduleId: "m" });
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toMatch(/^(py|sh|ps):a,b$/);
    });
  }
});
