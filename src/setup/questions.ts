// The questions of each module's setup, in the order the skills ask them. ecosystem_setup_status
// returns them with flags, so the agent asks only what the plugin did not detect and the user has
// not answered yet. Pure Node (no "obsidian" import).
import type { Lang } from "../i18n";
import { ECOSYSTEM_ID } from "../types";
import type { CoreDetection } from "./detect";

interface Localized {
  pt: string;
  en: string;
}

export type QuestionKind = "unica" | "multipla" | "sim_nao" | "texto" | "lista";

export interface QuestionOption {
  valor: string;
  rotulo: Localized;
  recomendada?: boolean;
}

interface Question {
  chave: string;
  pergunta: Localized;
  tipo: QuestionKind;
  opcoes?: QuestionOption[];
  /** False for questions that only steer the interview (the answer is not given to the module). */
  salvar: boolean;
  /** Found by the plugin: the agent shows it for confirmation instead of asking. */
  detectado?: unknown;
  /** A hint for the options (not a detection). */
  sugestao?: unknown;
}

/** Everything a question may look at. */
export interface QuestionContext {
  core: CoreDetection;
  /** What the module's setup handler detected. */
  module: Record<string, unknown>;
  /** Folders the core Script Engine already allows. */
  allowedScriptFolders: string[];
}

export interface QuestionView {
  chave: string;
  pergunta: string;
  tipo: QuestionKind;
  opcoes?: Array<{ valor: string; rotulo: string; recomendada?: boolean }>;
  salvar: boolean;
  ja_respondida: boolean;
  detectada: boolean;
  valor_detectado?: unknown;
  sugestao?: unknown;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter(isNonEmptyString) : [];
}

function yesNo(): QuestionOption[] {
  return [
    { valor: "sim", rotulo: { pt: "Sim", en: "Yes" } },
    { valor: "nao", rotulo: { pt: "Não", en: "No" } },
  ];
}

function agentHints(clients: string[]): string[] {
  const out = new Set<string>();
  for (const name of clients) {
    if (/claude/i.test(name)) out.add("claude-code");
    if (/antigravity|gemini/i.test(name)) out.add("antigravity");
    if (/codex/i.test(name)) out.add("codex");
  }
  return [...out];
}

function serviceHints(hosts: string[]): string[] {
  const out = new Set<string>();
  for (const host of hosts) {
    if (/atlassian/i.test(host)) {
      out.add("jira");
      out.add("confluence");
    }
    if (/bitbucket/i.test(host)) out.add("bitbucket");
    if (/github/i.test(host)) out.add("github");
  }
  return [...out];
}

/** Folder names out of a list of strings or of { folder | pasta | path | name } rows. */
function folderNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const names: string[] = [];
  for (const item of value) {
    if (isNonEmptyString(item)) {
      names.push(item);
    } else if (typeof item === "object" && item !== null) {
      const row = item as Record<string, unknown>;
      const name = row.folder ?? row.pasta ?? row.path ?? row.name;
      if (isNonEmptyString(name)) names.push(name);
    }
  }
  return names.slice(0, 10);
}

