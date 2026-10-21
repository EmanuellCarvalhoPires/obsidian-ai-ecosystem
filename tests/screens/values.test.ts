import { describe, expect, it } from "vitest";
import { validateDefinition } from "../../src/screens/definition";
import { formatIssue } from "../../src/screens/issues";
import type { FieldIssue, ScreenDefinition, ScreenField } from "../../src/screens/model";
import { checkInitialValues, describeErrors, initialValueFor, normalizeVaultPath, validateField, validateSubmission } from "../../src/screens/values";

function field(raw: Record<string, unknown>): ScreenField {
  const result = validateDefinition({ slug: "t", titulo: "T", campos: [{ id: "campo", rotulo: "Campo", ...raw }] });
  if (!result.ok) throw new Error(result.errors.join("\n"));
  return result.definition.campos[0]!;
}

function value(raw: Record<string, unknown>, input: unknown, enforceRequired = true): unknown {
  const result = validateField(field(raw), input, enforceRequired);
  if (!result.ok) throw new Error(`unexpected issue ${result.issue.code}`);
  return result.value;
}

function issue(raw: Record<string, unknown>, input: unknown, enforceRequired = true): FieldIssue | undefined {
  const result = validateField(field(raw), input, enforceRequired);
  return result.ok ? undefined : result.issue;
}

describe("required", () => {
  it.each([
    [{ tipo: "texto" }, ""],
    [{ tipo: "texto" }, "   "],
    [{ tipo: "texto_longo" }, undefined],
    [{ tipo: "inteiro" }, ""],
    [{ tipo: "data" }, null],
    [{ tipo: "selecao", opcoes: ["a"] }, ""],
    [{ tipo: "selecao_multipla", opcoes: ["a"] }, []],
    [{ tipo: "lista" }, []],
    [{ tipo: "lista" }, ["", "  "]],
    [{ tipo: "tabela", colunas: [{ id: "a" }] }, []],
    [{ tipo: "tabela", colunas: [{ id: "a" }] }, [{ a: "" }]],
    [{ tipo: "url" }, ""],
    [{ tipo: "senha", destino_nome: "A" }, ""],
    [{ tipo: "caixa" }, false],
    [{ tipo: "interruptor" }, undefined],
  ])("blocks an empty %j when it is required", (raw, input) => {
    expect(issue({ ...raw, obrigatorio: true }, input)?.code).toBe("required");
  });

  it("lets the same empty values through when the field is optional or required is not enforced", () => {
    expect(issue({ tipo: "texto" }, "")).toBeUndefined();
    expect(issue({ tipo: "texto", obrigatorio: true }, "", false)).toBeUndefined();
    expect(issue({ tipo: "caixa", obrigatorio: true }, false, false)).toBeUndefined();
  });

  it("accepts a ticked required box", () => {
    expect(value({ tipo: "caixa", obrigatorio: true }, true)).toBe(true);
  });
});

describe("text", () => {
  it("trims single-line text, keeps long text as typed and checks lengths", () => {
    expect(value({ tipo: "texto" }, "  Ana ")).toBe("Ana");
    expect(value({ tipo: "texto_longo" }, "line 1\nline 2 ")).toBe("line 1\nline 2 ");
    expect(issue({ tipo: "texto", min: 3 }, "ab")).toEqual({ code: "too_short", params: { min: 3 } });
    expect(issue({ tipo: "texto", max: 3 }, "abcd")).toEqual({ code: "too_long", params: { max: 3 } });
    expect(issue({ tipo: "texto_longo", max: 5 }, "abcdef")?.code).toBe("too_long");
  });

  it("applies padrao_regex", () => {
    expect(issue({ tipo: "texto", padrao_regex: "^[A-Z]{3}-\\d{4}$" }, "ABC-1234")).toBeUndefined();
    expect(issue({ tipo: "texto", padrao_regex: "^[A-Z]{3}-\\d{4}$" }, "abc-1234")?.code).toBe("pattern");
  });

  it("refuses values of the wrong type", () => {
    expect(issue({ tipo: "texto" }, 5)?.code).toBe("bad_type");
    expect(issue({ tipo: "texto" }, {})?.code).toBe("bad_type");
  });
});

