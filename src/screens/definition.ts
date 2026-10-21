// Checks a screen definition before it is previewed or saved. Pure Node: no "obsidian" import.
import {
  ACTION_KEY,
  COLUMN_TYPES,
  FIELD_ID_PATTERN,
  FIELD_TYPES,
  MAX_COLUMNS,
  MAX_DEFINITION_CHARS,
  MAX_FIELDS,
  MAX_OPTIONS,
  RESERVED_SLUGS,
  SECRET_NAME_PATTERN,
  SLUG_PATTERN,
  isValidDate,
  isValidDateTime,
  isValidTime,
} from "./model";
import type { ColumnType, FieldOption, FieldType, ScreenDefinition, ScreenField, TableColumn } from "./model";
import { formatIssue } from "./issues";
import { validateField } from "./values";

const COMMON_KEYS = ["id", "tipo", "rotulo", "ajuda"];

/** Properties each type accepts besides the common ones. Anything else is reported. */
const TYPE_KEYS: Record<FieldType, string[]> = {
  texto: ["obrigatorio", "padrao", "min", "max", "padrao_regex"],
  texto_longo: ["obrigatorio", "padrao", "min", "max"],
  inteiro: ["obrigatorio", "padrao", "min", "max", "passo"],
  decimal: ["obrigatorio", "padrao", "min", "max", "passo"],
  data: ["obrigatorio", "padrao", "min", "max"],
  hora: ["obrigatorio", "padrao", "min", "max"],
  data_hora: ["obrigatorio", "padrao", "min", "max"],
  selecao: ["obrigatorio", "padrao", "opcoes"],
  selecao_multipla: ["obrigatorio", "padrao", "opcoes", "min", "max"],
  caixa: ["obrigatorio", "padrao"],
  interruptor: ["obrigatorio", "padrao"],
  url: ["obrigatorio", "padrao"],
  email: ["obrigatorio", "padrao"],
  telefone: ["obrigatorio", "padrao"],
  cor: ["obrigatorio", "padrao"],
  intervalo: ["padrao", "min", "max", "passo"],
  pasta: ["obrigatorio", "padrao"],
  arquivo: ["obrigatorio", "padrao", "extensoes"],
  nota: ["obrigatorio", "padrao"],
  tag: ["obrigatorio", "padrao"],
  lista: ["obrigatorio", "padrao", "min", "max"],
  tabela: ["obrigatorio", "padrao", "min", "max", "colunas"],
  rotulo: [],
  separador: [],
  aprovacao: [],
  acao: [],
  senha: ["obrigatorio", "min", "max", "destino_nome"],
};

const TOP_KEYS = ["slug", "titulo", "descricao", "campos"];

const MAX_TITLE = 120;
const MAX_DESCRIPTION = 1000;
const MAX_LABEL = 200;
const MAX_HELP = 500;
const MAX_REGEX = 200;

export type DefinitionResult = { ok: true; definition: ScreenDefinition } | { ok: false; errors: string[] };

type Fail = (message: string) => void;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function shown(value: unknown): string {
  const text = typeof value === "string" ? value : (JSON.stringify(value) ?? String(value));
  return text.length > 40 ? `${text.slice(0, 40)}...` : text;
}

function where(index: number, id: unknown): string {
  return typeof id === "string" && id !== "" ? `campos[${index}] "${id}"` : `campos[${index}]`;
}

/**
 * Checks a definition received from an agent (or read from disk) and returns a normalized copy
 * (options and columns as objects, extensions lowercase, no unknown properties). Every problem
 * found is listed, so the agent can fix them in one go. The input is never changed.
 */