function coreQuestions(ctx: QuestionContext): Question[] {
  const claudeMdOptions: QuestionOption[] = ctx.core.claude_md
    ? [
        { valor: "permitido", rotulo: { pt: "Permitir atualizar o bloco", en: "Allow updating the block" }, recomendada: true },
        { valor: "recusado", rotulo: { pt: "Não mexer no CLAUDE.md", en: "Leave CLAUDE.md alone" } },
      ]
    : [
        { valor: "criar", rotulo: { pt: "Criar um CLAUDE.md com o bloco", en: "Create a CLAUDE.md with the block" }, recomendada: true },
        { valor: "recusado", rotulo: { pt: "Não criar", en: "Do not create" } },
      ];
  return [
    {
      chave: "agentes",
      pergunta: { pt: "Quais agentes de IA você usa com este cofre?", en: "Which AI agents do you use with this vault?" },
      tipo: "multipla",
      opcoes: [
        { valor: "claude-code", rotulo: { pt: "Claude Code", en: "Claude Code" } },
        { valor: "antigravity", rotulo: { pt: "Antigravity", en: "Antigravity" } },
        { valor: "codex", rotulo: { pt: "Codex", en: "Codex" } },
      ],
      salvar: true,
      sugestao: agentHints(ctx.core.clientes),
    },
    {
      chave: "arquivo_settings",
      pergunta: {
        pt: "O cofre é sincronizado ou está em git, e os hooks devem ir junto? Isso decide onde gravar as entradas dos hooks.",
        en: "Is the vault synced or in git, and should the hooks travel with it? This decides where the hook entries are written.",
      },
      tipo: "unica",
      opcoes: [
        { valor: "settings.local.json", rotulo: { pt: "settings.local.json (pessoal)", en: "settings.local.json (personal)" }, recomendada: true },
        { valor: "settings.json", rotulo: { pt: "settings.json (compartilhado)", en: "settings.json (shared)" } },
      ],
      salvar: true,
    },
    {
      chave: "modo_hooks",
      pergunta: { pt: "Como os hooks de proteção devem reagir ao caminho errado?", en: "How should the protection hooks react to the wrong path?" },
      tipo: "unica",
      opcoes: [
        { valor: "bloquear", rotulo: { pt: "Bloquear", en: "Block" }, recomendada: true },
        { valor: "avisar", rotulo: { pt: "Avisar", en: "Warn" } },
        { valor: "off", rotulo: { pt: "Desligado", en: "Off" } },
      ],
      salvar: true,
    },
    {
      chave: "claude_md",
      pergunta: {
        pt: ctx.core.claude_md
          ? "O agente pode atualizar o bloco de guia de uso no CLAUDE.md deste cofre? Só o trecho entre os marcadores muda."
          : "Este cofre não tem CLAUDE.md. Quer que o agente crie um com o bloco de guia de uso?",
        en: ctx.core.claude_md
          ? "May the agent update the usage guide block in this vault's CLAUDE.md? Only the part between the markers changes."
          : "This vault has no CLAUDE.md. Do you want the agent to create one with the usage guide block?",
      },
      tipo: "unica",
      opcoes: claudeMdOptions,
      salvar: true,
    },
  ];
}

function environmentQuestions(ctx: QuestionContext): Question[] {
  const folder = ctx.module.toolNotesFolder;
  return [
    {
      chave: "servicos",
      pergunta: { pt: "Quais serviços o agente vai chamar com secrets?", en: "Which services will the agent call with secrets?" },
      tipo: "multipla",
      opcoes: [
        { valor: "jira", rotulo: { pt: "Jira", en: "Jira" } },
        { valor: "bitbucket", rotulo: { pt: "Bitbucket", en: "Bitbucket" } },
        { valor: "confluence", rotulo: { pt: "Confluence", en: "Confluence" } },
        { valor: "github", rotulo: { pt: "GitHub", en: "GitHub" } },
      ],
      salvar: true,
      sugestao: serviceHints(stringList(ctx.module.knownHosts)),
    },
    {
      chave: "pasta_notas_tools",
      pergunta: { pt: "Qual pasta do cofre guarda as notas de tools e requests?", en: "Which vault folder holds the tool and request notes?" },
      tipo: "texto",
      salvar: true,
      detectado: isNonEmptyString(folder) ? folder : undefined,
    },
  ];
}

