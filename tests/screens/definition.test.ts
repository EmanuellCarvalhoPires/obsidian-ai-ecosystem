import { describe, expect, it } from "vitest";
import { validateDefinition } from "../../src/screens/definition";
import { FIELD_TYPES } from "../../src/screens/model";
import type { ScreenDefinition } from "../../src/screens/model";

function define(...campos: Array<Record<string, unknown>>): unknown {
  return { slug: "tela", titulo: "Screen", campos };
}

function check(...campos: Array<Record<string, unknown>>): string[] {
  const result = validateDefinition(define(...campos));
  return result.ok ? [] : result.errors;
}

function accepted(...campos: Array<Record<string, unknown>>): ScreenDefinition {
  const result = validateDefinition(define(...campos));
  if (!result.ok) throw new Error(result.errors.join("\n"));
  return result.definition;
}

/** One valid field of every type (the contract lists 27). */
const SAMPLES: Array<Record<string, unknown>> = [
  { id: "f_texto", tipo: "texto", rotulo: "Text", min: 1, max: 20, padrao_regex: "^[a-z]+$" },
  { id: "f_longo", tipo: "texto_longo", rotulo: "Long text", min: 0, max: 500 },
  { id: "f_inteiro", tipo: "inteiro", rotulo: "Integer", min: 0, max: 10, passo: 2, padrao: 4 },
  { id: "f_decimal", tipo: "decimal", rotulo: "Decimal", min: 0.5, max: 9.5, passo: 0.5 },
  { id: "f_data", tipo: "data", rotulo: "Date", min: "2026-01-01", max: "2026-12-31", padrao: "2026-10-21" },
  { id: "f_hora", tipo: "hora", rotulo: "Time", min: "08:00", max: "18:00" },
  { id: "f_data_hora", tipo: "data_hora", rotulo: "Date and time", min: "2026-01-01T00:00" },
  { id: "f_selecao", tipo: "selecao", rotulo: "Choice", opcoes: ["a", { valor: "b", rotulo: "Option B" }], padrao: "a" },
  { id: "f_multipla", tipo: "selecao_multipla", rotulo: "Choices", opcoes: ["x", "y", "z"], min: 1, max: 2, padrao: ["x"] },
  { id: "f_caixa", tipo: "caixa", rotulo: "Box", padrao: true },
  { id: "f_interruptor", tipo: "interruptor", rotulo: "Switch" },
  { id: "f_url", tipo: "url", rotulo: "URL", padrao: "https://example.com" },
  { id: "f_email", tipo: "email", rotulo: "Email" },
  { id: "f_telefone", tipo: "telefone", rotulo: "Phone" },
  { id: "f_cor", tipo: "cor", rotulo: "Color", padrao: "#ff8800" },
  { id: "f_intervalo", tipo: "intervalo", rotulo: "Slider", min: 0, max: 100, passo: 5, padrao: 50 },
  { id: "f_pasta", tipo: "pasta", rotulo: "Folder" },
  { id: "f_arquivo", tipo: "arquivo", rotulo: "File", extensoes: [".PDF", "md"] },
  { id: "f_nota", tipo: "nota", rotulo: "Note" },
  { id: "f_tag", tipo: "tag", rotulo: "Tag" },
  { id: "f_lista", tipo: "lista", rotulo: "List", min: 1, max: 5, padrao: ["one"] },
  { id: "f_tabela", tipo: "tabela", rotulo: "Table", colunas: [{ id: "item", rotulo: "Item" }, { id: "qtd", rotulo: "Qty", tipo: "inteiro", obrigatorio: true }, "preco"] },
  { id: "f_rotulo", tipo: "rotulo", rotulo: "Read this first" },
  { id: "f_separador", tipo: "separador" },
  { id: "f_aprovacao", tipo: "aprovacao", rotulo: "Approve?" },
  { id: "f_acao", tipo: "acao", rotulo: "Generate" },
  { id: "f_senha", tipo: "senha", rotulo: "Password", min: 8, destino_nome: "MY_PASSWORD" },
];

