// In-memory ring buffer of the requests shown by the Inspector. Pure Node: no "obsidian".
// History is never written to disk.
import type { ActivityEntry, ActivityHandle, ActivityInput, ActivitySink } from "../types";
import type { Redactor } from "./redaction";

const OUTPUT_CAP = 256 * 1024;
const PENDING_LINE_CAP = 4096;

export type LoggerEvent = {
  type: "added" | "updated" | "removed" | "cleared";
  entry?: ActivityEntry;
};
export type LoggerListener = (e: LoggerEvent) => void;

export interface LiveLoggerOptions {
  redactor: Redactor;
  maxEntries: () => number;
  now?: () => number;
}

export class LiveLogger implements ActivitySink {
  private readonly list: ActivityEntry[] = [];
  private readonly listeners = new Set<LoggerListener>();
  private counter = 0;
  private readonly redactor: Redactor;
  private readonly maxEntries: () => number;
  private readonly now: () => number;

  constructor(opts: LiveLoggerOptions) {
    this.redactor = opts.redactor;
    this.maxEntries = opts.maxEntries;
    this.now = opts.now ?? Date.now;
  }

  log(input: ActivityInput): ActivityEntry {
    const entry = this.create(input, input.status, input.durationMs, false);
    this.insert(entry);
    return entry;
  }

  begin(input: Omit<ActivityInput, "status" | "durationMs">): ActivityHandle {
    const entry = this.create({ ...input, status: 0, durationMs: 0 }, 0, 0, true);
    this.insert(entry);
    let ended = false;
    const pending: Record<"stdout" | "stderr", string> = { stdout: "", stderr: "" };

    const write = (stream: "stdout" | "stderr", text: string): void => {
      if (!text) return;
      const redacted = this.redactor.text(text);
      const prefixed = stream === "stderr" ? redacted.replace(/^(?=.)/gm, "[stderr] ") : redacted;
      let out = entry.output + prefixed;
      if (out.length > OUTPUT_CAP) out = out.slice(out.length - OUTPUT_CAP);
      entry.output = out;
    };
    const flush = (): void => {
      for (const stream of ["stdout", "stderr"] as const) {
        write(stream, pending[stream]);
        pending[stream] = "";
      }
    };

    return {
      id: entry.id,
      appendOutput: (stream, chunk) => {
        if (ended || !chunk) return;
        // Only complete lines are redacted, so a secret split across chunks is still masked.
        const data = pending[stream] + chunk;
        const cut = Math.max(data.lastIndexOf("\n"), data.lastIndexOf("\r")) + 1;
        let ready = data.slice(0, cut);
        let rest = data.slice(cut);
        if (rest.length > PENDING_LINE_CAP) {
          ready += rest;
          rest = "";
        }
        pending[stream] = rest;
        if (!ready) return;
        write(stream, ready);
        this.touch(entry);
      },
      end: (update) => {
        if (ended) return;
        ended = true;
        flush();
        entry.status = update.status;
        entry.durationMs = update.durationMs;
        if (update.response !== undefined) entry.response = this.redactor.value(update.response);
        entry.running = false;
        this.touch(entry);
      },
    };
  }

  entries(): readonly ActivityEntry[] {
    return this.list;
  }

  get(id: string): ActivityEntry | undefined {
    return this.list.find((e) => e.id === id);
  }

  clear(): void {
    this.list.length = 0;
    this.emit({ type: "cleared" });
  }

  subscribe(cb: LoggerListener): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  private create(input: ActivityInput, status: number, durationMs: number, running: boolean): ActivityEntry {
    return {
      id: String(++this.counter),
      time: input.time ?? this.now(),
      kind: input.kind,
      method: input.method,
      target: input.target,
      moduleId: input.moduleId,
      client: input.client ?? "",
      status,
      durationMs,
      requestHeaders: this.redactor.headers(input.requestHeaders ?? {}),
      payload: input.payload === undefined ? "" : this.redactor.value(input.payload),
      response: input.response === undefined ? "" : this.redactor.value(input.response),
      output: "",
      alert: input.alert ?? false,
      running,
    };
  }

  private insert(entry: ActivityEntry): void {
    this.list.push(entry);
    this.emit({ type: "added", entry });
    const max = Math.max(1, Math.floor(this.maxEntries()) || 1);
    while (this.list.length > max) {
      const dropped = this.list.shift();
      if (dropped) this.emit({ type: "removed", entry: dropped });
    }
  }

  private touch(entry: ActivityEntry): void {
    if (this.list.includes(entry)) this.emit({ type: "updated", entry });
  }

  private emit(e: LoggerEvent): void {
    for (const cb of [...this.listeners]) {
      try {
        cb(e);
      } catch (err) {
        console.warn("Inspector listener failed", err);
      }
    }
  }
}

export interface EntryFilter {
  moduleId?: string;
  client?: string;
  query?: string;
}

export function filterEntries(entries: readonly ActivityEntry[], f: EntryFilter): ActivityEntry[] {
  const q = f.query?.trim().toLowerCase();
  return entries.filter((e) => {
    if (f.moduleId && e.moduleId !== f.moduleId) return false;
    if (f.client && e.client !== f.client) return false;
    if (q) {
      const hay = [e.method, e.target, e.moduleId, e.client, String(e.status)].join("\n").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

// Formatting helpers used by the view (kept here so they are testable without Obsidian).

const pad2 = (n: number): string => String(n).padStart(2, "0");

/** HH:mm:ss in local time. */
export function formatTime(ms: number): string {
  const d = new Date(ms);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

export function formatDuration(entry: Pick<ActivityEntry, "running" | "durationMs">): string {
  return entry.running ? "" : `${Math.round(entry.durationMs)} ms`;
}

export type StatusClass = "running" | "ok" | "client-error" | "server-error" | "other";

export function statusClass(entry: Pick<ActivityEntry, "running" | "status">): StatusClass {
  if (entry.running) return "running";
  if (entry.status >= 200 && entry.status < 300) return "ok";
  if (entry.status >= 400 && entry.status < 500) return "client-error";
  if (entry.status >= 500) return "server-error";
  return "other";
}

/** Sorted distinct non-empty values, for the filter dropdowns. */
export function distinctValues(entries: readonly ActivityEntry[], pick: (e: ActivityEntry) => string): string[] {
  return [...new Set(entries.map(pick).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}
