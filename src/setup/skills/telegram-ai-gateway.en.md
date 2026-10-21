---
name: configurar-telegram-ai-gateway
description: "Sets up AI Ecosystem's Telegram AI Gateway (bot token kept in Environment Keys, chat ID discovered through /start and the events that notify). Use when a session-start notice asks for it or when the user asks to configure the Telegram AI Gateway."
---

# Set up the Telegram AI Gateway

The Telegram AI Gateway sends notices and approval requests with buttons to the user's Telegram. The bot token is kept in Environment Keys, and the plugin discovers the chat ID by itself when the user sends `/start` to the bot.

Prerequisites: the core (`ai-ecosystem`) and Environment Keys (`environment-variables`) set up. If `pre_requisitos` shows Environment Keys is not installed or not set up, **stop here**: tell the user to install and set up Environment Keys first (AI Ecosystem module catalog, skill `configurar-environment-variables`) and come back afterwards. If the core is what is missing, run the `configurar-ai-ecosystem` skill first.

{{COMMON}}

## Telegram questions

In this order:

1. `sabe_obter_token` (yes or no, `salvar: false`): does the user know how to get the bot token and the chat ID? It is not saved: it only decides whether you teach the step by step. If the status shows `detectado.modulo.tokenState` equal to `env-keys`, the token is already set up: do not ask. If the answer is **yes**, the next action is to open the token screen (section "Create the token secret"), without asking "do you have the token at hand?" and without asking for anything in the chat.
2. `token_secret` (`salvar: true`): the name of the secret that holds the token. Almost always `TELEGRAM_BOT_TOKEN`. If `tokenState` is `env-keys`, it is already detected.
3. `eventos` (multiple choice): which events trigger a Telegram notification. Options: `conclusao_desenvolvimento` (notice when a development ends), `pedidos_aprovacao` (approval requests with buttons), `avisos` (informative notices). Recommend all three.

## Step by step for someone who does not know how to get the token

If the user said they do not know, teach it, without asking for anything in the chat:

1. In Telegram, open a conversation with `@BotFather` and send `/newbot`.
2. Pick a name and a username for the bot (the username ends in `bot`).
3. BotFather shows the bot token. The user copies it but **does not send it to you**.
4. **As soon as the user says they copied the token, open the token screen right away** (section "Create the token secret"): they paste the token into the Obsidian screen, not into the chat.
5. Then open a conversation with the new bot and send `/start`. That is what lets the plugin discover the chat ID: the user types nothing.

## Create the token secret

Whenever you are about to ask the user to create the token, **do it with the `env_criar_secret` tool**, which opens the create-variable screen in Obsidian. Do not describe a manual path, do not send the user to look for the screen in the settings and do not wait for a "ready" before calling the tool.

- Call `env_criar_secret` with `nome_sugerido: "TELEGRAM_BOT_TOKEN"`, `tipo_sugerido: "token"`, `dominios_sugeridos: ["api.telegram.org"]` and a short `descricao` (for example, "Telegram AI Gateway bot token"). Never turn on "Full access" or "Any host": the tool already does not allow it.
- Say in one line, before the call, what is about to happen: "I opened the new variable screen in Obsidian: paste the token and click Create. The call waits up to 5 minutes."
- The screen takes only what the user types. You receive only `Secret TELEGRAM_BOT_TOKEN criada`, `cancelado` or `expirado`. On `cancelado` or `expirado`, ask whether they want to try again and call the tool again if they say yes.
- Opening the screen does not have to wait for the final summary: the user's click on Create is already the confirmation.
- If the tool does not exist (an old Environment Keys), tell the user to update Environment Keys and restart the session. Do not ask for the token in the chat.
- Then save the secret name and go on to `/start`, as in the steps below.

## Steps after the summary

1. If `tokenState` is still not `env-keys` (the secret has not been created yet), do the "Create the token secret" section now. If it was already created above, skip this step.
2. Save the secret name: `ecosystem_setup_save` with `modulo: "telegram-ai-gateway"`, `chave: "token_secret"`, `valor: "TELEGRAM_BOT_TOKEN"` (the name, never the token).
3. Ask the user to send `/start` to the bot and wait. Call `ecosystem_setup_status` again until `detectado.modulo.chatIdConfigured` is `true` (the wait is for the `/start`, not for a typed number). If it takes long, remind the user of the `/start` and of the right bot.
4. Save `eventos` with `ecosystem_setup_save`.
5. Update the `CLAUDE.md` block and call `ecosystem_setup_complete` with `modulo: "telegram-ai-gateway"`. If it refuses for a missing token or chat ID, go back to the matching step.
