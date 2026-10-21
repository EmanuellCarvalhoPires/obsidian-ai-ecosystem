import { afterEach, describe, expect, it } from "vitest";
import { allStrings, setLanguage, t } from "../../src/i18n";

afterEach(() => setLanguage(undefined));

const EMOJI = /\p{Extended_Pictographic}/u;

function placeholders(text: string): string[] {
  return [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? "").sort();
}

describe("i18n tables", () => {
  const { en, pt } = allStrings();

  it("has the same keys in English and Portuguese", () => {
    expect(Object.keys(pt).sort()).toEqual(Object.keys(en).sort());
  });

  it("has no empty strings", () => {
    for (const [key, value] of [...Object.entries(en), ...Object.entries(pt)]) {
      expect(value.trim(), key).not.toBe("");
    }
  });

  it("uses the same placeholders in both languages", () => {
    for (const key of Object.keys(en)) {
      expect(placeholders(pt[key] ?? ""), key).toEqual(placeholders(en[key] ?? ""));
    }
  });

  it("contains no emoji characters", () => {
    for (const [key, value] of [...Object.entries(en), ...Object.entries(pt)]) {
      expect(EMOJI.test(value), `${key}: ${value}`).toBe(false);
    }
  });

  it("keeps keys under the area prefixes", () => {
    const prefixes = ["core.", "server.", "runner.", "inspector.", "catalog.", "settings.", "screens."];
    for (const key of Object.keys(en)) {
      expect(prefixes.some((p) => key.startsWith(p)), key).toBe(true);
    }
  });

  it("translates and replaces placeholders", () => {
    setLanguage("en");
    expect(t("core.notice.restarted", { port: 27150 })).toBe("AI Ecosystem server restarted on port 27150.");
    setLanguage("pt");
    expect(t("core.notice.restarted", { port: 27150 })).toBe("Servidor do AI Ecosystem reiniciado na porta 27150.");
    expect(t("does.not.exist")).toBe("does.not.exist");
  });
});
