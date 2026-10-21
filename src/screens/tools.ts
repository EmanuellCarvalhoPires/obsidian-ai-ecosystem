// MCP tools of the screens: the four infrastructure tools (tela_criar, tela_listar, tela_editar,
// tela_remover) and one tool per saved screen (tela_<slug>). Pure Node.
import type { HubTool } from "../types";
import { COLUMN_TYPES, FIELD_ID_PATTERN, FIELD_TYPES, SLUG_PATTERN, screenToolName } from "./model";
import type { ScreenDefinition, ScreenField } from "./model";
import type { ScreenService } from "./service";

const COLUMN_SCHEMA = {
  type: "object",
  properties: {
    id: { type: "string", pattern: FIELD_ID_PATTERN.source },
    rotulo: { type: "string" },
    tipo: { type: "string", enum: [...COLUMN_TYPES], description: "Default: texto." },
    obrigatorio: { type: "boolean" },
  },
  required: ["id"],
  additionalProperties: false,
};

const FIELD_SCHEMA = {
  type: "object",
  properties: {
    id: { type: "string", pattern: FIELD_ID_PATTERN.source, description: "Key of the value in the answer." },
    tipo: { type: "string", enum: [...FIELD_TYPES] },
    rotulo: { type: "string", description: "Label shown to the user (the text for rotulo, the button text for acao)." },
    ajuda: { type: "string", description: "Help text under the label." },
    obrigatorio: { type: "boolean", description: "Blocks Confirm while empty." },
    padrao: { description: "Initial value (never for senha)." },
    min: { description: "Number (inteiro, decimal, intervalo), YYYY-MM-DD / HH:mm / YYYY-MM-DDTHH:mm (data, hora, data_hora), or a count of characters / items / rows (texto, texto_longo, senha, selecao_multipla, lista, tabela)." },
    max: { description: "Same kinds of value as min." },
    passo: { type: "number", description: "Step (inteiro, decimal, intervalo)." },
    opcoes: {
      type: "array",
      description: "selecao and selecao_multipla: texts, or { valor, rotulo } objects.",
      items: { anyOf: [{ type: "string" }, { type: "object", properties: { valor: { type: "string" }, rotulo: { type: "string" } }, required: ["valor"], additionalProperties: false }] },
    },
    padrao_regex: { type: "string", description: "texto: regular expression the value must match." },
    extensoes: { type: "array", items: { type: "string" }, description: 'arquivo: accepted extensions, e.g. ["md", "pdf"].' },
    colunas: { type: "array", items: COLUMN_SCHEMA, description: "tabela: the columns." },
    destino_nome: { type: "string", description: "senha: name of the entry created in Environment Keys (required)." },
  },
  required: ["id", "tipo"],
  additionalProperties: false,
};

const DEFINITION_SCHEMA = {
  type: "object",
  properties: {
    slug: { type: "string", pattern: SLUG_PATTERN.source, description: "Becomes the tool tela_<slug>. Lowercase letters, digits and _." },
    titulo: { type: "string" },
    descricao: { type: "string" },
    campos: { type: "array", items: FIELD_SCHEMA, minItems: 1 },
  },
  required: ["slug", "titulo", "campos"],
  additionalProperties: false,
};

const FIELD_GUIDE =
  "Field types: texto, texto_longo, inteiro, decimal, data (YYYY-MM-DD), hora (HH:mm), data_hora (YYYY-MM-DDTHH:mm), " +
  "selecao (opcoes), selecao_multipla (opcoes), caixa, interruptor, url, email, telefone, cor (#rrggbb), " +
  "intervalo (slider, needs min and max), pasta, arquivo (vault file, optional extensoes), nota (vault .md note), tag (vault tags), " +
  "lista (list of texts), tabela (rows by colunas), rotulo (informative text, no value), separador (divider), " +
  "aprovacao (Approve / Reject buttons, returns aprovado or recusado), acao (button, returns valores.acao = its id), " +
  "senha (password: needs destino_nome; saved in Environment Keys, never returned to you, reported in secretos). " +
  "The user always sees a preview and must approve before anything is saved.";

