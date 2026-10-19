// Finds the interpreter for each script language. Pure Node.

import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as nodePath from "node:path";
import type { ScriptLanguage } from "../types";

export interface ResolvedBinary {
  command: string;
  prefixArgs: string[];
}

export interface BinaryDetectorOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  exists?: (p: string) => boolean;
  /** Resolves a command name through PATH. Returns the absolute path or undefined. */
  which?: (cmd: string) => Promise<string | undefined>;
}

export interface ResolveContext {
  cwdAbs: string;
  vaultBasePath: string;
  /** Interpreter path from settings.interpreterPaths. */
  override?: string;
}

const POWERSHELL_FLAGS = ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File"];

function isWindowsAppsStub(p: string): boolean {
  return /[\\/]WindowsApps[\\/]/i.test(p);
}

function notFound(language: ScriptLanguage): { error: string } {
  return { error: `Interpreter for ${language} not found. Set its path in Settings > AI Ecosystem > Scripts.` };
}

export class BinaryDetector {
  private readonly platform: NodeJS.Platform;
  private readonly env: NodeJS.ProcessEnv;
  private readonly exists: (p: string) => boolean;
  private readonly whichImpl: (cmd: string) => Promise<string | undefined>;
  private readonly cache = new Map<string, string>();

  constructor(opts: BinaryDetectorOptions = {}) {
    this.platform = opts.platform ?? process.platform;
    this.env = opts.env ?? process.env;
    this.exists = opts.exists ?? ((p) => fs.existsSync(p));
    this.whichImpl = opts.which ?? ((cmd) => defaultWhich(cmd, this.platform));
  }

  clearCache(): void {
    this.cache.clear();
  }

  async resolve(
    language: ScriptLanguage,
    ctx: ResolveContext,
  ): Promise<ResolvedBinary | { error: string }> {
    const override = ctx.override?.trim();
    if (override) {
      if (this.exists(override)) return { command: override, prefixArgs: [] };
      if (!/[\\/]/.test(override)) {
        const found = await this.which(override);
        if (found) return { command: found, prefixArgs: [] };
      }
      return { error: `The ${language} interpreter set in Settings > AI Ecosystem > Scripts was not found: ${override}` };
    }

    switch (language) {
      case "python":
        return this.resolvePython(ctx);
      case "node":
        return this.first(language, ["node"]);
      case "bash":
        return this.resolveBash();
      case "powershell":
        return this.first(language, this.platform === "win32" ? ["pwsh", "powershell.exe"] : ["pwsh"]);
    }
  }

  buildArgs(
    language: ScriptLanguage,
    scriptAbsPath: string,
    args: string[],
    prefixArgs: string[],
  ): string[] {
    switch (language) {
      case "python":
      case "node":
        return [...prefixArgs, scriptAbsPath, ...args];
      case "bash": {
        // Backslashes are escapes for bash; forward slashes work on every platform.
        const script = this.platform === "win32" ? scriptAbsPath.replace(/\\/g, "/") : scriptAbsPath;
        return [...prefixArgs, script, ...args];
      }
      case "powershell":
        return [...prefixArgs, ...POWERSHELL_FLAGS, scriptAbsPath, ...args];
    }
  }

  private get path(): typeof nodePath.posix {
    return this.platform === "win32" ? nodePath.win32 : nodePath.posix;
  }

  private async which(cmd: string): Promise<string | undefined> {
    const cached = this.cache.get(cmd);
    if (cached) return cached;
    let found: string | undefined;
    try {
      found = await this.whichImpl(cmd);
    } catch {
      found = undefined;
    }
    if (found) this.cache.set(cmd, found);
    return found;
  }

  private async first(
    language: ScriptLanguage,
    commands: string[],
  ): Promise<ResolvedBinary | { error: string }> {
    for (const cmd of commands) {
      const found = await this.which(cmd);
      if (found) return { command: found, prefixArgs: [] };
    }
    return notFound(language);
  }

  private async resolvePython(ctx: ResolveContext): Promise<ResolvedBinary | { error: string }> {
    const p = this.path;
    const rel = this.platform === "win32" ? ["Scripts", "python.exe"] : ["bin", "python"];
    for (const root of [ctx.cwdAbs, ctx.vaultBasePath]) {
      for (const dir of [".venv", "venv"]) {
        const candidate = p.join(root, dir, ...rel);
        if (this.exists(candidate)) return { command: candidate, prefixArgs: [] };
      }
    }

    const names = this.platform === "win32" ? ["python"] : ["python3", "python"];
    let stub: string | undefined;
    for (const name of names) {
      const found = await this.which(name);
      if (!found) continue;
      if (isWindowsAppsStub(found)) {
        stub ??= found;
        continue;
      }
      return { command: found, prefixArgs: [] };
    }
    if (this.platform === "win32") {
      const launcher = await this.which("py");
      if (launcher) return { command: launcher, prefixArgs: ["-3"] };
    }
    if (stub) return { command: stub, prefixArgs: [] };
    return notFound("python");
  }

  private async resolveBash(): Promise<ResolvedBinary | { error: string }> {
    if (this.platform === "win32") {
      const roots = [
        this.env["ProgramFiles"],
        this.env["ProgramFiles(x86)"],
        this.env["ProgramW6432"],
      ]
        .filter((r): r is string => !!r)
        .map((r) => nodePath.win32.join(r, "Git", "bin", "bash.exe"));
      const local = this.env["LOCALAPPDATA"];
      if (local) roots.push(nodePath.win32.join(local, "Programs", "Git", "bin", "bash.exe"));
      for (const candidate of roots) {
        if (this.exists(candidate)) return { command: candidate, prefixArgs: [] };
      }
      return this.first("bash", ["bash"]);
    }
    return this.first("bash", ["bash", "sh"]);
  }
}

function defaultWhich(cmd: string, platform: NodeJS.Platform): Promise<string | undefined> {
  const tool = platform === "win32" ? "where" : "which";
  return new Promise((resolve) => {
    try {
      execFile(tool, [cmd], { timeout: 3000, windowsHide: true }, (err, stdout) => {
        if (err) return resolve(undefined);
        const lines = String(stdout)
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean);
        resolve(lines.find((l) => !isWindowsAppsStub(l)) ?? lines[0]);
      });
    } catch {
      resolve(undefined);
    }
  });
}