export function validateDefinition(raw: unknown): DefinitionResult {
  const errors: string[] = [];
  if (!isRecord(raw)) return { ok: false, errors: ["definicao must be an object with slug, titulo, descricao and campos."] };

  const size = JSON.stringify(raw).length;
  if (size > MAX_DEFINITION_CHARS) errors.push(`The definition is too large (${size} characters, the limit is ${MAX_DEFINITION_CHARS}).`);

  for (const key of Object.keys(raw)) {
    if (!TOP_KEYS.includes(key)) errors.push(`Unknown property "${key}" (accepted: ${TOP_KEYS.join(", ")}).`);
  }

  const slug = raw.slug;
  if (typeof slug !== "string" || !SLUG_PATTERN.test(slug)) {
    errors.push(`slug must match ${SLUG_PATTERN.source} (lowercase letters, digits and "_", 1 to 48 characters).`);
  } else if (RESERVED_SLUGS.includes(slug)) {
    errors.push(`slug "${slug}" is reserved (it would collide with the tool tela_${slug}).`);
  }

  const titulo = raw.titulo;
  if (typeof titulo !== "string" || titulo.trim() === "") errors.push("titulo is required (a non-empty text).");
  else if (titulo.length > MAX_TITLE) errors.push(`titulo is too long (at most ${MAX_TITLE} characters).`);

  const descricao = raw.descricao;
  if (descricao !== undefined && (typeof descricao !== "string" || descricao.length > MAX_DESCRIPTION)) {
    errors.push(`descricao must be a text of at most ${MAX_DESCRIPTION} characters.`);
  }

  const fields: ScreenField[] = [];
  const campos = raw.campos;
  if (!Array.isArray(campos) || campos.length === 0) {
    errors.push("campos must be a list with at least one field.");
  } else {
    if (campos.length > MAX_FIELDS) errors.push(`campos has ${campos.length} fields (at most ${MAX_FIELDS}).`);
    const ids = new Set<string>();
    const secretNames = new Set<string>();
    campos.slice(0, MAX_FIELDS).forEach((entry, index) => {
      const field = checkField(entry, index, errors);
      if (!field) return;
      if (ids.has(field.id)) errors.push(`${where(index, field.id)}: the id is used by another field.`);
      ids.add(field.id);
      if (field.destino_nome) {
        const key = field.destino_nome.toLowerCase();
        if (secretNames.has(key)) errors.push(`${where(index, field.id)}: destino_nome "${field.destino_nome}" is used by another password field.`);
        secretNames.add(key);
      }
      fields.push(field);
    });
  }

  if (errors.length > 0) return { ok: false, errors };
  const definition: ScreenDefinition = { slug: slug as string, titulo: (titulo as string).trim(), campos: fields };
  if (typeof descricao === "string" && descricao.trim() !== "") definition.descricao = descricao.trim();
  return { ok: true, definition };
}

/** Returns the field when everything about it is valid; problems are pushed to `errors`. */
function checkField(entry: unknown, index: number, errors: string[]): ScreenField | undefined {
  if (!isRecord(entry)) {
    errors.push(`campos[${index}] must be an object.`);
    return undefined;
  }
  const before = errors.length;
  const label = where(index, entry.id);
  const fail: Fail = (message) => {
    errors.push(`${label}: ${message}`);
  };

  const id = entry.id;
  if (typeof id !== "string" || !FIELD_ID_PATTERN.test(id)) fail(`id must match ${FIELD_ID_PATTERN.source} (lowercase letters, digits and "_", 1 to 40 characters).`);
  else if (id === ACTION_KEY) fail(`id "${ACTION_KEY}" is reserved (the button result is returned as valores.${ACTION_KEY}).`);

  const tipo = entry.tipo;
  if (typeof tipo !== "string" || !(FIELD_TYPES as readonly string[]).includes(tipo)) {
    fail(`tipo must be one of: ${FIELD_TYPES.join(", ")}.`);
    return undefined;
  }
  const type = tipo as FieldType;

  const allowed = [...COMMON_KEYS, ...TYPE_KEYS[type]];
  for (const key of Object.keys(entry)) {
    if (!allowed.includes(key)) fail(`"${key}" does not apply to type ${type} (accepted: ${allowed.join(", ")}).`);
  }

  const rotulo = entry.rotulo;
  if (type === "separador") {
    if (rotulo !== undefined && (typeof rotulo !== "string" || rotulo.length > MAX_LABEL)) fail(`rotulo must be a text of at most ${MAX_LABEL} characters.`);
  } else if (typeof rotulo !== "string" || rotulo.trim() === "") fail("rotulo is required (the label shown to the user).");
  else if (rotulo.length > MAX_LABEL) fail(`rotulo is too long (at most ${MAX_LABEL} characters).`);

  const ajuda = entry.ajuda;
  if (ajuda !== undefined && (typeof ajuda !== "string" || ajuda.length > MAX_HELP)) fail(`ajuda must be a text of at most ${MAX_HELP} characters.`);
  if (entry.obrigatorio !== undefined && typeof entry.obrigatorio !== "boolean") fail("obrigatorio must be true or false.");

  const field: ScreenField = { id: typeof id === "string" ? id : "", tipo: type, rotulo: typeof rotulo === "string" ? rotulo.trim() : "" };
  if (typeof ajuda === "string" && ajuda.trim() !== "") field.ajuda = ajuda.trim();
  if (entry.obrigatorio === true) field.obrigatorio = true;

  checkBounds(entry, type, field, fail);
  checkOptions(entry, type, field, fail);
  checkRegex(entry, type, field, fail);
  checkExtensions(entry, type, field, fail);
  checkColumns(entry, type, field, fail);
  checkSecretName(entry, type, field, fail);

  if (errors.length === before) checkDefault(entry, field, fail);
  return errors.length > before ? undefined : field;
}

