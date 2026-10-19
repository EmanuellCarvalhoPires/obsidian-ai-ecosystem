import { describe, expect, it, vi } from "vitest";
import {
  LiveLogger,
  distinctValues,
  filterEntries,
  formatDuration,
  formatTime,
  statusClass,
  type LoggerEvent,
} from "../../src/inspector/live-logger";
import { MASK, createRedactor } from "../../src/inspector/redaction";
import type { ActivityInput } from "../../src/types";

function make(max = 100) {
  const limit = { max };
  let clock = 1000;
  const logger = new LiveLogger({
    redactor: createRedactor(() => undefined),
    maxEntries: () => limit.max,
    now: () => clock++,
  });
  return { logger, limit };
}

const base: ActivityInput = {
  kind: "http",
  method: "GET",
  target: "/api/v1/x",
  moduleId: "mod",
  status: 200,
  durationMs: 5,
};

describe("log", () => {
  it("creates entries with defaults and redaction", () => {
    const { logger } = make();
    const e = logger.log({
      ...base,
      client: "Claude Code",
      requestHeaders: { Authorization: "Bearer abcdefgh12345" },
      payload: { password: "x" },
      response: "token=abc",
    });
    expect(e.id).toBe("1");
    expect(e.time).toBe(1000);
    expect(e.requestHeaders.Authorization).toBe(MASK);
    expect(JSON.parse(e.payload).password).toBe(MASK);
    expect(e.response).toBe(`token=${MASK}`);
    expect(e.output).toBe("");
    expect(e.alert).toBe(false);
    expect(e.running).toBe(false);
    expect(logger.log({ ...base, time: 5 }).time).toBe(5);
    expect(logger.entries()[1]?.client).toBe("");
    expect(logger.get("2")?.time).toBe(5);
  });
});

describe("ring buffer", () => {
  it("drops the oldest entries", () => {
    const { logger } = make(3);
    for (let i = 0; i < 5; i++) logger.log({ ...base, target: `/${i}` });
    expect(logger.entries().map((e) => e.target)).toEqual(["/2", "/3", "/4"]);
  });

  it("follows maxEntries changes on the next insert", () => {
    const { logger, limit } = make(5);
    for (let i = 0; i < 5; i++) logger.log({ ...base, target: `/${i}` });
    limit.max = 2;
    logger.log({ ...base, target: "/5" });
    expect(logger.entries().map((e) => e.target)).toEqual(["/4", "/5"]);
    limit.max = 10;
    logger.log({ ...base, target: "/6" });
    expect(logger.entries()).toHaveLength(3);
  });
});

describe("begin / append / end", () => {
  it("tracks a running entry", () => {
    const { logger } = make();
    const h = logger.begin({ kind: "script", method: "Script", target: "a.py", moduleId: "ai-ecosystem", alert: true });
    const e = logger.get(h.id)!;
    expect(e.running).toBe(true);
    expect(e.status).toBe(0);
    h.appendOutput("stdout", "hello\n");
    h.appendOutput("stderr", "oops\nsecond\n");
    expect(e.output).toBe("hello\n[stderr] oops\n[stderr] second\n");
    h.end({ status: 200, durationMs: 12, response: { exitCode: 0 } });
    expect(e.running).toBe(false);
    expect(e.status).toBe(200);
    expect(e.durationMs).toBe(12);
    expect(JSON.parse(e.response)).toEqual({ exitCode: 0 });
    expect(e.alert).toBe(true);
    h.appendOutput("stdout", "late\n");
    h.end({ status: 500, durationMs: 99 });
    expect(e.output).not.toContain("late");
    expect(e.status).toBe(200);
  });

  it("redacts output, including a secret split across chunks, and flushes the tail on end", () => {
    const { logger } = make();
    const h = logger.begin({ kind: "script", method: "Script", target: "a.py", moduleId: "m" });
    const e = logger.get(h.id)!;
    h.appendOutput("stdout", "key: sk-abcdefghij");
    h.appendOutput("stdout", "klmnopqrstuvwx\nTOKEN=zzz");
    expect(e.output).toBe(`key: ${MASK}\n`);
    h.end({ status: 0, durationMs: 1 });
    expect(e.output).toBe(`key: ${MASK}\nTOKEN=${MASK}`);
  });

  it("caps the output keeping the tail", () => {
    const { logger } = make();
    const h = logger.begin({ kind: "script", method: "Script", target: "a.py", moduleId: "m" });
    const e = logger.get(h.id)!;
    const line = "x".repeat(1023) + "\n";
    for (let i = 0; i < 300; i++) h.appendOutput("stdout", line);
    h.appendOutput("stdout", "LAST\n");
    expect(e.output.length).toBe(256 * 1024);
    expect(e.output.endsWith("LAST\n")).toBe(true);
  });
});

describe("subscribe", () => {
  it("emits events and unsubscribes", () => {
    const { logger } = make(1);
    const events: LoggerEvent[] = [];
    const off = logger.subscribe((e) => events.push(e));
    const a = logger.log(base);
    const h = logger.begin({ kind: "script", method: "Script", target: "s", moduleId: "m" });
    h.end({ status: 200, durationMs: 1 });
    logger.clear();
    expect(events.map((e) => e.type)).toEqual(["added", "added", "removed", "updated", "cleared"]);
    expect(events[2]?.entry).toBe(a);
    off();
    logger.log(base);
    expect(events).toHaveLength(5);
  });

  it("isolates listener errors", () => {
    const { logger } = make();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const ok = vi.fn();
    logger.subscribe(() => {
      throw new Error("boom");
    });
    logger.subscribe(ok);
    expect(() => logger.log(base)).not.toThrow();
    expect(ok).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});

describe("filterEntries and helpers", () => {
  const { logger } = make();
  logger.log({ ...base, method: "POST", target: "/api/v1/telegram/approval", moduleId: "telegram", client: "Claude Code", status: 202 });
  logger.log({ ...base, method: "MCP Tool Call", target: "create_note", moduleId: "templates", client: "Antigravity", status: 404 });
  const all = logger.entries();

  it("filters by module, client and query", () => {
    expect(filterEntries(all, {})).toHaveLength(2);
    expect(filterEntries(all, { moduleId: "telegram" })).toHaveLength(1);
    expect(filterEntries(all, { client: "Antigravity" })[0]?.target).toBe("create_note");
    expect(filterEntries(all, { query: "APPROVAL" })).toHaveLength(1);
    expect(filterEntries(all, { query: "mcp tool" })).toHaveLength(1);
    expect(filterEntries(all, { query: "404" })).toHaveLength(1);
    expect(filterEntries(all, { query: "claude" })).toHaveLength(1);
    expect(filterEntries(all, { moduleId: "telegram", client: "Antigravity" })).toHaveLength(0);
  });

  it("formats time, duration and status", () => {
    const d = new Date(2026, 0, 2, 3, 4, 5).getTime();
    expect(formatTime(d)).toBe("03:04:05");
    expect(formatDuration({ running: false, durationMs: 41.6 })).toBe("42 ms");
    expect(formatDuration({ running: true, durationMs: 0 })).toBe("");
    expect(statusClass({ running: true, status: 0 })).toBe("running");
    expect(statusClass({ running: false, status: 204 })).toBe("ok");
    expect(statusClass({ running: false, status: 404 })).toBe("client-error");
    expect(statusClass({ running: false, status: 503 })).toBe("server-error");
    expect(statusClass({ running: false, status: 302 })).toBe("other");
    expect(distinctValues(all, (e) => e.client)).toEqual(["Antigravity", "Claude Code"]);
  });
});