describe("numbers", () => {
  it("coerces numeric text", () => {
    expect(value({ tipo: "inteiro" }, "42")).toBe(42);
    expect(value({ tipo: "inteiro" }, 7)).toBe(7);
    expect(value({ tipo: "decimal" }, "3,5")).toBe(3.5);
    expect(value({ tipo: "decimal" }, " -0.25 ")).toBe(-0.25);
  });

  it.each(["abc", "1e", "--1", "Infinity", "NaN", "1 2"])("refuses %j as a number", (input) => {
    expect(issue({ tipo: "decimal" }, input)?.code).toBe("invalid_number");
  });

  it("refuses a decimal where an integer is expected", () => {
    expect(issue({ tipo: "inteiro" }, "1.5")?.code).toBe("invalid_integer");
  });

  it("checks min and max, inclusive", () => {
    const raw = { tipo: "inteiro", min: 1, max: 10 };
    expect(issue(raw, 0)).toEqual({ code: "below_min", params: { min: 1 } });
    expect(issue(raw, 11)).toEqual({ code: "above_max", params: { max: 10 } });
    expect(issue(raw, 1)).toBeUndefined();
    expect(issue(raw, 10)).toBeUndefined();
  });

  it("checks the step from min", () => {
    const raw = { tipo: "decimal", min: 0.5, passo: 0.5 };
    expect(issue(raw, 2)).toBeUndefined();
    expect(issue(raw, 1.3)?.code).toBe("step");
    expect(issue({ tipo: "inteiro", passo: 5 }, 15)).toBeUndefined();
    expect(issue({ tipo: "inteiro", passo: 5 }, 14)?.code).toBe("step");
  });

  it("gives a slider its default, then its minimum, when nothing was sent", () => {
    expect(value({ tipo: "intervalo", min: 10, max: 20 }, undefined)).toBe(10);
    expect(value({ tipo: "intervalo", min: 10, max: 20, padrao: 15 }, undefined)).toBe(15);
    expect(issue({ tipo: "intervalo", min: 10, max: 20 }, 25)?.code).toBe("above_max");
  });
});

describe("dates and times", () => {
  it("accepts the formats of the browser inputs", () => {
    expect(value({ tipo: "data" }, "2026-02-28")).toBe("2026-02-28");
    expect(value({ tipo: "hora" }, "09:30")).toBe("09:30");
    expect(value({ tipo: "data_hora" }, "2026-10-21T13:45")).toBe("2026-10-21T13:45");
  });

  it.each([
    ["data", "2026-02-30", "invalid_date"],
    ["data", "21/10/2026", "invalid_date"],
    ["hora", "24:00", "invalid_time"],
    ["hora", "9:30", "invalid_time"],
    ["data_hora", "2026-10-21", "invalid_datetime"],
    ["data_hora", "2026-10-21T25:00", "invalid_datetime"],
  ])("refuses %s %j", (tipo, input, code) => {
    expect(issue({ tipo }, input)?.code).toBe(code);
  });

  it("checks min and max", () => {
    expect(issue({ tipo: "data", min: "2026-01-01", max: "2026-12-31" }, "2025-12-31")?.code).toBe("before_min");
    expect(issue({ tipo: "data", min: "2026-01-01", max: "2026-12-31" }, "2027-01-01")?.code).toBe("after_max");
    expect(issue({ tipo: "hora", min: "08:00", max: "18:00" }, "07:59")?.code).toBe("before_min");
    expect(issue({ tipo: "hora", min: "08:00", max: "18:00" }, "18:00")).toBeUndefined();
  });
});

