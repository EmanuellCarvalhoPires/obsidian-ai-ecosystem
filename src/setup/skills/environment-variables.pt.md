---
name: configurar-environment-variables
description: "Configura o Environment Keys do AI Ecosystem (serviços que serão chamados, pasta das notas de tools e criação das secrets pela tela do Obsidian, sem o valor passar pelo chat). Use quando um aviso de início de sessão pedir ou quando o usuário pedir para configurar o Environment Keys."
---

# Configurar o Environment Keys

O Environment Keys guarda tokens e outros dados sensíveis criptografados e deixa o agente usá-los por referência (`{{secret:NOME}}`), sem nunca ver o valor. Esta configuração diz quais serviços serão chamados e cria as secrets que eles precisam.

Pré-requisito: o núcleo (`ai-ecosystem`) configurado. Se `pre_requisitos` mostrar que não, execute primeiro a skill `configurar-ai-ecosystem` e volte.

{{COMMON}}

## Perguntas do Environment Keys

Nesta ordem:

1. `servicos` (várias escolhas): quais serviços o agente vai chamar com secrets. Opções: Jira, Bitbucket, Confluence, GitHub. Outro serviço entra por "Other". O valor gravado é a lista de nomes em minúsculas (`jira`, `bitbucket`, `confluence`, `github`, ou o nome digitado). `detectado.modulo.knownHosts` mostra hosts que o plugin já conhece: use-os como dica.
2. `pasta_notas_tools` (texto): a pasta do cofre onde ficam as notas de tools e requests. Só pergunte se `detectado.modulo.toolNotesFolder` estiver vazio. Se o plugin já achou uma, mostre-a no resumo.

## Etapas depois do resumo

1. Grave `servicos` e `pasta_notas_tools` com `ecosystem_setup_save`.
2. Confira em `detectado.modulo.vaultUnlocked` se o cofre de segredos está desbloqueado. Se não estiver, peça ao usuário para desbloqueá-lo no Obsidian e aguarde a confirmação dele.
3. Crie as secrets que cada serviço escolhido precisa, **uma por vez**, abrindo a tela com a tool `env_criar_secret`. Antes, chame `list_secrets` para não repetir um nome que já existe.
   - Sugira `nome_sugerido` (por exemplo `JIRA_API_TOKEN`), `tipo_sugerido` (`token`, `basic`, `bearer`, `header` ou `env`), `dominios_sugeridos` (o host exato da API, como `empresa.atlassian.net`, `api.bitbucket.org` ou `api.github.com`) e `descricao`.
   - Se faltar o domínio do site do usuário (Jira e Confluence usam um por empresa), pergunte com `AskUserQuestion` (o domínio não é segredo).
   - Nunca sugira "Acesso total" nem "Permitir qualquer domínio": só o usuário liga isso, na tela, se quiser.
   - A tool não aceita valor. O usuário digita o valor na tela, no Obsidian. Você recebe só `Secret NOME criada`, `cancelado` ou `expirado`. Em `cancelado` ou `expirado`, pergunte se o usuário quer tentar de novo ou pular essa secret.
4. Chame `ecosystem_setup_complete` com `modulo: "environment-variables"`.
5. Lembre ao usuário que o agente passa a usar as secrets pelo nome, em `{{secret:NOME}}`, e que o valor nunca aparece na conversa.
