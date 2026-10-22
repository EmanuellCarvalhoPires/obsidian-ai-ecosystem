---
name: configurar-ai-git-tools
description: "Configures the AI Ecosystem AI Git Tools (git hook mode, Bitbucket and GitHub secrets and the projects folder). Use when a session-start notice asks for it or when the user asks to configure AI Git Tools."
---

# Configure AI Git Tools

AI Git Tools brings local git (status, diff, log, commit, push, branch, merge, stash, tag, clone) and the GitHub and Bitbucket APIs (open, list, comment on and merge a PR; see the pipeline) into suite tools, and records each project's history as notes by itself (`Eventos/`, `Changelogs/` and the repository graph). No tool does anything destructive (no `push --force`, `reset --hard`, `rebase` or branch deletion), and `git_pr_merge` always asks for the user's approval, whatever the hook mode.

Prerequisite: the core (`ai-ecosystem`) configured. If `pre_requisitos` says it is not, run the `configurar-ai-ecosystem` skill first and come back.

{{COMMON}}

## AI Git Tools questions

In this order. Show in the summary what the plugin detected: the secrets found (`detectado.modulo.secrets`, names and types only, never values) and the projects folder (`detectado.modulo.projectsRoot`).

1. `modo_hooks` (a choice, `salvar: true`, handled by the core): how the hook reacts when the agent uses `git`, `gh` or `curl`/`Invoke-RestMethod` against the GitHub and Bitbucket APIs in the terminal instead of the tools.
   - `avisar` (Recommended): the call goes through and the agent gets a reminder to use the tool. **Warn that in this mode a git command typed in the terminal goes through, even a destructive one**: only Claude's normal permission prompt holds it.
   - `bloquear`: denies the call and points to the tool.
   - `off`: no warning hook. The `git_pr_merge` approval lock stays on.
2. `secret_bitbucket` (a choice, `salvar: true`): the secret used for the Bitbucket APIs (PR and pipeline). The options are the detected secrets, plus `nenhuma`.
3. `secret_github` (a choice, `salvar: true`): the secret used for the GitHub APIs (PR and pipeline). The options are the detected secrets, plus `nenhuma`.
4. `pasta_dos_projetos` (text, `salvar: true`): the vault folder with one folder per development project (`#dev/projeto` notes with the local clone). If `detectado.modulo.projectsRootExists` is true it is detected already: show it in the summary.
5. `claude_md`: the core's question (permission to update the guide block). Ask only if `claude_md.permissao` is not recorded yet; follow the "Guide block in CLAUDE.md" section above.

### Rules for the secret questions

- Show the options exactly as they come in `perguntas`: **no secret is marked as recommended** and you **do not suggest any name**. The user picks.
- Always offer the "None (set it up later)" option (value `nenhuma`). Choosing `nenhuma` stores an empty string and **does not block** `ecosystem_setup_complete`: the module becomes active, the local git tools work and only the PR and pipeline tools of that provider answer `secret_nao_configurada` until a secret is picked in the plugin settings.
- If more than 3 secrets were detected, ask the question with plan B (a numbered list in the chat), so all of them show up together with "None".
- **Never ask for the token.** If the user wants to create a new secret, have them use the `env_criar_secret` screen (the user types the value in Obsidian, allowing the host `api.bitbucket.org` or `api.github.com`); then call `ecosystem_setup_status` again and ask the question again with the updated list.

## Steps after the summary

1. Save the answers with `ecosystem_setup_save`, in order (`modo_hooks`, `secret_bitbucket`, `secret_github`, `pasta_dos_projetos`). For a secret not picked, save the value `nenhuma`.
2. Update the `CLAUDE.md` block and call `ecosystem_setup_complete` with `modulo: "ai-git-tools"`. An empty secret does not block completion.
3. Say, one line each: that git, PRs and pipelines go through the `git_*` tools and the project history becomes notes by itself; that `git_pr_merge` always asks "Posso fazer o merge do PR #N para a branch XYZ?" before merging; which hook mode was chosen (and, if it is `avisar`, that a command typed in the terminal goes through); and, if a secret was left as "None", that it can be picked later in the AI Git Tools settings.