describe("contact and format fields", () => {
  it("checks urls", () => {
    expect(value({ tipo: "url" }, " https://example.com/a?b=1 ")).toBe("https://example.com/a?b=1");
    for (const bad of ["example.com", "ftp://example.com", "javascript:alert(1)", "http://", "not a url"]) {
      expect(issue({ tipo: "url" }, bad)?.code, bad).toBe("invalid_url");
    }
  });

  it("checks emails", () => {
    expect(value({ tipo: "email" }, "ana@example.com")).toBe("ana@example.com");
    for (const bad of ["ana", "ana@", "@example.com", "ana@example", "a na@example.com"]) {
      expect(issue({ tipo: "email" }, bad)?.code, bad).toBe("invalid_email");
    }
  });

  it("checks phone numbers", () => {
    expect(value({ tipo: "telefone" }, "+55 (11) 91234-5678")).toBe("+55 (11) 91234-5678");
    for (const bad of ["12", "abc", "++5511999999999", "123-45"]) {
      expect(issue({ tipo: "telefone" }, bad)?.code, bad).toBe("invalid_phone");
    }
  });

  it("checks colors and expands the short form", () => {
    expect(value({ tipo: "cor" }, "#FF8800")).toBe("#ff8800");
    expect(value({ tipo: "cor" }, "#f80")).toBe("#ff8800");
    for (const bad of ["red", "#12", "#gggggg", "ff8800"]) expect(issue({ tipo: "cor" }, bad)?.code, bad).toBe("invalid_color");
  });
});

describe("choices", () => {
  const opcoes = [{ valor: "a", rotulo: "Alpha" }, "b", "c"];

  it("accepts only listed options", () => {
    expect(value({ tipo: "selecao", opcoes }, "b")).toBe("b");
    expect(issue({ tipo: "selecao", opcoes }, "z")?.code).toBe("not_option");
    expect(issue({ tipo: "selecao", opcoes }, "Alpha")?.code).toBe("not_option");
  });

  it("checks multiple choices, removes repeats and counts them", () => {
    const raw = { tipo: "selecao_multipla", opcoes, min: 1, max: 2 };
    expect(value(raw, ["a", "a", "b"])).toEqual(["a", "b"]);
    expect(issue(raw, ["a", "z"])?.code).toBe("not_option");
    expect(issue(raw, ["a", "b", "c"])).toEqual({ code: "too_many_items", params: { max: 2 } });
    expect(issue(raw, [])).toEqual({ code: "too_few_items", params: { min: 1 } });
    expect(issue(raw, "a")?.code).toBe("bad_type");
  });
});

describe("vault fields", () => {
  it("normalizes folders and refuses ways out of the vault", () => {
    expect(value({ tipo: "pasta" }, " Projetos\\Clientes/ ")).toBe("Projetos/Clientes");
    for (const bad of ["../fora", "a/../../b", "C:\\Windows", "a\0b"]) expect(issue({ tipo: "pasta" }, bad)?.code, bad).toBe("invalid_path");
    expect(normalizeVaultPath("/a//b/")).toBe("a/b");
  });

  it("checks the extension of files", () => {
    expect(value({ tipo: "arquivo" }, "Anexos/foto.PNG")).toBe("Anexos/foto.PNG");
    expect(issue({ tipo: "arquivo", extensoes: ["pdf", "docx"] }, "a/b.txt")).toEqual({ code: "bad_extension", params: { extensions: "pdf, docx" } });
    expect(issue({ tipo: "arquivo", extensoes: ["pdf"] }, "a/b.PDF")).toBeUndefined();
    expect(issue({ tipo: "arquivo", extensoes: ["pdf"] }, "a/semextensao")?.code).toBe("bad_extension");
  });

  it("accepts notes as markdown files only", () => {
    expect(value({ tipo: "nota" }, "Notas/Ideia.md")).toBe("Notas/Ideia.md");
    expect(issue({ tipo: "nota" }, "Notas/Ideia.txt")?.code).toBe("bad_extension");
  });

  it("normalizes tags and refuses invalid ones", () => {
    expect(value({ tipo: "tag" }, "projeto/ativo")).toBe("#projeto/ativo");
    expect(value({ tipo: "tag" }, "#Projeto-1")).toBe("#Projeto-1");
    for (const bad of ["#", "com espaco", "#123", "a#b"]) expect(issue({ tipo: "tag" }, bad)?.code, bad).toBe("invalid_tag");
  });
});

