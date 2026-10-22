---
name: configurar-ai-log-manager
description: "Configura o AI Log Manager do AI Ecosystem (modo dos logs, pastas acompanhadas, eventos de desenvolvimento, leitura de PRs e deploys e hooks do Claude Code). Use quando um aviso de início de sessão pedir ou quando o usuário pedir para configurar o AI Log Manager."
---

# Configurar o AI Log Manager

O AI Log Manager cria e mantém sozinho o log de cada conversa com o Claude Code no cofre (a partir dos transcripts), mostra os logs numa tela própria e registra commits, pushes, branches, PRs e deploys dos projetos de desenvolvimento como notas, com o grafo do repositório.

Pré-requisito: o núcleo (`ai-ecosystem`) configurado. Se `pre_requisitos` mostrar que não, execute primeiro a skill `configurar-ai-ecosystem` e volte.

{{COMMON}}

## Perguntas do AI Log Manager

Nesta ordem. Mostre no resumo o que o plugin detectou: quantos logs já existem (`detectado.modulo.existingLogs`) e quais projetos têm clone (`detectado.modulo.projectsWithClone`).

1. `modo_dos_logs` (uma escolha, `salvar: true`):
   - `observe` (Recomendado se `existingLogs` for maior que 0): só compara e relata, sem gravar. Serve para rodar ao lado do hook `Stop` e dos scripts de log que já existem, sem duplicar nada. O usuário muda para `active` depois de conferir.
   - `active` (Recomendado se não houver logs ainda): o plugin cria e atualiza os logs.
2. `pastas_acompanhadas` (lista, `salvar: true`): pastas do computador, fora do cofre, em que as conversas também devem ganhar log. O cofre e os clones dos projetos com nota `#dev/projeto` já são acompanhados: não pergunte por eles. Aceita lista vazia.
3. `registrar_eventos_dev` (sim ou não, `salvar: true`): registrar commits, pushes e branches novas dos projetos que têm clone como notas em `Projetos/<Projeto>/Eventos/`. A primeira leitura de cada projeto só guarda a linha de base, sem notas do histórico. Recomendado se `projectsWithClone` não estiver vazia.
4. `ler_remoto` (sim ou não, `salvar: true`): ler PRs e deploys do GitHub e do Bitbucket pelo Environment Keys. Só faz sentido se o item 3 for sim. Se o usuário disser sim, ele precisa criar a secret com o token (`GITHUB_TOKEN` ou `BITBUCKET_TOKEN`, permitindo o host `api.github.com` ou `api.bitbucket.org`) pela tela `env_criar_secret`, e você nunca pede nem vê o valor. Padrão: não.
5. `instalar_hooks` (sim ou não, `salvar: true`): instalar os hooks do Claude Code (`SessionStart`, `UserPromptSubmit`, `Stop`, `SessionEnd` e `PostToolUse` só para comandos `git` e `gh`). Eles gravam um arquivo pequeno numa pasta do plugin e não fazem nenhuma outra coisa. **Avise que isso altera o `settings.json` global do Claude Code** (é feita uma cópia de segurança). Se `detectado.modulo.hooksInstalled` já for verdadeiro, não pergunte: mostre no resumo.
6. `pasta_dos_projetos` (texto, `salvar: true`): a pasta do cofre com uma pasta por projeto de desenvolvimento. Se `detectado.modulo.projectsRootExists` for verdadeiro, já está detectada (`detectado.modulo.projectsRoot`): mostre no resumo.

## Etapas depois do resumo

1. Grave as respostas com `ecosystem_setup_save`, na ordem. A de `instalar_hooks` com valor `sim` já instala os hooks.
2. Atualize o bloco do `CLAUDE.md` e chame `ecosystem_setup_complete` com `modulo: "ai-log-manager"`.
3. Diga, em uma linha cada: que os logs novos aparecem sozinhos (ou só são comparados, no modo observar); que a tela de logs abre pelo comando "Abrir a tela de logs"; e, se o modo for `observe`, que a troca para `active` é feita nas configurações do plugin depois da conferência, e que só então o hook `Stop` antigo pode ser desligado.