function telegramQuestions(ctx: QuestionContext): Question[] {
  const tokenReady = ctx.module.tokenState === "env-keys";
  return [
    {
      chave: "sabe_obter_token",
      pergunta: { pt: "Você sabe obter o token do bot e o chat ID?", en: "Do you know how to get the bot token and the chat ID?" },
      tipo: "sim_nao",
      opcoes: yesNo(),
      salvar: false,
      detectado: tokenReady ? true : undefined,
    },
    {
      chave: "token_secret",
      pergunta: { pt: "Qual secret guarda o token do bot? (só o nome)", en: "Which secret holds the bot token? (the name only)" },
      tipo: "texto",
      salvar: true,
      detectado: tokenReady ? true : undefined,
      sugestao: "TELEGRAM_BOT_TOKEN",
    },
    {
      chave: "eventos",
      pergunta: { pt: "Quais eventos devem notificar no Telegram?", en: "Which events should notify on Telegram?" },
      tipo: "multipla",
      opcoes: [
        { valor: "conclusao_desenvolvimento", rotulo: { pt: "Conclusão de desenvolvimento", en: "Development finished" }, recomendada: true },
        { valor: "pedidos_aprovacao", rotulo: { pt: "Pedidos de aprovação", en: "Approval requests" }, recomendada: true },
        { valor: "avisos", rotulo: { pt: "Avisos", en: "Notices" }, recomendada: true },
      ],
      salvar: true,
      sugestao: stringList(ctx.module.eventos),
    },
  ];
}

function vaultSearchQuestions(ctx: QuestionContext): Question[] {
  const excluded = stringList(ctx.module.excludedFolders);
  return [
    {
      chave: "pastas_fora_do_indice",
      pergunta: {
        pt: "Quais pastas ficam fora do índice de busca? (anexos, arquivo morto, notas de tools)",
        en: "Which folders stay out of the search index? (attachments, archive, tool notes)",
      },
      tipo: "lista",
      salvar: true,
      detectado: excluded.length > 0 ? excluded : undefined,
      sugestao: folderNames(ctx.module.largestFolders),
    },
  ];
}

function scriptsQuestions(ctx: QuestionContext): Question[] {
  const moduleLanguages = stringList(ctx.module.languages);
  const folderLanguages = ctx.core.scripts_no_cofre.flatMap((f) => f.linguagens);
  const languages = [...new Set([...moduleLanguages, ...folderLanguages])];
  const scriptCount = typeof ctx.module.scriptCount === "number" ? ctx.module.scriptCount : 0;
  const scriptsFolder = ctx.module.scriptsFolder;
  return [
    {
      chave: "linguagens",
      pergunta: { pt: "Quais linguagens de script você usa?", en: "Which script languages do you use?" },
      tipo: "multipla",
      opcoes: [
        { valor: "python", rotulo: { pt: "Python", en: "Python" } },
        { valor: "node", rotulo: { pt: "Node.js", en: "Node.js" } },
        { valor: "bash", rotulo: { pt: "Bash", en: "Bash" } },
        { valor: "powershell", rotulo: { pt: "PowerShell", en: "PowerShell" } },
      ],
      salvar: false,
      detectado: languages.length > 0 ? languages : undefined,
    },
    {
      chave: "pastas_permitidas",
      pergunta: { pt: "De quais pastas do cofre os scripts podem rodar?", en: "Which vault folders may scripts run from?" },
      tipo: "lista",
      salvar: true,
      detectado: ctx.allowedScriptFolders.length > 0 ? ctx.allowedScriptFolders : undefined,
      sugestao: ctx.core.scripts_no_cofre.map((f) => f.pasta).filter((p) => p !== "."),
    },
    {
      chave: "pasta_de_scripts",
      pergunta: { pt: "Qual pasta guarda os scripts cadastrados no AI Scripts?", en: "Which folder holds the scripts registered in AI Scripts?" },
      tipo: "texto",
      salvar: true,
      detectado: isNonEmptyString(scriptsFolder) && scriptCount > 0 ? scriptsFolder : undefined,
      sugestao: isNonEmptyString(scriptsFolder) ? scriptsFolder : undefined,
    },
    {
      chave: "pode_gravar_fora_do_cofre",
      pergunta: { pt: "Os scripts podem gravar arquivos fora do cofre?", en: "May scripts write files outside the vault?" },
      tipo: "sim_nao",
      opcoes: [
        { valor: "false", rotulo: { pt: "Não", en: "No" }, recomendada: true },
        { valor: "true", rotulo: { pt: "Sim", en: "Yes" } },
      ],
      salvar: true,
    },
    {
      chave: "migrar_scripts",
      pergunta: { pt: "Existem scripts no cofre para migrar para o AI Scripts?", en: "Are there scripts in the vault to migrate to AI Scripts?" },
      tipo: "sim_nao",
      opcoes: yesNo(),
      salvar: false,
    },
  ];
}

