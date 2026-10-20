import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CatalogService, validateCatalog } from "../../src/catalog/catalog-service";
import embedded from "../../catalog.json";
import type { Catalog } from "../../src/types";

const good = (id: string, repo = `EmanuellCarvalhoPires/obsidian-${id}`) => ({
  id,
  repo,
  name: id,
  description: { en: "en", pt: "pt" },
  icon: "key-round",
  minEcosystemVersion: "1.0.0",
});

describe("validateCatalog", () => {
  it("keeps the embedded catalog intact", () => {
    expect(validateCatalog(embedded).modules.map((m) => m.id)).toEqual([
      "environment-variables",
      "telegram-ai-gateway",
      "ai-templates",
      "ai-scripts",
      "ai-vault-search",
    ]);
  });
  it("accepts the owner case-insensitively", () => {
    const c = validateCatalog({ version: 1, modules: [good("a", "emanuellcarvalhopires/x")] });
    expect(c.modules).toHaveLength(1);
  });
  it("drops other owners and malformed repos", () => {
    const c = validateCatalog({
      version: 1,
      modules: [good("a", "evil/x"), good("b", "EmanuellCarvalhoPires"), good("c", "EmanuellCarvalhoPires/x/y"), good("d")],
    });
    expect(c.modules.map((m) => m.id)).toEqual(["d"]);
  });
  it("drops bad ids, dedupes and defaults the icon", () => {
    const c = validateCatalog({
      version: 1,
      modules: [good("Bad_Id"), good("-x"), good("ok"), good("ok"), { ...good("noicon"), icon: 5 }, { ...good("noname"), name: "" }],
    });
    expect(c.modules.map((m) => m.id)).toEqual(["ok", "noicon"]);
    expect(c.modules[1]!.icon).toBe("puzzle");
  });
  it("handles garbage", () => {
    expect(validateCatalog(null).modules).toEqual([]);
    expect(validateCatalog({ modules: "x" }).modules).toEqual([]);
  });
});

describe("CatalogService", () => {
  const emb = validateCatalog(embedded);
  const remote: Catalog = { version: 1, modules: [good("remote-one")] };
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("uses the remote catalog", async () => {
    const fetchJson = vi.fn().mockResolvedValue(remote);
    const svc = new CatalogService({ embedded: emb, fetchJson });
    const r = await svc.load();
    expect(r.source).toBe("remote");
    expect(r.catalog.modules[0]!.id).toBe("remote-one");
  });
  it("falls back to embedded on failure or empty result", async () => {
    const svc = new CatalogService({ embedded: emb, fetchJson: vi.fn().mockRejectedValue(new Error("x")) });
    expect((await svc.load()).source).toBe("embedded");
    const svc2 = new CatalogService({ embedded: emb, fetchJson: vi.fn().mockResolvedValue({ version: 1, modules: [] }) });
    const r = await svc2.load();
    expect(r.source).toBe("embedded");
    expect(r.catalog.modules).toHaveLength(5);
  });
  it("caches until the ttl and reloads on force", async () => {
    const fetchJson = vi.fn().mockResolvedValue(remote);
    const svc = new CatalogService({ embedded: emb, fetchJson, ttlMs: 1000 });
    await svc.load();
    await svc.load();
    expect(fetchJson).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1001);
    await svc.load();
    expect(fetchJson).toHaveBeenCalledTimes(2);
    await svc.load(true);
    expect(fetchJson).toHaveBeenCalledTimes(3);
  });
});
