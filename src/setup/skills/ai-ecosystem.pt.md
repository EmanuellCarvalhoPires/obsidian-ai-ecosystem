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
4. `claude_md` (uma escolha): o que fazer com o `CLAUDE.md` do cofre. Olhe `claude_md.existe` no status.
   - Se o arquivo existe: **Atualizar o existente** (Recomendado), que grava o valor `permitido`; **Criar do zero**, que também grava `permitido` e segue a seção "CLAUDE.md do cofre"; ou **Não mexer**, que grava `recusado`.
   - Se não existe: `criar` (Recomendado), que cria um `CLAUDE.md` novo, ou `recusado`.
   Diga que o plugin nunca grava no `CLAUDE.md`: quem edita é o agente, só o bloco entre os marcadores e a seção "Mapa do cofre", com a permissão dada aqui.

Mostre também, no resumo, o que foi detectado: se existem `CLAUDE.md` e `GEMINI.md`, os módulos instalados (`detectado.nucleo.modulos`) e o arquivo de settings em uso. Se a resposta de `claude_md` for criar um arquivo novo, diga no resumo que o rascunho será mostrado antes de gravar.

## CLAUDE.md do cofre

Esta seção vale só para o núcleo: os outros módulos apenas atualizam o bloco. Ela cobre os dois caminhos da pergunta `claude_md` e é executada na etapa 2 de "Etapas depois do resumo".

**Atualizar o existente (`permitido`):**
- Atualize o bloco como na seção "Bloco de guia no CLAUDE.md".
- Faça também o mapa de pastas (seção "Mapa de pastas do cofre"): se o arquivo ainda não tem uma seção "Mapa do cofre", acrescente-a antes do bloco, e se já tem, só corrija o que mudou. Essa seção e o bloco são as únicas partes alteradas: o resto do arquivo não é tocado.

**Criar do zero, ou criar porque não existe arquivo (`criar`):**
1. Se o arquivo já existe, **não o apague nem o mova**: copie o conteúdo inteiro para `CLAUDE.backup-AAAA-MM-DD.md` na mesma pasta (se esse nome existir, acrescente `-2`, `-3`...) e avise o usuário onde ficou a cópia. Só então o arquivo será substituído.
2. Faça o mapa de pastas (seção "Mapa de pastas do cofre") e monte o rascunho com o esqueleto abaixo.
3. **Confirme a criação** antes de gravar: mostre o rascunho (as seções e o mapa de pastas) e peça a confirmação com `AskUserQuestion`, com "Criar o CLAUDE.md" como primeira opção (Recomendado), "Ajustar antes" e "Cancelar". Em "Ajustar antes", corrija o que o usuário pedir e confirme de novo. Em "Cancelar", não grave nada, chame `ecosystem_setup_save` com `claude_md` = `recusado` e avise o usuário.
4. Com o sim, grave o arquivo com o Write.

**Esqueleto do `CLAUDE.md` novo.** Siga o modelo do `CLAUDE.md` do cofre do autor do plugin: enxuto de propósito, porque é lido a cada chamada, inclusive pelos subagentes. Os procedimentos longos ficam em notas de referência, lidas só quando a tarefa pedir (por exemplo em `Knowledge/Referências do Cofre/`), e não são copiados de volta para o arquivo. Escreva no idioma da skill e adapte ao cofre, sem inventar o que o plugin não detectou. Seções, nesta ordem:
1. `# CLAUDE.md — <nome do cofre>`, com um parágrafo: este diretório é um cofre do Obsidian, a base de dados do usuário e a fonte principal de contexto sobre ele; mais um aviso de que o arquivo é enxuto de propósito.
2. `## Mapa do cofre`: o mapa de pastas, seguido do parágrafo "Manter o mapa em dia": sempre que identificar uma mudança nessa estrutura (pasta criada, renomeada, movida, apagada ou com outra função), atualizar o mapa no mesmo momento, sem pedir permissão, e avisar em uma linha o que mudou. Se a mudança também afetar as pastas fora do índice de busca, avisar o usuário.
3. `## Regra geral: SEMPRE a suíte AI Ecosystem`: para qualquer solicitação, usar primeiro as tools da suíte (a tabela do bloco diz qual), antes de Grep, Glob, Bash, PowerShell ou `curl`; perguntar "qual plugin cobre isso?". `find` acha por nome, `search` busca conteúdo e `get_section` lê só o trecho necessário. Se a tool falhar, ler o erro, corrigir os argumentos e chamar de novo; o terminal só com indisponibilidade comprovada (Obsidian fora do ar).
4. Só se o usuário já tiver o assunto no cofre (confira em `detectado`): uma seção curta para cada coisa que o cofre usa, sem copiar o que o bloco já diz. Por exemplo, as notas com molde (só por `create_note_from_template`), os scripts (só por `ecosystem_run_script`), o log da conversa (criado pelo plugin) e os fluxos automatizados.
5. O bloco de guia entre os marcadores, no fim, exatamente como veio em `bloco_claude_md`.