function templatesQuestions(ctx: QuestionContext): Question[] {
  const folder = ctx.module.templatesFolder;
  const count = typeof ctx.module.templateCount === "number" ? ctx.module.templateCount : 0;
  return [
    {
      chave: "pasta_de_templates",
      pergunta: { pt: "Qual pasta do cofre guarda os moldes?", en: "Which vault folder holds the templates?" },
      tipo: "texto",
      salvar: true,
      detectado: isNonEmptyString(folder) && count > 0 ? folder : undefined,
      sugestao: isNonEmptyString(folder) ? folder : undefined,
    },
    {
      chave: "regra_de_colisao",
      pergunta: { pt: "O que fazer quando já existe uma nota com o nome gerado?", en: "What to do when a note with the generated name already exists?" },
      tipo: "unica",
      opcoes: [
        { valor: "incremental", rotulo: { pt: "Numerar (Nome 1, Nome 2)", en: "Number it (Name 1, Name 2)" }, recomendada: true },
        { valor: "error", rotulo: { pt: "Recusar e avisar", en: "Refuse and warn" } },
        { valor: "overwrite", rotulo: { pt: "Sobrescrever", en: "Overwrite" } },
      ],
      salvar: true,
    },
    {
      chave: "migrar_templates",
      pergunta: { pt: "Existem moldes no cofre para transformar em templates?", en: "Are there templates in the vault to turn into templates?" },
      tipo: "sim_nao",
      opcoes: yesNo(),
      salvar: false,
    },
  ];
}

function logManagerQuestions(ctx: QuestionContext): Question[] {
  const existingLogs = typeof ctx.module.existingLogs === "number" ? ctx.module.existingLogs : 0;
  const clones = stringList(ctx.module.projectsWithClone);
  const hooksInstalled = ctx.module.hooksInstalled === true;
  const root = ctx.module.projectsRoot;
  return [
    {
      chave: "modo_dos_logs",
      pergunta: { pt: "Como o AI Log Manager deve tratar os logs?", en: "How should the AI Log Manager handle the logs?" },
      tipo: "unica",
      opcoes: [
        { valor: "observe", rotulo: { pt: "Só observar (compara, não grava)", en: "Observe only (compares, writes nothing)" }, recomendada: existingLogs > 0 },
        { valor: "active", rotulo: { pt: "Ativo (cria e atualiza os logs)", en: "Active (creates and updates the logs)" }, recomendada: existingLogs === 0 },
      ],
      salvar: true,
      sugestao: existingLogs > 0 ? "observe" : "active",
    },
    {
      chave: "pastas_acompanhadas",
      pergunta: {
        pt: "Quais pastas fora do cofre também devem ganhar log das conversas? (o cofre e os clones dos projetos já entram)",
        en: "Which folders outside the vault should also get conversation logs? (the vault and project clones are already included)",
      },
      tipo: "lista",
      salvar: true,
    },
    {
      chave: "registrar_eventos_dev",
      pergunta: {
        pt: "Registrar commits, pushes e branches dos projetos com clone como notas?",
        en: "Record commits, pushes and branches of projects with a clone as notes?",
      },
      tipo: "sim_nao",
      opcoes: [
        { valor: "true", rotulo: { pt: "Sim", en: "Yes" }, recomendada: clones.length > 0 },
        { valor: "false", rotulo: { pt: "Não", en: "No" }, recomendada: clones.length === 0 },
      ],
      salvar: true,
      sugestao: clones.length > 0 ? clones : undefined,
    },
    {
      chave: "ler_remoto",
      pergunta: {
        pt: "Ler PRs e deploys do GitHub ou Bitbucket pelo Environment Keys?",
        en: "Read PRs and deploys from GitHub or Bitbucket through Environment Keys?",
      },
      tipo: "sim_nao",
      opcoes: [
        { valor: "false", rotulo: { pt: "Não", en: "No" }, recomendada: true },
        { valor: "true", rotulo: { pt: "Sim (precisa de uma secret com o token)", en: "Yes (needs a secret with the token)" } },
      ],
      salvar: true,
    },
    {
      chave: "instalar_hooks",
      pergunta: {
        pt: "Instalar os hooks do Claude Code? (altera o settings.json global, com cópia de segurança)",
        en: "Install the Claude Code hooks? (changes the global settings.json, with a backup)",
      },
      tipo: "sim_nao",
      opcoes: [
        { valor: "true", rotulo: { pt: "Sim", en: "Yes" }, recomendada: true },
        { valor: "false", rotulo: { pt: "Não", en: "No" } },
      ],
      salvar: true,
      detectado: hooksInstalled ? true : undefined,
    },
    {
      chave: "pasta_dos_projetos",
      pergunta: { pt: "Qual pasta do cofre guarda os projetos de desenvolvimento?", en: "Which vault folder holds the development projects?" },
      tipo: "texto",
      salvar: true,
      detectado: ctx.module.projectsRootExists === true && isNonEmptyString(root) ? root : undefined,
      sugestao: isNonEmptyString(root) ? root : undefined,
    },
  ];
}

