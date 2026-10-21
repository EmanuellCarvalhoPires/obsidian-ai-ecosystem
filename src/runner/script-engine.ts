// Script Engine: validates a run, spawns the interpreter, streams redacted output. Pure Node.

import { spawn as nodeSpawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";
import { StringDecoder } from "node:string_decoder";
import { clearTimeout, setTimeout } from "node:timers";
import type {
  ActivityHandle,
  ActivitySink,
  HubScriptOptions,
  ScriptCaller,
  ScriptExecutionResult,
  ScriptSettings,
  SecretVaultService,
} from "../types";
import { BinaryDetector } from "./binary-detector";
import { SCRIPT_EXTENSIONS, validateRun } from "./script-policy";
import type { RunPlan } from "./script-policy";

const MAX_OUTPUT_CHARS = 1024 * 1024;
/** Raw output kept in memory before the head is dropped. */
const RAW_KEEP_CHARS = MAX_OUTPUT_CHARS * 2;
/** A line longer than this is flushed even without a newline. */
const MAX_LINE_CHARS = 64 * 1024;
const KILL_GRACE_MS = 2000;
const CLOSE_GRACE_MS = 1000;
const TRUNCATED_PREFIX = "[output truncated]\n";

export class ScriptRefusedError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ScriptRefusedError";
    this.code = code;
  }
}

export interface ScriptEngineDeps {
  vaultBasePath: string;
  getSettings: () => ScriptSettings;
  /** Vault-relative paths of #mcp/script notes. */
  getDeclaredScripts: () => string[];
  getSecrets: () => SecretVaultService | undefined;
  redact: (text: string) => string;
  activity: ActivitySink;
  isRegisteredModule: (id: string) => boolean;
  detector?: BinaryDetector;
  spawnImpl?: typeof nodeSpawn;
  tempDir?: string;
}

interface RunningProcess {
  kill: () => void;
}

/** Splits a stream into complete lines so a secret is never cut in half before redaction. */
class LineStream {
  private readonly decoder = new StringDecoder("utf8");
  private pending = "";
  private raw = "";
  private dropped = false;

  constructor(private readonly onLine: (redactedLine: string) => void, private readonly redact: (s: string) => string) {}

  push(chunk: Buffer | string): void {
    const text = typeof chunk === "string" ? chunk : this.decoder.write(chunk);
    if (!text) return;
    this.append(text);
  }

  end(): void {
    this.append(this.decoder.end());
    if (this.pending) this.emit(this.pending);
    this.pending = "";
  }

  /** Redacted full text, tail-capped. */
  result(): string {
    const text = this.redact(this.raw);
    if (!this.dropped && text.length <= MAX_OUTPUT_CHARS) return text;
    return TRUNCATED_PREFIX + text.slice(text.length - MAX_OUTPUT_CHARS);
  }

  private append(text: string): void {
    this.raw += text;
    if (this.raw.length > RAW_KEEP_CHARS) {
      this.raw = this.raw.slice(this.raw.length - MAX_OUTPUT_CHARS);
      this.dropped = true;
    }
    this.pending += text;
    let idx = this.pending.indexOf("\n");
    while (idx !== -1) {
      this.emit(this.pending.slice(0, idx + 1));
      this.pending = this.pending.slice(idx + 1);
      idx = this.pending.indexOf("\n");
    }
    if (this.pending.length > MAX_LINE_CHARS) {
      this.emit(this.pending);
      this.pending = "";
    }
  }

  private emit(line: string): void {
    try {
      this.onLine(this.redact(line));
    } catch {
      // A failing listener must not break the run.
    }
  }
}

export class ScriptEngine {
  private readonly detector: BinaryDetector;
  private readonly spawnImpl: typeof nodeSpawn;
  private readonly running = new Set<RunningProcess>();

  constructor(private readonly deps: ScriptEngineDeps) {
    this.detector = deps.detector ?? new BinaryDetector();
    this.spawnImpl = deps.spawnImpl ?? nodeSpawn;
  }

  runningCount(): number {
    return this.running.size;
  }

  killAll(): void {
    for (const proc of [...this.running]) proc.kill();
  }

