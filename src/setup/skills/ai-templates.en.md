---
name: configurar-ai-templates
description: "Sets up AI Ecosystem's AI Templates (templates folder, name collision rule and migration of the templates that already exist in the vault, without changing the originals). Use when a session-start notice asks for it or when the user asks to configure AI Templates."
---

# Set up AI Templates

AI Templates fills Markdown templates with JSON data and returns notes with aligned tables, images in the right folder and the file saved where the template says. The protection hooks send anyone who tries to write a note that has a template straight to disk to the plugin instead.

Prerequisite: the core (`ai-ecosystem`) set up. If `pre_requisitos` shows it is not, run the `configurar-ai-ecosystem` skill first and come back.

{{COMMON}}

## AI Templates questions

The plugin has no setting for a default folder of new notes, a date format or a timezone: those values come from each template. **Do not ask any of the three.**

In this order:

1. `pasta_de_templates` (text, `salvar: true`): the vault folder where the templates live. If `detectado.modulo.templatesFolder` already exists and holds templates (`templateCount`), it is already detected: show it in the summary.
2. `regra_de_colisao` (single choice, `salvar: true`): what to do when a note with the generated name already exists.
   - `incremental` (Recommended): creates `Name 1`, `Name 2`..., losing nothing.
   - `error`: refuses and warns.
   - `overwrite`: overwrites the existing note.
3. `migrar_templates` (yes or no, `salvar: false`): are there templates inside the vault, in ordinary notes, that the user wants to turn into AI Templates templates? If yes, follow the migration section.

## Migrating the existing templates

Only if the user said yes to `migrar_templates`. **The original notes are not changed, moved or deleted.**

1. Ask, with `AskUserQuestion`, whether you may run a **full search** for templates in the vault. If not, skip the migration.
2. Search with the AI Vault Search tools (`search`, `find`, `list_files`, `list_folders`), not with Grep or Glob: template folders, notes with placeholders (`{{...}}`, `<% ... %>`) and the ones listed by `list_templates` (those already exist: ignore them).
3. For each template found, read the note and **extract the fields** (name, type and whether it is required). For the expected format, call `list_templates` and `get_template_schema` on a template that already exists; if there is none, follow what `create_template` describes.
4. Show, template by template, the extracted fields and the suggested target path, and ask for **approval** with `AskUserQuestion` (approve, adjust or skip each one). Adjust whatever the user asks.
5. Only after approval, create each template with `create_template`. Check with `list_templates` and with `preview_template` (sample data) that the result comes out like the original note.
6. Say which templates were left out and why.

## Steps after the summary

1. Save `pasta_de_templates` and `regra_de_colisao` with `ecosystem_setup_save`.
2. Do the migration, if there was one.
3. Update the `CLAUDE.md` block and call `ecosystem_setup_complete` with `modulo: "ai-templates"`.
