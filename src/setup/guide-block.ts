// The usage guide the core generates for the agents: a short block between two markers that goes
// into GEMINI.md (written by the plugin) and into CLAUDE.md (inserted by the agent, with the
// user's permission, through the setup skill). Only the block between the markers is ever
// replaced: the rest of the file stays as it is. Pure Node (no "obsidian" import).
import type { Lang } from "../i18n";
import { ECOSYSTEM_ID } from "../types";

export const BLOCK_START = "<!-- ai-ecosystem:start -->";
export const BLOCK_END = "<!-- ai-ecosystem:end -->";

export type GuideTarget = "claude" | "gemini";

interface Localized {
  pt: string;
  en: string;
}

interface GuideRow {
  task: Localized;
  plugin: string;
  tools: string[];
}

interface ModuleGuide {
  id: string;
  rows: GuideRow[];
  /** What the protection hook would enforce, as advice for clients without hooks (GEMINI.md). */
  advice?: Localized;
}

/** The modules the guide knows, in the order of the table. */
const GUIDES: ModuleGuide[] = [
  {
    id: ECOSYSTEM_ID,
    rows: [
      {
        task: { pt: "Ver o estado da suíte e dos módulos", en: "See the state of the suite and its modules" },
        plugin: "AI Ecosystem",
        tools: ["ecosystem_status"],
      },
      {
        task: { pt: "Conferir a saúde da suíte e por onde começar (skill `/kit`)", en: "Check the health of the suite and where to start (skill `/kit`)" },
        plugin: "AI Ecosystem",
        tools: ["ecosystem_diagnostico"],
      },
      {
        task: { pt: "Rodar um script de uma pasta permitida", en: "Run a script from an allowed folder" },
        plugin: "AI Ecosystem",
        tools: ["ecosystem_list_scripts", "ecosystem_run_script"],
      },
      {
        task: { pt: "Pedir dados ao usuário em uma tela do Obsidian", en: "Ask the user for data in an Obsidian screen" },
        plugin: "AI Ecosystem",
        tools: ["tela_gerenciar", "tela_listar"],
      },
    ],
  },
  {
    id: "ai-vault-search",
    rows: [
      {
        task: { pt: "Buscar, listar ou ler algo dentro do cofre", en: "Search, list or read something inside the vault" },
        plugin: "AI Vault Search",
        tools: ["search", "find", "get_section", "get_note", "read_table", "list_folders", "list_files", "list_tags", "recent_notes"],
      },
    ],
    advice: {
      pt: "Para procurar algo dentro do cofre, use `search` para buscar conteúdo e `find` para buscar nome (ou `get_section`, `get_note`, `read_table`, `list_folders`, `list_files`, `list_tags` e `recent_notes`) em vez de Grep, Glob ou buscas de terminal nas pastas do cofre.",
      en: "To look for something inside the vault, use `search` to search content and `find` to search names (or `get_section`, `get_note`, `read_table`, `list_folders`, `list_files`, `list_tags` and `recent_notes`) instead of Grep, Glob or terminal searches in the vault folders.",
    },
  },
  {
    id: "ai-scripts",
    rows: [
      {
        task: { pt: "Executar um script registrado", en: "Run a registered script" },
        plugin: "AI Scripts",
        tools: ["list_ai_scripts", "get_script_schema", "run_ai_script"],
      },
    ],
    advice: {
      pt: "Os scripts das pastas permitidas rodam com `ecosystem_run_script` (ou `run_ai_script`, se estiverem registrados), não com `python`, `node` ou `bash` direto no terminal.",
      en: "Scripts in the allowed folders run with `ecosystem_run_script` (or `run_ai_script`, when registered), not with `python`, `node` or `bash` straight in the terminal.",
    },
  },
  {
    id: "ai-templates",
    rows: [
      {
        task: { pt: "Criar uma nota ou arquivo que tem molde", en: "Create a note or file that has a template" },
        plugin: "AI Templates",
        tools: ["list_templates", "get_template_schema", "create_note_from_template", "preview_template", "create_template"],
      },
    ],
    advice: {
      pt: "Uma nota que tem molde nasce com `create_note_from_template`, não com uma escrita direta do arquivo. Para acrescentar a uma nota que já existe, edite o arquivo normalmente.",
      en: "A note that has a template is created with `create_note_from_template`, not by writing the file directly. To add to a note that already exists, edit the file as usual.",
    },
  },
  {
    id: "ai-log-manager",
    rows: [
      {
        task: { pt: "Ver ou atualizar o log da conversa, ligar um log a um projeto", en: "See or update the conversation log, link a log to a project" },
        plugin: "AI Log Manager",
        tools: ["logs_status", "logs_update", "logs_create", "logs_link_project", "logs_rename", "logs_sync_all"],
      },
      {
        task: { pt: "Registrar eventos de desenvolvimento, gerar changelog ou o grafo do repositório", en: "Record development events, build a changelog or the repository graph" },
        plugin: "AI Log Manager",
        tools: ["dev_sync", "dev_record_event", "dev_changelog", "dev_graph"],
      },
    ],
    advice: {
      pt: "O log da conversa é criado e atualizado pelo plugin: não monte uma nota de log à mão. Use `logs_status` para ver o estado e `logs_create` só para escolher o título.",
      en: "The conversation log is created and updated by the plugin: do not build a log note by hand. Use `logs_status` to see the state and `logs_create` only to choose the title.",
    },
  },
  {
    id: "ai-git-tools",
    rows: [
      {
        task: { pt: "Commit, push, branch, merge, stash e tag", en: "Commit, push, branch, merge, stash and tag" },
        plugin: "AI Git Tools",
        tools: ["git_status", "git_diff", "git_log", "git_add", "git_commit", "git_push", "git_pull", "git_checkout", "git_merge", "git_stash", "git_tag"],
      },
      {
        task: { pt: "Abrir, listar, comentar e mesclar PR; ver pipeline", en: "Open, list, comment on and merge a PR; see the pipeline" },
        plugin: "AI Git Tools",
        tools: ["git_pr_criar", "git_pr_listar", "git_pr_obter", "git_pr_comentar", "git_pr_merge", "git_pipeline_status"],
      },
      {
        task: { pt: "Grafo, changelog e eventos de projeto", en: "Graph, changelog and project events" },
        plugin: "AI Git Tools",
        tools: ["git_graph", "git_changelog", "git_sync", "git_registrar_evento"],
      },
    ],
    advice: {
      pt: "Para git e para as APIs do GitHub e do Bitbucket, use as tools do AI Git Tools (`git_status`, `git_commit`, `git_push`, `git_pr_criar`...) em vez de `git`, `gh`, `curl` ou `Invoke-RestMethod` no terminal. Elas documentam o histórico do projeto sozinhas. `git_pr_merge` sempre pede a aprovação do usuário.",
      en: "For git and for the GitHub and Bitbucket APIs, use the AI Git Tools tools (`git_status`, `git_commit`, `git_push`, `git_pr_criar`...) instead of `git`, `gh`, `curl` or `Invoke-RestMethod` in the terminal. They record the project history by themselves. `git_pr_merge` always asks for the user's approval.",
    },
  },
  {
    id: "environment-variables",
    rows: [
      {
        task: { pt: "Chamar uma API autenticada ou usar um segredo", en: "Call an authenticated API or use a secret" },
        plugin: "Environment Keys",
        tools: ["tools_find", "tools_run", "list_secrets", "http_request"],
      },
      {
        task: { pt: "Criar uma secret nova (o usuário digita o valor)", en: "Create a new secret (the user types the value)" },
        plugin: "Environment Keys",
        tools: ["env_criar_secret"],
      },
    ],
    advice: {
      pt: "Para chamar um serviço que tem secret, use `tools_find` e `tools_run` (ou `http_request` com `{{secret:NOME}}`) em vez de `curl`, `wget` ou `Invoke-RestMethod` contra esse host. Nunca peça nem escreva o valor de uma secret.",
      en: "To call a service that has a secret, use `tools_find` and `tools_run` (or `http_request` with `{{secret:NAME}}`) instead of `curl`, `wget` or `Invoke-RestMethod` against that host. Never ask for or write the value of a secret.",
    },
  },
  {
    id: "telegram-ai-gateway",
    rows: [
      {
        task: { pt: "Avisar o usuário ou pedir uma aprovação", en: "Notify the user or ask for an approval" },
        plugin: "Telegram AI Gateway",
        tools: ["telegram_send_message", "telegram_ask_approval", "telegram_get_approval", "telegram_resolve_approval"],
      },
    ],
  },
];

