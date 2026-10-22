---
name: configurar-ai-git-tools
description: "Configura o AI Git Tools do AI Ecosystem (modo do hook de git, secrets do Bitbucket e do GitHub e pasta dos projetos). Use quando um aviso de início de sessão pedir ou quando o usuário pedir para configurar o AI Git Tools."
---

# Configurar o AI Git Tools

O AI Git Tools concentra o git local (status, diff, log, commit, push, branch, merge, stash, tag, clone) e as APIs do GitHub e do Bitbucket (abrir, listar, comentar e mesclar PR; ver pipeline) em tools da suíte, e documenta sozinho o histórico de cada projeto em notas (`Eventos/`, `Changelogs/` e o grafo do repositório). Nenhuma tool faz operação destrutiva (sem `push --force`, `reset --hard`, `rebase` ou apagar branch), e `git_pr_merge` sempre pede a aprovação do usuário, qualquer que seja o modo do hook.

Pré-requisito: o núcleo (`ai-ecosystem`) configurado. Se `pre_requisitos` mostrar que não, execute primeiro a skill `configurar-ai-ecosystem` e volte.

{{COMMON}}

## Perguntas do AI Git Tools

Nesta ordem. Mostre no resumo o que o plugin detectou: as secrets encontradas (`detectado.modulo.secrets`, só nomes e tipos, nunca valores) e a pasta dos projetos (`detectado.modulo.projectsRoot`).

1. `modo_hooks` (uma escolha, `salvar: true`, tratada pelo núcleo): como o hook reage quando o agente usa `git`, `gh` ou `curl`/`Invoke-RestMethod` contra as APIs do GitHub e do Bitbucket pelo terminal em vez das tools.
   - `avisar` (Recomendado): a chamada segue e o agente recebe o lembrete de usar a tool. **Avise que, neste modo, um comando git digitado no terminal passa, inclusive um destrutivo**: só o prompt normal de permissão do Claude o segura.
   - `bloquear`: nega a chamada e aponta a tool.
   - `off`: sem hook de aviso. A trava de aprovação do `git_pr_merge` continua ligada.
2. `secret_bitbucket` (uma escolha, `salvar: true`): a secret usada nas APIs do Bitbucket (PR e pipeline). As opções são as secrets detectadas, mais `nenhuma`.
3. `secret_github` (uma escolha, `salvar: true`): a secret usada nas APIs do GitHub (PR e pipeline). As opções são as secrets detectadas, mais `nenhuma`.
4. `pasta_dos_projetos` (texto, `salvar: true`): a pasta do cofre com uma pasta por projeto de desenvolvimento (notas `#dev/projeto` com o clone local). Se `detectado.modulo.projectsRootExists` for verdadeiro, já está detectada: mostre no resumo.
5. `claude_md`: é a pergunta do núcleo (permissão para atualizar o bloco de guia). Só pergunte se `claude_md.permissao` ainda não estiver registrada; siga a seção "Bloco de guia no CLAUDE.md" acima.

### Regras das perguntas de secret

- Mostre as opções exatamente como vêm em `perguntas`: **nenhuma secret é marcada como recomendada** e você **não sugere nenhum nome**. O usuário escolhe.
- Sempre ofereça a opção "Nenhuma (configurar depois)" (valor `nenhuma`). Escolher `nenhuma` grava string vazia e **não impede** o `ecosystem_setup_complete`: o módulo fica ativo, as tools de git local funcionam e só as tools de PR e pipeline daquele provedor respondem `secret_nao_configurada` até uma secret ser escolhida nas configurações do plugin.
- Se houver mais de 3 secrets detectadas, faça a pergunta no plano B (lista numerada no chat), para que todas apareçam junto com "Nenhuma".
- **Nunca peça o token.** Se o usuário quiser criar uma secret nova, mande usar a tela `env_criar_secret` (o usuário digita o valor no Obsidian, permitindo o host `api.bitbucket.org` ou `api.github.com`); depois chame `ecosystem_setup_status` de novo e refaça a pergunta com a lista atualizada.

## Etapas depois do resumo

1. Grave as respostas com `ecosystem_setup_save`, na ordem (`modo_hooks`, `secret_bitbucket`, `secret_github`, `pasta_dos_projetos`). Para uma secret não escolhida, grave o valor `nenhuma`.
2. Atualize o bloco do `CLAUDE.md` e chame `ecosystem_setup_complete` com `modulo: "ai-git-tools"`. Secret vazia não bloqueia a conclusão.
3. Diga, em uma linha cada: que git, PR e pipeline passam pelas tools `git_*` e o histórico do projeto vira nota sozinho; que `git_pr_merge` sempre pergunta "Posso fazer o merge do PR #N para a branch XYZ?" antes de mesclar; qual o modo do hook escolhido (e, se for `avisar`, que um comando digitado no terminal passa); e, se alguma secret ficou como "Nenhuma", que ela pode ser escolhida depois nas configurações do AI Git Tools.