  async run(options: HubScriptOptions, caller: ScriptCaller): Promise<ScriptExecutionResult> {
    const { deps } = this;
    const secrets = deps.getSecrets();
    const decision = validateRun(options, caller, {
      vaultBasePath: deps.vaultBasePath,
      settings: deps.getSettings(),
      declaredScripts: deps.getDeclaredScripts(),
      isRegisteredModule: deps.isRegisteredModule,
      secretsAvailable: secrets !== undefined,
      secretsLocked: secrets?.isLocked() ?? false,
    });
    if (!decision.ok) {
      this.logRefusal(options, caller, 403, decision.code, decision.reason);
      throw new ScriptRefusedError(decision.code, decision.reason);
    }
    const plan = decision.plan;

    const settings = deps.getSettings();
    const binary = await this.detector.resolve(plan.language, {
      cwdAbs: plan.cwdAbs,
      vaultBasePath: deps.vaultBasePath,
      override: settings.interpreterPaths?.[plan.language],
    });
    if ("error" in binary) {
      this.logRefusal(options, caller, 500, "interpreter-not-found", binary.error, plan);
      throw new ScriptRefusedError("interpreter-not-found", binary.error);
    }

    let tempFile: string | undefined;
    try {
      let scriptPath = plan.scriptAbsPath;
      if (plan.inlineCode !== undefined) {
        tempFile = await this.writeTempScript(plan);
        scriptPath = tempFile;
      }
      if (!scriptPath) throw new ScriptRefusedError("invalid-path", "No script to run.");
      const fullPath = scriptPath;
      const buildArgs = (scriptArgs: string[]): string[] => this.detector.buildArgs(plan.language, fullPath, scriptArgs, binary.prefixArgs);
      return await this.execute(options, plan, caller, binary.command, buildArgs, secrets);
    } finally {
      if (tempFile) await fs.promises.rm(tempFile, { force: true }).catch(() => undefined);
    }
  }

  private async writeTempScript(plan: RunPlan): Promise<string> {
    const ext = SCRIPT_EXTENSIONS[plan.language][0];
    const dir = this.deps.tempDir ?? os.tmpdir();
    const file = nodePath.join(dir, `aie-${crypto.randomBytes(8).toString("hex")}${ext}`);
    await fs.promises.writeFile(file, plan.inlineCode ?? "", { encoding: "utf8", mode: 0o600 });
    return file;
  }

  private logRefusal(
    options: HubScriptOptions,
    caller: ScriptCaller,
    status: number,
    code: string,
    reason: string,
    plan?: RunPlan,
  ): void {
    const { redact } = this.deps;
    let envKeys: string[] = [];
    try {
      envKeys = Object.keys(options.env ?? {});
    } catch {
      envKeys = [];
    }
    this.deps.activity.log({
      kind: "script",
      method: "Script",
      target: redact(plan?.displayTarget ?? (options.inlineCode !== undefined ? `inline (${String(options.language)})` : String(options.scriptPath ?? ""))),
      moduleId: String(caller?.moduleId ?? ""),
      client: callerName(caller),
      status,
      durationMs: 0,
      payload: {
        language: options.language,
        args: Array.isArray(options.args) ? options.args.map((a) => redact(String(a))) : [],
        cwd: options.cwd,
        envKeys,
      },
      response: { refused: code, reason: redact(reason) },
      alert: plan?.unrestricted,
    });
  }