const TEXT = {
  heading: { pt: "AI Ecosystem: guia de uso", en: "AI Ecosystem: usage guide" },
  intro: {
    pt: "Este cofre usa a suíte de plugins AI Ecosystem. Para cada tarefa abaixo, comece pela tool do plugin: ela roda dentro do Obsidian, fica registrada no Live Request Inspector e usa segredos sem que o valor apareça na conversa.",
    en: "This vault uses the AI Ecosystem plugin suite. For each task below, start with the plugin's tool: it runs inside Obsidian, is recorded in the Live Request Inspector and uses secrets without the value showing up in the conversation.",
  },
  task: { pt: "Tarefa", en: "Task" },
  plugin: { pt: "Plugin", en: "Plugin" },
  tools: { pt: "Tools", en: "Tools" },
  fallback: {
    pt: "**Se uma tool falhar:** leia a mensagem de erro, corrija os parâmetros e tente de novo pelo plugin. O terminal serve só quando o plugin está fora do ar (Obsidian fechado ou servidor parado).",
    en: "**If a tool fails:** read the error message, fix the parameters and try again through the plugin. The terminal is for when the plugin is down only (Obsidian closed or the server stopped).",
  },
  missing: {
    pt: "**Se as tools de um módulo não aparecem:** avise o usuário. O módulo pode ainda não estar configurado, ou a sessão precisa ser reiniciada. Não use o terminal para contornar.",
    en: "**If a module's tools do not show up:** tell the user. The module may not be configured yet, or the session needs a restart. Do not use the terminal to work around it.",
  },
  adviceHeading: { pt: "Como usar sem hooks", en: "Using it without hooks" },
  adviceIntro: {
    pt: "Este cliente não tem hooks que redirecionam o caminho errado, então siga estas orientações por conta própria:",
    en: "This client has no hooks that redirect the wrong path, so follow this guidance on your own:",
  },
  generated: {
    pt: "Bloco gerado pelo AI Ecosystem. Edite o que está fora dos marcadores.",
    en: "Block generated by AI Ecosystem. Edit what is outside the markers.",
  },
} satisfies Record<string, Localized>;