/** The value the AI Git Tools secret questions use for "no secret": the module stores an empty string. */
export const NO_SECRET = "nenhuma";

interface SecretRow {
  name: string;
  type?: string;
  allowedHosts: string[];
  allowAnyHost: boolean;
}

/**
 * The secrets the module detected (names and metadata only, never values). Accepts plain names
 * or rows shaped like the Environment Keys `listSecretMetadata` result.
 */
function secretRows(value: unknown): SecretRow[] {
  if (!Array.isArray(value)) return [];
  const rows: SecretRow[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    let row: SecretRow | undefined;
    if (isNonEmptyString(item)) {
      row = { name: item.trim(), allowedHosts: [], allowAnyHost: false };
    } else if (typeof item === "object" && item !== null) {
      const raw = item as Record<string, unknown>;
      if (isNonEmptyString(raw.name)) {
        row = {
          name: raw.name.trim(),
          type: isNonEmptyString(raw.type) ? raw.type : undefined,
          allowedHosts: stringList(raw.allowedHosts).map((h) => h.trim().toLowerCase()),
          allowAnyHost: raw.allowAnyHost === true,
        };
      }
    }
    if (row && row.name !== NO_SECRET && !seen.has(row.name)) {
      seen.add(row.name);
      rows.push(row);
    }
  }
  return rows;
}

