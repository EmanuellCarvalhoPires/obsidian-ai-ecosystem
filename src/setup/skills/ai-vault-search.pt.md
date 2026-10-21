---
name: configurar-ai-vault-search
description: "Configura o AI Vault Search do AI Ecosystem (pastas que ficam fora do índice de busca). Use quando um aviso de início de sessão pedir ou quando o usuário pedir para configurar o AI Vault Search."
---

# Configurar o AI Vault Search

O AI Vault Search indexa o cofre e responde buscas híbridas (grafo, BM25 e seções) em memória. Pastas grandes que não são notas (anexos, arquivo morto, notas geradas de tools) só atrapalham o índice, e os hooks de proteção deixam o agente usar Grep nelas. Esta configuração define essas pastas.

Pré-requisito: o núcleo (`ai-ecosystem`) configurado. Se `pre_requisitos` mostrar que não, execute primeiro a skill `configurar-ai-ecosystem` e volte.

{{COMMON}}

## Pergunta do AI Vault Search

1. `pastas_fora_do_indice` (várias escolhas, `salvar: true`): quais pastas ficam fora do índice. Monte as opções com o que o plugin detectou: as maiores pastas (`detectado.modulo.largestFolders`), as que já estão excluídas (`detectado.modulo.excludedFolders`) e os candidatos óbvios, como anexos, arquivo morto e a pasta das notas de tools do Environment Keys (`detectado.nucleo.modulos` diz se ele está instalado; a pasta, se conhecida, vem da resposta dele). Mostre quantas notas há no índice (`detectado.modulo.noteCount`). O valor gravado é a lista de caminhos de pasta relativos ao cofre. Se não houver nenhuma pasta a excluir, grave a lista vazia.

Se `excludedFolders` já tem pastas, a pergunta vira uma confirmação no resumo (`detectada: true`): não pergunte de novo, só mostre.

## Etapas depois do resumo

1. Grave `pastas_fora_do_indice` com `ecosystem_setup_save`.
2. Atualize o bloco do `CLAUDE.md` e chame `ecosystem_setup_complete` com `modulo: "ai-vault-search"`.
3. Diga que, com os hooks de proteção em modo bloquear, um Grep ou Glob dentro do cofre passa a ser redirecionado para `search_notes`, `list_files` e `get_section`, menos nas pastas que ficaram fora do índice.
