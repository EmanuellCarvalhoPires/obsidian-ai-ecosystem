import { describe, expect, it, vi } from "vitest";
import { ServiceBus } from "../../src/registry/service-bus";

describe("ServiceBus", () => {
  it("registers and gets a service", () => {
    const bus = new ServiceBus();
    const svc = { a: 1 };
    bus.register("secrets", "env", svc);
    expect(bus.get("secrets")).toBe(svc);
    expect(bus.list()).toMatchObject([{ name: "secrets", ownerModuleId: "env" }]);
    expect(bus.get("nope")).toBeUndefined();
  });

  it("refuses a service owned by another module", () => {
    const bus = new ServiceBus();
    bus.register("secrets", "env", 1);
    expect(() => bus.register("secrets", "other", 2)).toThrow('Service "secrets" is already provided by env');
    expect(bus.get("secrets")).toBe(1);
  });

  it("lets the same owner replace the instance and notifies", () => {
    const bus = new ServiceBus();
    const cb = vi.fn();
    bus.onChange(cb);
    bus.register("secrets", "env", 1);
    bus.register("secrets", "env", 2);
    expect(bus.get("secrets")).toBe(2);
    expect(cb.mock.calls).toEqual([
      ["secrets", true],
      ["secrets", true],
    ]);
  });

  it("validates names", () => {
    const bus = new ServiceBus();
    expect(() => bus.register("Bad Name", "m", 1)).toThrow();
    expect(() => bus.register("", "m", 1)).toThrow();
    expect(() => bus.register("-x", "m", 1)).toThrow();
    expect(() => bus.register("secret-holder:telegram-ai-gateway", "m", 1)).not.toThrow();
    expect(() => bus.register("templates", "m", 1)).not.toThrow();
  });

  it("unregister notifies only when something was removed", () => {
    const bus = new ServiceBus();
    const cb = vi.fn();
    bus.register("a", "m", 1);
    bus.onChange(cb);
    bus.unregister("a");
    bus.unregister("a");
    expect(cb.mock.calls).toEqual([["a", false]]);
  });

  it("removeOwnedBy removes and notifies for each", () => {
    const bus = new ServiceBus();
    bus.register("a", "m1", 1);
    bus.register("b", "m1", 2);
    bus.register("c", "m2", 3);
    const cb = vi.fn();
    bus.onChange(cb);
    expect(bus.removeOwnedBy("m1").sort()).toEqual(["a", "b"]);
    expect(cb.mock.calls).toEqual([
      ["a", false],
      ["b", false],
    ]);
    expect(bus.list().map((s) => s.name)).toEqual(["c"]);
  });

  it("isolates listener errors and supports unsubscribe", () => {
    const bus = new ServiceBus();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const good = vi.fn();
    bus.onChange(() => {
      throw new Error("boom");
    });
    const off = bus.onChange(good);
    bus.register("a", "m", 1);
    expect(good).toHaveBeenCalledWith("a", true);
    off();
    bus.register("b", "m", 1);
    expect(good).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("clear removes everything", () => {
    const bus = new ServiceBus();
    bus.register("a", "m", 1);
    bus.clear();
    expect(bus.list()).toEqual([]);
  });
});
