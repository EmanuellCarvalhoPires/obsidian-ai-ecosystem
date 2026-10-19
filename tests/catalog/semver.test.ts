import { describe, expect, it } from "vitest";
import { compareVersions, isAtLeast } from "../../src/catalog/semver";

describe("semver", () => {
  it("compares numerically", () => {
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
    expect(compareVersions("1.10.0", "1.9.0")).toBeGreaterThan(0);
    expect(compareVersions("1.2.3", "1.3.0")).toBeLessThan(0);
  });
  it("treats missing parts as 0 and ignores a leading v", () => {
    expect(compareVersions("1.2", "1.2.0")).toBe(0);
    expect(compareVersions("v2", "1.9.9")).toBeGreaterThan(0);
  });
  it("orders pre-releases below the release", () => {
    expect(compareVersions("1.0.0-beta.1", "1.0.0")).toBeLessThan(0);
    expect(compareVersions("1.0.0", "1.0.0-rc")).toBeGreaterThan(0);
  });
  it("isAtLeast", () => {
    expect(isAtLeast("1.14.4", "1.13.0")).toBe(true);
    expect(isAtLeast("1.12.9", "1.13.0")).toBe(false);
    expect(isAtLeast("1.0.0", "1.0.0")).toBe(true);
  });
});
