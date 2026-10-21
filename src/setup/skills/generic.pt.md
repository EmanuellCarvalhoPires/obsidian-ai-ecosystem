---
name: configurar-{{ID}}
description: "Configura o módulo {{NAME}} do AI Ecosystem. Use quando um aviso de início de sessão pedir ou quando o usuário pedir para configurar o {{NAME}}."
---

# Configurar o {{NAME}}

Este módulo não traz perguntas próprias. A configuração confere o que o plugin detectou, grava as respostas que o módulo aceitar e conclui.

Pré-requisito: o núcleo (`ai-ecosystem`) configurado. Se `pre_requisitos` mostrar que não, execute primeiro a skill `configurar-ai-ecosystem` e volte.

{{COMMON}}

## Perguntas do módulo

Siga a lista `perguntas` do status. Se ela vier vazia, mostre no resumo o que o módulo detectou (`detectado.modulo`) e peça só a confirmação para concluir.
