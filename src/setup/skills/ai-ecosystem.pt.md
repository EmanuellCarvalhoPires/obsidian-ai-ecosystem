---
name: configurar-ai-ecosystem
description: "Configura o núcleo do AI Ecosystem neste cofre (agentes usados, arquivo de settings dos hooks, modo dos hooks e bloco de guia no CLAUDE.md). Use quando um aviso de início de sessão pedir ou quando o usuário pedir para configurar o AI Ecosystem. É a primeira rodada de qualquer instalação de módulo."
---

# Configurar o AI Ecosystem (núcleo)

Esta é a primeira rodada de qualquer instalação: os módulos só concluem a configuração depois dela. O AI Ecosystem é o servidor que dá aos agentes as tools dos plugins do Obsidian, e os hooks do Claude Code mantêm o agente nelas. Aqui o usuário escolhe como isso se comporta neste cofre.

{{COMMON}}

## Perguntas do núcleo

Nesta ordem, em uma rodada de até quatro perguntas (as de `perguntas` que ainda faltam):

1. `agentes` (várias escolhas): quais agentes de IA o usuário usa com este cofre. Opções: Claude Code, Antigravity, Codex, Cursor. Quem usa outro escolhe "Other". O valor gravado é a lista dos nomes em minúsculas, com os de "Other" como foram escritos. Se `detectado.nucleo.clientes` já mostra clientes cadastrados, use-os como dica para a recomendação. Ao salvar a resposta, o AI Ecosystem conecta automaticamente os clientes de IA selecionados ao servidor MCP local deste cofre.
2. `arquivo_settings` (uma escolha): onde gravar as entradas dos hooks. A pergunta é se o cofre é sincronizado ou está em git e se as entradas devem ir junto. Veja em `detectado.nucleo.git` e `detectado.nucleo.sincronizacao` o que o plugin achou e diga isso na pergunta.
   - `settings.local.json` (Recomendado): só nesta máquina, fora do git e da sincronização.
   - `settings.json`: compartilhado. Só quando o usuário quer os hooks no git para uma equipe. Os comandos levam o caminho deste cofre e o plugin reescreve o caminho em cada máquina quando roda, então cada pessoa precisa do AI Ecosystem instalado.
3. `modo_hooks` (uma escolha): como os hooks de proteção reagem quando o agente tenta o caminho errado.
   - `bloquear` (Recomendado): nega a chamada e aponta a tool certa.
   - `avisar`: deixa passar e lembra a tool certa.
   - `off`: não faz nada.
4. `claude_md` (uma escolha): o usuário permite que o agente mantenha o bloco de guia de uso no `CLAUDE.md`? Olhe `claude_md.existe` no status.
   - Se o arquivo existe: `permitido` (Recomendado) ou `recusado`.
   - Se não existe: `criar` (Recomendado), que cria o arquivo só com o bloco, ou `recusado`.
   Diga que o plugin nunca grava no `CLAUDE.md`: quem edita é o agente, só o trecho entre os marcadores, com a permissão dada aqui.

Mostre também, no resumo, o que foi detectado: se existem `CLAUDE.md` e `GEMINI.md`, os módulos instalados (`detectado.nucleo.modulos`) e o arquivo de settings em uso.

## Etapas depois do resumo

1. Grave as quatro respostas com `ecosystem_setup_save`. `agentes` leva a lista, `modo_hooks` vale para todos os módulos e `arquivo_settings` move as entradas dos hooks para o arquivo escolhido.
2. Se `claude_md` for `permitido` ou `criar`, grave o bloco no `CLAUDE.md` como descrito na seção "Bloco de guia no CLAUDE.md".
3. Chame `ecosystem_setup_complete` com `modulo: "ai-ecosystem"`.
4. Diga ao usuário que, para instalar mais módulos, basta usar o catálogo do plugin: cada um traz a sua própria configuração, e o bloco do `CLAUDE.md` é refeito com todos eles.
