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
4. `claude_md` (single choice): what to do with the vault's `CLAUDE.md`. Look at `claude_md.existe` in the status.
   - If the file exists: **Update the existing one** (Recommended), which saves the value `permitido`; **Start from scratch**, which also saves `permitido` and follows the "Vault CLAUDE.md" section; or **Leave it alone**, which saves `recusado`.
   - If it does not exist: `criar` (Recommended), which creates a new `CLAUDE.md`, or `recusado`.
   Say that the plugin never writes to `CLAUDE.md`: the agent edits it, only the block between the markers and the "Vault map" section, with the permission given here.

Also show in the summary what was detected: whether `CLAUDE.md` and `GEMINI.md` exist, the installed modules (`detectado.nucleo.modulos`) and the settings file in use. If the `claude_md` answer means writing a new file, say in the summary that the draft is shown before anything is written.

## Vault CLAUDE.md

This section applies to the core only: the other modules just update the block. It covers both paths of the `claude_md` question and runs in step 2 of "Steps after the summary".

**Update the existing one (`permitido`):**
- Update the block as in the "Guide block in CLAUDE.md" section.
- Also do the folder map (section "Vault folder map"): if the file does not have a "Vault map" section yet, add it before the block, and if it does, only fix what changed. That section and the block are the only parts changed: the rest of the file is not touched.

**Start from scratch, or create because there is no file (`criar`):**
1. If the file already exists, **do not delete or move it**: copy the whole content to `CLAUDE.backup-YYYY-MM-DD.md` in the same folder (if that name exists, add `-2`, `-3`...) and tell the user where the copy is. Only then will the file be replaced.
2. Do the folder map (section "Vault folder map") and build the draft with the skeleton below.
3. **Confirm the creation** before writing: show the draft (the sections and the folder map) and ask for confirmation with `AskUserQuestion`, with "Create the CLAUDE.md" as the first option (Recommended), "Adjust first" and "Cancel". On "Adjust first", fix what the user asks and confirm again. On "Cancel", write nothing, call `ecosystem_setup_save` with `claude_md` = `recusado` and tell the user.
4. On yes, write the file with Write.

**Skeleton of the new `CLAUDE.md`.** Follow the model of the plugin author's vault `CLAUDE.md`: lean on purpose, because it is read on every call, subagents included. Long procedures live in reference notes, read only when the task needs them (for example in `Knowledge/Referências do Cofre/`), and are not copied back into the file. Write in the skill's language and adapt it to the vault, without inventing what the plugin did not detect. Sections, in this order:
1. `# CLAUDE.md — <vault name>`, with a paragraph: this directory is an Obsidian vault, the user's database and the main source of context about them; plus a note that the file is lean on purpose.
2. `## Vault map`: the folder map, followed by the paragraph "Keep the map up to date": whenever a change in that structure is identified (folder created, renamed, moved, deleted or with a new role), update the map right then, without asking permission, and say in one line what changed. If the change also affects the folders kept out of the search index, tell the user.
3. `## General rule: ALWAYS the AI Ecosystem suite`: for any request, use the suite's tools first (the block's table says which), before Grep, Glob, Bash, PowerShell or `curl`; ask "which plugin covers this?". `find` finds by name, `search` searches content and `get_section` reads only the part needed. If the tool fails, read the error, fix the arguments and call again; the terminal only with proven unavailability (Obsidian down).
4. Only if the vault already has the subject (check `detectado`): a short section for each thing the vault uses, without copying what the block already says. For example, notes with templates (only through `create_note_from_template`), scripts (only through `ecosystem_run_script`), the conversation log (created by the plugin) and automated flows.
5. The guide block between the markers, at the end, exactly as it came in `bloco_claude_md`.

## Vault folder map

1. Read the structure with `list_folders` (or `find`): the root folders and one level below each, without hidden folders (`.obsidian`, `.claude`, `.git`) or `node_modules`. To understand what a folder is for, look at its name and one or two notes inside it with `get_section`.
2. Write one line per folder, in the format ``- `Folder/`: what it is for.``, and one line only for the subfolders that explain the parent folder better. Folder with an unclear role: ask the user in the same confirmation round instead of guessing.
3. In an empty vault, or one with few folders, the map lists only what exists; the new folders go in after the "Folder structure for the modules" section.

## Folder structure for the modules

After the map, think of a folder structure for the vault and **suggest creating** the folders the modules will use in the future. Nothing is created without the user's approval.

1. Start from what the vault already has: if an equivalent folder exists (for example `Anexos/`, `Templates/` or `Projetos/`), reuse it and do not suggest another with the same role. Suggest only the missing ones, at most one per role. Candidates, for the installed modules and the ones the plugin offers in its catalog:
   - `Templates/AI/` for the AI Templates templates.
   - `Scripts/AI/` for the AI Scripts scripts.
   - `Knowledge/Logs/` for the AI Log Manager conversation logs.
   - `Projetos/` with one folder per development project, for AI Git Tools and for project logs and changelogs.
   - `MCP/` (or the tool notes folder Environment Keys detected) for service accesses and references.
   - `Anexos/` and `Arquivo/`, which usually stay out of the search index.
2. Show the list as a table (folder, module that will use it, reason) and ask with a multiple-choice `AskUserQuestion` which ones to create, the recommended first. The "Other" option allows asking for another folder or name.
3. Create only the chosen folders, with the agent's file tools (an empty folder is enough; do not create notes inside them). If the `CLAUDE.md` was created or updated, add the new folders to the "Vault map" with the mark "(reserved for the X module)".
4. Say in one line that Obsidian and git do not keep an empty folder: they only stay in git once they get a file, but they already work as a destination for the modules.

## Steps after the summary

1. Save the four answers with `ecosystem_setup_save`. `agentes` takes the list, `modo_hooks` applies to all modules and `arquivo_settings` moves the hook entries to the chosen file.
2. If `claude_md` is `permitido` or `criar`, follow the "Vault CLAUDE.md" section: update the existing file, or create the new one with the backup, the folder map and the confirmation.
3. Follow the "Folder structure for the modules" section: suggest the folders, create the approved ones and add them to the map. If `claude_md` was `recusado`, the suggestion still applies, just without touching the file.
4. Call `ecosystem_setup_complete` with `modulo: "ai-ecosystem"`.
5. Tell the user that, to install more modules, they just use the plugin catalog: each one brings its own setup, and the `CLAUDE.md` block is rebuilt with all of them.
