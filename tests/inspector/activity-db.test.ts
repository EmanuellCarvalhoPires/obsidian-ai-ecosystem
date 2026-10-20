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
});
