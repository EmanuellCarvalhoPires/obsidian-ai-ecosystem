---
name: kit
description: "Kit de boas-vindas do AI Ecosystem. Confere o que está instalado, explica em linguagem simples o que está ok e o que falta e propõe os primeiros passos práticos. Use quando o usuário digitar /kit ou perguntar por onde começar, o que a suíte faz, quais são os primeiros passos ou pedir para mostrar o que está instalado."
---

# Kit de boas-vindas

Você vai apresentar a suíte AI Ecosystem a quem acabou de instalá-la. Fale em linguagem simples, sem jargão, e seja breve. Nada de listas enormes: o objetivo é deixar a pessoa pronta para o primeiro uso.

## Etapa 1: o que está instalado

Chame `ecosystem_diagnostico` (se ela não aparecer na lista de tools, busque-a com `tools_find`). Resuma o relatório para o usuário:

- o que está `ok`, em uma frase;
- cada `aviso` ou `erro`, com a ação sugerida pelo relatório, explicada em palavras simples;
- módulo "não instalado" não é defeito: diga que ele pode ser instalado pelo catálogo do AI Ecosystem (configurações do plugin, aba Catálogo) e para que serve.

Nunca mostre nem peça segredos, tokens ou senhas. O relatório só traz contagens e sim/não.

## Etapa 2: o que já dá para usar

- Se a tool `list_templates` existir, chame-a e liste os templates disponíveis (nome e para que servem, em uma linha cada).
- Se a tool `list_ai_scripts` existir, chame-a e liste os scripts disponíveis do mesmo jeito.
- Se o módulo de templates ou o de scripts não estiver instalado, diga isso e como instalá-lo pelo catálogo. Não invente nomes de templates ou scripts: cite somente o que as tools devolveram.

## Etapa 3: três primeiros passos

Proponha **três** passos práticos, escolhendo entre os abaixo. Inclua só os que existem nesta instalação (template ou script citado que não apareceu nas listas da etapa 2 deve ser omitido, sem substituir por outro inventado):

1. Criar a primeira nota diária com o template `nota_diaria`.
2. Rodar o script `links_quebrados` para ver a saúde do cofre.
3. Rodar o script `backup_cofre` com `dry_run` (só simula, não copia nada).
4. Mandar um aviso de teste no Telegram, se o relatório mostrar o Telegram configurado.
5. Criar a primeira nota de reunião com o template `nota_reuniao`.

Se menos de três se aplicarem, proponha só os que se aplicam e, se faltar módulo, sugira instalá-lo como passo.

## Regras de execução

- **Não execute nada ainda.** Mostre os passos e peça a escolha do usuário (use `AskUserQuestion` com os passos como opções, quando existir; senão, pergunte no próprio chat).
- Só depois da escolha, execute o passo escolhido.
- **Nunca** execute sem o usuário escolher algo que grave fora do cofre ou envie mensagem (backup para outra pasta, aviso no Telegram e similares). Mesmo escolhido, descreva em uma linha o que vai acontecer e confirme se houver qualquer dúvida sobre o destino.
- Para criar notas a partir de templates, use as tools do AI Templates, nunca montando a nota à mão.

## Fechamento: tour de busca

Termine oferecendo um tour rápido de busca, em três linhas:

1. `search` busca dentro do conteúdo das notas e arquivos; `find` acha arquivos pelo nome; `get_section` lê só o trecho que interessa.
2. Elas são mais rápidas e econômicas que `grep`, `Grep` ou `Glob`, e ficam registradas no Live Request Inspector.
3. Pergunte se o usuário quer ver um exemplo com um termo que ele escolher.