## Mapa de pastas do cofre

1. Leia a estrutura com `list_folders` (ou `find`): as pastas da raiz e um nível abaixo de cada uma, sem as pastas ocultas (`.obsidian`, `.claude`, `.git`) nem `node_modules`. Para entender a função de uma pasta, olhe o nome e uma ou duas notas dentro dela com `get_section`.
2. Escreva uma linha por pasta, no formato ``- `Pasta/`: para que serve.``, e uma linha só para as subpastas que explicam melhor a pasta mãe. Pasta de função duvidosa: pergunte ao usuário na mesma rodada de confirmação, em vez de chutar.
3. Em um cofre vazio, ou com poucas pastas, o mapa lista só o que existe; as pastas novas entram depois da seção "Estrutura de pastas para os módulos".

## Estrutura de pastas para os módulos

Depois do mapa, pense em uma estrutura de pastas para o cofre e **sugira a criação** das pastas que os módulos vão usar no futuro. Nada é criado sem a aprovação do usuário.

1. Parta do que o cofre já tem: se existe uma pasta equivalente (por exemplo `Anexos/`, `Templates/` ou `Projetos/`), reaproveite-a e não sugira outra com o mesmo papel. Sugira só as que faltam, no máximo uma por função. Entre as candidatas, para os módulos instalados e os que o plugin oferece no catálogo:
   - `Templates/AI/` para os moldes do AI Templates.
   - `Scripts/AI/` para os scripts do AI Scripts.
   - `Knowledge/Logs/` para os logs de conversa do AI Log Manager.
   - `Projetos/` com uma pasta por projeto de desenvolvimento, para o AI Git Tools e para os logs e changelogs de projeto.
   - `MCP/` (ou a pasta das notas de tools que o Environment Keys detectou) para acessos e referências de serviços.
   - `Anexos/` e `Arquivo/`, que costumam ficar fora do índice de busca.
2. Mostre a lista como uma tabela (pasta, módulo que vai usá-la, motivo) e pergunte com `AskUserQuestion` de múltipla escolha quais criar, com as recomendadas primeiro. A opção "Other" permite pedir outra pasta ou outro nome.
3. Crie só as pastas escolhidas, com as ferramentas de arquivos do agente (uma pasta vazia basta; não crie notas dentro delas). Se o `CLAUDE.md` foi criado ou atualizado, acrescente as pastas novas ao "Mapa do cofre" com a marca "(reservada para o módulo X)".
4. Diga em uma linha que o Obsidian e o git não guardam pasta vazia: elas só ficam no git depois que ganham um arquivo, mas já valem como destino para os módulos.

## Etapas depois do resumo

1. Grave as quatro respostas com `ecosystem_setup_save`. `agentes` leva a lista, `modo_hooks` vale para todos os módulos e `arquivo_settings` move as entradas dos hooks para o arquivo escolhido.
2. Se `claude_md` for `permitido` ou `criar`, siga a seção "CLAUDE.md do cofre": atualize o existente, ou crie o novo com o backup, o mapa de pastas e a confirmação.
3. Siga a seção "Estrutura de pastas para os módulos": sugira as pastas, crie as aprovadas e acrescente-as ao mapa. Se `claude_md` foi `recusado`, a sugestão vale mesmo assim, só sem mexer no arquivo.
4. Chame `ecosystem_setup_complete` com `modulo: "ai-ecosystem"`.
5. Diga ao usuário que, para instalar mais módulos, basta usar o catálogo do plugin: cada um traz a sua própria configuração, e o bloco do `CLAUDE.md` é refeito com todos eles.