/** Ids of the modules the guide has a section for. */
export function knownGuideModules(): string[] {
  return GUIDES.map((g) => g.id);
}

/**
 * The block, markers included, for the given modules (the core is always part of it). Unknown
 * module ids are left out. The result does not end with a newline.
 */
export function buildGuideBlock(options: { lang: Lang; modules: string[]; target: GuideTarget }): string {
  const { lang, target } = options;
  const wanted = new Set([ECOSYSTEM_ID, ...options.modules]);
  const guides = GUIDES.filter((g) => wanted.has(g.id));

  const lines: string[] = [BLOCK_START, `<!-- ${TEXT.generated[lang]} -->`, `## ${TEXT.heading[lang]}`, "", TEXT.intro[lang], ""];
  lines.push(`| ${TEXT.task[lang]} | ${TEXT.plugin[lang]} | ${TEXT.tools[lang]} |`, "| --- | --- | --- |");
  for (const guide of guides) {
    for (const row of guide.rows) lines.push(`| ${row.task[lang]} | ${row.plugin} | ${row.tools.map((tool) => `\`${tool}\``).join(", ")} |`);
  }
  lines.push("", TEXT.fallback[lang], "", TEXT.missing[lang]);

  if (target === "gemini") {
    const advice = guides.filter((g) => g.advice);
    if (advice.length > 0) {
      lines.push("", `### ${TEXT.adviceHeading[lang]}`, "", TEXT.adviceIntro[lang], "");
      for (const guide of advice) lines.push(`- ${guide.advice?.[lang] ?? ""}`);
    }
  }
  lines.push(BLOCK_END);
  return lines.join("\n");
}

function eolOf(text: string): string {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

/** Where the block is in a file: from the start marker to the end of the end marker. */
export function findBlock(text: string): { start: number; end: number } | undefined {
  const start = text.indexOf(BLOCK_START);
  if (start < 0) return undefined;
  const endMarker = text.indexOf(BLOCK_END, start + BLOCK_START.length);
  if (endMarker < 0) return undefined;
  return { start, end: endMarker + BLOCK_END.length };
}

export function hasBlock(text: string): boolean {
  return findBlock(text) !== undefined;
}

/**
 * Puts the block in the file text: replaces the one between the markers, or adds it at the end.
 * Everything outside the block is returned unchanged (an added block follows a blank line).
 */
export function upsertBlock(text: string, block: string): string {
  const eol = eolOf(text);
  const body = eol === "\n" ? block : block.replace(/\n/g, eol);
  const found = findBlock(text);
  if (found) return text.slice(0, found.start) + body + text.slice(found.end);
  if (text === "") return body + eol;
  const separator = text.endsWith("\n") ? eol : eol + eol;
  return text + separator + body + eol;
}
