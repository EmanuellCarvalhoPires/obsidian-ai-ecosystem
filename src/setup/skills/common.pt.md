## Como conduzir a configuração

1. Chame `ecosystem_setup_status` com `modulo: "{{ID}}"`. O resultado traz o que o plugin já detectou (`detectado`), as respostas já gravadas (`respostas`), as `perguntas` (cada uma com `ja_respondida` e `detectada`), os `pre_requisitos`, o estado do `CLAUDE.md` (`claude_md`) e o bloco de guia pronto (`bloco_claude_md`).
2. Pré-requisitos: se algum item de `pre_requisitos` estiver com `ok: false`, resolva-o antes (as instruções do módulo dizem como) e só então volte a este passo.
3. Pergunte **somente** o que o plugin não detectou e o usuário ainda não respondeu: perguntas com `ja_respondida: false` e `detectada: false`. As com `detectada: true` não são perguntadas: mostre o `valor_detectado` no resumo final para o usuário confirmar ou corrigir.
4. Faça as perguntas **uma rodada por vez**, na ordem da lista, com a ferramenta de perguntas clicáveis `AskUserQuestion`: de 1 a 4 perguntas por chamada, de 2 a 4 opções por pergunta, a opção recomendada sempre primeiro e com "(Recomendado)" no rótulo. A opção "Other" (Outros) aparece sozinha. O `AskUserQuestion` não existe em subagentes: nunca delegue a entrevista.
   - **Plano B:** se o `AskUserQuestion` for negado (por exemplo, por um hook de autorização do usuário), falhar ou não existir, não pare e não grave nada por conta própria. Faça a mesma rodada no próprio chat: cada pergunta numerada, as opções numeradas (a recomendada primeiro, marcada "(Recomendado)"), mais a opção de responder com outro valor. Peça uma resposta curta (por exemplo "1a, 2b") e espere. Use o mesmo plano B para o resumo e para a permissão do `CLAUDE.md`: o "sim" do usuário no chat vale como confirmação.
5. Se uma resposta vier ambígua ou incompleta e a skill `grill-me` existir, use-a para esclarecer. Sem ela, faça uma pergunta de acompanhamento.
6. Quando as perguntas acabarem, mostre um **resumo** (o que foi detectado e o que foi respondido) e peça a confirmação com `AskUserQuestion`, com "Confirmar e aplicar" como primeira opção.
7. Só depois do sim, chame `ecosystem_setup_save` uma vez por resposta (`modulo`, `chave`, `valor`), pulando as perguntas com `salvar: false`. Faça as etapas específicas do módulo que vêm depois do resumo, atualize o bloco do CLAUDE.md (seção abaixo) e, por fim, chame `ecosystem_setup_complete` com `modulo: "{{ID}}"`. Se uma dessas ferramentas recusar algo, leia o motivo, acerte com o usuário e tente de novo.
8. Termine dizendo o que ficou configurado. Avise que os hooks e as tools novas valem para sessões novas (ou depois de reiniciar a sessão) e que esta configuração não será pedida de novo.

## Regras que não mudam

- **Nunca peça token, senha, chave de API ou qualquer segredo no chat.** Se o usuário colar um, não repita o valor, não o grave em lugar nenhum e peça para ele trocar essa credencial. Segredos entram só pela tela `env_criar_secret`, que o usuário preenche no Obsidian.
- Não use o terminal, nem leia ou edite os arquivos de `.claude/ai-ecosystem/`, para contornar um problema. Se uma ferramenta de que esta skill precisa (`ecosystem_setup_status`, `ecosystem_setup_save`, `ecosystem_setup_complete` ou outra) não estiver na sua lista de ferramentas, peça ao usuário para reiniciar a sessão do Claude Code e tente de novo depois.
- Nunca apague nem mova arquivos do usuário.

## Bloco de guia no CLAUDE.md

O resultado do status traz o bloco pronto em `bloco_claude_md`, já com os marcadores `<!-- ai-ecosystem:start -->` e `<!-- ai-ecosystem:end -->`, e `claude_md` diz se o arquivo existe (`existe`), onde está (`caminho`), se já tem o bloco (`tem_bloco`) e o que o usuário já permitiu (`permissao`: `permitido`, `criar` ou `recusado`).

- Se `permissao` for `permitido` ou `criar`, atualize o bloco sem perguntar de novo e avise o usuário em uma linha. Se for `recusado`, não toque no arquivo. Se não houver permissão registrada, peça uma vez com `AskUserQuestion`.
- **Arquivo existente:** leia o arquivo inteiro. Se ele já tem os marcadores, troque só o trecho entre eles (os marcadores incluídos) pelo `bloco_claude_md`. Se não tem, acrescente o bloco no fim do arquivo, depois de uma linha em branco. O resto do arquivo não é tocado, nem um espaço.
- **Arquivo inexistente:** só crie se o usuário permitiu (`criar`). O arquivo novo contém apenas o bloco.
- Use as ferramentas de leitura e edição de arquivos (Read e Edit, ou Write para o arquivo novo), não uma busca no cofre.
