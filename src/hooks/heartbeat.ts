// Tells the Claude Code hooks the core is alive: <state>/heartbeat holds Date.now() and is
// rewritten every 15 s. The hooks let everything through when it is missing or older than 45 s.
// Pure Node (no "obsidian" import).
import { clearInterval, setInterval } from "node:timers";
import type { StateDir } from "./state-dir";

export const HEARTBEAT_INTERVAL_MS = 15_000;

export class Heartbeat {
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly state: StateDir,
    private readonly intervalMs = HEARTBEAT_INTERVAL_MS,
  ) {}

  /** Writes the file now and then every interval. Calling it twice does nothing. */
  start(): void {
    if (this.timer) return;
    this.beat();
    this.timer = setInterval(() => this.beat(), this.intervalMs);
    this.timer.unref();
  }

  /** Stops the timer and deletes the file, so the hooks stop guarding right away. */
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    try {
      this.state.remove("heartbeat");
    } catch {
      // The hooks treat a stale file as dead after 45 s anyway.
    }
  }

  private beat(): void {
    try {
      this.state.writeText("heartbeat", String(Date.now()));
    } catch (err) {
      console.warn("[AI Ecosystem] Could not write the hooks heartbeat", err);
    }
  }
}
