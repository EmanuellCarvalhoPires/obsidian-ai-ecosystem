import { describe, expect, it } from "vitest";
import { checkApiVersion, normalizeApiVersion } from "../../src/api/api-version";

describe("normalizeApiVersion", () => {
  it("accepts positive integers and numeric strings", () => {
    expect(normalizeApiVersion(1)).toBe(1);
    expect(normalizeApiVersion("1")).toBe(1);
    expect(normalizeApiVersion(" 2 ")).toBe(2);
  });

  it("rejects everything else", () => {
    for (const bad of [0, -1, 1.5, NaN, Infinity, "0", "1.5", "abc", "", "-1", null, undefined, {}, [], true]) {
      expect(normalizeApiVersion(bad)).toBeUndefined();
    }
  });
});

describe("checkApiVersion", () => {
  it("accepts a supported version", () => {
    expect(checkApiVersion("Mod", "1", [1])).toEqual({ ok: true, version: 1 });
  });

  it("explains an invalid version", () => {
    expect(checkApiVersion("Mod", undefined, [1])).toEqual({
      ok: false,
      reason: "Mod did not say which Provider API version it uses.",
    });
  });

  it("explains a newer version", () => {
    expect(checkApiVersion("Mod", 3, [1, 2])).toEqual({
      ok: false,
      reason: "Mod needs Provider API v3, but this AI Ecosystem supports v1, v2. Update AI Ecosystem.",
    });
  });

  it("explains an older version", () => {
    expect(checkApiVersion("Mod", 1, [2])).toEqual({
      ok: false,
      reason: "Mod uses Provider API v1, which this AI Ecosystem no longer supports. Update Mod.",
    });
  });
});