function describeField(field: ScreenField): string {
  const flags = [field.tipo, ...(field.obrigatorio ? ["required"] : [])].join(", ");
  switch (field.tipo) {
    case "senha":
      return `- ${field.id} (${flags}): ${field.rotulo}. NOT returned: saved in Environment Keys as "${field.destino_nome}", shown in secretos as "preenchido".`;
    case "acao":
      return `- ${field.id} (${flags}): ${field.rotulo}. Button: valores.acao is the id of the clicked button.`;
    case "aprovacao":
      return `- ${field.id} (${flags}): ${field.rotulo}. Returns "aprovado" or "recusado".`;
    case "selecao":
    case "selecao_multipla":
      return `- ${field.id} (${flags}): ${field.rotulo}. Options: ${(field.opcoes ?? []).map((o) => o.valor).join(" | ")}.`;
    case "tabela":
      return `- ${field.id} (${flags}): ${field.rotulo}. Rows with: ${(field.colunas ?? []).map((c) => `${c.id} (${c.tipo})`).join(", ")}.`;
    default:
      return `- ${field.id} (${flags}): ${field.rotulo}.`;
  }
}

/** Description of a saved screen's tool: what it asks and what comes back. */
export function describeScreenTool(definition: ScreenDefinition): string {
  const valued = definition.campos.filter((f) => f.tipo !== "separador" && f.tipo !== "rotulo");
  const lines = [
    `Opens the screen "${definition.titulo}" in Obsidian for the user and waits up to 5 minutes for the answer.`,
    ...(definition.descricao ? [definition.descricao] : []),
    'Returns { status: "confirmado" | "cancelado" | "expirado", valores, secretos }. cancelado means the user closed the screen or sent another message.',
    ...(valued.length > 0 ? ["Fields:", ...valued.map(describeField)] : []),
  ];
  return lines.join("\n");
}

export function createScreenTool(definition: ScreenDefinition, service: ScreenService): HubTool {
  return {
    name: screenToolName(definition.slug),
    title: definition.titulo,
    description: describeScreenTool(definition),
    inputSchema: {
      type: "object",
      properties: {
        contexto: { type: "string", description: "Text shown at the top of the screen, to tell the user why you are asking." },
        valores_iniciais: {
          type: "object",
          description: "Pre-filled values by field id. Password fields cannot be pre-filled.",
        },
      },
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["confirmado", "cancelado", "expirado"] },
        valores: { type: "object" },
        secretos: { type: "object", description: 'Password field id to "preenchido".' },
      },
      required: ["status", "valores", "secretos"],
    },
    annotations: { title: definition.titulo, readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    handler: (args, ctx) => service.call(definition.slug, args, ctx),
  };
}

export function createScreenInfraTools(service: ScreenService): HubTool[] {
  return [
    {
      name: "tela_criar",
      title: "Create a screen",
      description:
        "Creates a screen (a form the user fills in inside Obsidian) as a new tool tela_<slug>. " +
        "The user sees a preview of the screen and its JSON definition and must approve it; nothing is saved before that. " +
        `${FIELD_GUIDE} Returns { status: "aprovado" | "recusado" | "expirado" | "cancelado" }; waits up to 5 minutes.`,
      inputSchema: { type: "object", properties: { definicao: DEFINITION_SCHEMA }, required: ["definicao"], additionalProperties: false },
      annotations: { title: "Create a screen", readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      handler: (args, ctx) => service.create(args, ctx),
    },
    {
      name: "tela_listar",
      title: "List screens",
      description: "Lists the saved screens (slug, tool name, title and fields) and the limit of screens.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { title: "List screens", readOnlyHint: true, openWorldHint: false },
      handler: () => Promise.resolve(service.listTool()),
    },
    {
      name: "tela_editar",
      title: "Edit a screen",
      description:
        "Replaces the definition of a saved screen (the slug cannot change). The user sees a preview and must approve it. " +
        `${FIELD_GUIDE} Returns { status: "aprovado" | "recusado" | "expirado" | "cancelado" }; waits up to 5 minutes.`,
      inputSchema: {
        type: "object",
        properties: { slug: { type: "string", pattern: SLUG_PATTERN.source }, definicao: DEFINITION_SCHEMA },
        required: ["slug", "definicao"],
        additionalProperties: false,
      },
      annotations: { title: "Edit a screen", readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      handler: (args, ctx) => service.edit(args, ctx),
    },
    {
      name: "tela_remover",
      title: "Remove a screen",
      description:
        "Removes a saved screen and its tool tela_<slug>. The user sees the screen and must approve the removal. " +
        'Returns { status: "aprovado" | "recusado" | "expirado" | "cancelado" }; waits up to 5 minutes.',
      inputSchema: { type: "object", properties: { slug: { type: "string", pattern: SLUG_PATTERN.source } }, required: ["slug"], additionalProperties: false },
      annotations: { title: "Remove a screen", readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
      handler: (args, ctx) => service.remove(args, ctx),
    },
  ];
}

/** Infrastructure tools plus one tool per saved screen. */
export function createScreenTools(service: ScreenService): HubTool[] {
  return [...createScreenInfraTools(service), ...service.list().map((d) => createScreenTool(d, service))];
}
