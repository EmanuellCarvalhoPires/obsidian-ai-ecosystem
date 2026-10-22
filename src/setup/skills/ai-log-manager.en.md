---
name: configurar-ai-log-manager
description: "Configures the AI Ecosystem AI Log Manager (log mode, tracked folders, development events, reading PRs and deploys, and the Claude Code hooks). Use when a session-start notice asks for it or when the user asks to configure the AI Log Manager."
---

# Configure the AI Log Manager

The AI Log Manager creates and keeps the log of every Claude Code conversation in the vault by itself (from the transcripts), shows the logs on a screen of its own and records commits, pushes, branches, PRs and deploys of development projects as notes, with the repository graph.

Prerequisite: the core (`ai-ecosystem`) configured. If `pre_requisitos` says it is not, run the `configurar-ai-ecosystem` skill first and come back.

{{COMMON}}

## AI Log Manager questions

In this order. Show in the summary what the plugin detected: how many logs already exist (`detectado.modulo.existingLogs`) and which projects have a clone (`detectado.modulo.projectsWithClone`).

1. `modo_dos_logs` (a choice, `salvar: true`):
   - `observe` (Recommended when `existingLogs` is above 0): only compares and reports, writes nothing. It runs next to the `Stop` hook and the log scripts that already exist without duplicating anything. The user switches to `active` after checking.
   - `active` (Recommended when there are no logs yet): the plugin creates and updates the logs.
2. `pastas_acompanhadas` (list, `salvar: true`): folders on the computer, outside the vault, whose conversations should also get a log. The vault and the clones of projects with a `#dev/projeto` note are tracked already: do not ask about them. An empty list is fine.
3. `registrar_eventos_dev` (yes or no, `salvar: true`): record commits, pushes and new branches of projects that have a clone as notes in `Projetos/<Project>/Eventos/`. The first read of each project only stores a baseline, with no notes for the history. Recommended when `projectsWithClone` is not empty.
4. `ler_remoto` (yes or no, `salvar: true`): read PRs and deploys from GitHub and Bitbucket through Environment Keys. Only makes sense if item 3 is yes. If the user says yes they must create the secret with the token (`GITHUB_TOKEN` or `BITBUCKET_TOKEN`, allowing the host `api.github.com` or `api.bitbucket.org`) in the `env_criar_secret` screen, and you never ask for or see the value. Default: no.
5. `instalar_hooks` (yes or no, `salvar: true`): install the Claude Code hooks (`SessionStart`, `UserPromptSubmit`, `Stop`, `SessionEnd` and `PostToolUse` only for `git` and `gh` commands). They write a small file in a plugin folder and do nothing else. **Warn that this changes the global Claude Code `settings.json`** (a backup is made). If `detectado.modulo.hooksInstalled` is already true, do not ask: show it in the summary.
6. `pasta_dos_projetos` (text, `salvar: true`): the vault folder with one folder per development project. If `detectado.modulo.projectsRootExists` is true it is detected already (`detectado.modulo.projectsRoot`): show it in the summary.

## Steps after the summary

1. Save the answers with `ecosystem_setup_save`, in order. The `instalar_hooks` answer with value `sim` installs the hooks right away.
2. Update the `CLAUDE.md` block and call `ecosystem_setup_complete` with `modulo: "ai-log-manager"`.
3. Say, one line each: that new logs appear by themselves (or are only compared, in observe mode); that the logs screen opens with the command "Open the logs screen"; and, if the mode is `observe`, that switching to `active` is done in the plugin settings after checking, and only then the old `Stop` hook can be turned off.