/** Host part of an allowed-host entry ("https://api.github.com/x", "*.github.com" or "api.github.com:443"). */
function hostOf(entry: string): string {
  return entry.replace(/^[a-z]+:\/\//, "").replace(/^\*\./, "").split(/[/:]/)[0] ?? "";
}

/**
 * The secrets that may serve a provider. When no secret carries host data (plain names), all of
 * them are listed; otherwise the ones allowed for the provider's hosts, plus the ones open to any host.
 */
function secretsFor(rows: SecretRow[], hosts: string[]): SecretRow[] {
  const withHostData = rows.some((r) => r.allowAnyHost || r.allowedHosts.length > 0);
  if (!withHostData) return rows;
  return rows.filter((r) => r.allowAnyHost || r.allowedHosts.some((entry) => hosts.includes(hostOf(entry))));
}

function secretOptions(rows: SecretRow[]): QuestionOption[] {
  // No option is ever recommended and no name is suggested (decision D6): the user picks.
  const options: QuestionOption[] = rows.map((r) => ({
    valor: r.name,
    rotulo: r.type ? { pt: `${r.name} (${r.type})`, en: `${r.name} (${r.type})` } : { pt: r.name, en: r.name },
  }));
  options.push({ valor: NO_SECRET, rotulo: { pt: "Nenhuma (configurar depois)", en: "None (set it up later)" } });
  return options;
}

function gitToolsQuestions(ctx: QuestionContext): Question[] {
  const rows = secretRows(ctx.module.secrets);
  const root = ctx.module.projectsRoot;
  return [
    {
      chave: "modo_hooks",
      pergunta: {
        pt: "Como o hook do AI Git Tools deve reagir a git, gh ou chamadas às APIs do GitHub e do Bitbucket pelo terminal?",
        en: "How should the AI Git Tools hook react to git, gh or calls to the GitHub and Bitbucket APIs from the terminal?",
      },
      tipo: "unica",
      opcoes: [
        { valor: "avisar", rotulo: { pt: "Avisar", en: "Warn" }, recomendada: true },
        { valor: "bloquear", rotulo: { pt: "Bloquear", en: "Block" } },
        { valor: "off", rotulo: { pt: "Desligado", en: "Off" } },
      ],
      salvar: true,
    },
    {
      chave: "secret_bitbucket",
      pergunta: {
        pt: "Qual secret o AI Git Tools usa para as APIs do Bitbucket (PR e pipeline)?",
        en: "Which secret does AI Git Tools use for the Bitbucket APIs (PR and pipeline)?",
      },
      tipo: "unica",
      opcoes: secretOptions(secretsFor(rows, ["api.bitbucket.org", "bitbucket.org"])),
      salvar: true,
    },
    {
      chave: "secret_github",
      pergunta: {
        pt: "Qual secret o AI Git Tools usa para as APIs do GitHub (PR e pipeline)?",
        en: "Which secret does AI Git Tools use for the GitHub APIs (PR and pipeline)?",
      },
      tipo: "unica",
      opcoes: secretOptions(secretsFor(rows, ["api.github.com", "github.com"])),
      salvar: true,
    },
    {
      chave: "pasta_dos_projetos",
      pergunta: { pt: "Qual pasta do cofre guarda os projetos de desenvolvimento?", en: "Which vault folder holds the development projects?" },
      tipo: "texto",
      salvar: true,
      detectado: ctx.module.projectsRootExists === true && isNonEmptyString(root) ? root : undefined,
    },
  ];
}

function questionsOf(moduleId: string, ctx: QuestionContext): Question[] {
  switch (moduleId) {
    case ECOSYSTEM_ID:
      return coreQuestions(ctx);
    case "environment-variables":
      return environmentQuestions(ctx);
    case "telegram-ai-gateway":
      return telegramQuestions(ctx);
    case "ai-vault-search":
      return vaultSearchQuestions(ctx);
    case "ai-scripts":
      return scriptsQuestions(ctx);
    case "ai-templates":
      return templatesQuestions(ctx);
    case "ai-log-manager":
      return logManagerQuestions(ctx);
    case "ai-git-tools":
      return gitToolsQuestions(ctx);
    default:
      return [];
  }
}

const NO_DETECTION: QuestionContext = {
  core: { claude_md: false, scripts_no_cofre: [], clientes: [] } as unknown as CoreDetection,
  module: {},
  allowedScriptFolders: [],
};

/** Keys of the questions that only steer the interview (their answers never reach the module). */
export function steeringKeys(moduleId: string): string[] {
  return questionsOf(moduleId, NO_DETECTION)
    .filter((q) => !q.salvar)
    .map((q) => q.chave);
}

/** The questions of a module for the agent, with the flags that say what is still missing. */
export function buildQuestions(moduleId: string, ctx: QuestionContext, answers: Record<string, unknown>, lang: Lang): QuestionView[] {
  return questionsOf(moduleId, ctx).map((q) => {
    const view: QuestionView = {
      chave: q.chave,
      pergunta: q.pergunta[lang],
      tipo: q.tipo,
      salvar: q.salvar,
      ja_respondida: q.chave in answers,
      detectada: q.detectado !== undefined,
    };
    if (q.opcoes) {
      view.opcoes = q.opcoes.map((o) => ({ valor: o.valor, rotulo: o.rotulo[lang], ...(o.recomendada ? { recomendada: true } : {}) }));
    }
    if (q.detectado !== undefined) view.valor_detectado = q.detectado;
    if (q.sugestao !== undefined && (!Array.isArray(q.sugestao) || q.sugestao.length > 0)) view.sugestao = q.sugestao;
    return view;
  });
}
