// The setup skills: valid frontmatter on line 1, the interview rules, and that no skill ever asks
// for a token, password or secret in the chat.
import { describe, expect, it } from "vitest";
import { buildSkill, skillName, skillPath } from "../../src/setup/skill-texts";

const EMOJI = /\p{Extended_Pictographic}/u;
const MODULES = ["ai-ecosystem", "environment-variables", "telegram-ai-gateway", "ai-vault-search", "ai-scripts", "ai-templates"];
const LANGS = ["pt", "en"] as const;

/** Reads the frontmatter the way Claude Code needs it: first line "---", key: value pairs, closing "---". */
function frontmatter(text: string): { fields: Record<string, string>; body: string } {
  const lines = text.split("\n");
  expect(lines[0]).toBe("---");
  const end = lines.indexOf("---", 1);
  expect(end).toBeGreaterThan(1);
  const fields: Record<string, string> = {};
  for (const line of lines.slice(1, end)) {
    const match = /^([a-z-]+): (.*)$/.exec(line);
    expect(match, line).not.toBeNull();
    fields[match![1]!] = match![2]!;
  }
  return { fields, body: lines.slice(end + 1).join("\n") };
}

function ids(): Array<[string, (typeof LANGS)[number]]> {
  return MODULES.flatMap((id) => LANGS.map((lang) => [id, lang] as [string, (typeof LANGS)[number]]));
}