  private async execute(
    options: HubScriptOptions,
    plan: RunPlan,
    caller: ScriptCaller,
    command: string,
    buildArgs: (scriptArgs: string[]) => string[],
    secrets: SecretVaultService | undefined,
  ): Promise<ScriptExecutionResult> {
    const { deps } = this;
    const isWindows = process.platform === "win32";
    const hasStdin = options.stdin !== undefined;
    const spawnOptions = {
      cwd: plan.cwdAbs,
      shell: false,
      windowsHide: true,
      detached: !isWindows,
      stdio: (hasStdin ? ["pipe", "pipe", "pipe"] : ["ignore", "pipe", "pipe"]) as [
        "ignore" | "pipe",
        "pipe",
        "pipe",
      ],
    };

    const handle: ActivityHandle = options.skipActivityLog ? { id: "skipped", appendOutput: () => {}, end: () => {} } : deps.activity.begin({
      kind: "script",
      method: "Script",
      target: plan.displayTarget,
      moduleId: caller.moduleId,
      client: callerName(caller),
      payload: {
        language: plan.language,
        args: plan.args.map((a) => deps.redact(a)),
        cwd: plan.cwdAbs,
        timeoutSeconds: Math.round(plan.timeoutMs / 1000),
        envKeys: Object.keys(plan.env),
      },
      alert: plan.unrestricted,
    });
    const startedAt = Date.now();
    if (options.signal?.aborted) {
      const durationMs = Date.now() - startedAt;
      handle.end({
        status: 408,
        durationMs,
        response: { exitCode: -1, killed: true },
      });
      return { exitCode: -1, stdout: "", stderr: "", durationMs, killed: true };
    }

    const fail = (error: ScriptRefusedError): ScriptRefusedError => {
      handle.end({
        status: error.code === "interpreter-not-found" ? 500 : 403,
        durationMs: Date.now() - startedAt,
        response: { refused: error.code, reason: deps.redact(error.message) },
      });
      return error;
    };

    let child: ChildProcess | undefined;
    let spawnThrown: unknown;
    const doSpawn = (env: Record<string, string>, scriptArgs: string[] = plan.args): void => {
      try {
        child = this.spawnImpl(command, buildArgs(scriptArgs), { ...spawnOptions, env: { ...process.env, ...env } });
      } catch (err) {
        spawnThrown = err;
      }
    };

    if (plan.needsSecrets && secrets) {
      try {
        // Newer Environment Keys also resolve {{secret:NAME}} in the arguments; older ones only in env.
        if (typeof secrets.spawnWithSecretsAndArgs === "function") {
          await secrets.spawnWithSecretsAndArgs(
            { env: plan.env, args: plan.args },
            (resolved) => doSpawn(resolved.env, resolved.args),
            caller.moduleId,
          );
        } else {
          await secrets.spawnWithSecrets(plan.env, (resolvedEnv) => doSpawn(resolvedEnv), caller.moduleId);
        }
      } catch (err) {
        if (child) killTree(child);
        throw fail(new ScriptRefusedError("secrets-refused", deps.redact(errorMessage(err))));
      }
    } else {
      doSpawn(plan.env);
    }

    if (!child) {
      const message = spawnThrown ? errorMessage(spawnThrown) : "The interpreter could not be started.";
      throw fail(new ScriptRefusedError("interpreter-not-found", `Could not start ${command}: ${deps.redact(message)}`));
    }
    const proc: ChildProcess = child;

    if (options.stdin !== undefined && proc.stdin) {
      proc.stdin.on("error", () => undefined);
      proc.stdin.write(options.stdin, "utf8");
      proc.stdin.end();
    }

    let killed = false;
    const stdout = new LineStream((line) => {
      handle.appendOutput("stdout", line);
      options.onStdout?.(line);
    }, deps.redact);
    const stderr = new LineStream((line) => {
      handle.appendOutput("stderr", line);
      options.onStderr?.(line);
    }, deps.redact);

    return new Promise<ScriptExecutionResult>((resolve, reject) => {
      let settled = false;
      let exitCode: number | null = null;
      let timeoutTimer: NodeJS.Timeout | undefined;
      let closeTimer: NodeJS.Timeout | undefined;
      const running: RunningProcess = {
        kill: () => {
          killed = true;
          killTree(proc);
          // If the process refuses to die, give up waiting for it.
          const hard = setTimeout(finish, KILL_GRACE_MS + 2000);
          hard.unref();
        },
      };
      this.running.add(running);

      const onAbort = (): void => {
        running.kill();
      };
      if (options.signal) {
        if (options.signal.aborted) {
          running.kill();
        } else {
          options.signal.addEventListener("abort", onAbort, { once: true });
        }
      }

      const finish = (): void => {
        if (settled) return;
        settled = true;
        if (timeoutTimer) clearTimeout(timeoutTimer);
        if (closeTimer) clearTimeout(closeTimer);
        options.signal?.removeEventListener("abort", onAbort);
        this.running.delete(running);
        stdout.end();
        stderr.end();
        proc.stdout?.destroy();
        proc.stderr?.destroy();
        const durationMs = Date.now() - startedAt;
        const code = exitCode ?? -1;
        handle.end({
          status: code === 0 ? 200 : killed ? 408 : 500,
          durationMs,
          response: { exitCode: code, killed },
        });
        resolve({ exitCode: code, stdout: stdout.result(), stderr: stderr.result(), durationMs, killed });
      };

      proc.stdout?.on("data", (chunk: Buffer | string) => stdout.push(chunk));
      proc.stderr?.on("data", (chunk: Buffer | string) => stderr.push(chunk));
      proc.once("error", (err: NodeJS.ErrnoException) => {
        if (settled) return;
        settled = true;
        if (timeoutTimer) clearTimeout(timeoutTimer);
        if (closeTimer) clearTimeout(closeTimer);
        options.signal?.removeEventListener("abort", onAbort);
        this.running.delete(running);
        const message = err.code === "ENOENT" ? `Interpreter not found: ${command}` : `Could not start ${command}: ${err.message}`;
        reject(fail(new ScriptRefusedError("interpreter-not-found", deps.redact(message))));
      });
      proc.once("exit", (code) => {
        exitCode = code;
        // Background grandchildren can keep the pipes open: do not wait for them forever.
        closeTimer = setTimeout(finish, CLOSE_GRACE_MS);
      });
      proc.once("close", (code) => {
        if (exitCode === null) exitCode = code;
        finish();
      });

      timeoutTimer = setTimeout(() => running.kill(), plan.timeoutMs);
    });
  }
}

function callerName(caller: ScriptCaller): string {
  return caller?.client?.name ?? "module:" + String(caller?.moduleId ?? "");
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Kills the process and everything it started. */
function killTree(child: ChildProcess): void {
  const pid = child.pid;
  if (pid === undefined) {
    child.kill();
    return;
  }
  if (process.platform === "win32") {
    try {
      const killer = nodeSpawn("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
      killer.on("error", () => child.kill());
    } catch {
      child.kill();
    }
    return;
  }
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
  const force = setTimeout(() => {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      try {
        child.kill("SIGKILL");
      } catch {
        // Already gone.
      }
    }
  }, KILL_GRACE_MS);
  force.unref();
  child.once("close", () => clearTimeout(force));
}
