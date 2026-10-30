---
name: configurar-ai-templates
description: "Configura o AI Templates do AI Ecosystem (pasta dos moldes, regra de colisão de nomes e migração dos moldes que já existem no cofre, sem alterar os originais). Use quando um aviso de início de sessão pedir ou quando o usuário pedir para configurar o AI Templates."
---

# Configurar o AI Templates

O AI Templates preenche moldes Markdown com dados em JSON e devolve notas com tabelas alinhadas, imagens na pasta certa e o arquivo salvo onde o molde manda. Os hooks de proteção redirecionam para o plugin quem tenta escrever direto uma nota que tem molde.

Pré-requisito: o núcleo (`ai-ecosystem`) configurado. Se `pre_requisitos` mostrar que não, execute primeiro a skill `configurar-ai-ecosystem` e volte.

{{COMMON}}

## Perguntas do AI Templates

O plugin não tem configuração de pasta padrão das notas novas, de formato de data nem de fuso: esses valores vêm de cada molde. **Não pergunte nenhum dos três.**

Nesta ordem:

1. `pasta_de_templates` (texto, `salvar: true`): a pasta do cofre onde ficam os moldes. Se `detectado.modulo.templatesFolder` já existe e tem moldes (`templateCount`), já está detectada: mostre no resumo.
2. `regra_de_colisao` (uma escolha, `salvar: true`): o que fazer quando já existe uma nota com o nome que o molde gerou.
   - `incremental` (Recomendado): cria `Nome 1`, `Nome 2`..., sem perder nada.
   - `error`: recusa e avisa.
   - `overwrite`: sobrescreve a nota existente.
3. `migrar_templates` (sim ou não, `salvar: false`): existem moldes dentro do cofre, em notas comuns, que o usuário queira transformar em templates do AI Templates? Se sim, siga a seção de migração.

## Migração dos moldes existentes

Só se o usuário disse que sim em `migrar_templates`. **As notas originais não são alteradas, movidas nem apagadas.**

1. Pergunte, com `AskUserQuestion`, se pode fazer uma **busca completa** de moldes no cofre. Se não, pule a migração.
2. Busque com as tools do AI Vault Search (`search`, `find`, `list_files`, `list_folders`), não com Grep ou Glob: pastas de moldes e templates, notas com placeholders (`{{...}}`, `<% ... %>`) e as listadas em `list_templates` (essas já existem: ignore-as).
3. Para cada molde encontrado, leia a nota e **extraia os campos** (nome, tipo e se é obrigatório). Para o formato esperado, chame `list_templates` e `get_template_schema` em um template que já exista; se não houver nenhum, siga o que `create_template` descreve.
4. Mostre, molde por molde, os campos extraídos e o caminho de destino sugerido, e peça a **aprovação** com `AskUserQuestion` (aprovar, ajustar ou pular cada um). Ajuste o que o usuário pedir.
5. Só depois de aprovado, crie cada template com `create_template`. Confira com `list_templates` e com `preview_template` (dados de exemplo) que o resultado sai como a nota original.
6. Diga quais moldes ficaram de fora e por quê.

## Etapas depois do resumo

1. Grave `pasta_de_templates` e `regra_de_colisao` com `ecosystem_setup_save`.
2. Faça a migração, se houve.
3. Atualize o bloco do `CLAUDE.md` e chame `ecosystem_setup_complete` com `modulo: "ai-templates"`.
