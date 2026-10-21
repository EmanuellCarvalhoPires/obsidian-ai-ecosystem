// Checks that "node" is on the PATH: the hook commands start with it. Pure Node (no "obsidian" import).
import { execFile } from "node:child_process";

export const NODE_DOWNLOAD_URL = "https://nodejs.org";

export interface NodeStatus {
  available: boolean;
  /** Output of "node --version", e.g. "v22.5.0". */
  version?: string;
}

export type NodeProbe = () => Promise<NodeStatus>;

const TIMEOUT_MS = 5000;

export function probeNode(): Promise<NodeStatus> {
  return new Promise((resolve) => {
    execFile("node", ["--version"], { timeout: TIMEOUT_MS, windowsHide: true }, (err, stdout) => {
      const version = String(stdout).trim();
      resolve(err || !version ? { available: false } : { available: true, version });
    });
  });
}

/** Runs the probe once and remembers the answer until clear() is called. */
export class NodeChecker {
  private cached: Promise<NodeStatus> | undefined;
  private last: NodeStatus | undefined;

  constructor(private readonly probe: NodeProbe = probeNode) {}

  check(): Promise<NodeStatus> {
    this.cached ??= this.probe().then(
      (status) => (this.last = status),
      () => (this.last = { available: false }),
    );
    return this.cached;
  }

  /** The answer of the last check, undefined before the first one finished. */
  peek(): NodeStatus | undefined {
    return this.last;
  }

  clear(): void {
    this.cached = undefined;
    this.last = undefined;
  }
}