describe("validateDefinition", () => {
  it("covers every field type of the contract", () => {
    expect(new Set(SAMPLES.map((s) => s.tipo))).toEqual(new Set(FIELD_TYPES));
    expect(FIELD_TYPES).toHaveLength(27);
  });

  it("accepts a valid sample of every type and normalizes it", () => {
    const definition = accepted(...SAMPLES);
    expect(definition.campos).toHaveLength(SAMPLES.length);
    const byId = Object.fromEntries(definition.campos.map((f) => [f.id, f]));
    expect(byId.f_selecao?.opcoes).toEqual([
      { valor: "a", rotulo: "a" },
      { valor: "b", rotulo: "Option B" },
    ]);
    expect(byId.f_arquivo?.extensoes).toEqual(["pdf", "md"]);
    expect(byId.f_tabela?.colunas).toEqual([
      { id: "item", rotulo: "Item", tipo: "texto" },
      { id: "qtd", rotulo: "Qty", tipo: "inteiro", obrigatorio: true },
      { id: "preco", rotulo: "preco", tipo: "texto" },
    ]);
    expect(byId.f_separador?.rotulo).toBe("");
  });

  it("returns a copy and leaves the input alone", () => {
    const raw = define({ id: "a", tipo: "selecao", rotulo: "A", opcoes: ["x"] });
    const before = JSON.stringify(raw);
    const result = validateDefinition(raw);
    expect(JSON.stringify(raw)).toBe(before);
    expect(result.ok && result.definition).not.toBe(raw);
  });

  it("refuses what is not an object, and unknown properties", () => {
    expect(validateDefinition("x")).toMatchObject({ ok: false });
    expect(validateDefinition(null)).toMatchObject({ ok: false });
    expect(validateDefinition([])).toMatchObject({ ok: false });
    const extra = validateDefinition({ slug: "a", titulo: "A", campos: [{ id: "x", tipo: "texto", rotulo: "X" }], cor: "red" });
    expect(extra.ok).toBe(false);
    expect(!extra.ok && extra.errors.join(" ")).toContain('Unknown property "cor"');
  });

  it.each([
    ["Upper", false],
    ["with space", false],
    ["", false],
    ["a".repeat(49), false],
    ["ok_slug_1", true],
    ["a", true],
    ["a".repeat(48), true],
  ])("slug %j is valid: %s", (slug, valid) => {
    const result = validateDefinition({ slug, titulo: "T", campos: [{ id: "x", tipo: "texto", rotulo: "X" }] });
    expect(result.ok).toBe(valid);
  });

  it.each(["criar", "listar", "editar", "remover"])("refuses the reserved slug %s", (slug) => {
    const result = validateDefinition({ slug, titulo: "T", campos: [{ id: "x", tipo: "texto", rotulo: "X" }] });
    expect(result.ok).toBe(false);
  });

  it("needs a title and at least one field, and limits the number of fields", () => {
    expect(validateDefinition({ slug: "a", titulo: " ", campos: [] })).toMatchObject({ ok: false });
    const many = Array.from({ length: 61 }, (_, i) => ({ id: `f${i}`, tipo: "texto", rotulo: "F" }));
    const result = validateDefinition({ slug: "a", titulo: "A", campos: many });
    expect(!result.ok && result.errors.join(" ")).toContain("at most 60");
  });

  it("lists every problem at once, naming the field", () => {
    const errors = check(
      { id: "Bad Id", tipo: "texto", rotulo: "X" },
      { id: "ok", tipo: "inventado", rotulo: "X" },
      { id: "sem_rotulo", tipo: "texto" },
      { id: "dup", tipo: "texto", rotulo: "A" },
      { id: "dup", tipo: "texto", rotulo: "B" },
    );
    expect(errors.length).toBeGreaterThanOrEqual(4);
    const text = errors.join("\n");
    expect(text).toContain("id must match");
    expect(text).toContain("tipo must be one of");
    expect(text).toContain('campos[2] "sem_rotulo": rotulo is required');
    expect(text).toContain("the id is used by another field");
  });

  it("reserves the id acao", () => {
    expect(check({ id: "acao", tipo: "texto", rotulo: "X" }).join(" ")).toContain("reserved");
  });

  it("refuses properties that do not apply to the type", () => {
    expect(check({ id: "a", tipo: "caixa", rotulo: "A", min: 1 }).join(" ")).toContain('"min" does not apply to type caixa');
    expect(check({ id: "a", tipo: "texto", rotulo: "A", opcoes: ["x"] }).join(" ")).toContain('"opcoes" does not apply');
    expect(check({ id: "a", tipo: "intervalo", rotulo: "A", min: 0, max: 5, obrigatorio: true }).join(" ")).toContain('"obrigatorio" does not apply');
  });

  describe("per type", () => {
    it.each([
      ["inteiro min not a number", { tipo: "inteiro", min: "1" }, "min must be a number"],
      ["inteiro with a decimal bound", { tipo: "inteiro", max: 1.5 }, "whole number"],
      ["inteiro with a decimal step", { tipo: "inteiro", passo: 0.5 }, "passo must be a whole number"],
      ["decimal min above max", { tipo: "decimal", min: 5, max: 1 }, "min cannot be greater than max"],
      ["passo zero", { tipo: "decimal", passo: 0 }, "passo must be a number greater than 0"],
      ["texto negative length", { tipo: "texto", min: -1 }, "whole number of 0 or more"],
      ["texto bad regex", { tipo: "texto", padrao_regex: "(" }, "not a valid regular expression"],
      ["texto empty regex", { tipo: "texto", padrao_regex: "" }, "padrao_regex"],
      ["data bad min", { tipo: "data", min: "2026-13-01" }, "YYYY-MM-DD"],
      ["data bad format", { tipo: "data", max: "21/10/2026" }, "YYYY-MM-DD"],
      ["hora bad max", { tipo: "hora", max: "25:00" }, "HH:mm"],
      ["data_hora bad min", { tipo: "data_hora", min: "2026-01-01" }, "YYYY-MM-DDTHH:mm"],
      ["selecao without options", { tipo: "selecao" }, "opcoes must be a list"],
      ["selecao empty options", { tipo: "selecao", opcoes: [] }, "opcoes must be a list"],
      ["selecao repeated option", { tipo: "selecao", opcoes: ["a", "a"] }, "repeated"],
      ["selecao bad option", { tipo: "selecao", opcoes: [1] }, "non-empty text"],
      ["selecao_multipla default outside options", { tipo: "selecao_multipla", opcoes: ["a"], padrao: ["b"] }, "padrao is not valid"],
      ["selecao_multipla default over max", { tipo: "selecao_multipla", opcoes: ["a", "b"], max: 1, padrao: ["a", "b"] }, "padrao is not valid"],
      ["intervalo without bounds", { tipo: "intervalo" }, "min is required for a slider"],
      ["intervalo equal bounds", { tipo: "intervalo", min: 3, max: 3 }, "cannot be equal"],
      ["intervalo default outside", { tipo: "intervalo", min: 0, max: 10, padrao: 11 }, "padrao is not valid"],
      ["arquivo bad extension", { tipo: "arquivo", extensoes: ["a/b"] }, "invalid extension"],
      ["arquivo extensions not a list", { tipo: "arquivo", extensoes: "pdf" }, "list of extensions"],
      ["tabela without columns", { tipo: "tabela" }, "colunas must be a list"],
      ["tabela repeated column", { tipo: "tabela", colunas: [{ id: "a" }, { id: "a" }] }, "repeated"],
      ["tabela bad column type", { tipo: "tabela", colunas: [{ id: "a", tipo: "data" }] }, "colunas[0].tipo"],
      ["tabela bad column id", { tipo: "tabela", colunas: [{ id: "A B" }] }, "colunas[0].id"],
      ["senha without destino_nome", { tipo: "senha" }, "destino_nome is required"],
      ["senha bad destino_nome", { tipo: "senha", destino_nome: "1abc" }, "destino_nome is required"],
      ["senha with default", { tipo: "senha", destino_nome: "A", padrao: "x" }, '"padrao" does not apply to type senha'],
      ["url bad default", { tipo: "url", padrao: "ftp://x" }, "padrao is not valid"],
      ["email bad default", { tipo: "email", padrao: "nope" }, "padrao is not valid"],
      ["cor bad default", { tipo: "cor", padrao: "red" }, "padrao is not valid"],
      ["caixa string default", { tipo: "caixa", padrao: "yes" }, "padrao is not valid"],
      ["obrigatorio not boolean", { tipo: "texto", obrigatorio: "sim" }, "obrigatorio must be true or false"],
    ])("%s", (_name, field, message) => {
      const errors = check({ id: "campo", rotulo: "Campo", ...field });
      expect(errors.join("\n")).toContain(message);
    });
  });

  it("refuses two password fields that write the same entry", () => {
    const errors = check(
      { id: "a", tipo: "senha", rotulo: "A", destino_nome: "TOKEN" },
      { id: "b", tipo: "senha", rotulo: "B", destino_nome: "token" },
    );
    expect(errors.join(" ")).toContain("used by another password field");
  });

  it("refuses a definition that is too large", () => {
    const result = validateDefinition({ slug: "a", titulo: "A", descricao: "x".repeat(70_000), campos: [{ id: "x", tipo: "texto", rotulo: "X" }] });
    expect(!result.ok && result.errors.join(" ")).toContain("too large");
  });
});
