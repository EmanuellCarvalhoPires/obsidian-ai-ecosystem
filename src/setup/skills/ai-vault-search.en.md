---
name: configurar-ai-vault-search
description: "Sets up AI Ecosystem's AI Vault Search (folders kept out of the search index). Use when a session-start notice asks for it or when the user asks to configure AI Vault Search."
---

# Set up AI Vault Search

AI Vault Search indexes the vault and answers hybrid searches (graph, BM25 and sections) in memory. Large folders that are not notes (attachments, archive, generated tool notes) only get in the way of the index, and the protection hooks let the agent use Grep in them. This setup defines those folders. The search covers any folder on the computer, not only the vault, and there is reading of spreadsheets and documents (xlsx, docx, pdf).

Prerequisite: the core (`ai-ecosystem`) set up. If `pre_requisitos` shows it is not, run the `configurar-ai-ecosystem` skill first and come back.

{{COMMON}}

## AI Vault Search question

1. `pastas_fora_do_indice` (multiple choice, `salvar: true`): which folders stay out of the index. Build the options from what the plugin detected: the largest folders (`detectado.modulo.largestFolders`), the ones already excluded (`detectado.modulo.excludedFolders`) and the obvious candidates, such as attachments, archive and the Environment Keys tool notes folder (`detectado.nucleo.modulos` says whether it is installed; the folder, if known, comes from its answer). Show how many notes are in the index (`detectado.modulo.noteCount`). The saved value is the list of folder paths relative to the vault; the exclusions also apply to absolute paths inside the vault, case-insensitively. If there is no folder to exclude, save the empty list.

If `excludedFolders` already has folders, the question becomes a confirmation in the summary (`detectada: true`): do not ask again, just show it.

## Steps after the summary

1. Save `pastas_fora_do_indice` with `ecosystem_setup_save`.
2. Update the `CLAUDE.md` block and call `ecosystem_setup_complete` with `modulo: "ai-vault-search"`.
3. Say that, with the protection hooks in block mode, a Grep or Glob inside the vault is redirected to `search` and `find` (content and name search, in the vault by default and in any folder on the PC with an absolute path or an extension other than md), `get_section` (reads a section or line range of a note or file), `read_table` (reads CSV, TSV and XLSX), `list_files` and `list_folders` (`search_notes` and `find_notes` remain as legacy aliases), except in the folders left out of the index.
