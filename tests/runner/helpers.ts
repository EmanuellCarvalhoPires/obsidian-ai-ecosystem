import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type {
  ActivityHandle,
  ActivityInput,
  ActivitySink,
  ScriptSettings,
  SecretVaultService,
} from "../../src/types";
import { BinaryDetector } from "../../src/runner/binary-detector";

export function makeVault(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "aie-vault-"));
}

export function writeFile(vault: string, rel: string, content: string): string {
  const abs = path.join(vault, ...rel.split("/"));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  return abs;
}

export function removeVault(vault: string): void {
  fs.rmSync(vault, { recursive: true, force: true });
}

export function settings(partial: Partial<ScriptSettings> = {}): ScriptSettings {
  return {
    allowedFolders: ["Scripts"],
    restrictionsDisabled: false,
    maxTimeoutSeconds: 300,
    interpreterPaths: {},
    ...partial,
  };
}

/** A detector that resolves `node` to the node running the tests. */
export function nodeDetector(): BinaryDetector {
  return new BinaryDetector({
    which: async (cmd) => (cmd === "node" ? process.execPath : undefined),
  });
}

export interface RecordedActivity {
  logs: ActivityInput[];
  begins: Array<Omit<ActivityInput, "status" | "durationMs">>;
  output: Array<{ stream: "stdout" | "stderr"; chunk: string }>;
  ends: Array<{ status: number; durationMs: number; response?: unknown }>;
  sink: ActivitySink;
}

export function recordingSink(): RecordedActivity {
  const rec: RecordedActivity = { logs: [], begins: [], output: [], ends: [], sink: undefined as never };
  rec.sink = {
    log: (e) => {
      rec.logs.push(e);
    },
    begin: (e) => {
      rec.begins.push(e);
      const handle: ActivityHandle = {
        id: "act-" + rec.begins.length,
        appendOutput: (stream, chunk) => {
          rec.output.push({ stream, chunk });
        },
        end: (u) => {
          rec.ends.push(u);
        },
      };
      return handle;
    },
  };
  return rec;
}

export const redactTopSecret = (text: string): string => text.split("TOPSECRET").join("***");

export function fakeSecrets(locked = false): SecretVaultService & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    isLocked: () => locked,
    redact: redactTopSecret,
    spawnWithSecrets: async (env, spawnFn, callerModuleId) => {
      calls.push(callerModuleId);
      const resolved: Record<string, string> = {};
      for (const [k, v] of Object.entries(env)) resolved[k] = v.replace(/\{\{secret:[A-Z_]+\}\}/g, "TOPSECRET");
      spawnFn(resolved);
    },
  };
}