type BoundKind = "number" | "date" | "time" | "datetime" | "count" | "length";

function boundKind(type: FieldType): BoundKind | undefined {
  switch (type) {
    case "inteiro":
    case "decimal":
    case "intervalo":
      return "number";
    case "data":
      return "date";
    case "hora":
      return "time";
    case "data_hora":
      return "datetime";
    case "selecao_multipla":
    case "lista":
    case "tabela":
      return "count";
    case "texto":
    case "texto_longo":
    case "senha":
      return "length";
    default:
      return undefined;
  }
}

function checkBounds(entry: Record<string, unknown>, type: FieldType, field: ScreenField, fail: Fail): void {
  const kind = boundKind(type);
  if (!kind) return;
  for (const key of ["min", "max"] as const) {
    const value = entry[key];
    if (value === undefined) {
      if (type === "intervalo") fail(`${key} is required for a slider.`);
      continue;
    }
    switch (kind) {
      case "number":
        if (!isNumber(value)) fail(`${key} must be a number.`);
        else if (type === "inteiro" && !Number.isInteger(value)) fail(`${key} must be a whole number.`);
        else field[key] = value;
        break;
      case "count":
      case "length":
        if (!isNumber(value) || !Number.isInteger(value) || value < 0) fail(`${key} must be a whole number of 0 or more (${kind === "count" ? "items or rows" : "characters"}).`);
        else field[key] = value;
        break;
      case "date":
        if (typeof value !== "string" || !isValidDate(value)) fail(`${key} must be a date as YYYY-MM-DD.`);
        else field[key] = value;
        break;
      case "time":
        if (typeof value !== "string" || !isValidTime(value)) fail(`${key} must be a time as HH:mm.`);
        else field[key] = value;
        break;
      case "datetime":
        if (typeof value !== "string" || !isValidDateTime(value)) fail(`${key} must be a date and time as YYYY-MM-DDTHH:mm.`);
        else field[key] = value;
        break;
    }
  }
  if (field.min !== undefined && field.max !== undefined) {
    if (field.min > field.max) fail("min cannot be greater than max.");
    else if (type === "intervalo" && field.min === field.max) fail("min and max cannot be equal for a slider.");
  }

  if (entry.passo !== undefined) {
    const step = entry.passo;
    if (!isNumber(step) || step <= 0) fail("passo must be a number greater than 0.");
    else if (type === "inteiro" && !Number.isInteger(step)) fail("passo must be a whole number for type inteiro.");
    else field.passo = step;
  }
}

function checkOptions(entry: Record<string, unknown>, type: FieldType, field: ScreenField, fail: Fail): void {
  if (type !== "selecao" && type !== "selecao_multipla") return;
  const raw = entry.opcoes;
  if (!Array.isArray(raw) || raw.length === 0) {
    fail("opcoes must be a list with at least one option (texts, or objects with valor and rotulo).");
    return;
  }
  if (raw.length > MAX_OPTIONS) fail(`opcoes has ${raw.length} options (at most ${MAX_OPTIONS}).`);
  const options: FieldOption[] = [];
  const seen = new Set<string>();
  (raw as unknown[]).slice(0, MAX_OPTIONS).forEach((item, i) => {
    let valor: unknown;
    let rotulo: unknown;
    if (typeof item === "string") {
      valor = item;
      rotulo = item;
    } else if (isRecord(item)) {
      for (const key of Object.keys(item)) if (key !== "valor" && key !== "rotulo") fail(`opcoes[${i}] has an unknown property "${key}".`);
      valor = item.valor;
      rotulo = item.rotulo ?? item.valor;
    }
    if (typeof valor !== "string" || valor === "" || typeof rotulo !== "string") {
      fail(`opcoes[${i}] must be a non-empty text or an object { valor, rotulo } with texts.`);
      return;
    }
    if (seen.has(valor)) fail(`opcoes[${i}]: the value "${valor}" is repeated.`);
    seen.add(valor);
    options.push({ valor, rotulo });
  });
  field.opcoes = options;
}

