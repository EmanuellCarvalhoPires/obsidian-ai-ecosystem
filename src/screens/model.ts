// Screen definitions ("telas"): the model, its constants and the formats shared by the definition
// and value validation. Pure Node: no "obsidian" import.

export const SLUG_PATTERN = /^[a-z0-9_]{1,48}$/;
export const FIELD_ID_PATTERN = /^[a-z0-9_]{1,40}$/;
/** Name of the entry a password field creates in Environment Keys. */
export const SECRET_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
export const SCREEN_TOOL_PREFIX = "tela_";
/** Slugs that would collide with the infrastructure tools (tela_criar, tela_listar...). */
export const RESERVED_SLUGS: readonly string[] = ["criar", "listar", "editar", "remover"];
/** Key the id of a clicked "acao" button is returned under (valores.acao), so no field may use it as id. */
export const ACTION_KEY = "acao";
export const DEFAULT_MAX_SCREENS = 30;
/** How long a screen (or a preview) waits for the user. */
export const SCREEN_WAIT_MS = 5 * 60_000;
/** Environment Keys masks values of at least this many characters in outputs. */
export const MIN_MASKED_SECRET_LENGTH = 6;

export const MAX_FIELDS = 60;
export const MAX_OPTIONS = 200;
export const MAX_COLUMNS = 20;
export const MAX_DEFINITION_CHARS = 64_000;

export const FIELD_TYPES = [
  "texto",
  "texto_longo",
  "inteiro",
  "decimal",
  "data",
  "hora",
  "data_hora",
  "selecao",
  "selecao_multipla",
  "caixa",
  "interruptor",
  "url",
  "email",
  "telefone",
  "cor",
  "intervalo",
  "pasta",
  "arquivo",
  "nota",
  "tag",
  "lista",
  "tabela",
  "rotulo",
  "separador",
  "aprovacao",
  "acao",
  "senha",
] as const;

export type FieldType = (typeof FIELD_TYPES)[number];

export const COLUMN_TYPES = ["texto", "inteiro", "decimal", "caixa"] as const;
export type ColumnType = (typeof COLUMN_TYPES)[number];

export interface FieldOption {
  valor: string;
  rotulo: string;
}

export interface TableColumn {
  id: string;
  rotulo: string;
  tipo: ColumnType;
  obrigatorio?: boolean;
}

export interface ScreenField {
  id: string;
  tipo: FieldType;
  /** Label. For "rotulo" it is the informative text, for "acao" the button text. Empty only for "separador". */
  rotulo: string;
  ajuda?: string;
  obrigatorio?: boolean;
  padrao?: unknown;
  min?: number | string;
  max?: number | string;
  passo?: number;
  opcoes?: FieldOption[];
  padrao_regex?: string;
  extensoes?: string[];
  colunas?: TableColumn[];
  destino_nome?: string;
}

export interface ScreenDefinition {
  slug: string;
  titulo: string;
  descricao?: string;
  campos: ScreenField[];
}

/** Field types that only show something. */
export const DISPLAY_TYPES: readonly FieldType[] = ["rotulo", "separador"];
/** Field types that submit the screen by themselves (they replace the Confirm button). */
export const SUBMIT_TYPES: readonly FieldType[] = ["aprovacao", "acao"];

/** Types the agent can pre-fill with valores_iniciais (not displays, buttons or passwords). */
export function holdsValue(type: FieldType): boolean {
  return !DISPLAY_TYPES.includes(type) && !SUBMIT_TYPES.includes(type) && type !== "senha";
}

export function screenToolName(slug: string): string {
  return `${SCREEN_TOOL_PREFIX}${slug}`;
}

// ---------------------------------------------------------------------------
// Issues (what is wrong with a value)
// ---------------------------------------------------------------------------

export type IssueCode =
  | "required"
  | "bad_type"
  | "invalid_number"
  | "invalid_integer"
  | "below_min"
  | "above_max"
  | "step"
  | "too_short"
  | "too_long"
  | "pattern"
  | "invalid_url"
  | "invalid_email"
  | "invalid_phone"
  | "invalid_color"
  | "invalid_date"
  | "invalid_time"
  | "invalid_datetime"
  | "before_min"
  | "after_max"
  | "not_option"
  | "too_few_items"
  | "too_many_items"
  | "too_few_rows"
  | "too_many_rows"
  | "bad_extension"
  | "invalid_path"
  | "invalid_tag"
  | "cell"
  | "secret_unavailable"
  | "secret_locked"
  | "secret_exists"
  | "secret_failed"
  | "expired";

/** A problem with a value. Rendered by the UI with t() and for agents with the English table. */
export interface FieldIssue {
  code: IssueCode;
  params?: Record<string, string | number>;
  /** For "cell": what is wrong with the cell. */
  cause?: FieldIssue;
}

// ---------------------------------------------------------------------------
// Formats shared with the value validation
// ---------------------------------------------------------------------------

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^\d{2}:\d{2}$/;
const DATETIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

export function isValidDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

export function isValidTime(value: string): boolean {
  if (!TIME_PATTERN.test(value)) return false;
  const [h, m] = value.split(":").map(Number) as [number, number];
  return h < 24 && m < 60;
}

export function isValidDateTime(value: string): boolean {
  return DATETIME_PATTERN.test(value) && isValidDate(value.slice(0, 10)) && isValidTime(value.slice(11));
}
