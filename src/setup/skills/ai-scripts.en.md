---
name: configurar-ai-scripts
description: "Sets up AI Ecosystem's AI Scripts (languages, allowed script folders, writing outside the vault and migration of the scripts that already exist in the vault, without deleting the originals). Use when a session-start notice asks for it or when the user asks to configure AI Scripts."
---

# Set up AI Scripts

AI Scripts registers, categorizes and runs local scripts with parameter validation. Scripts only run from the folders the user allowed, and the protection hooks send anyone who tries to run one of those scripts straight in the terminal to the plugin instead.

Prerequisite: the core (`ai-ecosystem`) set up. If `pre_requisitos` shows it is not, run the `configurar-ai-ecosystem` skill first and come back.

{{COMMON}}

## AI Scripts questions

In this order:

1. `linguagens` (`salvar: false`): the script languages the user uses. The plugin detects them by extension (`detectado.nucleo.scripts_no_cofre`) and from the scripts already registered (`detectado.modulo.languages`). If it found some, do not ask: show them in the summary. If it found nothing, ask (Python, Node, Bash, PowerShell). It only guides the rest.
2. `pastas_permitidas` (multiple choice, `salvar: true`): the vault folders scripts may run from. Show the detected ones (`detectado.nucleo.scripts_no_cofre`, with the file count of each folder, and the ones already allowed) and let the user choose. The answer only adds folders to the ones already allowed, it never removes. It only works during this setup, only accepts folders that exist in the vault (never the root, `.claude` or the Obsidian configuration folder) and the user sees a notice in Obsidian with the folders added. After the setup, these folders change only in the AI Ecosystem settings. The saved value is the list of paths relative to the vault.
3. `pasta_de_scripts` (text, `salvar: true`): the folder where AI Scripts keeps the registered scripts. If `detectado.modulo.scriptsFolder` already exists and holds scripts (`scriptCount`), it is already detected.
4. `pode_gravar_fora_do_cofre` (yes or no, `salvar: true`): may scripts write files outside the vault? Recommend "no" and explain the risk in one line.
5. `migrar_scripts` (yes or no, `salvar: false`): are there scripts inside the vault the user wants to migrate to AI Scripts? If yes, follow the migration section.

## Migrating the existing scripts

Only if the user said yes to `migrar_scripts`. Everything here is additive: **no original file is deleted, moved or changed.**

1. Ask, with `AskUserQuestion`, whether you may run a **full search** for scripts in the vault. If not, skip the migration.
2. Search with the AI Vault Search tools (`search`, `find`, `list_files`, `list_folders`), not with Grep or Glob. Look for `.py`, `.js`, `.mjs`, `.sh` and `.ps1` files and for notes that describe scripts. If AI Vault Search is not installed, use `ecosystem_list_scripts` and ask the user which folders to look at.
3. List what is reusable: path, language and one line about what the script does (read the start of each). Let the user mark which ones to migrate.
4. **Scan the marked scripts' code for secrets**: tokens, passwords, API keys, `Authorization` headers, URLs with a user and password. Show only the file, the line and the variable name, **never the value**. For each finding, propose replacing the value with `{{secret:NAME}}`. The secrets are created with the `env_criar_secret` tool (Environment Keys must be installed and set up), one at a time, with the user typing the value in the screen. The originals are not edited: the new registration points to the script, and the swap to `{{secret:NAME}}` applies to whoever uses the registered copy or the script's environment, and the user decides later whether to fix the original.
5. Show the whole plan (scripts, categories, parameters and secrets) and ask for **permission** with `AskUserQuestion` before creating any registration.
6. To register, follow the format AI Scripts already uses: call `list_ai_scripts` and `get_script_schema` on a script that is already registered and copy the structure. If none is registered to copy from, tell the user and offer to register the first one through the AI Scripts settings.
7. Confirm with `list_ai_scripts` that the new registrations show up and say which ones were left out and why.

## Steps after the summary

1. Save the answers with `salvar: true`. `pastas_permitidas` updates the allowed folders of the core Script Engine, and the protection hooks start covering those folders.
2. Do the migration, if there was one.
3. Update the `CLAUDE.md` block and call `ecosystem_setup_complete` with `modulo: "ai-scripts"`.