function checkRegex(entry: Record<string, unknown>, type: FieldType, field: ScreenField, fail: Fail): void {
  if (type !== "texto" || entry.padrao_regex === undefined) return;
  const source = entry.padrao_regex;
  if (typeof source !== "string" || source === "" || source.length > MAX_REGEX) {
    fail(`padrao_regex must be a regular expression of at most ${MAX_REGEX} characters.`);
    return;
  }
  try {
    new RegExp(source);
    field.padrao_regex = source;
  } catch {
    fail(`padrao_regex "${shown(source)}" is not a valid regular expression.`);
  }
}

function checkExtensions(entry: Record<string, unknown>, type: FieldType, field: ScreenField, fail: Fail): void {
  if (type !== "arquivo" || entry.extensoes === undefined) return;
  const raw = entry.extensoes;
  if (!Array.isArray(raw)) {
    fail('extensoes must be a list of extensions such as ["md", "pdf"].');
    return;
  }
  const list: string[] = [];
  for (const item of raw) {
    const ext = typeof item === "string" ? item.replace(/^\./, "").toLowerCase() : "";
    if (!/^[a-z0-9]{1,10}$/.test(ext)) fail(`extensoes has an invalid extension (${shown(item)}).`);
    else if (!list.includes(ext)) list.push(ext);
  }
  if (list.length > 0) field.extensoes = list;
}

function checkColumns(entry: Record<string, unknown>, type: FieldType, field: ScreenField, fail: Fail): void {
  if (type !== "tabela") return;
  const raw = entry.colunas;
  if (!Array.isArray(raw) || raw.length === 0) {
    fail("colunas must be a list with at least one column (objects with id, rotulo and optionally tipo).");
    return;
  }
  if (raw.length > MAX_COLUMNS) fail(`colunas has ${raw.length} columns (at most ${MAX_COLUMNS}).`);
  const columns: TableColumn[] = [];
  const seen = new Set<string>();
  (raw as unknown[]).slice(0, MAX_COLUMNS).forEach((item, i) => {
    const source = typeof item === "string" ? { id: item, rotulo: item } : item;
    if (!isRecord(source)) {
      fail(`colunas[${i}] must be an object { id, rotulo, tipo?, obrigatorio? }.`);
      return;
    }
    for (const key of Object.keys(source)) {
      if (!["id", "rotulo", "tipo", "obrigatorio"].includes(key)) fail(`colunas[${i}] has an unknown property "${key}".`);
    }
    const id = source.id;
    if (typeof id !== "string" || !FIELD_ID_PATTERN.test(id)) {
      fail(`colunas[${i}].id must match ${FIELD_ID_PATTERN.source}.`);
      return;
    }
    if (seen.has(id)) fail(`colunas[${i}]: the id "${id}" is repeated.`);
    seen.add(id);
    const tipo = source.tipo ?? "texto";
    if (typeof tipo !== "string" || !(COLUMN_TYPES as readonly string[]).includes(tipo)) fail(`colunas[${i}].tipo must be one of: ${COLUMN_TYPES.join(", ")}.`);
    const rotulo = source.rotulo ?? id;
    if (typeof rotulo !== "string" || rotulo.trim() === "" || rotulo.length > MAX_LABEL) fail(`colunas[${i}].rotulo must be a non-empty text.`);
    if (source.obrigatorio !== undefined && typeof source.obrigatorio !== "boolean") fail(`colunas[${i}].obrigatorio must be true or false.`);
    const column: TableColumn = { id, rotulo: typeof rotulo === "string" ? rotulo.trim() : id, tipo: tipo as ColumnType };
    if (source.obrigatorio === true) column.obrigatorio = true;
    columns.push(column);
  });
  field.colunas = columns;
}

function checkSecretName(entry: Record<string, unknown>, type: FieldType, field: ScreenField, fail: Fail): void {
  if (type !== "senha") return;
  const name = entry.destino_nome;
  if (typeof name !== "string" || !SECRET_NAME_PATTERN.test(name)) {
    fail(`destino_nome is required and must match ${SECRET_NAME_PATTERN.source} (the name of the entry created in Environment Keys).`);
  } else {
    field.destino_nome = name;
  }
}

/** The default is checked with the same code that checks submitted values (required does not apply). */
function checkDefault(entry: Record<string, unknown>, field: ScreenField, fail: Fail): void {
  if (entry.padrao === undefined) return;
  const result = validateField(field, entry.padrao, false);
  if (!result.ok) {
    fail(`padrao is not valid: ${formatIssue(result.issue)}`);
    return;
  }
  if (!result.empty) field.padrao = result.value;
}
