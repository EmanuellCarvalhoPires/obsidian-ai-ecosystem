---
name: configurar-ai-ecosystem
description: "Sets up the AI Ecosystem core in this vault (agents in use, settings file for the hooks, hook mode and the guide block in CLAUDE.md). Use when a session-start notice asks for it or when the user asks to configure AI Ecosystem. It is the first round of any module install."
---

# Set up AI Ecosystem (core)

This is the first round of any install: the modules only finish their setup after it. AI Ecosystem is the server that gives agents the tools of the Obsidian plugins, and the Claude Code hooks keep the agent on them. Here the user chooses how that behaves in this vault.

{{COMMON}}

## Core questions

In this order, in one round of up to four questions (the ones in `perguntas` that are still missing):

1. `agentes` (multiple choice): which AI agents the user uses with this vault. Options: Claude Code, Antigravity, Codex, Cursor. Anyone using another picks "Other". The saved value is the list of names in lowercase, with the "Other" ones as typed. If `detectado.nucleo.clientes` already shows registered clients, use them as a hint for the recommendation. Upon saving the answer, AI Ecosystem automatically connects the selected AI clients to this vault's local MCP server.
2. `arquivo_settings` (single choice): where to write the hook entries. The question is whether the vault is synced or in git and whether the entries should travel with it. Look at `detectado.nucleo.git` and `detectado.nucleo.sincronizacao` for what the plugin found and say so in the question.
   - `settings.local.json` (Recommended): this machine only, outside git and sync.
   - `settings.json`: shared. Only when the user wants the hooks in git for a team. The commands carry this vault's path and the plugin rewrites the path on each machine when it runs, so everyone needs AI Ecosystem installed.
3. `modo_hooks` (single choice): how the protection hooks react when the agent tries the wrong path.
   - `bloquear` (Recommended): denies the call and points to the right tool.
   - `avisar`: lets it through and reminds the right tool.
   - `off`: does nothing.
4. `claude_md` (single choice): does the user allow the agent to keep the usage guide block in `CLAUDE.md`? Look at `claude_md.existe` in the status.
   - If the file exists: `permitido` (Recommended) or `recusado`.
   - If it does not exist: `criar` (Recommended), which creates the file with just the block, or `recusado`.
   Say that the plugin never writes to `CLAUDE.md`: the agent edits it, only the part between the markers, with the permission given here.

Also show in the summary what was detected: whether `CLAUDE.md` and `GEMINI.md` exist, the installed modules (`detectado.nucleo.modulos`) and the settings file in use.

## Steps after the summary

1. Save the four answers with `ecosystem_setup_save`. `agentes` takes the list, `modo_hooks` applies to all modules and `arquivo_settings` moves the hook entries to the chosen file.
2. If `claude_md` is `permitido` or `criar`, write the block into `CLAUDE.md` as described in the "Guide block in CLAUDE.md" section.
3. Call `ecosystem_setup_complete` with `modulo: "ai-ecosystem"`.
4. Tell the user that, to install more modules, they just use the plugin catalog: each one brings its own setup, and the `CLAUDE.md` block is rebuilt with all of them.
