---
name: configurar-ai-scripts
description: "Configura o AI Scripts do AI Ecosystem (linguagens, pastas permitidas de scripts, gravação fora do cofre e migração dos scripts que já existem no cofre, sem apagar os originais). Use quando um aviso de início de sessão pedir ou quando o usuário pedir para configurar o AI Scripts."
---

# Configurar o AI Scripts

O AI Scripts cadastra, categoriza e executa scripts locais com validação de parâmetros. Os scripts só rodam das pastas que o usuário permitiu, e os hooks de proteção redirecionam para o plugin quem tenta rodar um desses scripts direto no terminal.

Pré-requisito: o núcleo (`ai-ecosystem`) configurado. Se `pre_requisitos` mostrar que não, execute primeiro a skill `configurar-ai-ecosystem` e volte.

{{COMMON}}

## Perguntas do AI Scripts

Nesta ordem:

1. `linguagens` (`salvar: false`): as linguagens de script que o usuário usa. O plugin detecta por extensão (`detectado.nucleo.scripts_no_cofre`) e pelos scripts já cadastrados (`detectado.modulo.languages`). Se achou, não pergunte: mostre no resumo. Se não achou nada, pergunte (Python, Node, Bash, PowerShell). Serve só para orientar o resto.
2. `pastas_permitidas` (várias escolhas, `salvar: true`): as pastas do cofre de onde os scripts podem rodar. Mostre as detectadas (`detectado.nucleo.scripts_no_cofre`, com o número de arquivos de cada pasta, e as que já estão permitidas) e deixe o usuário escolher. A resposta só acrescenta pastas às já permitidas, nunca tira. Só vale durante esta configuração, só aceita pastas que existem no cofre (nunca a raiz, `.claude` nem a pasta de configuração do Obsidian) e o usuário vê um aviso no Obsidian com as pastas acrescentadas. Depois da configuração, essas pastas mudam só nas configurações do AI Ecosystem. O valor gravado é a lista de caminhos relativos ao cofre.
3. `pasta_de_scripts` (texto, `salvar: true`): a pasta onde o AI Scripts guarda os scripts cadastrados. Se `detectado.modulo.scriptsFolder` já existe e tem scripts (`scriptCount`), já está detectada.
4. `pode_gravar_fora_do_cofre` (sim ou não, `salvar: true`): os scripts podem gravar arquivos fora do cofre? Recomende "não" e explique o risco em uma linha.
5. `migrar_scripts` (sim ou não, `salvar: false`): existem scripts dentro do cofre que o usuário queira migrar para o AI Scripts? Se sim, siga a seção de migração.

## Migração dos scripts existentes

Só se o usuário disse que sim em `migrar_scripts`. Tudo aqui é aditivo: **nenhum arquivo original é apagado, movido ou alterado.**

1. Pergunte, com `AskUserQuestion`, se pode fazer uma **busca completa** de scripts no cofre. Se não, pule a migração.
2. Busque com as tools do AI Vault Search (`search`, `find`, `list_files`, `list_folders`), não com Grep ou Glob. Procure arquivos `.py`, `.js`, `.mjs`, `.sh` e `.ps1` e as notas que descrevem scripts. Se o AI Vault Search não estiver instalado, use `ecosystem_list_scripts` e peça ao usuário as pastas a olhar.
3. Liste o que é reaproveitável: caminho, linguagem e uma linha sobre o que o script faz (leia o começo de cada um). Deixe o usuário marcar quais migrar.
4. **Varra segredos no código** dos marcados: tokens, senhas, chaves de API, cabeçalhos `Authorization`, URLs com usuário e senha. Mostre só o arquivo, a linha e o nome da variável, **nunca o valor**. Para cada achado, proponha trocar o valor por `{{secret:NOME}}`. As secrets são criadas com a tool `env_criar_secret` (o Environment Keys precisa estar instalado e configurado), uma por vez, com o usuário digitando o valor na tela. Os originais não são editados: o registro novo aponta para o script e a troca por `{{secret:NOME}}` vale para quem usa a cópia registrada ou o ambiente do script, e o usuário decide depois se ajusta o original.
5. Mostre o plano completo (scripts, categorias, parâmetros e secrets) e peça a **permissão** com `AskUserQuestion` antes de criar qualquer registro.
6. Para registrar, siga o formato que o AI Scripts já usa: chame `list_ai_scripts` e `get_script_schema` em um script já cadastrado e copie a estrutura. Se não houver nenhum cadastrado para copiar, avise o usuário e ofereça cadastrar o primeiro pelas configurações do AI Scripts.
7. Confirme com `list_ai_scripts` que os novos registros aparecem e diga quais ficaram de fora e por quê.

## Etapas depois do resumo

1. Grave as respostas com `salvar: true`. `pastas_permitidas` atualiza as pastas permitidas do Script Engine do núcleo e os hooks de proteção passam a cobrir essas pastas.
2. Faça a migração, se houve.
3. Atualize o bloco do `CLAUDE.md` e chame `ecosystem_setup_complete` com `modulo: "ai-scripts"`.