describe("setup skills", () => {
  it.each(ids())("%s (%s) has valid frontmatter on line 1, with name and a quoted description", (id, lang) => {
    const text = buildSkill(id, id, lang);
    expect(text.startsWith(`---\nname: configurar-${id}\n`)).toBe(true);
    const { fields } = frontmatter(text);
    expect(Object.keys(fields)).toEqual(["name", "description"]);
    expect(fields.name).toBe(`configurar-${id}`);
    expect(fields.description).toMatch(/^".{40,}"$/);
    // A quoted YAML string with no inner quote.
    expect(fields.description!.slice(1, -1)).not.toContain('"');
    expect(text.endsWith("\n")).toBe(true);
  });

  it.each(ids())("%s (%s) says what it does and when to use it", (id, lang) => {
    const description = frontmatter(buildSkill(id, id, lang)).fields.description!;
    if (lang === "pt") {
      expect(description).toContain("Use quando um aviso de início de sessão pedir ou quando o usuário pedir para configurar");
    } else {
      expect(description).toContain("Use when a session-start notice asks for it or when the user asks to configure");
    }
  });

  it.each(ids())("%s (%s) has no leftover placeholder and no emoji", (id, lang) => {
    const text = buildSkill(id, "Some Name", lang);
    expect(text).not.toMatch(/\{\{(ID|NAME|COMMON)\}\}/);
    expect(EMOJI.test(text)).toBe(false);
  });

  it.each(ids())("%s (%s) follows the interview rules", (id, lang) => {
    const text = buildSkill(id, id, lang);
    for (const tool of ["ecosystem_setup_status", "ecosystem_setup_save", "ecosystem_setup_complete", "AskUserQuestion", "grill-me", "env_criar_secret"]) {
      expect(text, tool).toContain(tool);
    }
    // The calls name the module.
    expect(text).toContain(`modulo: "${id}"`);
    // Limits of the clickable question tool, recommended first, "Other", never in subagents.
    expect(text).toContain(lang === "pt" ? "de 1 a 4 perguntas por chamada, de 2 a 4 opções por pergunta" : "1 to 4 questions per call, 2 to 4 options per question");
    expect(text).toContain(lang === "pt" ? "(Recomendado)" : "(Recommended)");
    expect(text).toContain('"Other"');
    expect(text).toContain(lang === "pt" ? "não existe em subagentes" : "does not exist in subagents");
    expect(text).toContain(lang === "pt" ? "**uma rodada por vez**" : "**one round at a time**");
    expect(text).toContain(lang === "pt" ? "**somente** o que o plugin não detectou" : "**only** what the plugin did not detect");
    // Plan B when the clickable question tool is denied (user authorization hooks) or fails.
    expect(text).toContain(lang === "pt" ? "**Plano B:**" : "**Plan B:**");
    expect(text).toContain(lang === "pt" ? "no próprio chat" : "in the chat itself");
    // Confirmation before saving; restart instead of the terminal when a tool is missing.
    expect(text).toContain(lang === "pt" ? "peça a confirmação" : "ask for confirmation");
    expect(text).toContain(lang === "pt" ? "reiniciar a sessão do Claude Code" : "restart the Claude Code session");
    expect(text).toContain(lang === "pt" ? "Não use o terminal" : "Do not use the terminal");
    // Hooks and tools only apply to new sessions.
    expect(text).toContain(lang === "pt" ? "valem para sessões novas" : "apply to new sessions");
  });

  it.each(ids())("%s (%s) never asks for a secret in the chat", (id, lang) => {
    const text = buildSkill(id, id, lang);
    expect(text).toContain(lang === "pt" ? "**Nunca peça token, senha, chave de API ou qualquer segredo no chat.**" : "**Never ask for a token, password, API key or any secret in the chat.**");
    const asking =
      lang === "pt"
        ? /(cole|informe|digite|envie|passe|me d[eê])[^.\n]{0,40}(token|senha|chave de api|segredo)[^.\n]{0,40}\bno chat\b/i
        : /(paste|send|type|enter|give me|share)[^.\n]{0,40}(token|password|api key|secret)[^.\n]{0,40}\bin the chat\b/i;
    expect(text).not.toMatch(asking);
  });

  it("the CLAUDE.md block rules only touch the part between the markers", () => {
    for (const lang of LANGS) {
      const text = buildSkill("ai-scripts", "AI Scripts", lang);
      expect(text).toContain("<!-- ai-ecosystem:start -->");
      expect(text).toContain("<!-- ai-ecosystem:end -->");
      expect(text).toContain("bloco_claude_md");
      expect(text).toContain(lang === "pt" ? "O resto do arquivo não é tocado" : "The rest of the file is not touched");
      expect(text).toContain(lang === "pt" ? "Se `permissao` for `permitido` ou `criar`" : "If `permissao` is `permitido` or `criar`");
    }
  });

  it("the core skill asks the four core questions, in order, and writes the block", () => {
    const pt = buildSkill("ai-ecosystem", "AI Ecosystem", "pt");
    const order = ["`agentes`", "`arquivo_settings`", "`modo_hooks`", "`claude_md`"].map((k) => pt.indexOf(k, pt.indexOf("## Perguntas do núcleo")));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    for (const word of ["Claude Code, Antigravity, Codex", "settings.local.json", "settings.json", "bloquear", "avisar", "off"]) expect(pt).toContain(word);
    expect(pt).toContain("o plugin nunca grava no `CLAUDE.md`");
  });

  it("the core skill offers to update or recreate an existing CLAUDE.md, confirms the creation, maps the folders and suggests module folders", () => {
    for (const lang of LANGS) {
      const text = buildSkill("ai-ecosystem", "AI Ecosystem", lang);
      const pt = lang === "pt";
      // Existing file: update it or start from scratch.
      expect(text).toContain(pt ? "**Atualizar o existente**" : "**Update the existing one**");
      expect(text).toContain(pt ? "**Criar do zero**" : "**Start from scratch**");
      // Starting from scratch never deletes: the old file is copied to a backup first.
      expect(text).toContain(pt ? "CLAUDE.backup-AAAA-MM-DD.md" : "CLAUDE.backup-YYYY-MM-DD.md");
      expect(text).toContain(pt ? "**não o apague nem o mova**" : "**do not delete or move it**");
      // The creation is confirmed with the draft before anything is written.
      expect(text).toContain(pt ? "**Confirme a criação**" : "**Confirm the creation**");
      expect(text).toContain(pt ? "Criar o CLAUDE.md" : "Create the CLAUDE.md");
      // The folder map goes into the file; the module folders are only suggested.
      expect(text).toContain(pt ? "## Mapa de pastas do cofre" : "## Vault folder map");
      expect(text).toContain(pt ? "## Mapa do cofre" : "## Vault map");
      expect(text).toContain("list_folders");
      expect(text).toContain(pt ? "## Estrutura de pastas para os módulos" : "## Folder structure for the modules");
      expect(text).toContain(pt ? "**sugira a criação**" : "**suggest creating**");
      expect(text).toContain(pt ? "Nada é criado sem a aprovação do usuário." : "Nothing is created without the user's approval.");
      for (const folder of ["Templates/AI/", "Scripts/AI/", "Knowledge/Logs/", "Projetos/"]) expect(text).toContain(folder);
    }
  });

  it("the Environment Keys skill creates the secrets through the screen and never offers full access", () => {
    for (const lang of LANGS) {
      const text = buildSkill("environment-variables", "Environment Keys", lang);
      expect(text).toContain("`servicos`");
      expect(text).toContain("`pasta_notas_tools`");
      expect(text).toContain("`nome_sugerido`");
      expect(text).toContain("`dominios_sugeridos`");
      expect(text).toContain("list_secrets");
      expect(text).toContain(lang === "pt" ? 'Nunca sugira "Acesso total"' : 'Never suggest "Full access"');
      expect(text).toContain(lang === "pt" ? "Secret NOME criada" : "Secret NAME criada");
    }
  });

  it("the Telegram skill needs Environment Keys, teaches the bot setup and takes the token through the screen", () => {
    for (const lang of LANGS) {
      const text = buildSkill("telegram-ai-gateway", "Telegram AI Gateway", lang);
      expect(text).toContain("environment-variables");
      expect(text).toContain(lang === "pt" ? "**pare aqui**" : "**stop here**");
      expect(text).toContain("@BotFather");
      expect(text).toContain("/newbot");
      expect(text).toContain("/start");
      expect(text).toContain("TELEGRAM_BOT_TOKEN");
      expect(text).toContain("api.telegram.org");
      expect(text).toContain("env_criar_secret");
      expect(text).toContain('chave: "token_secret"');
      expect(text).toContain("chatIdConfigured");
      for (const event of ["conclusao_desenvolvimento", "pedidos_aprovacao", "avisos"]) expect(text).toContain(event);
      expect(text).toContain(lang === "pt" ? "o nome, nunca o token" : "the name, never the token");
      // The token screen opens through the tool at the moment the token is asked for, not after the summary.
      expect(text).toContain(lang === "pt" ? "## Criar a secret do token" : "## Create the token secret");
      expect(text).toContain(lang === "pt" ? "o pedido é feito pela ferramenta `env_criar_secret`" : "do it with the `env_criar_secret` tool");
      expect(text).toContain(lang === "pt" ? "Assim que o usuário disser que copiou o token, abra a tela do token na hora" : "As soon as the user says they copied the token, open the token screen right away");
      expect(text).toContain(lang === "pt" ? "não espere um \"pronto\" antes de chamar a ferramenta" : "do not wait for a \"ready\" before calling the tool");
    }
  });

  it("the AI Vault Search skill offers the largest folders as suggestions", () => {
    const text = buildSkill("ai-vault-search", "AI Vault Search", "en");
    expect(text).toContain("`pastas_fora_do_indice`");
    expect(text).toContain("largestFolders");
  });

  it("the AI Scripts skill migrates with consent, scans for secrets and keeps the originals", () => {
    for (const lang of LANGS) {
      const text = buildSkill("ai-scripts", "AI Scripts", lang);
      for (const word of ["`pastas_permitidas`", "`pasta_de_scripts`", "`pode_gravar_fora_do_cofre`", "`migrar_scripts`", "search_notes", "list_files", "{{secret:NOME}}", "env_criar_secret", "list_ai_scripts", "get_script_schema"]) {
        expect(text.replace(/\{\{secret:NAME\}\}/g, "{{secret:NOME}}"), word).toContain(word);
      }
      expect(text).toContain(lang === "pt" ? "**busca completa**" : "**full search**");
      expect(text).toContain(lang === "pt" ? "**nenhum arquivo original é apagado, movido ou alterado.**" : "**no original file is deleted, moved or changed.**");
      expect(text).toContain(lang === "pt" ? "**nunca o valor**" : "**never the value**");
      expect(text).toContain(lang === "pt" ? "**permissão**" : "**permission**");
      // The search goes through the plugin, not through Grep.
      expect(text).toContain(lang === "pt" ? "não com Grep ou Glob" : "not with Grep or Glob");
    }
  });

  it("the AI Templates skill never asks the default folder, the date format or the timezone", () => {
    for (const lang of LANGS) {
      const text = buildSkill("ai-templates", "AI Templates", lang);
      expect(text).toContain(lang === "pt" ? "**Não pergunte nenhum dos três.**" : "**Do not ask any of the three.**");
      for (const key of ["`pasta_de_templates`", "`regra_de_colisao`", "`migrar_templates`", "create_template", "get_template_schema", "preview_template"]) expect(text).toContain(key);
      expect(text).toContain(lang === "pt" ? "**As notas originais não são alteradas, movidas nem apagadas.**" : "**The original notes are not changed, moved or deleted.**");
      expect(text).toContain(lang === "pt" ? "**extraia os campos**" : "**extract the fields**");
      expect(text).toContain(lang === "pt" ? "**aprovação**" : "**approval**");
    }
  });

  it("a module with no text of its own gets the generic skill, with a safe name", () => {
    const text = buildSkill("my-module", 'My "Module"', "en");
    expect(text.startsWith("---\nname: configurar-my-module\n")).toBe(true);
    expect(frontmatter(text).fields.description).toContain("My Module");
    expect(text).toContain('modulo: "my-module"');
    expect(text).toContain("ecosystem_setup_status");
  });

  it("names the skill and its file the same way the plan does", () => {
    expect(skillName("ai-scripts")).toBe("configurar-ai-scripts");
    expect(skillPath("ai-scripts")).toBe(".claude/skills/configurar-ai-scripts/SKILL.md");
  });
});
