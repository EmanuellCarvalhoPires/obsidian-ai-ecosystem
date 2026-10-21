---
name: configurar-telegram-ai-gateway
description: "Configura o Telegram AI Gateway do AI Ecosystem (token do bot guardado no Environment Keys, descoberta do chat ID pelo /start e eventos que notificam). Use quando um aviso de início de sessão pedir ou quando o usuário pedir para configurar o Telegram AI Gateway."
---

# Configurar o Telegram AI Gateway

O Telegram AI Gateway envia avisos e pedidos de aprovação com botões para o Telegram do usuário. O token do bot fica guardado no Environment Keys, e o chat ID o plugin descobre sozinho quando o usuário manda `/start` ao bot.

Pré-requisitos: o núcleo (`ai-ecosystem`) e o Environment Keys (`environment-variables`) configurados. Se `pre_requisitos` mostrar que o Environment Keys não está instalado ou configurado, **pare aqui**: diga ao usuário para instalar e configurar o Environment Keys primeiro (catálogo de módulos do AI Ecosystem, skill `configurar-environment-variables`) e volte depois. Se for o núcleo que falta, execute antes a skill `configurar-ai-ecosystem`.

{{COMMON}}

## Perguntas do Telegram

Nesta ordem:

1. `sabe_obter_token` (sim ou não, `salvar: false`): o usuário sabe obter o token do bot e o chat ID? Não é gravada: só decide se você ensina o passo a passo. Se o status mostra `detectado.modulo.tokenState` igual a `env-keys`, o token já está configurado: não pergunte. Se a resposta for **sim**, a próxima ação é abrir a tela do token (seção "Criar a secret do token"), sem perguntar "já tem o token em mãos?" nem pedir nada no chat.
2. `token_secret` (`salvar: true`): o nome da secret que guarda o token. Quase sempre é `TELEGRAM_BOT_TOKEN`. Se `tokenState` for `env-keys`, já está detectado.
3. `eventos` (várias escolhas): quais eventos geram notificação no Telegram. Opções: `conclusao_desenvolvimento` (aviso quando um desenvolvimento termina), `pedidos_aprovacao` (pedidos de aprovação com botões), `avisos` (avisos informativos). Recomende as três.

## Passo a passo para quem não sabe obter o token

Se o usuário disse que não sabe, ensine, sem pedir nada no chat:

1. No Telegram, abrir uma conversa com `@BotFather` e enviar `/newbot`.
2. Escolher um nome e um nome de usuário para o bot (o de usuário termina em `bot`).
3. O BotFather mostra o token do bot. O usuário o copia, mas **não o envia a você**.
4. **Assim que o usuário disser que copiou o token, abra a tela do token na hora** (seção "Criar a secret do token"): ele cola o token na tela do Obsidian, não no chat.
5. Depois, abrir uma conversa com o bot novo e enviar `/start`. É isso que permite ao plugin descobrir o chat ID: o usuário não digita nada.

## Criar a secret do token

Sempre que for pedir ao usuário para criar o token, **o pedido é feito pela ferramenta `env_criar_secret`**, que abre no Obsidian a tela de criar variável. Não descreva um caminho manual, não mande o usuário procurar a tela nas configurações e não espere um "pronto" antes de chamar a ferramenta.

- Chame `env_criar_secret` com `nome_sugerido: "TELEGRAM_BOT_TOKEN"`, `tipo_sugerido: "token"`, `dominios_sugeridos: ["api.telegram.org"]` e uma `descricao` curta (por exemplo, "Token do bot do Telegram AI Gateway"). Nunca ligue "Acesso total" nem "Permitir qualquer domínio": a ferramenta já não deixa.
- Diga em uma linha, antes da chamada, o que vai acontecer: "Abri a tela de nova variável no Obsidian: cole o token e clique em Criar. A chamada espera até 5 minutos."
- A tela aceita só o usuário digitar o valor. Você recebe apenas `Secret TELEGRAM_BOT_TOKEN criada`, `cancelado` ou `expirado`. Em `cancelado` ou `expirado`, pergunte se quer tentar de novo e chame a ferramenta de novo se ele disser que sim.
- A abertura da tela não precisa esperar o resumo final: o clique do usuário em Criar já é a confirmação.
- Se a ferramenta não existir (Environment Keys antigo), diga ao usuário para atualizar o Environment Keys e reiniciar a sessão. Não peça o token no chat.
- Em seguida, grave o nome da secret e siga para o `/start`, como nas etapas abaixo.

## Etapas depois do resumo

1. Se `tokenState` ainda não for `env-keys` (a secret ainda não foi criada), faça agora a seção "Criar a secret do token". Se já foi criada acima, pule este passo.
2. Grave o nome da secret: `ecosystem_setup_save` com `modulo: "telegram-ai-gateway"`, `chave: "token_secret"`, `valor: "TELEGRAM_BOT_TOKEN"` (o nome, nunca o token).
3. Peça ao usuário para enviar `/start` ao bot e aguarde. Chame `ecosystem_setup_status` de novo até `detectado.modulo.chatIdConfigured` ser `true` (a espera é pelo `/start`, não por um número digitado). Se demorar, lembre o usuário do `/start` e do bot certo.
4. Grave `eventos` com `ecosystem_setup_save`.
5. Atualize o bloco do `CLAUDE.md` e chame `ecosystem_setup_complete` com `modulo: "telegram-ai-gateway"`. Se ele recusar por falta de token ou de chat ID, volte ao passo correspondente.
