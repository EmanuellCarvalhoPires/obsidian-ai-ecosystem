import { describe, expect, it } from "vitest";
import { BLOCK_END, BLOCK_START, buildGuideBlock, findBlock, hasBlock, knownGuideModules, upsertBlock } from "../../src/setup/guide-block";

const EMOJI = /\p{Extended_Pictographic}/u;

describe("buildGuideBlock", () => {
  it("is a block between the two markers with a task, plugin and tools table", () => {
    const block = buildGuideBlock({ lang: "en", modules: ["ai-vault-search", "ai-scripts"], target: "claude" });
    const lines = block.split("\n");
    expect(lines[0]).toBe(BLOCK_START);
    expect(lines[lines.length - 1]).toBe(BLOCK_END);
    expect(block).toContain("| Task | Plugin | Tools |");
    expect(block).toContain("| Search, list or read something inside the vault | AI Vault Search | `search`, `find`, `get_section`, `get_note`, `read_table`, `list_folders`, `list_files`, `list_tags`, `recent_notes` |");
    expect(block).not.toContain("search_notes");
    expect(block).toContain("`list_ai_scripts`");
    // The core is always there; modules that are not installed are not.
    expect(block).toContain("`ecosystem_status`");
    expect(block).not.toContain("create_note_from_template");
    expect(block).not.toContain("telegram_send_message");
  });

  it("explains the fallback and what to do when the tools of a module do not show up", () => {
    const en = buildGuideBlock({ lang: "en", modules: [], target: "claude" });
    expect(en).toContain("**If a tool fails:**");
    expect(en).toContain("The terminal is for when the plugin is down only");
    expect(en).toContain("**If a module's tools do not show up:** tell the user.");
    expect(en).toContain("Do not use the terminal to work around it.");
    const pt = buildGuideBlock({ lang: "pt", modules: [], target: "claude" });
    expect(pt).toContain("**Se uma tool falhar:**");
    expect(pt).toContain("**Se as tools de um módulo não aparecem:** avise o usuário.");
    expect(pt).toContain("Não use o terminal para contornar.");
  });

  it("lists every module of the suite, in the language asked", () => {
    const all = knownGuideModules();
    expect(all).toEqual(["ai-ecosystem", "ai-vault-search", "ai-scripts", "ai-templates", "ai-log-manager", "ai-git-tools", "environment-variables", "telegram-ai-gateway"]);
    const block = buildGuideBlock({ lang: "pt", modules: all, target: "claude" });
    for (const tool of ["search", "run_ai_script", "create_note_from_template", "http_request", "env_criar_secret", "telegram_ask_approval", "tela_gerenciar"]) {
      expect(block).toContain(`\`${tool}\``);
    }
    expect(block).toContain("| Tarefa | Plugin | Tools |");
    expect(block).toContain("Executar um script registrado");
  });

  it("ignores unknown modules and has no emoji", () => {
    const block = buildGuideBlock({ lang: "pt", modules: ["something-else", "ai-templates"], target: "gemini" });
    expect(block).not.toContain("something-else");
    expect(EMOJI.test(block)).toBe(false);
  });

  it("only the GEMINI.md block carries the advice that stands in for the hooks, and only for installed modules", () => {
    const modules = ["ai-vault-search", "environment-variables", "ai-scripts", "ai-templates"];
    const gemini = buildGuideBlock({ lang: "en", modules, target: "gemini" });
    expect(gemini).toContain("### Using it without hooks");
    expect(gemini).toContain("`search`");
    expect(gemini).toContain("instead of Grep, Glob or terminal searches");
    expect(gemini).toContain("`search_vault_tools` and `run_vault_tool`");
    expect(gemini).toContain("instead of `curl`, `wget` or `Invoke-RestMethod`");
    expect(gemini).toContain("`ecosystem_run_script`");
    expect(gemini).toContain("`create_note_from_template`");

    expect(buildGuideBlock({ lang: "en", modules, target: "claude" })).not.toContain("Using it without hooks");
    const partial = buildGuideBlock({ lang: "en", modules: ["ai-templates"], target: "gemini" });
    expect(partial).toContain("`create_note_from_template`, not by writing the file directly");
    expect(partial).not.toContain("instead of Grep");
    // Telegram has no hook and no advice: the section is left out when nothing applies.
    expect(buildGuideBlock({ lang: "en", modules: ["telegram-ai-gateway"], target: "gemini" })).not.toContain("Using it without hooks");
  });

  it("is deterministic", () => {
    const a = buildGuideBlock({ lang: "en", modules: ["ai-scripts"], target: "gemini" });
    expect(buildGuideBlock({ lang: "en", modules: ["ai-scripts"], target: "gemini" })).toBe(a);
  });
});

describe("upsertBlock", () => {
  const block = `${BLOCK_START}\nnew\n${BLOCK_END}`;

  it("creates the content of a missing file", () => {
    expect(upsertBlock("", block)).toBe(`${block}\n`);
  });

  it("adds the block at the end and leaves the file as it was", () => {
    const text = "# Mine\n\nMy rule.\n";
    const next = upsertBlock(text, block);
    expect(next.startsWith(text)).toBe(true);
    expect(next).toBe(`${text}\n${block}\n`);
    expect(upsertBlock("no newline at the end", block)).toBe(`no newline at the end\n\n${block}\n`);
  });

  it("replaces only what is between the markers", () => {
    const before = "# Mine\n\nline 1\n\n";
    const after = "\n\n## Later\n\nmore text   \n";
    const text = `${before}${BLOCK_START}\nold stuff\nmore old\n${BLOCK_END}${after}`;
    const next = upsertBlock(text, block);
    expect(next).toBe(`${before}${block}${after}`);
    expect(upsertBlock(next, block)).toBe(next);
  });

  it("keeps CRLF files in CRLF", () => {
    const text = "# Mine\r\n\r\nline\r\n";
    const next = upsertBlock(text, block);
    expect(next).toBe(`${text}\r\n${block.replace(/\n/g, "\r\n")}\r\n`);
    expect(next.replace(/\r\n/g, "")).not.toContain("\n");
    const replaced = upsertBlock(next, `${BLOCK_START}\nother\n${BLOCK_END}`);
    expect(replaced).toBe(`${text}\r\n${BLOCK_START}\r\nother\r\n${BLOCK_END}\r\n`);
  });

  it("finds a block, and treats a lone start marker as no block", () => {
    expect(hasBlock(`x ${BLOCK_START} y ${BLOCK_END}`)).toBe(true);
    expect(findBlock(`ab${BLOCK_START}${BLOCK_END}cd`)).toEqual({ start: 2, end: 2 + BLOCK_START.length + BLOCK_END.length });
    expect(hasBlock(`${BLOCK_START} without an end`)).toBe(false);
    expect(hasBlock(`${BLOCK_END} before ${BLOCK_START}`)).toBe(false);
    // With no complete block the new one is added, and the lone marker stays where it was.
    const lone = `# t\n${BLOCK_START}\n`;
    expect(upsertBlock(lone, block).startsWith(lone)).toBe(true);
  });
});
