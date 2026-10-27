import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { ActivityDatabase } from "../../src/inspector/activity-db";
import { LiveLogger } from "../../src/inspector/live-logger";
import { createRedactor } from "../../src/inspector/redaction";
import type { ActivityEntry } from "../../src/types";

describe("ActivityDatabase", () => {
  it("initializes an in-memory database and saves/retrieves entries", () => {
    const db = new ActivityDatabase({ filePath: ":memory:" });

    const entry: ActivityEntry = {
      id: "1",
      time: 1700000000000,
      kind: "http",
      method: "POST",
      target: "/api/v1/test",
      moduleId: "test-module",
      client: "Claude Code",
      status: 200,
      durationMs: 42,
      requestHeaders: { "content-type": "application/json" },
      payload: '{"hello":"world"}',
      response: '{"success":true}',
      output: "",
      alert: false,
      running: false,
    };

    db.save(entry);

    const history = db.getRecent();
    expect(history).toHaveLength(1);
    expect(history[0]).toEqual(entry);

    db.close();
  });

  it("updates an existing entry", () => {
    const db = new ActivityDatabase({ filePath: ":memory:" });

    const entry: ActivityEntry = {
      id: "100",
      time: 1700000000000,
      kind: "script",
      method: "myscript",
      target: "scripts/test.py",
      moduleId: "ai-scripts",
      client: "Antigravity",
      status: 0,
      durationMs: 0,
      requestHeaders: {},
      payload: "",
      response: "",
      output: "Starting...",
      alert: false,
      running: true,
    };

    db.save(entry);

    entry.status = 200;
    entry.durationMs = 150;
    entry.running = false;
    entry.output = "Starting...\nDone!";

    db.update(entry);

    const history = db.getRecent();
    expect(history).toHaveLength(1);
    expect(history[0].status).toBe(200);
    expect(history[0].running).toBe(false);
    expect(history[0].output).toBe("Starting...\nDone!");

    db.close();
  });

  it("clears entries", () => {
    const db = new ActivityDatabase({ filePath: ":memory:" });

    db.save({
      id: "1",
      time: 1000,
      kind: "http",
      method: "GET",
      target: "/health",
      moduleId: "ai-ecosystem",
      client: "unknown",
      status: 200,
      durationMs: 1,
      requestHeaders: {},
      payload: "",
      response: "OK",
      output: "",
      alert: false,
      running: false,
    });

    expect(db.getRecent()).toHaveLength(1);
    db.clear();
    expect(db.getRecent()).toHaveLength(0);

    db.close();
  });

  it("integrates with LiveLogger to persist entries and restore counter", () => {
    const db = new ActivityDatabase({ filePath: ":memory:" });
    const redactor = createRedactor(() => undefined);

    const logger1 = new LiveLogger({
      redactor,
      maxEntries: () => 500,
      database: db,
    });

    logger1.log({
      kind: "mcp",
      method: "MCP Tool Call",
      target: "search_notes",
      moduleId: "ai-vault-search",
      client: "Claude Code",
      status: 200,
      durationMs: 12,
      payload: { query: "test" },
      response: { results: [] },
    });

    expect(logger1.entries()).toHaveLength(1);
    expect(logger1.entries()[0].id).toBe("1");

    // Create a new logger with the same database (simulating reload)
    const logger2 = new LiveLogger({
      redactor,
      maxEntries: () => 500,
      database: db,
    });

    expect(logger2.entries()).toHaveLength(1);
    expect(logger2.entries()[0].target).toBe("search_notes");

    // Next log should increment from the highest id (2)
    logger2.log({
      kind: "http",
      method: "GET",
      target: "/api/v1/ping",
      moduleId: "ai-ecosystem",
      status: 200,
      durationMs: 1,
    });

    expect(logger2.entries()).toHaveLength(2);
    expect(logger2.entries()[1].id).toBe("2");

    db.close();
  });

  const baseEntry = (id: string, time: number, extra: Partial<ActivityEntry> = {}): ActivityEntry => ({
    id,
    time,
    kind: "http",
    method: "POST",
    target: "/api/v1/test",
    moduleId: "test-module",
    client: "Claude Code",
    status: 200,
    durationMs: 1,
    requestHeaders: {},
    payload: "",
    response: "",
    output: "",
    alert: false,
    running: false,
    ...extra,
  });

  it("keeps only the newest maxRows entries", () => {
    const db = new ActivityDatabase({ filePath: ":memory:", maxRows: 5, pruneEvery: 1 });

    const now = Date.now();
    for (let i = 1; i <= 12; i++) {
      db.save(baseEntry(String(i), now + i));
    }

    const history = db.getRecent();
    expect(history).toHaveLength(5);
    expect(history.map((e) => e.time)).toEqual([now + 8, now + 9, now + 10, now + 11, now + 12]);

    db.close();
  });

  it("clips payload at the start and output at the end when over textCap", () => {
    const db = new ActivityDatabase({ filePath: ":memory:", textCap: 100 });

    const payload = "p".repeat(1000);
    const output = "x".repeat(900) + "y".repeat(100);
    db.save(baseEntry("1", 1000, { payload, output }));

    const [entry] = db.getRecent();
    expect(entry.payload).toBe(payload.slice(0, 100) + "\n[... 900 characters omitted]");
    expect(entry.payload).toContain("characters omitted");
    expect(entry.output).toBe("[... 900 characters omitted]\n" + "y".repeat(100));

    db.close();
  });

  it("drops rows older than maxAgeMs when the file is reopened", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "activity-db-"));
    const filePath = path.join(dir, "a.sqlite");
    const tenDaysMs = 10 * 24 * 60 * 60 * 1000;

    try {
      const first = new ActivityDatabase({ filePath });
      first.save(baseEntry("old", Date.now() - tenDaysMs));
      first.save(baseEntry("now", Date.now()));
      first.close();

      const reopened = new ActivityDatabase({ filePath });
      const history = reopened.getRecent();
      expect(history.map((e) => e.id)).toEqual(["now"]);
      reopened.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