describe("lists and tables", () => {
  it("trims the items, drops the blank ones and counts the rest", () => {
    expect(value({ tipo: "lista" }, [" a ", "", "b"])).toEqual(["a", "b"]);
    expect(issue({ tipo: "lista", max: 2 }, ["a", "b", "c"])?.code).toBe("too_many_items");
    expect(issue({ tipo: "lista", min: 2 }, ["a", ""])?.code).toBe("too_few_items");
    expect(issue({ tipo: "lista" }, [1])?.code).toBe("bad_type");
    expect(issue({ tipo: "lista" }, "a")?.code).toBe("bad_type");
  });

  const tabela = {
    tipo: "tabela",
    colunas: [
      { id: "item", rotulo: "Item", obrigatorio: true },
      { id: "qtd", rotulo: "Qty", tipo: "inteiro" },
      { id: "ok", rotulo: "Done", tipo: "caixa" },
    ],
  };

  it("coerces each cell by its column and drops untouched rows", () => {
    expect(value(tabela, [{ item: " Pen ", qtd: "3", ok: true }, {}, { item: "", qtd: "", ok: false }, { item: "Ink" }])).toEqual([
      { item: "Pen", qtd: 3, ok: true },
      { item: "Ink", qtd: null, ok: false },
    ]);
  });

  it("points at the row and column that is wrong", () => {
    const bad = issue(tabela, [{ item: "A", qtd: "1" }, { item: "", qtd: "2" }]);
    expect(bad).toMatchObject({ code: "cell", params: { row: 2, column: "Item" }, cause: { code: "required" } });
    expect(formatIssue(bad!)).toBe("Row 2, Item: This field is required.");
    expect(issue(tabela, [{ item: "A", qtd: "1.5" }])).toMatchObject({ code: "cell", cause: { code: "invalid_integer" } });
    expect(issue(tabela, [{ item: "A", qtd: "x" }])).toMatchObject({ code: "cell", cause: { code: "invalid_number" } });
  });

  it("counts rows", () => {
    expect(issue({ ...tabela, min: 2 }, [{ item: "A" }])?.code).toBe("too_few_rows");
    expect(issue({ ...tabela, max: 1 }, [{ item: "A" }, { item: "B" }])?.code).toBe("too_many_rows");
  });
});

describe("validateSubmission", () => {
  const definition = (campos: Array<Record<string, unknown>>): ScreenDefinition => {
    const result = validateDefinition({ slug: "t", titulo: "T", campos });
    if (!result.ok) throw new Error(result.errors.join("\n"));
    return result.definition;
  };

  it("collects every issue by field id", () => {
    const def = definition([
      { id: "nome", tipo: "texto", rotulo: "Name", obrigatorio: true },
      { id: "email", tipo: "email", rotulo: "Email" },
      { id: "idade", tipo: "inteiro", rotulo: "Age", min: 18 },
    ]);
    const result = validateSubmission(def, { nome: "", email: "x", idade: "10" });
    expect(result.ok).toBe(false);
    expect(!result.ok && Object.keys(result.errors)).toEqual(["nome", "email", "idade"]);
    expect(!result.ok && describeErrors(def, result.errors)).toEqual([
      "nome (Name): This field is required.",
      "email (Email): Enter a valid email address.",
      "idade (Age): Must be at least 18.",
    ]);
  });

  it("separates passwords from the values and never puts them in values", () => {
    const def = definition([
      { id: "usuario", tipo: "texto", rotulo: "User" },
      { id: "chave", tipo: "senha", rotulo: "Key", obrigatorio: true, destino_nome: "KEY" },
      { id: "opcional", tipo: "senha", rotulo: "Optional", destino_nome: "OPT" },
    ]);
    const result = validateSubmission(def, { usuario: "ana", chave: "p@ss word ", opcional: "" });
    expect(result).toEqual({ ok: true, values: { usuario: "ana" }, secrets: { chave: "p@ss word " } });
  });

  it("reports the empty values of optional fields as null, false or an empty list", () => {
    const def = definition([
      { id: "a", tipo: "texto", rotulo: "A" },
      { id: "b", tipo: "caixa", rotulo: "B" },
      { id: "c", tipo: "lista", rotulo: "C" },
      { id: "d", tipo: "selecao_multipla", rotulo: "D", opcoes: ["x"] },
      { id: "e", tipo: "aprovacao", rotulo: "E" },
      { id: "f", tipo: "rotulo", rotulo: "Just text" },
      { id: "g", tipo: "separador" },
    ]);
    expect(validateSubmission(def, {})).toEqual({ ok: true, values: { a: null, b: false, c: [], d: [], e: null }, secrets: {} });
  });

  it("returns the clicked action and ignores one that is not a button", () => {
    const def = definition([
      { id: "ir", tipo: "acao", rotulo: "Go" },
      { id: "nome", tipo: "texto", rotulo: "Name" },
    ]);
    expect(validateSubmission(def, {}, { action: "ir" })).toMatchObject({ ok: true, values: { nome: null, acao: "ir" } });
    expect(validateSubmission(def, {}, { action: "nome" })).toMatchObject({ ok: true, values: { nome: null } });
    expect((validateSubmission(def, {}, { action: "nome" }) as { values: object }).values).not.toHaveProperty("acao");
  });

  it("does not enforce required fields after a rejection but still checks formats", () => {
    const def = definition([
      { id: "motivo", tipo: "texto", rotulo: "Why", obrigatorio: true },
      { id: "email", tipo: "email", rotulo: "Email" },
    ]);
    expect(validateSubmission(def, { email: "" }, { skipRequired: true }).ok).toBe(true);
    expect(validateSubmission(def, { email: "x" }, { skipRequired: true }).ok).toBe(false);
  });
});

