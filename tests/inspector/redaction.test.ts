import { describe, expect, it } from "vitest";
import { MASK, createRedactor } from "../../src/inspector/redaction";
import type { SecretVaultService } from "../../src/types";

const plain = createRedactor(() => undefined);

function fakeSecrets(redact: (s: string) => string): SecretVaultService {
  return { isLocked: () => false, redact, spawnWithSecrets: async () => undefined };
}

describe("fallback patterns", () => {
  it("masks Bearer and Basic tokens but keeps the label", () => {
    expect(plain.text("Authorization: Bearer abcdef1234567890")).toBe(`Authorization: Bearer ${MASK}`);
    expect(plain.text("Authorization: Basic dXNlcjpwYXNzd29yZA==")).toBe(`Authorization: Basic ${MASK}`);
    expect(plain.text("Basic information here")).toBe("Basic information here");
  });

  it("masks query and form parameters", () => {
    expect(plain.text("/x?a=1&access_token=abc123&b=2")).toBe(`/x?a=1&access_token=${MASK}&b=2`);
    expect(plain.text("api_key=zzz&password=p%40ss&client_secret=s")).toBe(
      `api_key=${MASK}&password=${MASK}&client_secret=${MASK}`,
    );
    expect(plain.text("monkey=banana")).toBe("monkey=banana");
  });

  it("masks sensitive JSON string fields", () => {
    const out = plain.text('{"user":"ana","password":"hunter2","refresh_token": "r-1","token_type":"bearer"}');
    expect(out).toBe(`{"user":"ana","password":"${MASK}","refresh_token": "${MASK}","token_type":"bearer"}`);
  });

  it.each([
    ["github", "ghp_abcdefghijklmnopqrstuvwxyz0123456789"],
    ["github pat", "github_pat_11ABCDEFG0123456789_abcdefghijklmnop"],
    ["slack", "xoxb-1234567890-abcdefghij"],
    ["openai", "sk-abcdefghijklmnopqrstuvwx"],
    ["anthropic", "sk-ant-api03-abcdefghijklmnopqrstu"],
    ["aws", "AKIAABCDEFGHIJKLMNOP"],
    ["atlassian", "ATATT3xFfGF0abcdefghijklmnopqrstuvwxyz=1234"],
    ["evc", "evc_0123456789abcdef"],
    ["aie", "aie_0123456789abcdef"],
    ["telegram", "123456789:ABCdefGHIjklMNOpqrSTUvwxYZ012345678"],
    ["jwt", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTYifQ.SflKxwRJSMeKKF2QT4"],
  ])("masks %s tokens", (_n, token) => {
    expect(plain.text(`value ${token} end`)).toBe(`value ${MASK} end`);
  });

  it("masks PEM private key blocks", () => {
    const pem = "-----BEGIN PRIVATE KEY-----\nMIIabc\ndef\n-----END PRIVATE KEY-----";
    expect(plain.text(`k:\n${pem}\nafter`)).toBe(`k:\n${MASK}\nafter`);
  });

  it("cannot be tricked by forged sentinels in the input", () => {
    const forged = "token=0 and {{secret:X}}";
    const out = plain.text(forged);
    expect(out).toBe(`token=${MASK} and {{secret:X}}`);
    expect(plain.text("ab")).toBe("a�b");
  });

  it("keeps placeholders visible", () => {
    expect(plain.text("Authorization: {{bearer:X}}")).toBe("Authorization: {{bearer:X}}");
    expect(plain.text("?token={{secret:X}}&a=1")).toBe("?token={{secret:X}}&a=1");
    expect(plain.text('{"password":"{{secret:DB_PASS}}"}')).toBe('{"password":"{{secret:DB_PASS}}"}');
    expect(plain.text("Authorization: {{basic:Y}}")).toBe("Authorization: {{basic:Y}}");
  });
});

describe("secrets service", () => {
  it("uses secrets.redact first and is not limited", () => {
    const r = createRedactor(() => fakeSecrets((s) => s.replace("hunter2", "***")));
    expect(r.isLimited()).toBe(false);
    expect(r.text("pw hunter2 token=abc")).toBe(`pw *** token=${MASK}`);
  });

  it("is limited without the service", () => {
    expect(plain.isLimited()).toBe(true);
  });

  it("falls back when redact throws", () => {
    const r = createRedactor(() =>
      fakeSecrets(() => {
        throw new Error("locked");
      }),
    );
    expect(r.text("Bearer abcdef1234567890")).toBe(`Bearer ${MASK}`);
  });
});

describe("headers", () => {
  it("masks sensitive headers and returns a copy", () => {
    const input = {
      Authorization: "Bearer real-token-123",
      Cookie: "a=b",
      "X-Custom-Token": "abc",
      "X-Api-Key": "k",
      Accept: "application/json",
      "X-Note": "token=abc123",
      "x-auth": "{{bearer:Z}}",
    };
    const out = plain.headers(input);
    expect(out.Authorization).toBe(MASK);
    expect(out.Cookie).toBe(MASK);
    expect(out["X-Custom-Token"]).toBe(MASK);
    expect(out["X-Api-Key"]).toBe(MASK);
    expect(out.Accept).toBe("application/json");
    expect(out["X-Note"]).toBe(`token=${MASK}`);
    expect(out["x-auth"]).toBe("{{bearer:Z}}");
    expect(input.Authorization).toBe("Bearer real-token-123");
    expect(plain.headers({ Authorization: "{{bearer:X}}" }).Authorization).toBe("{{bearer:X}}");
  });
});

describe("value", () => {
  it("passes strings through text()", () => {
    expect(plain.value("token=abc")).toBe(`token=${MASK}`);
  });

  it("pretty prints and masks nested sensitive keys", () => {
    const out = plain.value({ a: { password: "x", list: [{ api_key: "k", ok: 1 }], max_tokens: 5, secret: "{{secret:S}}" } });
    const parsed = JSON.parse(out);
    expect(parsed.a.password).toBe(MASK);
    expect(parsed.a.list[0].api_key).toBe(MASK);
    expect(parsed.a.list[0].ok).toBe(1);
    expect(parsed.a.max_tokens).toBe(5);
    expect(parsed.a.secret).toBe("{{secret:S}}");
    expect(out).toContain('\n  "a"');
  });

  it("handles circular references", () => {
    const a: Record<string, unknown> = { name: "a" };
    a.self = a;
    const out = plain.value(a);
    expect(JSON.parse(out).self).toBe("[Circular]");
  });

  it("does not flag repeated non-circular references", () => {
    const shared = { x: 1 };
    expect(JSON.parse(plain.value({ a: shared, b: shared }))).toEqual({ a: { x: 1 }, b: { x: 1 } });
  });

  it("summarizes binaries", () => {
    const out = JSON.parse(plain.value({ buf: Buffer.from("hello"), u8: new Uint8Array(3) }));
    expect(out.buf).toBe("<binary 5 bytes>");
    expect(out.u8).toBe("<binary 3 bytes>");
  });

  it("truncates long values", () => {
    const out = plain.value("x".repeat(100), 40);
    expect(out.startsWith("x".repeat(40))).toBe(true);
    expect(out).toContain("\n… [truncated 60 chars]");
  });

  it("has a default limit of 65536 chars", () => {
    const out = plain.value("y".repeat(70_000));
    expect(out).toContain("[truncated 4464 chars]");
  });
});
