// Checks and coerces the values of a screen (what the user typed, or what the agent pre-fills).
// Pure Node: no "obsidian" import.
import {
  ACTION_KEY,
  DISPLAY_TYPES,
  holdsValue,
  isValidDate,
  isValidDateTime,
  isValidTime,
} from "./model";
import type { FieldIssue, IssueCode, ScreenDefinition, ScreenField, TableColumn } from "./model";
import { formatIssue } from "./issues";

export type FieldValueResult = { ok: true; value: unknown; empty: boolean } | { ok: false; issue: FieldIssue };

const MAX_TEXT = 5_000;
const MAX_LONG_TEXT = 100_000;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^\+?[0-9 ()\-.]{6,25}$/;
const COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const TAG_BODY = /^[\p{L}\p{N}_\-/]+$/u;

function ok(value: unknown, empty = false): FieldValueResult {
  return { ok: true, value, empty };
}

function fail(code: IssueCode, params?: Record<string, string | number>): FieldValueResult {
  return { ok: false, issue: params ? { code, params } : { code } };
}

function isBlank(raw: unknown): boolean {
  return raw === undefined || raw === null || (typeof raw === "string" && raw.trim() === "") || (Array.isArray(raw) && raw.length === 0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The value a field starts with when nothing is pre-filled. */
export function initialValueFor(field: ScreenField): unknown {
  if (field.padrao !== undefined) return field.padrao;
  switch (field.tipo) {
    case "caixa":
    case "interruptor":
      return false;
    case "intervalo":
      return typeof field.min === "number" ? field.min : 0;
    case "cor":
      return "#000000";
    case "selecao_multipla":
    case "lista":
    case "tabela":
      return [];
    default:
      return undefined;
  }
}

/** Vault-relative path with "/" separators, or undefined when it points outside the vault. */
export function normalizeVaultPath(value: string): string | undefined {
  if (value.includes("\0")) return undefined;
  const parts = value
    .trim()
    .replace(/\\/g, "/")
    .split("/")
    .map((p) => p.trim())
    .filter((p) => p !== "" && p !== ".");
  if (parts.some((p) => p === "..")) return undefined;
  if (parts.length > 0 && /^[A-Za-z]:$/.test(parts[0] ?? "")) return undefined;
  return parts.join("/");
}

function parseNumber(raw: unknown): number | undefined {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : undefined;
  if (typeof raw !== "string") return undefined;
  const text = raw.trim().replace(",", ".");
  if (text === "" || !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(text)) return undefined;
  const value = Number(text);
  return Number.isFinite(value) ? value : undefined;
}

function checkStep(value: number, base: number, step: number): boolean {
  const q = (value - base) / step;
  return Math.abs(q - Math.round(q)) < 1e-9;
}

function checkNumber(field: ScreenField, raw: unknown, integer: boolean): FieldValueResult {
  const value = parseNumber(raw);
  if (value === undefined) return fail("invalid_number");
  if (integer && !Number.isInteger(value)) return fail("invalid_integer");
  if (typeof field.min === "number" && value < field.min) return fail("below_min", { min: field.min });
  if (typeof field.max === "number" && value > field.max) return fail("above_max", { max: field.max });
  if (field.passo !== undefined && !checkStep(value, typeof field.min === "number" ? field.min : 0, field.passo)) {
    return fail("step", { step: field.passo });
  }
  return ok(value);
}

function checkText(field: ScreenField, raw: unknown, trim: boolean): FieldValueResult {
  if (typeof raw !== "string") return fail("bad_type");
  const value = trim ? raw.trim() : raw;
  if (value.length > (field.tipo === "texto_longo" ? MAX_LONG_TEXT : MAX_TEXT)) return fail("too_long", { max: field.tipo === "texto_longo" ? MAX_LONG_TEXT : MAX_TEXT });
  if (typeof field.min === "number" && value.length < field.min) return fail("too_short", { min: field.min });
  if (typeof field.max === "number" && value.length > field.max) return fail("too_long", { max: field.max });
  if (field.padrao_regex !== undefined) {
    let matches = true;
    try {
      matches = new RegExp(field.padrao_regex).test(value);
    } catch {
      matches = true;
    }
    if (!matches) return fail("pattern");
  }
  return ok(value);
}

function checkMoment(field: ScreenField, raw: unknown, valid: (v: string) => boolean, code: IssueCode): FieldValueResult {
  if (typeof raw !== "string") return fail("bad_type");
  const value = raw.trim();
  if (!valid(value)) return fail(code);
  if (typeof field.min === "string" && value < field.min) return fail("before_min", { min: field.min });
  if (typeof field.max === "string" && value > field.max) return fail("after_max", { max: field.max });
  return ok(value);
}

function checkCount(field: ScreenField, count: number, items: boolean): FieldIssue | undefined {
  if (typeof field.min === "number" && count < field.min) return { code: items ? "too_few_items" : "too_few_rows", params: { min: field.min } };
  if (typeof field.max === "number" && count > field.max) return { code: items ? "too_many_items" : "too_many_rows", params: { max: field.max } };
  return undefined;
}

function checkPath(field: ScreenField, raw: unknown): FieldValueResult {
  if (typeof raw !== "string") return fail("bad_type");
  const value = normalizeVaultPath(raw);
  if (value === undefined || value === "") return fail("invalid_path");
  const name = value.slice(value.lastIndexOf("/") + 1);
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
  if (field.tipo === "nota" && ext !== "md") return fail("bad_extension", { extensions: "md" });
  if (field.tipo === "arquivo" && field.extensoes && field.extensoes.length > 0 && !field.extensoes.includes(ext)) {
    return fail("bad_extension", { extensions: field.extensoes.join(", ") });
  }
  return ok(value);
}

function checkTag(raw: unknown): FieldValueResult {
  if (typeof raw !== "string") return fail("bad_type");
  const body = raw.trim().replace(/^#/, "");
  if (!TAG_BODY.test(body) || /^[\p{N}/_-]+$/u.test(body)) return fail("invalid_tag");
  return ok(`#${body}`);
}

function checkUrl(raw: unknown): FieldValueResult {
  if (typeof raw !== "string") return fail("bad_type");
  const value = raw.trim();
  try {
    const url = new URL(value);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.hostname === "") return fail("invalid_url");
  } catch {
    return fail("invalid_url");
  }
  return ok(value);
}

function checkOption(field: ScreenField, value: unknown): boolean {
  return typeof value === "string" && (field.opcoes ?? []).some((o) => o.valor === value);
}

function checkTable(field: ScreenField, raw: unknown): FieldValueResult {
  if (!Array.isArray(raw)) return fail("bad_type");
  const columns = field.colunas ?? [];
  const rows: Array<Record<string, unknown>> = [];
  let index = 0;
  for (const entry of raw) {
    if (!isRecord(entry)) return fail("bad_type");
    index++;
    const cells = columns.map((c) => ({ column: c, raw: entry[c.id] }));
    // A row nobody touched (every cell blank, no box ticked) is dropped.
    if (cells.every((c) => c.raw === undefined || c.raw === null || c.raw === "" || c.raw === false)) {
      index--;
      continue;
    }
    const row: Record<string, unknown> = {};
    for (const { column, raw: cell } of cells) {
      const result = checkCell(column, cell);
      if (!result.ok) {
        return { ok: false, issue: { code: "cell", params: { row: index, column: column.rotulo }, cause: result.issue } };
      }
      row[column.id] = result.value;
    }
    rows.push(row);
  }
  const problem = checkCount(field, rows.length, false);
  if (problem) return { ok: false, issue: problem };
  return ok(rows);
}

function checkCell(column: TableColumn, raw: unknown): FieldValueResult {
  if (column.tipo === "caixa") {
    if (raw !== undefined && raw !== null && typeof raw !== "boolean") return fail("bad_type");
    const value = raw === true;
    return column.obrigatorio && !value ? fail("required") : ok(value);
  }
  if (isBlank(raw)) return column.obrigatorio ? fail("required") : ok(null, true);
  if (column.tipo === "texto") {
    if (typeof raw !== "string") return fail("bad_type");
    return ok(raw.trim());
  }
  const value = parseNumber(raw);
  if (value === undefined) return fail("invalid_number");
  if (column.tipo === "inteiro" && !Number.isInteger(value)) return fail("invalid_integer");
  return ok(value);
}

/**
 * Checks one value and returns it coerced (numbers as numbers, paths normalized...).
 * `enforceRequired: false` is used for defaults and pre-filled values, which may be incomplete.
 */
export function validateField(field: ScreenField, raw: unknown, enforceRequired = true): FieldValueResult {
  const tipo = field.tipo;
  if (DISPLAY_TYPES.includes(tipo) || tipo === "acao") return ok(undefined, true);

  if (tipo === "caixa" || tipo === "interruptor") {
    if (raw !== undefined && raw !== null && typeof raw !== "boolean") return fail("bad_type");
    const value = raw === true;
    return enforceRequired && field.obrigatorio && !value ? fail("required") : ok(value);
  }

  if (tipo === "intervalo") {
    const source = isBlank(raw) ? initialValueFor(field) : raw;
    return checkNumber(field, source, false);
  }

  if (isBlank(raw)) {
    if (enforceRequired && field.obrigatorio) return fail("required");
    if (tipo === "selecao_multipla" || tipo === "lista" || tipo === "tabela") {
      const problem = enforceRequired ? checkCount(field, 0, tipo !== "tabela") : undefined;
      return problem ? { ok: false, issue: problem } : ok([], true);
    }
    return ok(null, true);
  }

  switch (tipo) {
    case "texto":
      return checkText(field, raw, true);
    case "texto_longo":
      return checkText(field, raw, false);
    case "senha":
      return checkText(field, raw, false);
    case "inteiro":
      return checkNumber(field, raw, true);
    case "decimal":
      return checkNumber(field, raw, false);
    case "data":
      return checkMoment(field, raw, isValidDate, "invalid_date");
    case "hora":
      return checkMoment(field, raw, isValidTime, "invalid_time");
    case "data_hora":
      return checkMoment(field, raw, isValidDateTime, "invalid_datetime");
    case "selecao":
      return checkOption(field, raw) ? ok(raw) : fail("not_option");
    case "selecao_multipla": {
      if (!Array.isArray(raw)) return fail("bad_type");
      const chosen: string[] = [];
      for (const item of raw) {
        if (!checkOption(field, item)) return fail("not_option");
        if (!chosen.includes(item as string)) chosen.push(item as string);
      }
      const problem = checkCount(field, chosen.length, true);
      return problem ? { ok: false, issue: problem } : ok(chosen);
    }
    case "url":
      return checkUrl(raw);
    case "email":
      return typeof raw !== "string" ? fail("bad_type") : EMAIL.test(raw.trim()) ? ok(raw.trim()) : fail("invalid_email");
    case "telefone": {
      if (typeof raw !== "string") return fail("bad_type");
      const value = raw.trim();
      return PHONE.test(value) && value.replace(/\D/g, "").length >= 6 ? ok(value) : fail("invalid_phone");
    }
    case "cor": {
      if (typeof raw !== "string") return fail("bad_type");
      const value = raw.trim().toLowerCase();
      if (!COLOR.test(value)) return fail("invalid_color");
      return ok(value.length === 4 ? `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}` : value);
    }
    case "pasta":
    case "arquivo":
    case "nota":
      return checkPath(field, raw);
    case "tag":
      return checkTag(raw);
    case "lista": {
      if (!Array.isArray(raw)) return fail("bad_type");
      const items: string[] = [];
      for (const item of raw) {
        if (typeof item !== "string") return fail("bad_type");
        if (item.trim() !== "") items.push(item.trim());
      }
      const problem = checkCount(field, items.length, true);
      if (problem) return { ok: false, issue: problem };
      return enforceRequired && field.obrigatorio && items.length === 0 ? fail("required") : ok(items, items.length === 0);
    }
    case "tabela": {
      const result = checkTable(field, raw);
      return result.ok && enforceRequired && field.obrigatorio && (result.value as unknown[]).length === 0 ? fail("required") : result;
    }
    case "aprovacao":
      return raw === "aprovado" || raw === "recusado" ? ok(raw) : fail("not_option");
    default:
      return fail("bad_type");
  }
}

// ---------------------------------------------------------------------------
// Submission
// ---------------------------------------------------------------------------

export interface SubmitOptions {
  /** Id of the "acao" button that submitted the screen. */
  action?: string;
  /** True when the user rejected (aprovacao "recusado"): required fields no longer block. */
  skipRequired?: boolean;
}

export type SubmissionResult =
  | {
      ok: true;
      /** Values to give the agent. Password fields are never in here. */
      values: Record<string, unknown>;
      /** Password field id to the typed value. Only for the code that stores it. */
      secrets: Record<string, string>;
    }
  | { ok: false; errors: Record<string, FieldIssue> };

/** Checks everything the user filled in. Returns the coerced values, or the issue of each bad field. */
export function validateSubmission(definition: ScreenDefinition, raw: Record<string, unknown>, options: SubmitOptions = {}): SubmissionResult {
  const values: Record<string, unknown> = {};
  const secrets: Record<string, string> = {};
  const errors: Record<string, FieldIssue> = {};
  const enforceRequired = options.skipRequired !== true;

  for (const field of definition.campos) {
    if (DISPLAY_TYPES.includes(field.tipo) || field.tipo === "acao") continue;
    const result = validateField(field, raw[field.id], enforceRequired);
    if (!result.ok) {
      errors[field.id] = result.issue;
      continue;
    }
    if (field.tipo === "senha") {
      if (!result.empty && typeof result.value === "string") secrets[field.id] = result.value;
    } else if (field.tipo === "aprovacao" && result.empty) {
      values[field.id] = null;
    } else {
      values[field.id] = result.value;
    }
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  if (options.action !== undefined && definition.campos.some((f) => f.id === options.action && f.tipo === "acao")) {
    values[ACTION_KEY] = options.action;
  }
  return { ok: true, values, secrets };
}

/** One line per issue, in English, for agents. */
export function describeErrors(definition: ScreenDefinition, errors: Record<string, FieldIssue>): string[] {
  return Object.entries(errors).map(([id, issue]) => {
    const field = definition.campos.find((f) => f.id === id);
    return `${id}${field ? ` (${field.rotulo})` : ""}: ${formatIssue(issue)}`;
  });
}

export type InitialValuesResult = { ok: true; values: Record<string, unknown> } | { ok: false; errors: string[] };

/**
 * Checks the valores_iniciais an agent sends. Unknown fields, password fields and fields that hold
 * no value are refused (a pre-filled password would travel through the call and the Inspector).
 */
export function checkInitialValues(definition: ScreenDefinition, initial: unknown): InitialValuesResult {
  if (initial === undefined || initial === null) return { ok: true, values: {} };
  if (!isRecord(initial)) return { ok: false, errors: ["valores_iniciais must be an object { <field id>: value }."] };
  const errors: string[] = [];
  const values: Record<string, unknown> = {};
  for (const [id, raw] of Object.entries(initial)) {
    const field = definition.campos.find((f) => f.id === id);
    if (!field) {
      errors.push(`valores_iniciais "${id}": this screen has no field with that id.`);
      continue;
    }
    if (field.tipo === "senha") {
      errors.push(`valores_iniciais "${id}": password fields cannot be pre-filled (only the user types them, and the value never goes through the AI).`);
      continue;
    }
    if (!holdsValue(field.tipo)) {
      errors.push(`valores_iniciais "${id}": a field of type ${field.tipo} holds no value.`);
      continue;
    }
    const result = validateField(field, raw, false);
    if (!result.ok) errors.push(`valores_iniciais "${id}": ${formatIssue(result.issue)}`);
    else if (!result.empty) values[id] = result.value;
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, values };
}