describe("checkInitialValues", () => {
  const def = (): ScreenDefinition => {
    const result = validateDefinition({
      slug: "t",
      titulo: "T",
      campos: [
        { id: "nome", tipo: "texto", rotulo: "Name" },
        { id: "idade", tipo: "inteiro", rotulo: "Age", min: 0 },
        { id: "segredo", tipo: "senha", rotulo: "Secret", destino_nome: "SEC" },
        { id: "texto", tipo: "rotulo", rotulo: "Info" },
        { id: "botao", tipo: "acao", rotulo: "Go" },
        { id: "sim", tipo: "aprovacao", rotulo: "OK?" },
      ],
    });
    if (!result.ok) throw new Error(result.errors.join(" "));
    return result.definition;
  };

  it("coerces what is accepted and leaves out the empty ones", () => {
    expect(checkInitialValues(def(), { nome: " Ana ", idade: "5" })).toEqual({ ok: true, values: { nome: "Ana", idade: 5 } });
    expect(checkInitialValues(def(), undefined)).toEqual({ ok: true, values: {} });
    expect(checkInitialValues(def(), { nome: "" })).toEqual({ ok: true, values: {} });
  });

  it("refuses a password field without repeating the value", () => {
    const result = checkInitialValues(def(), { segredo: "hunter2-hunter2" });
    expect(result.ok).toBe(false);
    const text = JSON.stringify(result);
    expect(text).toContain("cannot be pre-filled");
    expect(text).not.toContain("hunter2");
  });

  it("refuses unknown fields, fields without a value and invalid values, all at once", () => {
    const result = checkInitialValues(def(), { nada: 1, texto: "x", botao: "x", sim: "aprovado", idade: -4 });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors).toHaveLength(5);
    expect(checkInitialValues(def(), [])).toMatchObject({ ok: false });
  });
});

describe("initialValueFor", () => {
  it("starts every type from something sensible", () => {
    expect(initialValueFor(field({ tipo: "caixa" }))).toBe(false);
    expect(initialValueFor(field({ tipo: "lista" }))).toEqual([]);
    expect(initialValueFor(field({ tipo: "intervalo", min: 5, max: 9 }))).toBe(5);
    expect(initialValueFor(field({ tipo: "intervalo", min: 5, max: 9, padrao: 7 }))).toBe(7);
    expect(initialValueFor(field({ tipo: "cor" }))).toBe("#000000");
    expect(initialValueFor(field({ tipo: "texto", padrao: "x" }))).toBe("x");
    expect(initialValueFor(field({ tipo: "texto" }))).toBeUndefined();
  });
});
