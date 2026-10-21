---
name: configurar-environment-variables
description: "Sets up AI Ecosystem's Environment Keys (services that will be called, tool notes folder and creation of the secrets through the Obsidian screen, with no value passing through the chat). Use when a session-start notice asks for it or when the user asks to configure Environment Keys."
---

# Set up Environment Keys

Environment Keys keeps tokens and other sensitive data encrypted and lets the agent use them by reference (`{{secret:NAME}}`), never seeing the value. This setup says which services will be called and creates the secrets they need.

Prerequisite: the core (`ai-ecosystem`) set up. If `pre_requisitos` shows it is not, run the `configurar-ai-ecosystem` skill first and come back.

{{COMMON}}

## Environment Keys questions

In this order:

1. `servicos` (multiple choice): which services the agent will call with secrets. Options: Jira, Bitbucket, Confluence, GitHub. Another service goes in through "Other". The saved value is the list of names in lowercase (`jira`, `bitbucket`, `confluence`, `github`, or the typed name). `detectado.modulo.knownHosts` shows hosts the plugin already knows: use them as a hint.
2. `pasta_notas_tools` (text): the vault folder where the tool and request notes live. Only ask if `detectado.modulo.toolNotesFolder` is empty. If the plugin already found one, show it in the summary.

## Steps after the summary

1. Save `servicos` and `pasta_notas_tools` with `ecosystem_setup_save`.
2. Check in `detectado.modulo.vaultUnlocked` that the secret vault is unlocked. If it is not, ask the user to unlock it in Obsidian and wait for their confirmation.
3. Create the secrets each chosen service needs, **one at a time**, opening the screen with the `env_criar_secret` tool. Before that, call `list_secrets` so you do not repeat a name that already exists.
   - Suggest `nome_sugerido` (for example `JIRA_API_TOKEN`), `tipo_sugerido` (`token`, `basic`, `bearer`, `header` or `env`), `dominios_sugeridos` (the exact API host, such as `company.atlassian.net`, `api.bitbucket.org` or `api.github.com`) and `descricao`.
   - If the user's site domain is missing (Jira and Confluence use one per company), ask with `AskUserQuestion` (the domain is not a secret).
   - Never suggest "Full access" or "Allow any domain": only the user turns that on, in the screen, if they want it.
   - The tool does not accept a value. The user types the value in the screen, inside Obsidian. You receive only `Secret NAME criada`, `cancelado` or `expirado`. On `cancelado` or `expirado`, ask whether the user wants to try again or skip that secret.
4. Call `ecosystem_setup_complete` with `modulo: "environment-variables"`.
5. Remind the user that the agent now uses the secrets by name, in `{{secret:NAME}}`, and that the value never shows up in the conversation.
