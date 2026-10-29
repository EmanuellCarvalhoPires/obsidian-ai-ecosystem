# Plano de implementação: itens aceitos da auditoria do AI Ecosystem (núcleo)

## Sumário
- Etapa 1: Teto de saída do ecosystem_run_script (MCP) (linhas 98-192)
- Etapa 2: Mesmo teto na rota REST /scripts/run (linhas 194-272)
- Etapa 3: ecosystem_status compacto (linhas 274-362)
- Etapa 4: script_id como alias no ecosystem_run_script (linhas 364-458)
- Etapa 5: Lote genérico no tools_run (linhas 460-550)
- Etapa 6: Diagnóstico percebe módulo defasado (linhas 552-642)
- Etapa 7: ecosystem_run_script respeita o cancelamento (linhas 644-719)
- Etapa 8: Remover a entrada de aprovação do tools_run das settings (linhas 721-811)
- Etapa 9: Limpar o código morto de execucao no script de hooks (linhas 813-897)
- Etapa 10: Corrigir os textos que ainda falam de aprovação do tools_run (linhas 899-981)
- Etapa 11: Podar e truncar o activity.sqlite (linhas 983-1069)
- Etapa 12: Texto da tela do inspetor e caminho pelo configDir (linhas 1071-1149)
- Etapa 13: ecosystem_setup_status sem bloco e perguntas quando já configurado (linhas 1151-1239)
- Etapa 14: ecosystem_list_scripts só com caminhos (linhas 1241-1321)
- Etapa 15: ecosystem_diagnostico só com avisos e contagem (linhas 1323-1407)
- Etapa 16: Hook de resumo dos módulos no início da sessão (linhas 1409-1500)
- Etapa 17: Ajustar os testes afetados pelo hook de resumo (linhas 1502-1586)
- Etapa 18: Fundir tela_criar e tela_editar em tela_gerenciar (linhas 1588-1682)
- Etapa 19: Atualizar textos e README que citam tela_criar e tela_editar (linhas 1684-1770)
- Etapa 20: Ajustar os testes de telas para tela_gerenciar (linhas 1772-1858)
- Etapa 21: Opção do servidor MCP para esconder tools do tools/list no modo completo (linhas 1860-1942)
- Etapa 22: Esconder as tools de setup do tools/list quando não há pendência (linhas 1944-2028)
- Etapa 23: ecosystem_setup_save em lote (linhas 2030-2112)
- Etapa 24: Descrição curta do ecosystem_run_script com as regras na mensagem de recusa (linhas 2114-2196)
- Etapa 25: Só marcar falha do módulo quando ele lança exceção ou está indisponível (linhas 2198-2288)
- Etapa 26: Hook de falha ignora erro de argumento e lote (linhas 2290-2366)
- Etapa 27: Catálogo compara a versão do manifest, não a tag (linhas 2368-2450)
- Etapa 28: Refatorar a proteção do script em avaliar e aplicar (linhas 2452-2534)
- Etapa 29: Tipo despacho no script e DISPATCH_SPEC (linhas 2536-2628)
- Etapa 30: Hook manager instala o despachante único e migra as entradas antigas (linhas 2630-2722)
- Etapa 31: Ajustar e ampliar os testes do hook manager para o despachante (linhas 2724-2812)
- Etapa 32: Documentar as mudanças no README (inglês e português) (linhas 2814-2900)
- Etapa 33: Verificação geral (linhas 2902-2986)

## 1. Objetivo
Implementar, no plugin AI Ecosystem (núcleo), os 16 itens aceitos da auditoria: economia de tokens nas respostas das tools, executor de scripts mais robusto, diagnóstico melhor, hooks mais leves e documentação verdadeira.
Está pronto quando `npx tsc --noEmit`, `npx vitest run`, `npx eslint .` (0 erros) e `npm run build` passam e cada um dos 16 itens tem comportamento testado.

## 2. Contexto completo
- **Projeto:** plugin do Obsidian AI Ecosystem em TypeScript (esbuild, vitest, eslint com eslint-plugin-obsidianmd). Raiz: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem`. Não há CLAUDE.md na raiz; as convenções saem do código e do README.
- **Estado atual:** servidor MCP/REST em `src\server`, executor de scripts em `src\runner`, tools do núcleo em `src\core`, `src\setup`, `src\screens` e `src\tool-index`, hooks do Claude Code em `src\hooks` (script `src\hooks\script\ai-ecosystem-hook.mjs`), inspetor em `src\inspector`, catálogo em `src\catalog`. Linha de base: tsc sem erros, 918 testes passando, eslint com 0 erros e 19 avisos.
- **Motivação:** auditoria do ecossistema encontrou respostas de tools grandes demais, falhas silenciosas (processos órfãos, proteção desligada por erro de argumento, módulo defasado sem aviso), arquivos crescendo sem limite, código morto e textos falsos, e seis processos Node por comando de shell.
- **Fora do escopo:** alterar outros plugins (AI Scripts, Git Tools etc.); verificar `.deploy-target` de outros módulos; mudar o contrato REST de GET /status e GET /scripts; commit, push e deploy.

## 3. Regras globais de implementação
- Idioma: o código, os comentários e os nomes de identificadores ficam em inglês (como já está nos arquivos); as mensagens do diagnóstico, do hook e dos achados ficam em português quando o arquivo já estiver em português; o README tem uma parte em inglês e uma em português espelhadas.
- Estilo do código: TypeScript estrito, 2 espaços, aspas duplas, ponto e vírgula, `import type` para tipos, sem dependências novas e sem alterar package.json.
- Os diretórios src/runner, src/server, src/registry, src/hooks, src/core, src/setup, src/tool-index são código Node puro: não importam o pacote "obsidian".
- O script src/hooks/script/ai-ecosystem-hook.mjs é Node puro, sem dependências, e nunca pode atrapalhar o agente: qualquer problema termina com saída 0 e sem texto.
- Comandos, sempre a partir de C:\Users\Trabalho\Documents\obsidian-ai-ecosystem: typecheck `npx tsc --noEmit`; testes `npx vitest run` (um arquivo: `npx vitest run tests\pasta\arquivo.test.ts`); lint `npx eslint .`; build `npm run build`.
- Linha de base antes das mudanças: tsc sem erros; 54 arquivos de teste e 918 testes passando; eslint com 0 erros e 19 avisos (nenhum erro ou aviso novo pode surgir).
- Cada etapa altera só os arquivos listados nela. Não faça commit, push, deploy nem mexa na pasta .git; não rode `npm install`; não escreva nem leia segredos, tokens ou arquivos .env.
- Se algo não bater com o descrito (arquivo, função ou assinatura inexistente, teste quebrado por motivo alheio à etapa), pare e relate em vez de improvisar.

## 4. Mapa das etapas
| # | Etapa | Esforço | Depende de | Paralelizável com |
| --- | --- | --- | --- | --- |
| 1 | Teto de saída do ecosystem_run_script (MCP) | médio | nenhuma | nenhuma |
| 2 | Mesmo teto na rota REST /scripts/run | baixo | Etapa 1 | nenhuma |
| 3 | ecosystem_status compacto | médio | Etapa 2 | nenhuma |
| 4 | script_id como alias no ecosystem_run_script | alto | Etapa 3 | nenhuma |
| 5 | Lote genérico no tools_run | alto | Etapa 4 | nenhuma |
| 6 | Diagnóstico percebe módulo defasado | alto | Etapa 5 | nenhuma |
| 7 | ecosystem_run_script respeita o cancelamento | médio | Etapa 6 | nenhuma |
| 8 | Remover a entrada de aprovação do tools_run das settings | alto | Etapa 7 | nenhuma |
| 9 | Limpar o código morto de execucao no script de hooks | médio | Etapa 8 | nenhuma |
| 10 | Corrigir os textos que ainda falam de aprovação do tools_run | baixo | Etapa 9 | nenhuma |
| 11 | Podar e truncar o activity.sqlite | médio | Etapa 10 | nenhuma |
| 12 | Texto da tela do inspetor e caminho pelo configDir | baixo | Etapa 11 | nenhuma |
| 13 | ecosystem_setup_status sem bloco e perguntas quando já configurado | médio | Etapa 12 | nenhuma |
| 14 | ecosystem_list_scripts só com caminhos | médio | Etapa 13 | nenhuma |
| 15 | ecosystem_diagnostico só com avisos e contagem | médio | Etapa 14 | nenhuma |
| 16 | Hook de resumo dos módulos no início da sessão | alto | Etapa 15 | nenhuma |
| 17 | Ajustar os testes afetados pelo hook de resumo | alto | Etapa 16 | nenhuma |
| 18 | Fundir tela_criar e tela_editar em tela_gerenciar | alto | Etapa 17 | nenhuma |
| 19 | Atualizar textos e README que citam tela_criar e tela_editar | baixo | Etapa 18 | nenhuma |
| 20 | Ajustar os testes de telas para tela_gerenciar | médio | Etapa 19 | nenhuma |
| 21 | Opção do servidor MCP para esconder tools do tools/list no modo completo | médio | Etapa 20 | nenhuma |
| 22 | Esconder as tools de setup do tools/list quando não há pendência | alto | Etapa 21 | nenhuma |
| 23 | ecosystem_setup_save em lote | médio | Etapa 22 | nenhuma |
| 24 | Descrição curta do ecosystem_run_script com as regras na mensagem de recusa | médio | Etapa 23 | nenhuma |
| 25 | Só marcar falha do módulo quando ele lança exceção ou está indisponível | alto | Etapa 24 | nenhuma |
| 26 | Hook de falha ignora erro de argumento e lote | médio | Etapa 25 | nenhuma |
| 27 | Catálogo compara a versão do manifest, não a tag | baixo | Etapa 26 | nenhuma |
| 28 | Refatorar a proteção do script em avaliar e aplicar | alto | Etapa 27 | nenhuma |
| 29 | Tipo despacho no script e DISPATCH_SPEC | alto | Etapa 28 | nenhuma |
| 30 | Hook manager instala o despachante único e migra as entradas antigas | alto | Etapa 29 | nenhuma |
| 31 | Ajustar e ampliar os testes do hook manager para o despachante | alto | Etapa 30 | nenhuma |
| 32 | Documentar as mudanças no README (inglês e português) | médio | Etapa 31 | nenhuma |
| 33 | Verificação geral | alto | Etapa 32 | nenhuma |

## 5. Etapas
Execute na ordem. Todas as etapas tocam arquivos em comum (script de hooks, script-tools.ts, testes) ou dependem do estado da suíte, por isso nenhuma é marcada como paralelizável.

## Etapa 1: Teto de saída do ecosystem_run_script (MCP) [Haiku 5.5 | esforço: médio]

**Objetivo:** limitar stdout e stderr devolvidos pela tool MCP ecosystem_run_script a ~4000 caracteres cada (início e fim), gravar a saída completa num arquivo e aceitar max_chars opcional, sem repetir o texto no structuredContent.
**Depende de:** nenhuma
**Paralelizável com:** nenhuma

**Arquivos**
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\runner\script-tools.ts` (teto, arquivo de spill, max_chars)
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\runner\script-tools.test.ts` (testes)
- Não tocar: qualquer outro arquivo

**Regras de implementação**
1. Não mude a rota REST nesta etapa (ela é a próxima etapa): createScriptRoutes continua devolvendo stdout e stderr completos como hoje.
2. A saída que chega a ScriptExecutionResult já vem com segredos mascarados: grave no arquivo exatamente esse texto, nunca outro.
3. Falha ao gravar o arquivo nunca pode quebrar a tool: nesse caso corte o texto igualmente e omita o caminho do arquivo.
4. Sem dependências novas; use só node:fs, node:path, node:os e node:crypto.

**Passos**
1. Em C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\runner\script-tools.ts troque `const AGENT_OUTPUT_CHARS = 20_000;` por `const DEFAULT_OUTPUT_CHARS = 4000;`, `const MAX_OUTPUT_CHARS = 100_000;`, `const SPILL_DIR_NAME = "ai-ecosystem-runs";` e `const SPILL_MAX_AGE_MS = 24 * 60 * 60 * 1000;`. Acrescente `import * as os from "node:os";` e `import { randomUUID } from "node:crypto";`.
2. Crie e exporte `export interface ClippedOutput { text: string; omitted: number; file?: string }` e `export function clipOutput(full: string, maxChars: number, stream: "out" | "err"): ClippedOutput`. Se `full.length <= maxChars` devolva `{ text: full, omitted: 0 }`. Senão: `const file = spillOutput(full, stream);`, `const head = Math.floor(maxChars / 4);`, `const tailLength = maxChars - head;`, `const omitted = full.length - maxChars;`, `const marker = "\n[... " + omitted + " characters omitted" + (file ? "; full output in " + file : "") + " ...]\n";` e devolva `{ text: full.slice(0, head) + marker + full.slice(full.length - tailLength), omitted, ...(file ? { file } : {}) }`.
3. Crie a função privada `spillOutput(full: string, stream: "out" | "err"): string | undefined`: dentro de try/catch (devolve undefined no catch), monte `const dir = nodePath.join(os.tmpdir(), SPILL_DIR_NAME);`, `fs.mkdirSync(dir, { recursive: true });`, apague (cada um num try/catch vazio) os arquivos da pasta cujo `mtimeMs` seja mais velho que SPILL_MAX_AGE_MS, grave `nodePath.join(dir, Date.now() + "-" + randomUUID().slice(0, 8) + "." + stream + ".txt")` com `fs.writeFileSync(file, full, "utf8")` e devolva o caminho.
4. Em parseRunRequest valide `a.max_chars`: se não for undefined, tem de ser número inteiro finito >= 1, senão devolva `{ ok: false, message: "max_chars must be a positive integer." }`. O retorno ok passa a ser `{ ok: true, options, maxChars }` com `maxChars = Math.min(a.max_chars ?? DEFAULT_OUTPUT_CHARS, MAX_OUTPUT_CHARS)` (ajuste o tipo ParsedRequest). Em runFromArgs o ramo `kind: "done"` passa a trazer também `maxChars` (ajuste o tipo de retorno).
5. Reescreva `formatRun(result, maxChars)`: `const out = clipOutput(result.stdout, maxChars, "out");` e `const err = clipOutput(result.stderr, maxChars, "err");`. O texto continua com as linhas Exit code, Killed, Duration, 'stdout:' + (out.text || '(empty)'), 'stderr:' + (err.text || '(empty)'). O structuredContent passa a ser só `{ exitCode, killed, durationMs, truncated: out.omitted > 0 || err.omitted > 0, ...(out.file ? { stdout_file: out.file } : {}), ...(err.file ? { stderr_file: err.file } : {}) }` (sem stdout e sem stderr). O handler da runTool passa `outcome.maxChars` para formatRun. Apague a função tail se não for mais usada.
6. No inputSchema da runTool acrescente a propriedade `max_chars: { type: "integer", minimum: 1, maximum: 100000, description: "Max characters of stdout and of stderr returned (default 4000; the start and the end are kept and the full output is saved to a file)." }`.
7. Em C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\runner\script-tools.test.ts leia o teste existente 'truncates long output for the agent' e qualquer teste que leia structuredContent.stdout ou stderr e adapte ao novo formato. Acrescente testes: (a) script node que imprime 10000 caracteres: o texto da tool contém 'characters omitted' e 'full output in', o arquivo citado existe e tem 10000 caracteres, e o trecho de stdout no texto tem no máximo 4000 caracteres mais o marcador; (b) com max_chars: 100 o trecho de stdout fica com ~100 caracteres mais o marcador; (c) saída curta passa intacta e sem arquivo; (d) max_chars: 0 devolve isError com 'max_chars'.

**BDD (estado esperado ao concluir)**
- Dado um script que imprime 10000 caracteres em stdout, Quando chamo ecosystem_run_script sem max_chars, Então o texto de stdout devolvido tem no máximo 4000 caracteres mais o marcador '[... N characters omitted; full output in <arquivo> ...]' e o arquivo citado existe com os 10000 caracteres.
- Dado o mesmo script, Quando passo max_chars: 100, Então o trecho de stdout tem ~100 caracteres mais o marcador.
- Dado um script que imprime 'ok', Quando o executo, Então o texto traz 'ok' sem marcador e structuredContent.truncated é false e não existe stdout_file.
- Dado max_chars: 0, Quando chamo a tool, Então o resultado é isError com a mensagem 'max_chars must be a positive integer.'.
- Dado qualquer chamada, Então structuredContent não contém as chaves stdout nem stderr.

**Verificação** (comandos a rodar, com o resultado esperado)
- npx tsc --noEmit → sem erros
- npx vitest run tests/runner/script-tools.test.ts → todos passam

**Prompt para o subagente**
```text
Você é um subagente de implementação em TypeScript. Objetivo desta etapa: limitar stdout e stderr devolvidos pela tool MCP ecosystem_run_script a ~4000 caracteres cada (início e fim), gravar a saída completa num arquivo e aceitar max_chars opcional, sem repetir o texto no structuredContent.

CONTEXTO COMPLETO
Projeto: plugin do Obsidian chamado AI Ecosystem (núcleo da suíte de plugins de IA), escrito em TypeScript, com servidor MCP e REST local, executor de scripts, índice e descoberta de tools (tools_find, tools_describe, tools_run), hooks do Claude Code gravados nas settings do cofre, configuração guiada de módulos, telas (formulários) e um inspetor de requisições. Raiz do repositório (RAIZ): C:\Users\Trabalho\Documents\obsidian-ai-ecosystem. Testes com vitest (pasta tests), sem Obsidian real (há um mock em tests\mocks\obsidian.ts).
Objetivo geral da demanda: implementar 16 melhorias aceitas numa auditoria do núcleo, na ordem: (1) teto de saída do ecosystem_run_script; (2) ecosystem_status compacto; (3) script_id no executor; (4) lote no tools_run; (5) diagnóstico que percebe módulo defasado; (6) cancelamento do run_script; (7) remover a aprovação do tools_run e o código morto; (8) limitar o activity.sqlite; (9) setup_status, list_scripts e diagnóstico enxutos; (10) resumo dos módulos no início da sessão; (11) tela_gerenciar e setup oculto sem pendência; (12) setup_save em lote; (13) descrição curta do run_script; (14) falha do módulo só por exceção; (15) catálogo por manifest.version; (16) despachante único dos hooks de proteção.
Regras globais:
1. Idioma: o código, os comentários e os nomes de identificadores ficam em inglês (como já está nos arquivos); as mensagens do diagnóstico, do hook e dos achados ficam em português quando o arquivo já estiver em português; o README tem uma parte em inglês e uma em português espelhadas.
2. Estilo do código: TypeScript estrito, 2 espaços, aspas duplas, ponto e vírgula, `import type` para tipos, sem dependências novas e sem alterar package.json.
3. Os diretórios src/runner, src/server, src/registry, src/hooks, src/core, src/setup, src/tool-index são código Node puro: não importam o pacote "obsidian".
4. O script src/hooks/script/ai-ecosystem-hook.mjs é Node puro, sem dependências, e nunca pode atrapalhar o agente: qualquer problema termina com saída 0 e sem texto.
5. Comandos, sempre a partir de C:\Users\Trabalho\Documents\obsidian-ai-ecosystem: typecheck `npx tsc --noEmit`; testes `npx vitest run` (um arquivo: `npx vitest run tests\pasta\arquivo.test.ts`); lint `npx eslint .`; build `npm run build`.
6. Linha de base antes das mudanças: tsc sem erros; 54 arquivos de teste e 918 testes passando; eslint com 0 erros e 19 avisos (nenhum erro ou aviso novo pode surgir).
7. Cada etapa altera só os arquivos listados nela. Não faça commit, push, deploy nem mexa na pasta .git; não rode `npm install`; não escreva nem leia segredos, tokens ou arquivos .env.
8. Se algo não bater com o descrito (arquivo, função ou assinatura inexistente, teste quebrado por motivo alheio à etapa), pare e relate em vez de improvisar.

O QUE JÁ EXISTE E É RELEVANTE PARA ESTA ETAPA
A tool ecosystem_run_script fica em C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\runner\script-tools.ts. Hoje existe a constante AGENT_OUTPUT_CHARS = 20_000, a função tail(text, max) e a função formatRun(result: ScriptExecutionResult) que devolve content com 'Exit code', 'Killed', 'Duration', 'stdout:' e 'stderr:' e também structuredContent com stdout e stderr repetidos (até 4 cópias do texto). parseRunRequest(raw) valida os argumentos e devolve { ok: true, options: HubScriptOptions } ou { ok: false, message }. runFromArgs(deps, args, client) chama parseRunRequest e depois deps.engine.run, devolvendo { kind: 'invalid' | 'refused' | 'done', ... }. O schema de entrada da tool (inputSchema) lista path, args, cwd, timeoutSeconds, env, language, code. O módulo AI Scripts do mesmo ecossistema usa a convenção de gravar saídas completas em os.tmpdir()/ai-scripts-runs; aqui use os.tmpdir()/ai-ecosystem-runs.

ARQUIVOS
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\runner\script-tools.ts` (teto, arquivo de spill, max_chars)
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\runner\script-tools.test.ts` (testes)
- Não tocar: qualquer outro arquivo

REGRAS DESTA ETAPA
1. Não mude a rota REST nesta etapa (ela é a próxima etapa): createScriptRoutes continua devolvendo stdout e stderr completos como hoje.
2. A saída que chega a ScriptExecutionResult já vem com segredos mascarados: grave no arquivo exatamente esse texto, nunca outro.
3. Falha ao gravar o arquivo nunca pode quebrar a tool: nesse caso corte o texto igualmente e omita o caminho do arquivo.
4. Sem dependências novas; use só node:fs, node:path, node:os e node:crypto.

O QUE FAZER, NESTA ORDEM
1. Em C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\runner\script-tools.ts troque `const AGENT_OUTPUT_CHARS = 20_000;` por `const DEFAULT_OUTPUT_CHARS = 4000;`, `const MAX_OUTPUT_CHARS = 100_000;`, `const SPILL_DIR_NAME = "ai-ecosystem-runs";` e `const SPILL_MAX_AGE_MS = 24 * 60 * 60 * 1000;`. Acrescente `import * as os from "node:os";` e `import { randomUUID } from "node:crypto";`.
2. Crie e exporte `export interface ClippedOutput { text: string; omitted: number; file?: string }` e `export function clipOutput(full: string, maxChars: number, stream: "out" | "err"): ClippedOutput`. Se `full.length <= maxChars` devolva `{ text: full, omitted: 0 }`. Senão: `const file = spillOutput(full, stream);`, `const head = Math.floor(maxChars / 4);`, `const tailLength = maxChars - head;`, `const omitted = full.length - maxChars;`, `const marker = "\n[... " + omitted + " characters omitted" + (file ? "; full output in " + file : "") + " ...]\n";` e devolva `{ text: full.slice(0, head) + marker + full.slice(full.length - tailLength), omitted, ...(file ? { file } : {}) }`.
3. Crie a função privada `spillOutput(full: string, stream: "out" | "err"): string | undefined`: dentro de try/catch (devolve undefined no catch), monte `const dir = nodePath.join(os.tmpdir(), SPILL_DIR_NAME);`, `fs.mkdirSync(dir, { recursive: true });`, apague (cada um num try/catch vazio) os arquivos da pasta cujo `mtimeMs` seja mais velho que SPILL_MAX_AGE_MS, grave `nodePath.join(dir, Date.now() + "-" + randomUUID().slice(0, 8) + "." + stream + ".txt")` com `fs.writeFileSync(file, full, "utf8")` e devolva o caminho.
4. Em parseRunRequest valide `a.max_chars`: se não for undefined, tem de ser número inteiro finito >= 1, senão devolva `{ ok: false, message: "max_chars must be a positive integer." }`. O retorno ok passa a ser `{ ok: true, options, maxChars }` com `maxChars = Math.min(a.max_chars ?? DEFAULT_OUTPUT_CHARS, MAX_OUTPUT_CHARS)` (ajuste o tipo ParsedRequest). Em runFromArgs o ramo `kind: "done"` passa a trazer também `maxChars` (ajuste o tipo de retorno).
5. Reescreva `formatRun(result, maxChars)`: `const out = clipOutput(result.stdout, maxChars, "out");` e `const err = clipOutput(result.stderr, maxChars, "err");`. O texto continua com as linhas Exit code, Killed, Duration, 'stdout:' + (out.text || '(empty)'), 'stderr:' + (err.text || '(empty)'). O structuredContent passa a ser só `{ exitCode, killed, durationMs, truncated: out.omitted > 0 || err.omitted > 0, ...(out.file ? { stdout_file: out.file } : {}), ...(err.file ? { stderr_file: err.file } : {}) }` (sem stdout e sem stderr). O handler da runTool passa `outcome.maxChars` para formatRun. Apague a função tail se não for mais usada.
6. No inputSchema da runTool acrescente a propriedade `max_chars: { type: "integer", minimum: 1, maximum: 100000, description: "Max characters of stdout and of stderr returned (default 4000; the start and the end are kept and the full output is saved to a file)." }`.
7. Em C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\runner\script-tools.test.ts leia o teste existente 'truncates long output for the agent' e qualquer teste que leia structuredContent.stdout ou stderr e adapte ao novo formato. Acrescente testes: (a) script node que imprime 10000 caracteres: o texto da tool contém 'characters omitted' e 'full output in', o arquivo citado existe e tem 10000 caracteres, e o trecho de stdout no texto tem no máximo 4000 caracteres mais o marcador; (b) com max_chars: 100 o trecho de stdout fica com ~100 caracteres mais o marcador; (c) saída curta passa intacta e sem arquivo; (d) max_chars: 0 devolve isError com 'max_chars'.

O QUE NÃO FAZER
- Não altere a rota REST (createScriptRoutes) nem outros arquivos.
- Não adicione dependências nem mude package.json.

CRITÉRIOS DE ACEITE
- Dado um script que imprime 10000 caracteres em stdout, Quando chamo ecosystem_run_script sem max_chars, Então o texto de stdout devolvido tem no máximo 4000 caracteres mais o marcador '[... N characters omitted; full output in <arquivo> ...]' e o arquivo citado existe com os 10000 caracteres.
- Dado o mesmo script, Quando passo max_chars: 100, Então o trecho de stdout tem ~100 caracteres mais o marcador.
- Dado um script que imprime 'ok', Quando o executo, Então o texto traz 'ok' sem marcador e structuredContent.truncated é false e não existe stdout_file.
- Dado max_chars: 0, Quando chamo a tool, Então o resultado é isError com a mensagem 'max_chars must be a positive integer.'.
- Dado qualquer chamada, Então structuredContent não contém as chaves stdout nem stderr.

VERIFICAÇÃO (rode a partir de C:\Users\Trabalho\Documents\obsidian-ai-ecosystem e cole a saída real)
- npx tsc --noEmit → sem erros
- npx vitest run tests/runner/script-tools.test.ts → todos passam

Se qualquer coisa não bater com o descrito (arquivo, função ou assinatura inexistente, comportamento diferente do dito acima, teste quebrado por motivo alheio a esta etapa), PARE e relate em vez de improvisar.
RELATÓRIO FINAL: liste os arquivos alterados ou criados (caminho absoluto), cole a saída real de cada comando de verificação (não resuma) e descreva qualquer desvio ou dúvida.
```

## Etapa 2: Mesmo teto na rota REST /scripts/run [Haiku 5.5 | esforço: baixo]

**Objetivo:** aplicar o mesmo teto de saída (e max_chars) à rota REST POST /scripts/run.
**Depende de:** Etapa 1 (Teto de saída do ecosystem_run_script (MCP))
**Paralelizável com:** nenhuma

**Arquivos**
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\runner\script-tools.ts` (só o handler de POST /scripts/run e a descrição da rota)
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\runner\script-tools.test.ts` (testes da rota)
- Não tocar: qualquer outro arquivo

**Regras de implementação**
1. Só o handler de POST /scripts/run e a descrição da rota mudam.
2. O corpo 200 passa a ser `{ exitCode, killed, durationMs, stdout, stderr, truncated, stdout_file?, stderr_file? }` com stdout e stderr cortados por clipOutput usando `outcome.maxChars` (o corpo da requisição aceita `max_chars`).

**Passos**
1. No handler de POST /scripts/run, no ramo 'done', calcule `const out = clipOutput(outcome.result.stdout, outcome.maxChars, "out");` e `const err = clipOutput(outcome.result.stderr, outcome.maxChars, "err");` e devolva o corpo `{ exitCode, killed, durationMs, stdout: out.text, stderr: err.text, truncated: out.omitted > 0 || err.omitted > 0, ...(out.file ? { stdout_file: out.file } : {}), ...(err.file ? { stderr_file: err.file } : {}) }`.
2. Atualize a descrição da rota para: `Runs a script. Body: { path, args?, cwd?, timeoutSeconds?, env?, language?, code?, max_chars? }. stdout and stderr are cut to max_chars (default 4000); the full output goes to a file.`
3. Em C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\runner\script-tools.test.ts (describe 'script routes') acrescente: um teste com script que imprime 10000 caracteres via POST /scripts/run (body path) cujo corpo tem stdout com no máximo 4000 caracteres mais o marcador, truncated true e stdout_file existente; um teste com max_chars: 50; e confira que o teste existente de 'POST /scripts/run returns 200 with the result' continua passando (adapte só se ele esperar a saída completa de algo > 4000).

**BDD (estado esperado ao concluir)**
- Dado um script que imprime 10000 caracteres, Quando faço POST /scripts/run com o path dele, Então o corpo 200 traz stdout com no máximo 4000 caracteres mais o marcador, truncated true e stdout_file apontando para um arquivo com os 10000 caracteres.
- Dado um script curto, Quando faço POST /scripts/run, Então stdout vem completo e truncated é false.
- Dado body com max_chars inválido (0), Quando faço POST /scripts/run, Então a resposta é 400 invalid-request.

**Verificação** (comandos a rodar, com o resultado esperado)
- npx tsc --noEmit → sem erros
- npx vitest run tests/runner/script-tools.test.ts → todos passam

**Prompt para o subagente**
```text
Você é um subagente de implementação em TypeScript. Objetivo desta etapa: aplicar o mesmo teto de saída (e max_chars) à rota REST POST /scripts/run.

CONTEXTO COMPLETO
Projeto: plugin do Obsidian chamado AI Ecosystem (núcleo da suíte de plugins de IA), escrito em TypeScript, com servidor MCP e REST local, executor de scripts, índice e descoberta de tools (tools_find, tools_describe, tools_run), hooks do Claude Code gravados nas settings do cofre, configuração guiada de módulos, telas (formulários) e um inspetor de requisições. Raiz do repositório (RAIZ): C:\Users\Trabalho\Documents\obsidian-ai-ecosystem. Testes com vitest (pasta tests), sem Obsidian real (há um mock em tests\mocks\obsidian.ts).
Objetivo geral da demanda: implementar 16 melhorias aceitas numa auditoria do núcleo, na ordem: (1) teto de saída do ecosystem_run_script; (2) ecosystem_status compacto; (3) script_id no executor; (4) lote no tools_run; (5) diagnóstico que percebe módulo defasado; (6) cancelamento do run_script; (7) remover a aprovação do tools_run e o código morto; (8) limitar o activity.sqlite; (9) setup_status, list_scripts e diagnóstico enxutos; (10) resumo dos módulos no início da sessão; (11) tela_gerenciar e setup oculto sem pendência; (12) setup_save em lote; (13) descrição curta do run_script; (14) falha do módulo só por exceção; (15) catálogo por manifest.version; (16) despachante único dos hooks de proteção.
Regras globais:
1. Idioma: o código, os comentários e os nomes de identificadores ficam em inglês (como já está nos arquivos); as mensagens do diagnóstico, do hook e dos achados ficam em português quando o arquivo já estiver em português; o README tem uma parte em inglês e uma em português espelhadas.
2. Estilo do código: TypeScript estrito, 2 espaços, aspas duplas, ponto e vírgula, `import type` para tipos, sem dependências novas e sem alterar package.json.
3. Os diretórios src/runner, src/server, src/registry, src/hooks, src/core, src/setup, src/tool-index são código Node puro: não importam o pacote "obsidian".
4. O script src/hooks/script/ai-ecosystem-hook.mjs é Node puro, sem dependências, e nunca pode atrapalhar o agente: qualquer problema termina com saída 0 e sem texto.
5. Comandos, sempre a partir de C:\Users\Trabalho\Documents\obsidian-ai-ecosystem: typecheck `npx tsc --noEmit`; testes `npx vitest run` (um arquivo: `npx vitest run tests\pasta\arquivo.test.ts`); lint `npx eslint .`; build `npm run build`.
6. Linha de base antes das mudanças: tsc sem erros; 54 arquivos de teste e 918 testes passando; eslint com 0 erros e 19 avisos (nenhum erro ou aviso novo pode surgir).
7. Cada etapa altera só os arquivos listados nela. Não faça commit, push, deploy nem mexa na pasta .git; não rode `npm install`; não escreva nem leia segredos, tokens ou arquivos .env.
8. Se algo não bater com o descrito (arquivo, função ou assinatura inexistente, teste quebrado por motivo alheio à etapa), pare e relate em vez de improvisar.

O QUE JÁ EXISTE E É RELEVANTE PARA ESTA ETAPA
A etapa anterior criou, em C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\runner\script-tools.ts, a função exportada `clipOutput(full, maxChars, stream)` (devolve { text, omitted, file? }), a constante DEFAULT_OUTPUT_CHARS = 4000 e fez parseRunRequest devolver também `maxChars` (aceitando o campo max_chars) e runFromArgs devolver `maxChars` no ramo 'done'. A rota REST fica em createScriptRoutes(deps) no mesmo arquivo: o handler de POST /scripts/run hoje devolve `{ exitCode, killed, durationMs, stdout, stderr }` completos (até 1 MB).

ARQUIVOS
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\runner\script-tools.ts` (só o handler de POST /scripts/run e a descrição da rota)
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\runner\script-tools.test.ts` (testes da rota)
- Não tocar: qualquer outro arquivo

REGRAS DESTA ETAPA
1. Só o handler de POST /scripts/run e a descrição da rota mudam.
2. O corpo 200 passa a ser `{ exitCode, killed, durationMs, stdout, stderr, truncated, stdout_file?, stderr_file? }` com stdout e stderr cortados por clipOutput usando `outcome.maxChars` (o corpo da requisição aceita `max_chars`).

O QUE FAZER, NESTA ORDEM
1. No handler de POST /scripts/run, no ramo 'done', calcule `const out = clipOutput(outcome.result.stdout, outcome.maxChars, "out");` e `const err = clipOutput(outcome.result.stderr, outcome.maxChars, "err");` e devolva o corpo `{ exitCode, killed, durationMs, stdout: out.text, stderr: err.text, truncated: out.omitted > 0 || err.omitted > 0, ...(out.file ? { stdout_file: out.file } : {}), ...(err.file ? { stderr_file: err.file } : {}) }`.
2. Atualize a descrição da rota para: `Runs a script. Body: { path, args?, cwd?, timeoutSeconds?, env?, language?, code?, max_chars? }. stdout and stderr are cut to max_chars (default 4000); the full output goes to a file.`
3. Em C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\runner\script-tools.test.ts (describe 'script routes') acrescente: um teste com script que imprime 10000 caracteres via POST /scripts/run (body path) cujo corpo tem stdout com no máximo 4000 caracteres mais o marcador, truncated true e stdout_file existente; um teste com max_chars: 50; e confira que o teste existente de 'POST /scripts/run returns 200 with the result' continua passando (adapte só se ele esperar a saída completa de algo > 4000).

O QUE NÃO FAZER
- Não altere a tool MCP nem o schema dela.
- Não toque em outros arquivos.

CRITÉRIOS DE ACEITE
- Dado um script que imprime 10000 caracteres, Quando faço POST /scripts/run com o path dele, Então o corpo 200 traz stdout com no máximo 4000 caracteres mais o marcador, truncated true e stdout_file apontando para um arquivo com os 10000 caracteres.
- Dado um script curto, Quando faço POST /scripts/run, Então stdout vem completo e truncated é false.
- Dado body com max_chars inválido (0), Quando faço POST /scripts/run, Então a resposta é 400 invalid-request.

VERIFICAÇÃO (rode a partir de C:\Users\Trabalho\Documents\obsidian-ai-ecosystem e cole a saída real)
- npx tsc --noEmit → sem erros
- npx vitest run tests/runner/script-tools.test.ts → todos passam

Se qualquer coisa não bater com o descrito (arquivo, função ou assinatura inexistente, comportamento diferente do dito acima, teste quebrado por motivo alheio a esta etapa), PARE e relate em vez de improvisar.
RELATÓRIO FINAL: liste os arquivos alterados ou criados (caminho absoluto), cole a saída real de cada comando de verificação (não resuma) e descreva qualquer desvio ou dúvida.
```

## Etapa 3: ecosystem_status compacto [Haiku 5.5 | esforço: médio]

**Objetivo:** fazer a tool ecosystem_status devolver uma linha por módulo e structuredContent enxuto, com a lista de tools só com detalhe:true ou filtrando por módulo.
**Depende de:** Etapa 2 (Mesmo teto na rota REST /scripts/run)
**Paralelizável com:** nenhuma

**Arquivos**
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\core\builtin-module.ts`
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\core\builtin-module.test.ts`
- Não tocar: qualquer outro arquivo

**Regras de implementação**
1. A rota GET /status e buildStatus continuam idênticos.
2. O inputSchema ganha `detalhe` (boolean, padrão false) e `modulo` (string, id do módulo).
3. Sem alterar mais nada fora dessa tool.

**Passos**
1. Crie e exporte em builtin-module.ts `export interface StatusOptions { detalhe?: boolean; modulo?: string }` e `export function compactStatus(status: EcosystemStatus, options: StatusOptions): { ok: true; text: string; structured: Record<string, unknown> } | { ok: false; error: string }`.
2. compactStatus: `const full = options.detalhe === true || options.modulo !== undefined;`. Se `options.modulo` for dado e não existir em status.modules, devolva `{ ok: false, error: "Unknown module \"X\". Installed: a, b, c." }` (X = o pedido, a,b,c = ids registrados). Lista de módulos = todos, ou só o pedido. Cada módulo vira `{ id, name, version, tools: toolNames.length, prompts: promptNames.length, routes: routeCount, ...(warnings.length ? { warnings } : {}), ...(full ? { toolNames, promptNames } : {}) }`. Os serviços viram `{ name, ownerModuleId }`. O texto reaproveita as linhas de formatStatusText (cabeçalho, servidor, uma linha por módulo, avisos, serviços); quando `full`, depois da linha do módulo acrescente a linha `  tools: <toolNames separados por vírgula>` (e `  prompts: ...` se houver). `structured` = `{ version, apiVersion, server, modules, services }` (módulos e serviços já enxutos).
3. Refatore formatStatusText para aceitar uma lista de módulos/serviços já filtrada sem mudar sua saída atual quando chamada como hoje (os testes existentes de formatStatusText devem continuar verdes); a forma mais simples é compactStatus montar um EcosystemStatus filtrado e reutilizar formatStatusText mais as linhas extras.
4. Na statusTool: inputSchema com `detalhe: { type: "boolean", default: false, description: "List the tool and prompt names of every module." }` e `modulo: { type: "string", description: "Only this module id, with its tool names." }`; o handler lê os dois argumentos (detalhe só vale se `=== true`, modulo só se string não vazia), chama compactStatus e devolve `{ content: [{ type: "text", text }], structuredContent: structured }` ou, em erro, `{ content: [{ type: "text", text: error }], isError: true }`. Atualize a descrição da tool citando os dois argumentos.
5. Troque CORE_TOOL_METADATA.ecosystem_status.resumo por `"Versão, servidor, módulos (detalhe:true lista as tools) e serviços do AI Ecosystem"`.
6. Em C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\core\builtin-module.test.ts adapte o teste 'ecosystem_status is read-only...' (hoje confere modules[0].toolNames e services com registeredAt) e acrescente: sem argumentos o structuredContent.modules[0] tem tools: 2 e NÃO tem toolNames; com detalhe: true tem toolNames ['http_request','list_secrets']; com modulo: 'environment-variables' devolve só esse módulo com toolNames; com modulo: 'nope' devolve isError e o texto lista os ids instalados; GET /status continua igual a buildStatus(deps).

**BDD (estado esperado ao concluir)**
- Dado um módulo com 2 tools, Quando chamo ecosystem_status sem argumentos, Então structuredContent.modules[0] tem tools = 2 e não tem toolNames.
- Dado o mesmo módulo, Quando chamo com detalhe: true, Então modules[0].toolNames lista as 2 tools e o texto traz a linha '  tools: ...'.
- Dado modulo: 'nope', Quando chamo, Então isError é true e o texto cita os módulos instalados.
- Dado a rota GET /status, Quando a chamo, Então o corpo continua igual a buildStatus(deps) (com toolNames).

**Verificação** (comandos a rodar, com o resultado esperado)
- npx tsc --noEmit → sem erros
- npx vitest run tests/core/builtin-module.test.ts → todos passam

**Prompt para o subagente**
```text
Você é um subagente de implementação em TypeScript. Objetivo desta etapa: fazer a tool ecosystem_status devolver uma linha por módulo e structuredContent enxuto, com a lista de tools só com detalhe:true ou filtrando por módulo.

CONTEXTO COMPLETO
Projeto: plugin do Obsidian chamado AI Ecosystem (núcleo da suíte de plugins de IA), escrito em TypeScript, com servidor MCP e REST local, executor de scripts, índice e descoberta de tools (tools_find, tools_describe, tools_run), hooks do Claude Code gravados nas settings do cofre, configuração guiada de módulos, telas (formulários) e um inspetor de requisições. Raiz do repositório (RAIZ): C:\Users\Trabalho\Documents\obsidian-ai-ecosystem. Testes com vitest (pasta tests), sem Obsidian real (há um mock em tests\mocks\obsidian.ts).
Objetivo geral da demanda: implementar 16 melhorias aceitas numa auditoria do núcleo, na ordem: (1) teto de saída do ecosystem_run_script; (2) ecosystem_status compacto; (3) script_id no executor; (4) lote no tools_run; (5) diagnóstico que percebe módulo defasado; (6) cancelamento do run_script; (7) remover a aprovação do tools_run e o código morto; (8) limitar o activity.sqlite; (9) setup_status, list_scripts e diagnóstico enxutos; (10) resumo dos módulos no início da sessão; (11) tela_gerenciar e setup oculto sem pendência; (12) setup_save em lote; (13) descrição curta do run_script; (14) falha do módulo só por exceção; (15) catálogo por manifest.version; (16) despachante único dos hooks de proteção.
Regras globais:
1. Idioma: o código, os comentários e os nomes de identificadores ficam em inglês (como já está nos arquivos); as mensagens do diagnóstico, do hook e dos achados ficam em português quando o arquivo já estiver em português; o README tem uma parte em inglês e uma em português espelhadas.
2. Estilo do código: TypeScript estrito, 2 espaços, aspas duplas, ponto e vírgula, `import type` para tipos, sem dependências novas e sem alterar package.json.
3. Os diretórios src/runner, src/server, src/registry, src/hooks, src/core, src/setup, src/tool-index são código Node puro: não importam o pacote "obsidian".
4. O script src/hooks/script/ai-ecosystem-hook.mjs é Node puro, sem dependências, e nunca pode atrapalhar o agente: qualquer problema termina com saída 0 e sem texto.
5. Comandos, sempre a partir de C:\Users\Trabalho\Documents\obsidian-ai-ecosystem: typecheck `npx tsc --noEmit`; testes `npx vitest run` (um arquivo: `npx vitest run tests\pasta\arquivo.test.ts`); lint `npx eslint .`; build `npm run build`.
6. Linha de base antes das mudanças: tsc sem erros; 54 arquivos de teste e 918 testes passando; eslint com 0 erros e 19 avisos (nenhum erro ou aviso novo pode surgir).
7. Cada etapa altera só os arquivos listados nela. Não faça commit, push, deploy nem mexa na pasta .git; não rode `npm install`; não escreva nem leia segredos, tokens ou arquivos .env.
8. Se algo não bater com o descrito (arquivo, função ou assinatura inexistente, teste quebrado por motivo alheio à etapa), pare e relate em vez de improvisar.

O QUE JÁ EXISTE E É RELEVANTE PARA ESTA ETAPA
Em C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\core\builtin-module.ts existem buildStatus(deps): EcosystemStatus (version, apiVersion, server, modules: ModuleInfo[], services: ServiceInfo[]), formatStatusText(status) e a tool statusTool dentro de createBuiltinTools. Hoje o handler devolve structuredContent: { ...status } com todos os módulos incluindo toolNames, promptNames, legacyAliasPaths e os services com registeredAt, o que dá ~4 mil caracteres. ModuleInfo (em C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\types\index.ts) tem id, name, version, apiVersion, registeredAt, routeCount, legacyAliasPaths, toolNames, promptNames, warnings. A rota REST GET /status (statusRoute em createBuiltinModule) devolve buildStatus(deps) completo e NÃO deve mudar. CORE_TOOL_METADATA.ecosystem_status.resumo é o texto de índice da tool (máx. 100 caracteres).

ARQUIVOS
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\core\builtin-module.ts`
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\core\builtin-module.test.ts`
- Não tocar: qualquer outro arquivo

REGRAS DESTA ETAPA
1. A rota GET /status e buildStatus continuam idênticos.
2. O inputSchema ganha `detalhe` (boolean, padrão false) e `modulo` (string, id do módulo).
3. Sem alterar mais nada fora dessa tool.

O QUE FAZER, NESTA ORDEM
1. Crie e exporte em builtin-module.ts `export interface StatusOptions { detalhe?: boolean; modulo?: string }` e `export function compactStatus(status: EcosystemStatus, options: StatusOptions): { ok: true; text: string; structured: Record<string, unknown> } | { ok: false; error: string }`.
2. compactStatus: `const full = options.detalhe === true || options.modulo !== undefined;`. Se `options.modulo` for dado e não existir em status.modules, devolva `{ ok: false, error: "Unknown module \"X\". Installed: a, b, c." }` (X = o pedido, a,b,c = ids registrados). Lista de módulos = todos, ou só o pedido. Cada módulo vira `{ id, name, version, tools: toolNames.length, prompts: promptNames.length, routes: routeCount, ...(warnings.length ? { warnings } : {}), ...(full ? { toolNames, promptNames } : {}) }`. Os serviços viram `{ name, ownerModuleId }`. O texto reaproveita as linhas de formatStatusText (cabeçalho, servidor, uma linha por módulo, avisos, serviços); quando `full`, depois da linha do módulo acrescente a linha `  tools: <toolNames separados por vírgula>` (e `  prompts: ...` se houver). `structured` = `{ version, apiVersion, server, modules, services }` (módulos e serviços já enxutos).
3. Refatore formatStatusText para aceitar uma lista de módulos/serviços já filtrada sem mudar sua saída atual quando chamada como hoje (os testes existentes de formatStatusText devem continuar verdes); a forma mais simples é compactStatus montar um EcosystemStatus filtrado e reutilizar formatStatusText mais as linhas extras.
4. Na statusTool: inputSchema com `detalhe: { type: "boolean", default: false, description: "List the tool and prompt names of every module." }` e `modulo: { type: "string", description: "Only this module id, with its tool names." }`; o handler lê os dois argumentos (detalhe só vale se `=== true`, modulo só se string não vazia), chama compactStatus e devolve `{ content: [{ type: "text", text }], structuredContent: structured }` ou, em erro, `{ content: [{ type: "text", text: error }], isError: true }`. Atualize a descrição da tool citando os dois argumentos.
5. Troque CORE_TOOL_METADATA.ecosystem_status.resumo por `"Versão, servidor, módulos (detalhe:true lista as tools) e serviços do AI Ecosystem"`.
6. Em C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\core\builtin-module.test.ts adapte o teste 'ecosystem_status is read-only...' (hoje confere modules[0].toolNames e services com registeredAt) e acrescente: sem argumentos o structuredContent.modules[0] tem tools: 2 e NÃO tem toolNames; com detalhe: true tem toolNames ['http_request','list_secrets']; com modulo: 'environment-variables' devolve só esse módulo com toolNames; com modulo: 'nope' devolve isError e o texto lista os ids instalados; GET /status continua igual a buildStatus(deps).

O QUE NÃO FAZER
- Não altere statusRoute nem buildStatus.
- Não altere outros arquivos.

CRITÉRIOS DE ACEITE
- Dado um módulo com 2 tools, Quando chamo ecosystem_status sem argumentos, Então structuredContent.modules[0] tem tools = 2 e não tem toolNames.
- Dado o mesmo módulo, Quando chamo com detalhe: true, Então modules[0].toolNames lista as 2 tools e o texto traz a linha '  tools: ...'.
- Dado modulo: 'nope', Quando chamo, Então isError é true e o texto cita os módulos instalados.
- Dado a rota GET /status, Quando a chamo, Então o corpo continua igual a buildStatus(deps) (com toolNames).

VERIFICAÇÃO (rode a partir de C:\Users\Trabalho\Documents\obsidian-ai-ecosystem e cole a saída real)
- npx tsc --noEmit → sem erros
- npx vitest run tests/core/builtin-module.test.ts → todos passam

Se qualquer coisa não bater com o descrito (arquivo, função ou assinatura inexistente, comportamento diferente do dito acima, teste quebrado por motivo alheio a esta etapa), PARE e relate em vez de improvisar.
RELATÓRIO FINAL: liste os arquivos alterados ou criados (caminho absoluto), cole a saída real de cada comando de verificação (não resuma) e descreva qualquer desvio ou dúvida.
```

## Etapa 4: script_id como alias no ecosystem_run_script [Haiku 5.5 | esforço: alto]

**Objetivo:** fazer ecosystem_run_script aceitar script_id (resolvido pelo registro do AI Scripts) como alternativa a path, e devolver erros que apontem o nome certo.
**Depende de:** Etapa 3 (ecosystem_status compacto)
**Paralelizável com:** nenhuma

**Arquivos**
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\runner\script-tools.ts`
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\core\ecosystem.ts` (só o objeto scripts dentro de this.builtin e o import)
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\runner\script-tools.test.ts`
- Não tocar: qualquer outro arquivo

**Regras de implementação**
1. O formato do serviço é externo: trate cada item de listScripts() como desconhecido e confira os tipos em tempo de execução (item é objeto, scriptId é string, scriptPath é string não vazia).
2. A política do Script Engine continua valendo: depois de resolver o caminho, quem decide se roda é engine.run (não crie atalho que pule a política).
3. path e code continuam funcionando exatamente como antes; script_id só é usado quando path e code não vêm.

**Passos**
1. Em script-tools.ts exporte `export interface ScriptsLookup { listScripts(): Promise<unknown[]> | unknown[] }` e acrescente em ScriptToolsDeps o campo opcional `getScriptsService?: () => ScriptsLookup | undefined;`.
2. Crie `async function resolveScriptId(deps: ScriptToolsDeps, raw: unknown): Promise<{ ok: true; args: unknown } | { ok: false; message: string }>`. Se `raw` não for objeto simples ou `script_id` não for string não vazia (depois de trim), devolva `{ ok: true, args: raw }` sem mexer. Se também vier `path` não vazio ou `code` definido, devolva `{ ok: false, message: "Give path or script_id, not both." }`. Busque `const service = deps.getScriptsService?.();`; se não houver service ou `typeof service.listScripts !== "function"`, devolva a mensagem `script_id "ID": AI Scripts is not available. Pass path (a script file of the vault) instead.`. Chame listScripts dentro de try/catch (erro vira a mesma mensagem de indisponível). Ache o item cujo `scriptId` seja igual ao pedido; se não achar: `script_id "ID" is not registered in AI Scripts. Call list_ai_scripts to see the ids, or pass path.`; se achar mas sem `scriptPath` string não vazia: `The script "ID" is registered in AI Scripts but has no script file here. Run it with run_ai_script {"script_id":"ID","params":{...}}.`; se achar com scriptPath, devolva `{ ok: true, args: { ...raw, path: scriptPath, script_id: undefined } }` (apague a chave script_id do objeto em vez de deixar undefined).
3. Em runFromArgs, antes de parseRunRequest, chame resolveScriptId; se `ok === false` devolva `{ kind: "invalid", message }`; senão use `resolved.args` no parse.
4. Em parseRunRequest troque a mensagem de 'path is required (or code with language).' por `path is required: a script path of the vault such as "Scripts/report.py" (see ecosystem_list_scripts), a script_id registered in AI Scripts, or code with language.` e valide `script_id`: se existir e não for string devolva `script_id must be a string.`.
5. No inputSchema da runTool acrescente `script_id: { type: "string", description: "Id of a script registered in AI Scripts that is a script file; resolved to its path. Alternative to path." }` e mude a descrição de `path` para `Script path relative to the vault root, e.g. "Scripts/report.py". Required unless script_id or code is given.`.
6. Em C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\core\ecosystem.ts importe `SCRIPTS_SERVICE` de '../types' (junto de SECRETS_SERVICE) e `import type { ScriptsLookup } from "../runner/script-tools";` (se já houver import de script-tools, estenda-o) e no objeto `scripts: {...}` de this.builtin acrescente `getScriptsService: () => this.bus.get<ScriptsLookup>(SCRIPTS_SERVICE),`.
7. Em C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\runner\script-tools.test.ts: estenda a função deps() para aceitar um getScriptsService opcional. Testes: (a) serviço com [{ scriptId: 'hello', scriptPath: 'Scripts/hello.js' }] e arquivo Scripts/hello.js que imprime 'oi': chamar com script_id 'hello' roda e stdout traz 'oi'; (b) script_id desconhecido → isError e texto contém 'not registered in AI Scripts'; (c) sem serviço → texto contém 'AI Scripts is not available'; (d) item sem scriptPath → texto contém 'run_ai_script'; (e) path e script_id juntos → 'not both'; (f) sem path nem script_id nem code → texto contém 'script_id'; (g) o script_id resolvido para uma pasta não permitida é recusado pelo engine (isError 'Script refused').

**BDD (estado esperado ao concluir)**
- Dado o serviço scripts com { scriptId: 'hello', scriptPath: 'Scripts/hello.js' } e esse arquivo imprimindo 'oi', Quando chamo ecosystem_run_script com script_id 'hello', Então roda o arquivo e stdout contém 'oi'.
- Dado um script_id que o AI Scripts não conhece, Quando chamo, Então o resultado é isError e a mensagem cita list_ai_scripts e path.
- Dado um script do AI Scripts sem arquivo, Quando chamo com o script_id dele, Então a mensagem manda usar run_ai_script.
- Dado path 'Scripts/a.js' e script_id juntos, Quando chamo, Então isError 'Give path or script_id, not both.'.
- Dado só path (uso antigo), Quando chamo, Então tudo funciona como antes (testes existentes passam).

**Verificação** (comandos a rodar, com o resultado esperado)
- npx tsc --noEmit → sem erros
- npx vitest run tests/runner/script-tools.test.ts tests/core/builtin-module.test.ts tests/integration/ecosystem.test.ts → todos passam

**Prompt para o subagente**
```text
Você é um subagente de implementação em TypeScript. Objetivo desta etapa: fazer ecosystem_run_script aceitar script_id (resolvido pelo registro do AI Scripts) como alternativa a path, e devolver erros que apontem o nome certo.

CONTEXTO COMPLETO
Projeto: plugin do Obsidian chamado AI Ecosystem (núcleo da suíte de plugins de IA), escrito em TypeScript, com servidor MCP e REST local, executor de scripts, índice e descoberta de tools (tools_find, tools_describe, tools_run), hooks do Claude Code gravados nas settings do cofre, configuração guiada de módulos, telas (formulários) e um inspetor de requisições. Raiz do repositório (RAIZ): C:\Users\Trabalho\Documents\obsidian-ai-ecosystem. Testes com vitest (pasta tests), sem Obsidian real (há um mock em tests\mocks\obsidian.ts).
Objetivo geral da demanda: implementar 16 melhorias aceitas numa auditoria do núcleo, na ordem: (1) teto de saída do ecosystem_run_script; (2) ecosystem_status compacto; (3) script_id no executor; (4) lote no tools_run; (5) diagnóstico que percebe módulo defasado; (6) cancelamento do run_script; (7) remover a aprovação do tools_run e o código morto; (8) limitar o activity.sqlite; (9) setup_status, list_scripts e diagnóstico enxutos; (10) resumo dos módulos no início da sessão; (11) tela_gerenciar e setup oculto sem pendência; (12) setup_save em lote; (13) descrição curta do run_script; (14) falha do módulo só por exceção; (15) catálogo por manifest.version; (16) despachante único dos hooks de proteção.
Regras globais:
1. Idioma: o código, os comentários e os nomes de identificadores ficam em inglês (como já está nos arquivos); as mensagens do diagnóstico, do hook e dos achados ficam em português quando o arquivo já estiver em português; o README tem uma parte em inglês e uma em português espelhadas.
2. Estilo do código: TypeScript estrito, 2 espaços, aspas duplas, ponto e vírgula, `import type` para tipos, sem dependências novas e sem alterar package.json.
3. Os diretórios src/runner, src/server, src/registry, src/hooks, src/core, src/setup, src/tool-index são código Node puro: não importam o pacote "obsidian".
4. O script src/hooks/script/ai-ecosystem-hook.mjs é Node puro, sem dependências, e nunca pode atrapalhar o agente: qualquer problema termina com saída 0 e sem texto.
5. Comandos, sempre a partir de C:\Users\Trabalho\Documents\obsidian-ai-ecosystem: typecheck `npx tsc --noEmit`; testes `npx vitest run` (um arquivo: `npx vitest run tests\pasta\arquivo.test.ts`); lint `npx eslint .`; build `npm run build`.
6. Linha de base antes das mudanças: tsc sem erros; 54 arquivos de teste e 918 testes passando; eslint com 0 erros e 19 avisos (nenhum erro ou aviso novo pode surgir).
7. Cada etapa altera só os arquivos listados nela. Não faça commit, push, deploy nem mexa na pasta .git; não rode `npm install`; não escreva nem leia segredos, tokens ou arquivos .env.
8. Se algo não bater com o descrito (arquivo, função ou assinatura inexistente, teste quebrado por motivo alheio à etapa), pare e relate em vez de improvisar.

O QUE JÁ EXISTE E É RELEVANTE PARA ESTA ETAPA
Em C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\runner\script-tools.ts, parseRunRequest(raw) hoje exige `path` (ou `code` com `language`) e responde 'path is required (or code with language).'. runFromArgs(deps, args, client) chama parseRunRequest e depois deps.engine.run. A interface ScriptToolsDeps tem engine, vaultBasePath, getSettings, getDeclaredScripts. O módulo irmão AI Scripts registra no barramento de serviços do núcleo o serviço de nome `"scripts"` (constante SCRIPTS_SERVICE em C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\types\index.ts) cujo método `listScripts()` devolve (Promise de) uma lista de resumos com os campos `scriptId: string` e `scriptPath?: string` (caminho do arquivo relativo à raiz do cofre; ausente quando o script é uma nota sem arquivo). A tool run_ai_script do AI Scripts executa pelo script_id com `params` validados por schema, e NÃO é substituída por este alias. Em C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\core\ecosystem.ts o objeto `this.builtin` monta `scripts: { engine, vaultBasePath, getSettings, getDeclaredScripts }` e o barramento é `this.bus` (`this.bus.get<T>(name)`). ecosystem.ts já importa SECRETS_SERVICE de '../types'.

ARQUIVOS
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\runner\script-tools.ts`
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\core\ecosystem.ts` (só o objeto scripts dentro de this.builtin e o import)
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\runner\script-tools.test.ts`
- Não tocar: qualquer outro arquivo

REGRAS DESTA ETAPA
1. O formato do serviço é externo: trate cada item de listScripts() como desconhecido e confira os tipos em tempo de execução (item é objeto, scriptId é string, scriptPath é string não vazia).
2. A política do Script Engine continua valendo: depois de resolver o caminho, quem decide se roda é engine.run (não crie atalho que pule a política).
3. path e code continuam funcionando exatamente como antes; script_id só é usado quando path e code não vêm.

O QUE FAZER, NESTA ORDEM
1. Em script-tools.ts exporte `export interface ScriptsLookup { listScripts(): Promise<unknown[]> | unknown[] }` e acrescente em ScriptToolsDeps o campo opcional `getScriptsService?: () => ScriptsLookup | undefined;`.
2. Crie `async function resolveScriptId(deps: ScriptToolsDeps, raw: unknown): Promise<{ ok: true; args: unknown } | { ok: false; message: string }>`. Se `raw` não for objeto simples ou `script_id` não for string não vazia (depois de trim), devolva `{ ok: true, args: raw }` sem mexer. Se também vier `path` não vazio ou `code` definido, devolva `{ ok: false, message: "Give path or script_id, not both." }`. Busque `const service = deps.getScriptsService?.();`; se não houver service ou `typeof service.listScripts !== "function"`, devolva a mensagem `script_id "ID": AI Scripts is not available. Pass path (a script file of the vault) instead.`. Chame listScripts dentro de try/catch (erro vira a mesma mensagem de indisponível). Ache o item cujo `scriptId` seja igual ao pedido; se não achar: `script_id "ID" is not registered in AI Scripts. Call list_ai_scripts to see the ids, or pass path.`; se achar mas sem `scriptPath` string não vazia: `The script "ID" is registered in AI Scripts but has no script file here. Run it with run_ai_script {"script_id":"ID","params":{...}}.`; se achar com scriptPath, devolva `{ ok: true, args: { ...raw, path: scriptPath, script_id: undefined } }` (apague a chave script_id do objeto em vez de deixar undefined).
3. Em runFromArgs, antes de parseRunRequest, chame resolveScriptId; se `ok === false` devolva `{ kind: "invalid", message }`; senão use `resolved.args` no parse.
4. Em parseRunRequest troque a mensagem de 'path is required (or code with language).' por `path is required: a script path of the vault such as "Scripts/report.py" (see ecosystem_list_scripts), a script_id registered in AI Scripts, or code with language.` e valide `script_id`: se existir e não for string devolva `script_id must be a string.`.
5. No inputSchema da runTool acrescente `script_id: { type: "string", description: "Id of a script registered in AI Scripts that is a script file; resolved to its path. Alternative to path." }` e mude a descrição de `path` para `Script path relative to the vault root, e.g. "Scripts/report.py". Required unless script_id or code is given.`.
6. Em C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\core\ecosystem.ts importe `SCRIPTS_SERVICE` de '../types' (junto de SECRETS_SERVICE) e `import type { ScriptsLookup } from "../runner/script-tools";` (se já houver import de script-tools, estenda-o) e no objeto `scripts: {...}` de this.builtin acrescente `getScriptsService: () => this.bus.get<ScriptsLookup>(SCRIPTS_SERVICE),`.
7. Em C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\runner\script-tools.test.ts: estenda a função deps() para aceitar um getScriptsService opcional. Testes: (a) serviço com [{ scriptId: 'hello', scriptPath: 'Scripts/hello.js' }] e arquivo Scripts/hello.js que imprime 'oi': chamar com script_id 'hello' roda e stdout traz 'oi'; (b) script_id desconhecido → isError e texto contém 'not registered in AI Scripts'; (c) sem serviço → texto contém 'AI Scripts is not available'; (d) item sem scriptPath → texto contém 'run_ai_script'; (e) path e script_id juntos → 'not both'; (f) sem path nem script_id nem code → texto contém 'script_id'; (g) o script_id resolvido para uma pasta não permitida é recusado pelo engine (isError 'Script refused').

O QUE NÃO FAZER
- Não altere o módulo AI Scripts (outro repositório).
- Não mexa na rota REST nem em outros trechos de ecosystem.ts.

CRITÉRIOS DE ACEITE
- Dado o serviço scripts com { scriptId: 'hello', scriptPath: 'Scripts/hello.js' } e esse arquivo imprimindo 'oi', Quando chamo ecosystem_run_script com script_id 'hello', Então roda o arquivo e stdout contém 'oi'.
- Dado um script_id que o AI Scripts não conhece, Quando chamo, Então o resultado é isError e a mensagem cita list_ai_scripts e path.
- Dado um script do AI Scripts sem arquivo, Quando chamo com o script_id dele, Então a mensagem manda usar run_ai_script.
- Dado path 'Scripts/a.js' e script_id juntos, Quando chamo, Então isError 'Give path or script_id, not both.'.
- Dado só path (uso antigo), Quando chamo, Então tudo funciona como antes (testes existentes passam).

VERIFICAÇÃO (rode a partir de C:\Users\Trabalho\Documents\obsidian-ai-ecosystem e cole a saída real)
- npx tsc --noEmit → sem erros
- npx vitest run tests/runner/script-tools.test.ts tests/core/builtin-module.test.ts tests/integration/ecosystem.test.ts → todos passam

Se qualquer coisa não bater com o descrito (arquivo, função ou assinatura inexistente, comportamento diferente do dito acima, teste quebrado por motivo alheio a esta etapa), PARE e relate em vez de improvisar.
RELATÓRIO FINAL: liste os arquivos alterados ou criados (caminho absoluto), cole a saída real de cada comando de verificação (não resuma) e descreva qualquer desvio ou dúvida.
```

## Etapa 5: Lote genérico no tools_run [Haiku 5.5 | esforço: alto]

**Objetivo:** fazer tools_run aceitar calls:[{id,args}] (até 10) para qualquer módulo, rodando em sequência e devolvendo uma saída resumida por item.
**Depende de:** Etapa 4 (script_id como alias no ecosystem_run_script)
**Paralelizável com:** nenhuma

**Arquivos**
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\tool-index\discovery-tools.ts`
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\tool-index\federation.test.ts`
- Não tocar: qualquer outro arquivo

**Regras de implementação**
1. O caminho de uma tool só (id + args) não pode mudar de comportamento nem de resposta (o teste 'returns the registered handler answer unchanged' continua verde: o resultado é devolvido sem cópia).
2. Itens do lote rodam um por vez, em ordem, e um item que falha não impede os seguintes.
3. Cada item respeita as mesmas regras do chamado individual: tools_run dentro de calls é recusado, módulo oculto é recusado, id desconhecido vira erro do item.

**Passos**
1. Extraia o corpo atual do handler (da leitura de id/args até o return de report) para uma função interna `async function runOne(id: string, rawArgs: unknown, ctx: HubCallContext): Promise<HubToolResult>` que contém a validação de args (objeto ou texto JSON), a recusa de 'tools_run', a busca da tool registrada, o fallback para o runner do índice e as mensagens de erro iguais às de hoje. O caminho de uma tool só passa a ser `runOne(id, args.args ?? {}, ctx)` depois de validar que id é string não vazia (mensagem atual 'Invalid arguments: id is required.').
2. Acrescente as constantes `const MAX_BATCH_CALLS = 10;` e `const BATCH_ITEM_CHARS = 1500;`.
3. Novo ramo no handler, antes do caminho de uma tool só: se `args.calls !== undefined`: se também vier `id` não vazio → `text("Invalid arguments: give id or calls, not both.", true)`; se `calls` não for array, estiver vazio ou tiver mais de MAX_BATCH_CALLS itens → `text("Invalid arguments: calls must be a list of 1 to 10 items {id, args}.", true)`. Rode cada item em sequência: item que não for objeto com `id` string não vazia vira um resultado de erro `text("Invalid arguments: item needs an id.", true)` sem abortar os outros; os demais usam `await runOne(item.id.trim(), item.args ?? {}, ctx)`.
4. Monte a resposta do lote: para cada item i (começando em 1) uma seção `"[" + i + "/" + n + "] " + id + " -> " + (result.isError ? "error" : "ok") + "\n" + resumo`, separadas por uma linha em branco, onde `resumo` é o texto dos blocos de conteúdo (blocos type text unidos por \n; bloco de imagem vira '[image]') cortado em BATCH_ITEM_CHARS caracteres: se passar, `texto.slice(0, BATCH_ITEM_CHARS) + "\n[... " + (texto.length - BATCH_ITEM_CHARS) + " characters omitted; call the tool alone for the full answer ...]"`. O resultado final é `{ content: [{ type: "text", text }], ...(todosFalharam ? { isError: true } : {}) }` onde todosFalharam = todos os itens com isError (um lote com sucesso parcial NÃO é isError).
5. Ajuste o inputSchema: acrescente `calls: { type: "array", maxItems: 10, description: "Several tools in one call, run one after the other (max 10), each answer summarized. Use instead of id and args.", items: { type: "object", properties: { id: { type: "string" }, args: { type: "object" } }, required: ["id"], additionalProperties: false } }` e REMOVA `required: ["id"]`. Na descrição acrescente a frase `Pass calls to run several tools in one call.`. Troque o resumo para `"Executa uma tool pelo id (ou várias em calls), repassando os argumentos ao módulo dono"`.
6. Em C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\tool-index\federation.test.ts acrescente no describe 'discovery tools': (a) lote de duas tools registradas devolve duas seções '[1/2] git_status -> ok' e '[2/2] ...'; (b) um item que lança exceção e outro ok: o lote não é isError, a seção do que falhou diz '-> error' e results (onToolResult) registra os dois módulos; (c) todos falham → isError; (d) item com texto de 3000 caracteres é cortado com 'characters omitted'; (e) calls junto com id → isError 'not both'; (f) 11 itens → isError; (g) item com id 'tools_run' → seção '-> error' com 'cannot run itself'; (h) a chamada de uma tool só continua devolvendo o mesmo objeto (já coberta, só confira).

**BDD (estado esperado ao concluir)**
- Dado duas tools registradas, Quando chamo tools_run com calls de 2 itens, Então a resposta tem as seções '[1/2] <id> -> ok' e '[2/2] <id> -> ok' na ordem.
- Dado um lote em que o 1º item lança exceção, Quando chamo, Então o 2º item ainda roda e o lote não é isError.
- Dado calls com 11 itens, Quando chamo, Então isError com 'calls must be a list of 1 to 10 items'.
- Dado id e calls juntos, Quando chamo, Então isError com 'not both'.
- Dado só id e args (uso antigo), Quando chamo, Então o resultado é o mesmo objeto devolvido pelo handler da tool.

**Verificação** (comandos a rodar, com o resultado esperado)
- npx tsc --noEmit → sem erros
- npx vitest run tests/tool-index tests/integration/indexed-mode.test.ts → todos passam

**Prompt para o subagente**
```text
Você é um subagente de implementação em TypeScript. Objetivo desta etapa: fazer tools_run aceitar calls:[{id,args}] (até 10) para qualquer módulo, rodando em sequência e devolvendo uma saída resumida por item.

CONTEXTO COMPLETO
Projeto: plugin do Obsidian chamado AI Ecosystem (núcleo da suíte de plugins de IA), escrito em TypeScript, com servidor MCP e REST local, executor de scripts, índice e descoberta de tools (tools_find, tools_describe, tools_run), hooks do Claude Code gravados nas settings do cofre, configuração guiada de módulos, telas (formulários) e um inspetor de requisições. Raiz do repositório (RAIZ): C:\Users\Trabalho\Documents\obsidian-ai-ecosystem. Testes com vitest (pasta tests), sem Obsidian real (há um mock em tests\mocks\obsidian.ts).
Objetivo geral da demanda: implementar 16 melhorias aceitas numa auditoria do núcleo, na ordem: (1) teto de saída do ecosystem_run_script; (2) ecosystem_status compacto; (3) script_id no executor; (4) lote no tools_run; (5) diagnóstico que percebe módulo defasado; (6) cancelamento do run_script; (7) remover a aprovação do tools_run e o código morto; (8) limitar o activity.sqlite; (9) setup_status, list_scripts e diagnóstico enxutos; (10) resumo dos módulos no início da sessão; (11) tela_gerenciar e setup oculto sem pendência; (12) setup_save em lote; (13) descrição curta do run_script; (14) falha do módulo só por exceção; (15) catálogo por manifest.version; (16) despachante único dos hooks de proteção.
Regras globais:
1. Idioma: o código, os comentários e os nomes de identificadores ficam em inglês (como já está nos arquivos); as mensagens do diagnóstico, do hook e dos achados ficam em português quando o arquivo já estiver em português; o README tem uma parte em inglês e uma em português espelhadas.
2. Estilo do código: TypeScript estrito, 2 espaços, aspas duplas, ponto e vírgula, `import type` para tipos, sem dependências novas e sem alterar package.json.
3. Os diretórios src/runner, src/server, src/registry, src/hooks, src/core, src/setup, src/tool-index são código Node puro: não importam o pacote "obsidian".
4. O script src/hooks/script/ai-ecosystem-hook.mjs é Node puro, sem dependências, e nunca pode atrapalhar o agente: qualquer problema termina com saída 0 e sem texto.
5. Comandos, sempre a partir de C:\Users\Trabalho\Documents\obsidian-ai-ecosystem: typecheck `npx tsc --noEmit`; testes `npx vitest run` (um arquivo: `npx vitest run tests\pasta\arquivo.test.ts`); lint `npx eslint .`; build `npm run build`.
6. Linha de base antes das mudanças: tsc sem erros; 54 arquivos de teste e 918 testes passando; eslint com 0 erros e 19 avisos (nenhum erro ou aviso novo pode surgir).
7. Cada etapa altera só os arquivos listados nela. Não faça commit, push, deploy nem mexa na pasta .git; não rode `npm install`; não escreva nem leia segredos, tokens ou arquivos .env.
8. Se algo não bater com o descrito (arquivo, função ou assinatura inexistente, teste quebrado por motivo alheio à etapa), pare e relate em vez de improvisar.

O QUE JÁ EXISTE E É RELEVANTE PARA ESTA ETAPA
Em C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\tool-index\discovery-tools.ts a função createDiscoveryTools(deps) cria três tools: tools_find, tools_describe e tools_run. O handler de tools_run lê `id` (string) e `args` (objeto ou texto JSON), recusa id 'tools_run', procura a tool registrada com deps.findTool(id) (e confere hidden(...)), ou, se não houver, procura no índice com deps.federation.get([id]) e usa o serviço runner (`toolRunnerServiceName(entry.moduleId)`); o resultado passa por `report(moduleId, call)` que usa `safe(call)` (transforma exceção em resultado de erro 'Error: ...') e chama deps.onToolResult. O inputSchema hoje tem `id` e `args` e `required: ["id"]`. Os testes de tools_run ficam em C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\tool-index\federation.test.ts no describe 'discovery tools' (helpers: discovery(), register(), index(), tool(), textOf(), ctx). O HubToolResult é { content: [{type:'text', text} | {type:'image', ...}], structuredContent?, isError? }.

ARQUIVOS
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\tool-index\discovery-tools.ts`
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\tool-index\federation.test.ts`
- Não tocar: qualquer outro arquivo

REGRAS DESTA ETAPA
1. O caminho de uma tool só (id + args) não pode mudar de comportamento nem de resposta (o teste 'returns the registered handler answer unchanged' continua verde: o resultado é devolvido sem cópia).
2. Itens do lote rodam um por vez, em ordem, e um item que falha não impede os seguintes.
3. Cada item respeita as mesmas regras do chamado individual: tools_run dentro de calls é recusado, módulo oculto é recusado, id desconhecido vira erro do item.

O QUE FAZER, NESTA ORDEM
1. Extraia o corpo atual do handler (da leitura de id/args até o return de report) para uma função interna `async function runOne(id: string, rawArgs: unknown, ctx: HubCallContext): Promise<HubToolResult>` que contém a validação de args (objeto ou texto JSON), a recusa de 'tools_run', a busca da tool registrada, o fallback para o runner do índice e as mensagens de erro iguais às de hoje. O caminho de uma tool só passa a ser `runOne(id, args.args ?? {}, ctx)` depois de validar que id é string não vazia (mensagem atual 'Invalid arguments: id is required.').
2. Acrescente as constantes `const MAX_BATCH_CALLS = 10;` e `const BATCH_ITEM_CHARS = 1500;`.
3. Novo ramo no handler, antes do caminho de uma tool só: se `args.calls !== undefined`: se também vier `id` não vazio → `text("Invalid arguments: give id or calls, not both.", true)`; se `calls` não for array, estiver vazio ou tiver mais de MAX_BATCH_CALLS itens → `text("Invalid arguments: calls must be a list of 1 to 10 items {id, args}.", true)`. Rode cada item em sequência: item que não for objeto com `id` string não vazia vira um resultado de erro `text("Invalid arguments: item needs an id.", true)` sem abortar os outros; os demais usam `await runOne(item.id.trim(), item.args ?? {}, ctx)`.
4. Monte a resposta do lote: para cada item i (começando em 1) uma seção `"[" + i + "/" + n + "] " + id + " -> " + (result.isError ? "error" : "ok") + "\n" + resumo`, separadas por uma linha em branco, onde `resumo` é o texto dos blocos de conteúdo (blocos type text unidos por \n; bloco de imagem vira '[image]') cortado em BATCH_ITEM_CHARS caracteres: se passar, `texto.slice(0, BATCH_ITEM_CHARS) + "\n[... " + (texto.length - BATCH_ITEM_CHARS) + " characters omitted; call the tool alone for the full answer ...]"`. O resultado final é `{ content: [{ type: "text", text }], ...(todosFalharam ? { isError: true } : {}) }` onde todosFalharam = todos os itens com isError (um lote com sucesso parcial NÃO é isError).
5. Ajuste o inputSchema: acrescente `calls: { type: "array", maxItems: 10, description: "Several tools in one call, run one after the other (max 10), each answer summarized. Use instead of id and args.", items: { type: "object", properties: { id: { type: "string" }, args: { type: "object" } }, required: ["id"], additionalProperties: false } }` e REMOVA `required: ["id"]`. Na descrição acrescente a frase `Pass calls to run several tools in one call.`. Troque o resumo para `"Executa uma tool pelo id (ou várias em calls), repassando os argumentos ao módulo dono"`.
6. Em C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\tool-index\federation.test.ts acrescente no describe 'discovery tools': (a) lote de duas tools registradas devolve duas seções '[1/2] git_status -> ok' e '[2/2] ...'; (b) um item que lança exceção e outro ok: o lote não é isError, a seção do que falhou diz '-> error' e results (onToolResult) registra os dois módulos; (c) todos falham → isError; (d) item com texto de 3000 caracteres é cortado com 'characters omitted'; (e) calls junto com id → isError 'not both'; (f) 11 itens → isError; (g) item com id 'tools_run' → seção '-> error' com 'cannot run itself'; (h) a chamada de uma tool só continua devolvendo o mesmo objeto (já coberta, só confira).

O QUE NÃO FAZER
- Não altere tools_find nem tools_describe.
- Não toque no hook de execução nem no script de hooks.

CRITÉRIOS DE ACEITE
- Dado duas tools registradas, Quando chamo tools_run com calls de 2 itens, Então a resposta tem as seções '[1/2] <id> -> ok' e '[2/2] <id> -> ok' na ordem.
- Dado um lote em que o 1º item lança exceção, Quando chamo, Então o 2º item ainda roda e o lote não é isError.
- Dado calls com 11 itens, Quando chamo, Então isError com 'calls must be a list of 1 to 10 items'.
- Dado id e calls juntos, Quando chamo, Então isError com 'not both'.
- Dado só id e args (uso antigo), Quando chamo, Então o resultado é o mesmo objeto devolvido pelo handler da tool.

VERIFICAÇÃO (rode a partir de C:\Users\Trabalho\Documents\obsidian-ai-ecosystem e cole a saída real)
- npx tsc --noEmit → sem erros
- npx vitest run tests/tool-index tests/integration/indexed-mode.test.ts → todos passam

Se qualquer coisa não bater com o descrito (arquivo, função ou assinatura inexistente, comportamento diferente do dito acima, teste quebrado por motivo alheio a esta etapa), PARE e relate em vez de improvisar.
RELATÓRIO FINAL: liste os arquivos alterados ou criados (caminho absoluto), cole a saída real de cada comando de verificação (não resuma) e descreva qualquer desvio ou dúvida.
```

## Etapa 6: Diagnóstico percebe módulo defasado [Haiku 5.5 | esforço: alto]

**Objetivo:** fazer ecosystem_diagnostico avisar quando um módulo registrado está numa versão diferente do manifest.json em disco ou quando o main.js dele é mais novo que o momento em que ele foi carregado.
**Depende de:** Etapa 5 (Lote genérico no tools_run)
**Paralelizável com:** nenhuma

**Arquivos**
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\core\diagnostic.ts`
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\core\builtin-module.ts` (só BuiltinModuleDeps: dois campos opcionais)
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\core\ecosystem.ts` (só o objeto this.builtin: dois campos)
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\core\diagnostic.test.ts`
- Não tocar: qualquer outro arquivo

**Regras de implementação**
1. Só leitura: use fs.readFileSync/statSync dentro de try/catch; qualquer erro de leitura significa 'sem sinal' e nenhum achado.
2. Não gere achado 'ok' para essa verificação (só avisos), para não aumentar a saída.
3. A mensagem não pode conter caminho de arquivo.
4. Sem vaultBasePath ou configDir nos deps, a verificação é pulada (os testes atuais não passam esses campos e não podem mudar).

**Passos**
1. Em diagnostic.ts importe `import * as fs from "node:fs";` e `import * as path from "node:path";` e acrescente em DiagnosticDeps os campos opcionais `vaultBasePath?: string;` e `configDir?: string;` (com comentário: absolute vault folder and Obsidian config folder name, used to compare the loaded modules with the files on disk). Acrescente os mesmos dois campos opcionais em BuiltinModuleDeps (builtin-module.ts) e, em ecosystem.ts, no objeto this.builtin: `vaultBasePath: deps.vaultBasePath,` e `configDir: deps.configDir,`.
2. Crie em diagnostic.ts a função `function staleModuleFinding(deps: DiagnosticDeps, info: ModuleInfo, name: string): Finding | undefined`. Se `!deps.vaultBasePath || !deps.configDir` devolva undefined. `const dir = path.join(deps.vaultBasePath, deps.configDir, "plugins", info.id);`. Leia `manifest.json` (JSON.parse em try/catch) e, se `typeof manifest.version === "string" && manifest.version !== info.version`, devolva um achado `{ id: "defasado:" + info.id, area: "modulos", severidade: "aviso", mensagem: name + ": carregado na versão " + info.version + ", mas o manifest.json em disco é " + manifest.version + ".", acao: STALE_ACTION }`. Senão, `fs.statSync(path.join(dir, "main.js")).mtimeMs`: se for maior que `info.registeredAt + 5000` devolva `{ id: "defasado:" + info.id, area: "modulos", severidade: "aviso", mensagem: name + ": o main.js em disco foi alterado depois de o módulo ser carregado.", acao: STALE_ACTION }`. Senão undefined. `const STALE_ACTION = "Recarregue o plugin (desative e ative de novo em Plugins da comunidade) para carregar a versão que está em disco.";`.
3. No laço de SUITE_MODULES (e para o próprio ECOSYSTEM_ID, que já faz parte de SUITE_MODULES), logo depois de tratar um módulo registrado, chame staleModuleFinding e, se devolver algo, `add(...)`. Não substitua o achado 'ok' existente do módulo: o aviso é um achado a mais.
4. Em C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\core\diagnostic.test.ts crie um vault temporário (fs.mkdtempSync em os.tmpdir()) com `.obsidian/plugins/ai-git-tools/manifest.json` e `main.js` e use deps({ vaultBasePath, configDir: '.obsidian' }). Casos: (a) manifest.version igual à versão registrada e main.js antigo (use fs.utimesSync para um mtime bem anterior a registeredAt) → nenhum achado 'defasado:'; (b) manifest.version '9.9.9' diferente → um aviso 'defasado:ai-git-tools' com as duas versões na mensagem; (c) mesma versão e main.js com mtime = agora e registeredAt = 1 → aviso do main.js; (d) sem pasta do plugin → nenhum achado; (e) a mensagem nunca contém o caminho do vault temporário. Remova o vault temporário no fim (afterEach).

**BDD (estado esperado ao concluir)**
- Dado um módulo registrado na versão 1.0.0 cujo manifest.json em disco diz 9.9.9, Quando rodo ecosystem_diagnostico, Então há um aviso 'defasado:<id>' citando as duas versões.
- Dado um módulo cuja versão bate mas o main.js foi modificado depois de registeredAt + 5 s, Quando rodo, Então há um aviso dizendo que o main.js em disco foi alterado depois do carregamento.
- Dado um módulo em dia, Quando rodo, Então não aparece nenhum achado 'defasado:'.
- Dado deps sem vaultBasePath, Quando rodo, Então a verificação é pulada e os testes existentes passam sem mudança.

**Verificação** (comandos a rodar, com o resultado esperado)
- npx tsc --noEmit → sem erros
- npx vitest run tests/core → todos passam

**Prompt para o subagente**
```text
Você é um subagente de implementação em TypeScript. Objetivo desta etapa: fazer ecosystem_diagnostico avisar quando um módulo registrado está numa versão diferente do manifest.json em disco ou quando o main.js dele é mais novo que o momento em que ele foi carregado.

CONTEXTO COMPLETO
Projeto: plugin do Obsidian chamado AI Ecosystem (núcleo da suíte de plugins de IA), escrito em TypeScript, com servidor MCP e REST local, executor de scripts, índice e descoberta de tools (tools_find, tools_describe, tools_run), hooks do Claude Code gravados nas settings do cofre, configuração guiada de módulos, telas (formulários) e um inspetor de requisições. Raiz do repositório (RAIZ): C:\Users\Trabalho\Documents\obsidian-ai-ecosystem. Testes com vitest (pasta tests), sem Obsidian real (há um mock em tests\mocks\obsidian.ts).
Objetivo geral da demanda: implementar 16 melhorias aceitas numa auditoria do núcleo, na ordem: (1) teto de saída do ecosystem_run_script; (2) ecosystem_status compacto; (3) script_id no executor; (4) lote no tools_run; (5) diagnóstico que percebe módulo defasado; (6) cancelamento do run_script; (7) remover a aprovação do tools_run e o código morto; (8) limitar o activity.sqlite; (9) setup_status, list_scripts e diagnóstico enxutos; (10) resumo dos módulos no início da sessão; (11) tela_gerenciar e setup oculto sem pendência; (12) setup_save em lote; (13) descrição curta do run_script; (14) falha do módulo só por exceção; (15) catálogo por manifest.version; (16) despachante único dos hooks de proteção.
Regras globais:
1. Idioma: o código, os comentários e os nomes de identificadores ficam em inglês (como já está nos arquivos); as mensagens do diagnóstico, do hook e dos achados ficam em português quando o arquivo já estiver em português; o README tem uma parte em inglês e uma em português espelhadas.
2. Estilo do código: TypeScript estrito, 2 espaços, aspas duplas, ponto e vírgula, `import type` para tipos, sem dependências novas e sem alterar package.json.
3. Os diretórios src/runner, src/server, src/registry, src/hooks, src/core, src/setup, src/tool-index são código Node puro: não importam o pacote "obsidian".
4. O script src/hooks/script/ai-ecosystem-hook.mjs é Node puro, sem dependências, e nunca pode atrapalhar o agente: qualquer problema termina com saída 0 e sem texto.
5. Comandos, sempre a partir de C:\Users\Trabalho\Documents\obsidian-ai-ecosystem: typecheck `npx tsc --noEmit`; testes `npx vitest run` (um arquivo: `npx vitest run tests\pasta\arquivo.test.ts`); lint `npx eslint .`; build `npm run build`.
6. Linha de base antes das mudanças: tsc sem erros; 54 arquivos de teste e 918 testes passando; eslint com 0 erros e 19 avisos (nenhum erro ou aviso novo pode surgir).
7. Cada etapa altera só os arquivos listados nela. Não faça commit, push, deploy nem mexa na pasta .git; não rode `npm install`; não escreva nem leia segredos, tokens ou arquivos .env.
8. Se algo não bater com o descrito (arquivo, função ou assinatura inexistente, teste quebrado por motivo alheio à etapa), pare e relate em vez de improvisar.

O QUE JÁ EXISTE E É RELEVANTE PARA ESTA ETAPA
Em C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\core\diagnostic.ts, buildDiagnostic(deps: DiagnosticDeps) monta achados (Finding { id, area, severidade: 'ok'|'aviso'|'erro', mensagem, acao? }). O primeiro bloco percorre SUITE_MODULES e, para cada módulo registrado (deps.listModules(): ModuleInfo[] com id, name, version, registeredAt em ms), adiciona achados 'modulo:<id>'. As mensagens são em português. DiagnosticDeps tem version, getServerStatus, listModules, getHooksStatus?, getService?. createDiagnosticTool(deps: DiagnosticDeps) é chamada em C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\core\builtin-module.ts com o objeto BuiltinModuleDeps inteiro (createBuiltinTools faz createDiagnosticTool(deps)), então campos novos em BuiltinModuleDeps chegam ao diagnóstico se também existirem em DiagnosticDeps. Em C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\core\ecosystem.ts o objeto this.builtin recebe version, listModules etc. e a classe Ecosystem tem deps.vaultBasePath (string absoluta) e deps.configDir (string opcional, ex. '.obsidian'). Os plugins ficam em <vaultBasePath>/<configDir>/plugins/<id>/ com manifest.json e main.js. O diagnóstico NUNCA pode mostrar caminho do usuário, só contagens e sim/não (há um teste de sentinelas em C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\core\diagnostic.test.ts).

ARQUIVOS
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\core\diagnostic.ts`
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\core\builtin-module.ts` (só BuiltinModuleDeps: dois campos opcionais)
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\core\ecosystem.ts` (só o objeto this.builtin: dois campos)
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\core\diagnostic.test.ts`
- Não tocar: qualquer outro arquivo

REGRAS DESTA ETAPA
1. Só leitura: use fs.readFileSync/statSync dentro de try/catch; qualquer erro de leitura significa 'sem sinal' e nenhum achado.
2. Não gere achado 'ok' para essa verificação (só avisos), para não aumentar a saída.
3. A mensagem não pode conter caminho de arquivo.
4. Sem vaultBasePath ou configDir nos deps, a verificação é pulada (os testes atuais não passam esses campos e não podem mudar).

O QUE FAZER, NESTA ORDEM
1. Em diagnostic.ts importe `import * as fs from "node:fs";` e `import * as path from "node:path";` e acrescente em DiagnosticDeps os campos opcionais `vaultBasePath?: string;` e `configDir?: string;` (com comentário: absolute vault folder and Obsidian config folder name, used to compare the loaded modules with the files on disk). Acrescente os mesmos dois campos opcionais em BuiltinModuleDeps (builtin-module.ts) e, em ecosystem.ts, no objeto this.builtin: `vaultBasePath: deps.vaultBasePath,` e `configDir: deps.configDir,`.
2. Crie em diagnostic.ts a função `function staleModuleFinding(deps: DiagnosticDeps, info: ModuleInfo, name: string): Finding | undefined`. Se `!deps.vaultBasePath || !deps.configDir` devolva undefined. `const dir = path.join(deps.vaultBasePath, deps.configDir, "plugins", info.id);`. Leia `manifest.json` (JSON.parse em try/catch) e, se `typeof manifest.version === "string" && manifest.version !== info.version`, devolva um achado `{ id: "defasado:" + info.id, area: "modulos", severidade: "aviso", mensagem: name + ": carregado na versão " + info.version + ", mas o manifest.json em disco é " + manifest.version + ".", acao: STALE_ACTION }`. Senão, `fs.statSync(path.join(dir, "main.js")).mtimeMs`: se for maior que `info.registeredAt + 5000` devolva `{ id: "defasado:" + info.id, area: "modulos", severidade: "aviso", mensagem: name + ": o main.js em disco foi alterado depois de o módulo ser carregado.", acao: STALE_ACTION }`. Senão undefined. `const STALE_ACTION = "Recarregue o plugin (desative e ative de novo em Plugins da comunidade) para carregar a versão que está em disco.";`.
3. No laço de SUITE_MODULES (e para o próprio ECOSYSTEM_ID, que já faz parte de SUITE_MODULES), logo depois de tratar um módulo registrado, chame staleModuleFinding e, se devolver algo, `add(...)`. Não substitua o achado 'ok' existente do módulo: o aviso é um achado a mais.
4. Em C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\core\diagnostic.test.ts crie um vault temporário (fs.mkdtempSync em os.tmpdir()) com `.obsidian/plugins/ai-git-tools/manifest.json` e `main.js` e use deps({ vaultBasePath, configDir: '.obsidian' }). Casos: (a) manifest.version igual à versão registrada e main.js antigo (use fs.utimesSync para um mtime bem anterior a registeredAt) → nenhum achado 'defasado:'; (b) manifest.version '9.9.9' diferente → um aviso 'defasado:ai-git-tools' com as duas versões na mensagem; (c) mesma versão e main.js com mtime = agora e registeredAt = 1 → aviso do main.js; (d) sem pasta do plugin → nenhum achado; (e) a mensagem nunca contém o caminho do vault temporário. Remova o vault temporário no fim (afterEach).

O QUE NÃO FAZER
- Não implemente nada sobre .deploy-target (fora do escopo desta etapa).
- Não altere o formato dos outros achados.

CRITÉRIOS DE ACEITE
- Dado um módulo registrado na versão 1.0.0 cujo manifest.json em disco diz 9.9.9, Quando rodo ecosystem_diagnostico, Então há um aviso 'defasado:<id>' citando as duas versões.
- Dado um módulo cuja versão bate mas o main.js foi modificado depois de registeredAt + 5 s, Quando rodo, Então há um aviso dizendo que o main.js em disco foi alterado depois do carregamento.
- Dado um módulo em dia, Quando rodo, Então não aparece nenhum achado 'defasado:'.
- Dado deps sem vaultBasePath, Quando rodo, Então a verificação é pulada e os testes existentes passam sem mudança.

VERIFICAÇÃO (rode a partir de C:\Users\Trabalho\Documents\obsidian-ai-ecosystem e cole a saída real)
- npx tsc --noEmit → sem erros
- npx vitest run tests/core → todos passam

Se qualquer coisa não bater com o descrito (arquivo, função ou assinatura inexistente, comportamento diferente do dito acima, teste quebrado por motivo alheio a esta etapa), PARE e relate em vez de improvisar.
RELATÓRIO FINAL: liste os arquivos alterados ou criados (caminho absoluto), cole a saída real de cada comando de verificação (não resuma) e descreva qualquer desvio ou dúvida.
```

## Etapa 7: ecosystem_run_script respeita o cancelamento [Haiku 5.5 | esforço: médio]

**Objetivo:** passar o AbortSignal da chamada MCP ao motor de scripts, para o processo ser morto quando o agente cancela ou a conexão cai.
**Depende de:** Etapa 6 (Diagnóstico percebe módulo defasado)
**Paralelizável com:** nenhuma

**Arquivos**
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\runner\script-tools.ts`
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\runner\script-tools.test.ts`
- Não tocar: qualquer outro arquivo

**Regras de implementação**
1. A rota REST não tem sinal: ela continua sem passá-lo.
2. Não altere script-engine.ts nem mcp-host.ts.

**Passos**
1. Em runFromArgs acrescente o quarto parâmetro `signal?: AbortSignal` e faça `deps.engine.run({ ...parsed.options, ...(signal ? { signal } : {}) }, { moduleId: ECOSYSTEM_ID, client })`.
2. No handler da runTool passe `ctx.signal` como quarto argumento de runFromArgs. A rota REST continua chamando com três argumentos.
3. Em C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\runner\script-tools.test.ts acrescente um teste: crie Scripts/sleep.js com `setTimeout(function () {}, 30000);`, crie um AbortController, chame o handler da runTool com `{ ...ctx, signal: controller.signal }` e args `{ path: "Scripts/sleep.js" }`, aborte após 300 ms e confirme que a promessa resolve em menos de 10 s com `structuredContent.killed === true` e texto contendo 'Killed: yes'. Dê ao teste um timeout de 15000 ms.

**BDD (estado esperado ao concluir)**
- Dado um script que dorme 30 s, Quando a chamada é abortada após 300 ms, Então a tool responde em menos de 10 s com killed true.
- Dado uma chamada sem sinal, Quando o script termina normalmente, Então o resultado é o mesmo de antes.

**Verificação** (comandos a rodar, com o resultado esperado)
- npx tsc --noEmit → sem erros
- npx vitest run tests/runner tests/server/cancellation.test.ts → todos passam

**Prompt para o subagente**
```text
Você é um subagente de implementação em TypeScript. Objetivo desta etapa: passar o AbortSignal da chamada MCP ao motor de scripts, para o processo ser morto quando o agente cancela ou a conexão cai.

CONTEXTO COMPLETO
Projeto: plugin do Obsidian chamado AI Ecosystem (núcleo da suíte de plugins de IA), escrito em TypeScript, com servidor MCP e REST local, executor de scripts, índice e descoberta de tools (tools_find, tools_describe, tools_run), hooks do Claude Code gravados nas settings do cofre, configuração guiada de módulos, telas (formulários) e um inspetor de requisições. Raiz do repositório (RAIZ): C:\Users\Trabalho\Documents\obsidian-ai-ecosystem. Testes com vitest (pasta tests), sem Obsidian real (há um mock em tests\mocks\obsidian.ts).
Objetivo geral da demanda: implementar 16 melhorias aceitas numa auditoria do núcleo, na ordem: (1) teto de saída do ecosystem_run_script; (2) ecosystem_status compacto; (3) script_id no executor; (4) lote no tools_run; (5) diagnóstico que percebe módulo defasado; (6) cancelamento do run_script; (7) remover a aprovação do tools_run e o código morto; (8) limitar o activity.sqlite; (9) setup_status, list_scripts e diagnóstico enxutos; (10) resumo dos módulos no início da sessão; (11) tela_gerenciar e setup oculto sem pendência; (12) setup_save em lote; (13) descrição curta do run_script; (14) falha do módulo só por exceção; (15) catálogo por manifest.version; (16) despachante único dos hooks de proteção.
Regras globais:
1. Idioma: o código, os comentários e os nomes de identificadores ficam em inglês (como já está nos arquivos); as mensagens do diagnóstico, do hook e dos achados ficam em português quando o arquivo já estiver em português; o README tem uma parte em inglês e uma em português espelhadas.
2. Estilo do código: TypeScript estrito, 2 espaços, aspas duplas, ponto e vírgula, `import type` para tipos, sem dependências novas e sem alterar package.json.
3. Os diretórios src/runner, src/server, src/registry, src/hooks, src/core, src/setup, src/tool-index são código Node puro: não importam o pacote "obsidian".
4. O script src/hooks/script/ai-ecosystem-hook.mjs é Node puro, sem dependências, e nunca pode atrapalhar o agente: qualquer problema termina com saída 0 e sem texto.
5. Comandos, sempre a partir de C:\Users\Trabalho\Documents\obsidian-ai-ecosystem: typecheck `npx tsc --noEmit`; testes `npx vitest run` (um arquivo: `npx vitest run tests\pasta\arquivo.test.ts`); lint `npx eslint .`; build `npm run build`.
6. Linha de base antes das mudanças: tsc sem erros; 54 arquivos de teste e 918 testes passando; eslint com 0 erros e 19 avisos (nenhum erro ou aviso novo pode surgir).
7. Cada etapa altera só os arquivos listados nela. Não faça commit, push, deploy nem mexa na pasta .git; não rode `npm install`; não escreva nem leia segredos, tokens ou arquivos .env.
8. Se algo não bater com o descrito (arquivo, função ou assinatura inexistente, teste quebrado por motivo alheio à etapa), pare e relate em vez de improvisar.

O QUE JÁ EXISTE E É RELEVANTE PARA ESTA ETAPA
Em C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\runner\script-tools.ts a função runFromArgs(deps, args, client) monta as opções do motor com parseRunRequest e chama `deps.engine.run(parsed.options, { moduleId: ECOSYSTEM_ID, client })`. A interface HubScriptOptions (em C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\types\index.ts) já tem o campo opcional `signal?: AbortSignal` e o motor (C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\runner\script-engine.ts) já mata o processo quando o sinal dispara (resultado com killed: true). O servidor MCP (C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\server\mcp-host.ts) já entrega `ctx.signal` ao handler da tool (HubCallContext.signal) e o aborta no notifications/cancelled ou quando a conexão fecha. Hoje o handler da runTool chama `runFromArgs(deps, args, ctx.client)` sem passar o sinal, então o script segue rodando até o timeout (300 s).

ARQUIVOS
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\runner\script-tools.ts`
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\runner\script-tools.test.ts`
- Não tocar: qualquer outro arquivo

REGRAS DESTA ETAPA
1. A rota REST não tem sinal: ela continua sem passá-lo.
2. Não altere script-engine.ts nem mcp-host.ts.

O QUE FAZER, NESTA ORDEM
1. Em runFromArgs acrescente o quarto parâmetro `signal?: AbortSignal` e faça `deps.engine.run({ ...parsed.options, ...(signal ? { signal } : {}) }, { moduleId: ECOSYSTEM_ID, client })`.
2. No handler da runTool passe `ctx.signal` como quarto argumento de runFromArgs. A rota REST continua chamando com três argumentos.
3. Em C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\runner\script-tools.test.ts acrescente um teste: crie Scripts/sleep.js com `setTimeout(function () {}, 30000);`, crie um AbortController, chame o handler da runTool com `{ ...ctx, signal: controller.signal }` e args `{ path: "Scripts/sleep.js" }`, aborte após 300 ms e confirme que a promessa resolve em menos de 10 s com `structuredContent.killed === true` e texto contendo 'Killed: yes'. Dê ao teste um timeout de 15000 ms.

O QUE NÃO FAZER
- Não toque em outros arquivos.

CRITÉRIOS DE ACEITE
- Dado um script que dorme 30 s, Quando a chamada é abortada após 300 ms, Então a tool responde em menos de 10 s com killed true.
- Dado uma chamada sem sinal, Quando o script termina normalmente, Então o resultado é o mesmo de antes.

VERIFICAÇÃO (rode a partir de C:\Users\Trabalho\Documents\obsidian-ai-ecosystem e cole a saída real)
- npx tsc --noEmit → sem erros
- npx vitest run tests/runner tests/server/cancellation.test.ts → todos passam

Se qualquer coisa não bater com o descrito (arquivo, função ou assinatura inexistente, comportamento diferente do dito acima, teste quebrado por motivo alheio a esta etapa), PARE e relate em vez de improvisar.
RELATÓRIO FINAL: liste os arquivos alterados ou criados (caminho absoluto), cole a saída real de cada comando de verificação (não resuma) e descreva qualquer desvio ou dúvida.
```

## Etapa 8: Remover a entrada de aprovação do tools_run das settings [Haiku 5.5 | esforço: alto]

**Objetivo:** parar de instalar o hook 'execucao' do tools_run (CORE_RUN_SPEC), remover a entrada antiga das settings na partida e tirar o campo coreRunApprovalInstalled.
**Depende de:** Etapa 7 (ecosystem_run_script respeita o cancelamento)
**Paralelizável com:** nenhuma

**Arquivos**
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\hooks\hook-specs.ts`
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\hooks\hook-manager.ts`
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\hooks\hook-manager.test.ts`
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\hooks\hook-execucao.test.ts` (só o import e o describe 'hook specs: execucao')
- Não tocar: qualquer outro arquivo

**Regras de implementação**
1. Mantenha 'execucao' em HookType e no COMMAND_PATTERN (entradas antigas precisam ser reconhecidas e removidas).
2. Remova só entradas com module === ECOSYSTEM_ID e type 'execucao'; nunca outras entradas do usuário.
3. Não deixe o resultado da remoção apagar um erro de install: registre (this.record) o resultado da remoção só quando `!ok`.
4. O script ai-ecosystem-hook.mjs NÃO é alterado nesta etapa.

**Passos**
1. Em hook-specs.ts apague a constante CORE_RUN_SPEC (e seu comentário) e deixe `export const CORE_SPECS: readonly HookSpec[] = [CORE_FAILURE_SPEC];`. Acima do tipo HookType acrescente o comentário `"execucao" is retired: no entry is written any more, the type stays so that entries from older versions are recognized and removed.`.
2. Em hook-manager.ts, dentro do try de installCore(), DEPOIS de `this.record(result);` acrescente: `for (const file of SETTINGS_FILES) { const removed = this.merger.remove(file, { module: ECOSYSTEM_ID, type: "execucao" }); if (!removed.ok) this.record(removed); }`.
3. Em hook-manager.ts apague o campo `coreRunApprovalInstalled?: boolean;` (e seu comentário) da interface HooksStatus e a linha correspondente de getStatus(). Rode `npx tsc --noEmit` e corrija qualquer outro uso que o compilador apontar (esperado: nenhum fora dos testes).
4. Em C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\hooks\hook-execucao.test.ts troque o import para `import { CORE_SPECS, buildCommand, parseCommand } from "../../src/hooks/hook-specs";` e reescreva o describe 'hook specs: execucao' para: `expect(CORE_SPECS.map((s) => s.type)).toEqual(["falha"]);` e `expect(parseCommand(buildCommand("/v", "ai-ecosystem", "execucao"))).toEqual({ module: "ai-ecosystem", type: "execucao" });` (o tipo continua sendo reconhecido). Não mexa no resto do arquivo.
5. Em C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\hooks\hook-manager.test.ts: (1) troque o teste 'installs the core approval of tools_run next to the failure entry' por 'does not install an approval for tools_run': depois de `started()` não existe `settings().hooks.PreToolUse` (undefined) e `getStatus().coreRunApprovalInstalled` não existe mais; (2) acrescente 'removes the execucao entry of an older version': antes de started() grave em settings.local.json do cofre um JSON com `hooks.PreToolUse` contendo o grupo antigo (matcher 'mcp__.*__tools_run', comando `node "<vault com barras>/.claude/ai-ecosystem/hooks/ai-ecosystem-hook.mjs" ai-ecosystem execucao`) e uma entrada de usuário não relacionada (por exemplo outro grupo PreToolUse com comando 'echo oi'); depois de started() o grupo antigo sumiu e a entrada do usuário continua; (3) simplifique o helper modulePre para `settings()?.hooks?.PreToolUse ?? []` (sem o filtro de execucao); (4) onde o teste espera `toContain("ai-ecosystem execucao")` (perto do fim de 'installs only the protection entry of AI Git Tools') troque por `toContain("ai-ecosystem falha")`; (5) rode o arquivo inteiro e corrija qualquer outra expectativa que dependa da entrada antiga (contagens de PreToolUse).

**BDD (estado esperado ao concluir)**
- Dado um cofre novo, Quando o núcleo inicia, Então as settings do Claude Code têm a entrada 'falha' e não têm nenhuma entrada PreToolUse do núcleo.
- Dado settings com a entrada antiga 'ai-ecosystem execucao' e uma entrada do usuário, Quando o núcleo inicia, Então a entrada antiga some e a do usuário permanece.
- Dado o código atual, Quando rodo a suíte de hooks, Então tudo passa.

**Verificação** (comandos a rodar, com o resultado esperado)
- npx tsc --noEmit → sem erros
- npx vitest run tests/hooks → todos passam

**Prompt para o subagente**
```text
Você é um subagente de implementação em TypeScript. Objetivo desta etapa: parar de instalar o hook 'execucao' do tools_run (CORE_RUN_SPEC), remover a entrada antiga das settings na partida e tirar o campo coreRunApprovalInstalled.

CONTEXTO COMPLETO
Projeto: plugin do Obsidian chamado AI Ecosystem (núcleo da suíte de plugins de IA), escrito em TypeScript, com servidor MCP e REST local, executor de scripts, índice e descoberta de tools (tools_find, tools_describe, tools_run), hooks do Claude Code gravados nas settings do cofre, configuração guiada de módulos, telas (formulários) e um inspetor de requisições. Raiz do repositório (RAIZ): C:\Users\Trabalho\Documents\obsidian-ai-ecosystem. Testes com vitest (pasta tests), sem Obsidian real (há um mock em tests\mocks\obsidian.ts).
Objetivo geral da demanda: implementar 16 melhorias aceitas numa auditoria do núcleo, na ordem: (1) teto de saída do ecosystem_run_script; (2) ecosystem_status compacto; (3) script_id no executor; (4) lote no tools_run; (5) diagnóstico que percebe módulo defasado; (6) cancelamento do run_script; (7) remover a aprovação do tools_run e o código morto; (8) limitar o activity.sqlite; (9) setup_status, list_scripts e diagnóstico enxutos; (10) resumo dos módulos no início da sessão; (11) tela_gerenciar e setup oculto sem pendência; (12) setup_save em lote; (13) descrição curta do run_script; (14) falha do módulo só por exceção; (15) catálogo por manifest.version; (16) despachante único dos hooks de proteção.
Regras globais:
1. Idioma: o código, os comentários e os nomes de identificadores ficam em inglês (como já está nos arquivos); as mensagens do diagnóstico, do hook e dos achados ficam em português quando o arquivo já estiver em português; o README tem uma parte em inglês e uma em português espelhadas.
2. Estilo do código: TypeScript estrito, 2 espaços, aspas duplas, ponto e vírgula, `import type` para tipos, sem dependências novas e sem alterar package.json.
3. Os diretórios src/runner, src/server, src/registry, src/hooks, src/core, src/setup, src/tool-index são código Node puro: não importam o pacote "obsidian".
4. O script src/hooks/script/ai-ecosystem-hook.mjs é Node puro, sem dependências, e nunca pode atrapalhar o agente: qualquer problema termina com saída 0 e sem texto.
5. Comandos, sempre a partir de C:\Users\Trabalho\Documents\obsidian-ai-ecosystem: typecheck `npx tsc --noEmit`; testes `npx vitest run` (um arquivo: `npx vitest run tests\pasta\arquivo.test.ts`); lint `npx eslint .`; build `npm run build`.
6. Linha de base antes das mudanças: tsc sem erros; 54 arquivos de teste e 918 testes passando; eslint com 0 erros e 19 avisos (nenhum erro ou aviso novo pode surgir).
7. Cada etapa altera só os arquivos listados nela. Não faça commit, push, deploy nem mexa na pasta .git; não rode `npm install`; não escreva nem leia segredos, tokens ou arquivos .env.
8. Se algo não bater com o descrito (arquivo, função ou assinatura inexistente, teste quebrado por motivo alheio à etapa), pare e relate em vez de improvisar.

O QUE JÁ EXISTE E É RELEVANTE PARA ESTA ETAPA
O núcleo grava entradas de hook do Claude Code em <cofre>/.claude/settings.local.json (ou settings.json). Em C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\hooks\hook-specs.ts existem os tipos HookType = 'protecao' | 'setup' | 'falha' | 'aprovacao' | 'execucao', CORE_FAILURE_SPEC (tipo falha, PostToolUseFailure), CORE_RUN_SPEC (tipo execucao, PreToolUse com matcher 'mcp__.*__tools_run') e CORE_SPECS = [CORE_FAILURE_SPEC, CORE_RUN_SPEC]. A decisão do dono foi dispensar a aprovação: o script C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\hooks\script\ai-ecosystem-hook.mjs já faz `pass()` (sai sem decisão) no início da função execution(), então a entrada só gasta um processo Node sem efeito. Em C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\hooks\hook-manager.ts, installCore() faz `const result = this.merger.install(this.state.getSettingsFile(), [...CORE_SPECS]); this.record(result);` depois de `for (const file of SETTINGS_FILES) this.merger.syncPaths(file);` e só quando o Node existe; HooksStatus tem o campo opcional `coreRunApprovalInstalled` preenchido em getStatus() por `entries.some((e) => e.module === ECOSYSTEM_ID && e.type === "execucao")`. this.merger (SettingsMerger, C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\hooks\settings-merger.ts) tem `remove(file, selector: { module: string; type?: HookType }): MergeResult` que só mexe em entradas do plugin (comando com ai-ecosystem-hook.mjs). O tipo 'execucao' e o COMMAND_PATTERN têm de continuar reconhecendo entradas antigas para poder removê-las. Os testes ficam em C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\hooks\hook-manager.test.ts (helpers locais: started(), settings(), state(), modulePre(), vault) e C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\hooks\hook-execucao.test.ts (que importa CORE_RUN_SPEC, CORE_SPECS, buildCommand, parseCommand).

ARQUIVOS
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\hooks\hook-specs.ts`
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\hooks\hook-manager.ts`
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\hooks\hook-manager.test.ts`
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\hooks\hook-execucao.test.ts` (só o import e o describe 'hook specs: execucao')
- Não tocar: qualquer outro arquivo

REGRAS DESTA ETAPA
1. Mantenha 'execucao' em HookType e no COMMAND_PATTERN (entradas antigas precisam ser reconhecidas e removidas).
2. Remova só entradas com module === ECOSYSTEM_ID e type 'execucao'; nunca outras entradas do usuário.
3. Não deixe o resultado da remoção apagar um erro de install: registre (this.record) o resultado da remoção só quando `!ok`.
4. O script ai-ecosystem-hook.mjs NÃO é alterado nesta etapa.

O QUE FAZER, NESTA ORDEM
1. Em hook-specs.ts apague a constante CORE_RUN_SPEC (e seu comentário) e deixe `export const CORE_SPECS: readonly HookSpec[] = [CORE_FAILURE_SPEC];`. Acima do tipo HookType acrescente o comentário `"execucao" is retired: no entry is written any more, the type stays so that entries from older versions are recognized and removed.`.
2. Em hook-manager.ts, dentro do try de installCore(), DEPOIS de `this.record(result);` acrescente: `for (const file of SETTINGS_FILES) { const removed = this.merger.remove(file, { module: ECOSYSTEM_ID, type: "execucao" }); if (!removed.ok) this.record(removed); }`.
3. Em hook-manager.ts apague o campo `coreRunApprovalInstalled?: boolean;` (e seu comentário) da interface HooksStatus e a linha correspondente de getStatus(). Rode `npx tsc --noEmit` e corrija qualquer outro uso que o compilador apontar (esperado: nenhum fora dos testes).
4. Em C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\hooks\hook-execucao.test.ts troque o import para `import { CORE_SPECS, buildCommand, parseCommand } from "../../src/hooks/hook-specs";` e reescreva o describe 'hook specs: execucao' para: `expect(CORE_SPECS.map((s) => s.type)).toEqual(["falha"]);` e `expect(parseCommand(buildCommand("/v", "ai-ecosystem", "execucao"))).toEqual({ module: "ai-ecosystem", type: "execucao" });` (o tipo continua sendo reconhecido). Não mexa no resto do arquivo.
5. Em C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\hooks\hook-manager.test.ts: (1) troque o teste 'installs the core approval of tools_run next to the failure entry' por 'does not install an approval for tools_run': depois de `started()` não existe `settings().hooks.PreToolUse` (undefined) e `getStatus().coreRunApprovalInstalled` não existe mais; (2) acrescente 'removes the execucao entry of an older version': antes de started() grave em settings.local.json do cofre um JSON com `hooks.PreToolUse` contendo o grupo antigo (matcher 'mcp__.*__tools_run', comando `node "<vault com barras>/.claude/ai-ecosystem/hooks/ai-ecosystem-hook.mjs" ai-ecosystem execucao`) e uma entrada de usuário não relacionada (por exemplo outro grupo PreToolUse com comando 'echo oi'); depois de started() o grupo antigo sumiu e a entrada do usuário continua; (3) simplifique o helper modulePre para `settings()?.hooks?.PreToolUse ?? []` (sem o filtro de execucao); (4) onde o teste espera `toContain("ai-ecosystem execucao")` (perto do fim de 'installs only the protection entry of AI Git Tools') troque por `toContain("ai-ecosystem falha")`; (5) rode o arquivo inteiro e corrija qualquer outra expectativa que dependa da entrada antiga (contagens de PreToolUse).

O QUE NÃO FAZER
- Não edite ai-ecosystem-hook.mjs.
- Não remova o tipo 'execucao' de HookType nem do COMMAND_PATTERN.

CRITÉRIOS DE ACEITE
- Dado um cofre novo, Quando o núcleo inicia, Então as settings do Claude Code têm a entrada 'falha' e não têm nenhuma entrada PreToolUse do núcleo.
- Dado settings com a entrada antiga 'ai-ecosystem execucao' e uma entrada do usuário, Quando o núcleo inicia, Então a entrada antiga some e a do usuário permanece.
- Dado o código atual, Quando rodo a suíte de hooks, Então tudo passa.

VERIFICAÇÃO (rode a partir de C:\Users\Trabalho\Documents\obsidian-ai-ecosystem e cole a saída real)
- npx tsc --noEmit → sem erros
- npx vitest run tests/hooks → todos passam

Se qualquer coisa não bater com o descrito (arquivo, função ou assinatura inexistente, comportamento diferente do dito acima, teste quebrado por motivo alheio a esta etapa), PARE e relate em vez de improvisar.
RELATÓRIO FINAL: liste os arquivos alterados ou criados (caminho absoluto), cole a saída real de cada comando de verificação (não resuma) e descreva qualquer desvio ou dúvida.
```

## Etapa 9: Limpar o código morto de execucao no script de hooks [Haiku 5.5 | esforço: médio]

**Objetivo:** apagar do script de hooks a função execution e tudo que só ela usa, e fazer o tipo 'execucao' (entradas antigas) sair sem decisão.
**Depende de:** Etapa 8 (Remover a entrada de aprovação do tools_run das settings)
**Paralelizável com:** nenhuma

**Arquivos**
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\hooks\script\ai-ecosystem-hook.mjs`
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\hooks\hook-execucao.test.ts`
- Não tocar: qualquer outro arquivo

**Regras de implementação**
1. Antes de apagar cada função, confirme com busca no arquivo que nenhuma outra função (protecao, setup, falha, regras de módulos) a chama; apague só o que for mesmo sem uso.
2. Nenhum comportamento de protecao, setup e falha pode mudar.
3. O script continua sem dependências e não pode quebrar: rode `node --check` nele.

**Passos**
1. No main(): troque `if (type === "aprovacao") return pass();` por `if (type === "aprovacao" || type === "execucao") return pass();` e apague o bloco `if (type === "execucao") { execution(stateDir, input).catch(() => allow()); return; }`.
2. Apague as constantes GENERIC_RUN, APPROVAL_REQUIRED, APPROVAL_WAIVED e TOOL_ID e a seção inteira '// execucao (PreToolUse of tools_run)' com as funções execution, toolArgs, runQuestion, fillTemplate, plainValue, oneLine, findIndexedTool, prNumber e askApproval (cada uma só depois de conferir que nada mais a usa). A função respond e remind permanecem.
3. Atualize o comentário do cabeçalho: `aprovacao and execucao (both retired: no decision, kept so old settings entries stay harmless)` e retire a frase 'execucao reads the tools.db files with node:sqlite' e a ressalva 'The exception is the type execucao...'.
4. Em C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\hooks\hook-execucao.test.ts substitua o describe 'hook script: execucao (tools_run)' (e o helper index() e o import de ToolIndexWriter se ficarem sem uso) por um describe 'hook script: execucao (retired)' com testes: (a) uma entrada com tool_input {id:'git_commit'} sai com status 0 e stdout vazio; (b) entrada que não é JSON sai com 0 e stdout vazio; (c) com stdin aberto (use runWithOpenStdin como o teste atual) sai com 0 e stdout vazio; (d) com AI_ECOSYSTEM_HOOKS=off e sem heartbeat também. Mantenha intactos os describes 'hook script: falha through tools_run' e 'hook script: ready calls in the protection messages'. Remova imports que ficarem sem uso (fs, spawnSync etc.) sem apagar os usados.

**BDD (estado esperado ao concluir)**
- Dado uma entrada de hook do tipo execucao com qualquer tool_input, Quando o script roda, Então sai com status 0 e sem nenhuma saída.
- Dado o script limpo, Quando rodo `node --check` nele, Então não há erro de sintaxe.
- Dado a suíte de hooks, Quando a rodo, Então todos os testes de protecao, setup, falha e ready calls continuam passando.

**Verificação** (comandos a rodar, com o resultado esperado)
- node --check C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\hooks\script\ai-ecosystem-hook.mjs → sem saída (sucesso)
- npx vitest run tests/hooks → todos passam
- npx tsc --noEmit → sem erros

**Prompt para o subagente**
```text
Você é um subagente de implementação em TypeScript. Objetivo desta etapa: apagar do script de hooks a função execution e tudo que só ela usa, e fazer o tipo 'execucao' (entradas antigas) sair sem decisão.

CONTEXTO COMPLETO
Projeto: plugin do Obsidian chamado AI Ecosystem (núcleo da suíte de plugins de IA), escrito em TypeScript, com servidor MCP e REST local, executor de scripts, índice e descoberta de tools (tools_find, tools_describe, tools_run), hooks do Claude Code gravados nas settings do cofre, configuração guiada de módulos, telas (formulários) e um inspetor de requisições. Raiz do repositório (RAIZ): C:\Users\Trabalho\Documents\obsidian-ai-ecosystem. Testes com vitest (pasta tests), sem Obsidian real (há um mock em tests\mocks\obsidian.ts).
Objetivo geral da demanda: implementar 16 melhorias aceitas numa auditoria do núcleo, na ordem: (1) teto de saída do ecosystem_run_script; (2) ecosystem_status compacto; (3) script_id no executor; (4) lote no tools_run; (5) diagnóstico que percebe módulo defasado; (6) cancelamento do run_script; (7) remover a aprovação do tools_run e o código morto; (8) limitar o activity.sqlite; (9) setup_status, list_scripts e diagnóstico enxutos; (10) resumo dos módulos no início da sessão; (11) tela_gerenciar e setup oculto sem pendência; (12) setup_save em lote; (13) descrição curta do run_script; (14) falha do módulo só por exceção; (15) catálogo por manifest.version; (16) despachante único dos hooks de proteção.
Regras globais:
1. Idioma: o código, os comentários e os nomes de identificadores ficam em inglês (como já está nos arquivos); as mensagens do diagnóstico, do hook e dos achados ficam em português quando o arquivo já estiver em português; o README tem uma parte em inglês e uma em português espelhadas.
2. Estilo do código: TypeScript estrito, 2 espaços, aspas duplas, ponto e vírgula, `import type` para tipos, sem dependências novas e sem alterar package.json.
3. Os diretórios src/runner, src/server, src/registry, src/hooks, src/core, src/setup, src/tool-index são código Node puro: não importam o pacote "obsidian".
4. O script src/hooks/script/ai-ecosystem-hook.mjs é Node puro, sem dependências, e nunca pode atrapalhar o agente: qualquer problema termina com saída 0 e sem texto.
5. Comandos, sempre a partir de C:\Users\Trabalho\Documents\obsidian-ai-ecosystem: typecheck `npx tsc --noEmit`; testes `npx vitest run` (um arquivo: `npx vitest run tests\pasta\arquivo.test.ts`); lint `npx eslint .`; build `npm run build`.
6. Linha de base antes das mudanças: tsc sem erros; 54 arquivos de teste e 918 testes passando; eslint com 0 erros e 19 avisos (nenhum erro ou aviso novo pode surgir).
7. Cada etapa altera só os arquivos listados nela. Não faça commit, push, deploy nem mexa na pasta .git; não rode `npm install`; não escreva nem leia segredos, tokens ou arquivos .env.
8. Se algo não bater com o descrito (arquivo, função ou assinatura inexistente, teste quebrado por motivo alheio à etapa), pare e relate em vez de improvisar.

O QUE JÁ EXISTE E É RELEVANTE PARA ESTA ETAPA
O script C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\hooks\script\ai-ecosystem-hook.mjs (Node puro, módulo ES, ~936 linhas) é copiado para <cofre>/.claude/ai-ecosystem/hooks/ e chamado como `node ai-ecosystem-hook.mjs <modulo> <tipo>`. A função main() despacha por tipo: protecao, setup, falha, aprovacao (já `return pass()`) e execucao (`execution(stateDir, input).catch(() => allow()); return;`). A função execution() já começa com `if (stateDir || input) return pass();` (aprovação dispensada), então todo o resto dela é código morto. Funções e constantes que só a execution usa: GENERIC_RUN, APPROVAL_REQUIRED, APPROVAL_WAIVED, TOOL_ID, execution, toolArgs, runQuestion, fillTemplate, plainValue, oneLine, findIndexedTool, askApproval (e prNumber, que já não é chamada). O comentário do cabeçalho (linhas 1 a 16) descreve o tipo execucao como o PreToolUse do tools_run. A etapa anterior parou de instalar a entrada 'execucao' nas settings e removeu as antigas, mas settings de outros cofres podem ainda ter a entrada, então o tipo continua aceito e deve sair em silêncio. O teste C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\hooks\hook-execucao.test.ts (helpers HookWorld e runWithOpenStdin de C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\hooks\helpers.ts; world.run(modulo, tipo, entrada, env)) tem o describe 'hook script: execucao (tools_run)' com vários casos que dependem do índice tools.db.

ARQUIVOS
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\hooks\script\ai-ecosystem-hook.mjs`
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\hooks\hook-execucao.test.ts`
- Não tocar: qualquer outro arquivo

REGRAS DESTA ETAPA
1. Antes de apagar cada função, confirme com busca no arquivo que nenhuma outra função (protecao, setup, falha, regras de módulos) a chama; apague só o que for mesmo sem uso.
2. Nenhum comportamento de protecao, setup e falha pode mudar.
3. O script continua sem dependências e não pode quebrar: rode `node --check` nele.

O QUE FAZER, NESTA ORDEM
1. No main(): troque `if (type === "aprovacao") return pass();` por `if (type === "aprovacao" || type === "execucao") return pass();` e apague o bloco `if (type === "execucao") { execution(stateDir, input).catch(() => allow()); return; }`.
2. Apague as constantes GENERIC_RUN, APPROVAL_REQUIRED, APPROVAL_WAIVED e TOOL_ID e a seção inteira '// execucao (PreToolUse of tools_run)' com as funções execution, toolArgs, runQuestion, fillTemplate, plainValue, oneLine, findIndexedTool, prNumber e askApproval (cada uma só depois de conferir que nada mais a usa). A função respond e remind permanecem.
3. Atualize o comentário do cabeçalho: `aprovacao and execucao (both retired: no decision, kept so old settings entries stay harmless)` e retire a frase 'execucao reads the tools.db files with node:sqlite' e a ressalva 'The exception is the type execucao...'.
4. Em C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\hooks\hook-execucao.test.ts substitua o describe 'hook script: execucao (tools_run)' (e o helper index() e o import de ToolIndexWriter se ficarem sem uso) por um describe 'hook script: execucao (retired)' com testes: (a) uma entrada com tool_input {id:'git_commit'} sai com status 0 e stdout vazio; (b) entrada que não é JSON sai com 0 e stdout vazio; (c) com stdin aberto (use runWithOpenStdin como o teste atual) sai com 0 e stdout vazio; (d) com AI_ECOSYSTEM_HOOKS=off e sem heartbeat também. Mantenha intactos os describes 'hook script: falha through tools_run' e 'hook script: ready calls in the protection messages'. Remova imports que ficarem sem uso (fs, spawnSync etc.) sem apagar os usados.

O QUE NÃO FAZER
- Não altere src/hooks/hook-specs.ts nem hook-manager.ts.
- Não altere nenhuma regra de protecao.

CRITÉRIOS DE ACEITE
- Dado uma entrada de hook do tipo execucao com qualquer tool_input, Quando o script roda, Então sai com status 0 e sem nenhuma saída.
- Dado o script limpo, Quando rodo `node --check` nele, Então não há erro de sintaxe.
- Dado a suíte de hooks, Quando a rodo, Então todos os testes de protecao, setup, falha e ready calls continuam passando.

VERIFICAÇÃO (rode a partir de C:\Users\Trabalho\Documents\obsidian-ai-ecosystem e cole a saída real)
- node --check C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\hooks\script\ai-ecosystem-hook.mjs → sem saída (sucesso)
- npx vitest run tests/hooks → todos passam
- npx tsc --noEmit → sem erros

Se qualquer coisa não bater com o descrito (arquivo, função ou assinatura inexistente, comportamento diferente do dito acima, teste quebrado por motivo alheio a esta etapa), PARE e relate em vez de improvisar.
RELATÓRIO FINAL: liste os arquivos alterados ou criados (caminho absoluto), cole a saída real de cada comando de verificação (não resuma) e descreva qualquer desvio ou dúvida.
```

## Etapa 10: Corrigir os textos que ainda falam de aprovação do tools_run [Haiku 5.5 | esforço: baixo]

**Objetivo:** corrigir README, instruções MCP, descrição do tools_run e comentário de tipo para não dizerem mais que tools externas pedem confirmação.
**Depende de:** Etapa 9 (Limpar o código morto de execucao no script de hooks)
**Paralelizável com:** nenhuma

**Arquivos**
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\core\builtin-module.ts` (só o texto de INDEXED_MCP_INSTRUCTIONS)
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\tool-index\discovery-tools.ts` (só a descrição do tools_run)
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\README.md` (os dois parágrafos de aprovação)
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\types\index.ts` (só o comentário de aprovacao)
- Não tocar: qualquer outro arquivo

**Regras de implementação**
1. Só texto: nenhuma lógica muda.
2. Mantenha 'Tools with effect' fora; não invente outra frase de aprovação.

**Passos**
1. builtin-module.ts: remova a última frase de INDEXED_MCP_INSTRUCTIONS (`Tools with effect externo ask the user before they run.`), deixando a frase anterior terminada em ponto; ajuste a concatenação para não sobrar espaço nem aspas soltas.
2. discovery-tools.ts: na descrição do tools_run troque o final por `The answer is the tool's own answer, unchanged.` (sem a frase sobre efeito externo).
3. README.md: troque o parágrafo em inglês por `**No approval prompt from the core.** The core installs only its failure hook (`falha`), which marks MCP tool failures so the protection hooks step aside for ten minutes. It never asks for approval on `tools_run`: whether a tool asks first is decided by your own Claude Code permission rules. Entries of the retired `execucao` hook left by older versions are removed when the plugin starts. The protection hooks above also give the ready `tools_run` call in their message.` e o parágrafo em português por `**Sem pedido de aprovação pelo núcleo.** O núcleo instala apenas o hook de falha (`falha`), que marca falhas de tools MCP para os hooks de proteção saírem do caminho por dez minutos. Ele nunca pede aprovação no `tools_run`: se uma tool pergunta antes é decisão das suas próprias regras de permissão do Claude Code. As entradas do hook `execucao` aposentado deixadas por versões antigas são removidas quando o plugin inicia. Os hooks de proteção acima também trazem, na mensagem, a chamada pronta com `tools_run`.`. Procure no README outras frases que digam que 'externo' pergunta ao usuário via hook (busque 'asks' e 'pergunta') e corrija só as que se referem ao tools_run.
4. types/index.ts: troque o comentário de `aprovacao?: string` por `Approval policy metadata kept in the tool index ("obrigatoria", "dispensada" or a question template with {arg} placeholders). No core hook reads it any more: the tools_run approval was removed.`.

**BDD (estado esperado ao concluir)**
- Dado o repositório, Quando busco 'ask the user' e 'ask the user first' em src e README, Então nenhuma ocorrência fala do tools_run.
- Dado o código, Quando rodo o compilador e a suíte, Então tudo passa (nenhuma lógica mudou).

**Verificação** (comandos a rodar, com o resultado esperado)
- npx tsc --noEmit → sem erros
- npx vitest run tests/core tests/integration tests/tool-index → todos passam

**Prompt para o subagente**
```text
Você é um subagente de implementação em TypeScript. Objetivo desta etapa: corrigir README, instruções MCP, descrição do tools_run e comentário de tipo para não dizerem mais que tools externas pedem confirmação.

CONTEXTO COMPLETO
Projeto: plugin do Obsidian chamado AI Ecosystem (núcleo da suíte de plugins de IA), escrito em TypeScript, com servidor MCP e REST local, executor de scripts, índice e descoberta de tools (tools_find, tools_describe, tools_run), hooks do Claude Code gravados nas settings do cofre, configuração guiada de módulos, telas (formulários) e um inspetor de requisições. Raiz do repositório (RAIZ): C:\Users\Trabalho\Documents\obsidian-ai-ecosystem. Testes com vitest (pasta tests), sem Obsidian real (há um mock em tests\mocks\obsidian.ts).
Objetivo geral da demanda: implementar 16 melhorias aceitas numa auditoria do núcleo, na ordem: (1) teto de saída do ecosystem_run_script; (2) ecosystem_status compacto; (3) script_id no executor; (4) lote no tools_run; (5) diagnóstico que percebe módulo defasado; (6) cancelamento do run_script; (7) remover a aprovação do tools_run e o código morto; (8) limitar o activity.sqlite; (9) setup_status, list_scripts e diagnóstico enxutos; (10) resumo dos módulos no início da sessão; (11) tela_gerenciar e setup oculto sem pendência; (12) setup_save em lote; (13) descrição curta do run_script; (14) falha do módulo só por exceção; (15) catálogo por manifest.version; (16) despachante único dos hooks de proteção.
Regras globais:
1. Idioma: o código, os comentários e os nomes de identificadores ficam em inglês (como já está nos arquivos); as mensagens do diagnóstico, do hook e dos achados ficam em português quando o arquivo já estiver em português; o README tem uma parte em inglês e uma em português espelhadas.
2. Estilo do código: TypeScript estrito, 2 espaços, aspas duplas, ponto e vírgula, `import type` para tipos, sem dependências novas e sem alterar package.json.
3. Os diretórios src/runner, src/server, src/registry, src/hooks, src/core, src/setup, src/tool-index são código Node puro: não importam o pacote "obsidian".
4. O script src/hooks/script/ai-ecosystem-hook.mjs é Node puro, sem dependências, e nunca pode atrapalhar o agente: qualquer problema termina com saída 0 e sem texto.
5. Comandos, sempre a partir de C:\Users\Trabalho\Documents\obsidian-ai-ecosystem: typecheck `npx tsc --noEmit`; testes `npx vitest run` (um arquivo: `npx vitest run tests\pasta\arquivo.test.ts`); lint `npx eslint .`; build `npm run build`.
6. Linha de base antes das mudanças: tsc sem erros; 54 arquivos de teste e 918 testes passando; eslint com 0 erros e 19 avisos (nenhum erro ou aviso novo pode surgir).
7. Cada etapa altera só os arquivos listados nela. Não faça commit, push, deploy nem mexa na pasta .git; não rode `npm install`; não escreva nem leia segredos, tokens ou arquivos .env.
8. Se algo não bater com o descrito (arquivo, função ou assinatura inexistente, teste quebrado por motivo alheio à etapa), pare e relate em vez de improvisar.

O QUE JÁ EXISTE E É RELEVANTE PARA ESTA ETAPA
A decisão do dono foi dispensar a aprovação do tools_run: nenhum hook do núcleo pergunta mais ao usuário, quem decide é a regra de permissão do Claude Code do usuário. Textos ainda dizem o contrário: C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\core\builtin-module.ts na constante INDEXED_MCP_INSTRUCTIONS termina com a frase `Tools with effect externo ask the user before they run.`; C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\tool-index\discovery-tools.ts na descrição do tools_run termina com `The answer is the tool's own answer, unchanged. Tools with effect externo ask the user first.`; C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\README.md tem dois parágrafos, um em inglês e um em português, que começam com `**Approval of `tools_run` (`execucao`).**` e `**Aprovação do `tools_run` (`execucao`).**` descrevendo o hook que foi removido; C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\types\index.ts documenta `aprovacao?: string` de HubTool como 'Approval policy read by the tools_run hook'. Os campos aprovacao dos metadados de tools (CORE_TOOL_METADATA e módulos) continuam existindo como metadado de índice e NÃO devem ser removidos.

ARQUIVOS
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\core\builtin-module.ts` (só o texto de INDEXED_MCP_INSTRUCTIONS)
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\tool-index\discovery-tools.ts` (só a descrição do tools_run)
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\README.md` (os dois parágrafos de aprovação)
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\types\index.ts` (só o comentário de aprovacao)
- Não tocar: qualquer outro arquivo

REGRAS DESTA ETAPA
1. Só texto: nenhuma lógica muda.
2. Mantenha 'Tools with effect' fora; não invente outra frase de aprovação.

O QUE FAZER, NESTA ORDEM
1. builtin-module.ts: remova a última frase de INDEXED_MCP_INSTRUCTIONS (`Tools with effect externo ask the user before they run.`), deixando a frase anterior terminada em ponto; ajuste a concatenação para não sobrar espaço nem aspas soltas.
2. discovery-tools.ts: na descrição do tools_run troque o final por `The answer is the tool's own answer, unchanged.` (sem a frase sobre efeito externo).
3. README.md: troque o parágrafo em inglês por `**No approval prompt from the core.** The core installs only its failure hook (`falha`), which marks MCP tool failures so the protection hooks step aside for ten minutes. It never asks for approval on `tools_run`: whether a tool asks first is decided by your own Claude Code permission rules. Entries of the retired `execucao` hook left by older versions are removed when the plugin starts. The protection hooks above also give the ready `tools_run` call in their message.` e o parágrafo em português por `**Sem pedido de aprovação pelo núcleo.** O núcleo instala apenas o hook de falha (`falha`), que marca falhas de tools MCP para os hooks de proteção saírem do caminho por dez minutos. Ele nunca pede aprovação no `tools_run`: se uma tool pergunta antes é decisão das suas próprias regras de permissão do Claude Code. As entradas do hook `execucao` aposentado deixadas por versões antigas são removidas quando o plugin inicia. Os hooks de proteção acima também trazem, na mensagem, a chamada pronta com `tools_run`.`. Procure no README outras frases que digam que 'externo' pergunta ao usuário via hook (busque 'asks' e 'pergunta') e corrija só as que se referem ao tools_run.
4. types/index.ts: troque o comentário de `aprovacao?: string` por `Approval policy metadata kept in the tool index ("obrigatoria", "dispensada" or a question template with {arg} placeholders). No core hook reads it any more: the tools_run approval was removed.`.

O QUE NÃO FAZER
- Não remova os campos aprovacao dos metadados das tools.
- Não altere código fora dos textos indicados.

CRITÉRIOS DE ACEITE
- Dado o repositório, Quando busco 'ask the user' e 'ask the user first' em src e README, Então nenhuma ocorrência fala do tools_run.
- Dado o código, Quando rodo o compilador e a suíte, Então tudo passa (nenhuma lógica mudou).

VERIFICAÇÃO (rode a partir de C:\Users\Trabalho\Documents\obsidian-ai-ecosystem e cole a saída real)
- npx tsc --noEmit → sem erros
- npx vitest run tests/core tests/integration tests/tool-index → todos passam

Se qualquer coisa não bater com o descrito (arquivo, função ou assinatura inexistente, comportamento diferente do dito acima, teste quebrado por motivo alheio a esta etapa), PARE e relate em vez de improvisar.
RELATÓRIO FINAL: liste os arquivos alterados ou criados (caminho absoluto), cole a saída real de cada comando de verificação (não resuma) e descreva qualquer desvio ou dúvida.
```

## Etapa 11: Podar e truncar o activity.sqlite [Haiku 5.5 | esforço: médio]

**Objetivo:** limitar o activity.sqlite por contagem (3000 linhas) e idade (7 dias) e truncar payload, response e output gravados a 4000 caracteres.
**Depende de:** Etapa 10 (Corrigir os textos que ainda falam de aprovação do tools_run)
**Paralelizável com:** nenhuma

**Arquivos**
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\inspector\activity-db.ts`
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\inspector\activity-db.test.ts`
- Não tocar: qualquer outro arquivo

**Regras de implementação**
1. Entradas devolvidas por getRecent para textos curtos (< 4000) continuam idênticas (o teste existente que compara com toEqual deve passar sem mudança).
2. Nenhuma exceção de poda pode escapar: tudo em try/catch com console.warn, como o resto da classe.
3. Constantes padrão: MAX_ROWS = 3000, MAX_AGE_MS = 7 dias, TEXT_CAP = 4000, PRUNE_EVERY = 200 gravações.

**Passos**
1. Acrescente a ActivityDatabaseOptions os campos opcionais `maxRows?: number; maxAgeMs?: number; textCap?: number; pruneEvery?: number;` e guarde-os (com os padrões acima) em campos privados da classe, mais `private writes = 0;`.
2. Crie métodos privados `clipText(text: string, keep: "start" | "end"): string`: se `text.length <= this.textCap` devolve o texto; senão, para 'start' devolve `text.slice(0, cap) + "\n[... " + (text.length - cap) + " characters omitted]"` e para 'end' devolve `"[... " + (text.length - cap) + " characters omitted]\n" + text.slice(text.length - cap)`.
3. Em save() e update() grave `this.clipText(entry.payload ?? "", "start")`, `this.clipText(entry.response ?? "", "start")` e `this.clipText(entry.output ?? "", "end")` no lugar dos três campos atuais.
4. Crie `private prune(initial: boolean): void` (try/catch com console.warn): `const cutoff = Date.now() - this.maxAgeMs;`; `const byAge = this.db.prepare("DELETE FROM activity_log WHERE time < ?").run(cutoff);`; `const byCount = this.db.prepare("DELETE FROM activity_log WHERE id IN (SELECT id FROM activity_log ORDER BY time DESC, id DESC LIMIT -1 OFFSET ?)").run(this.maxRows);`; se `initial && Number(byAge.changes) + Number(byCount.changes) > 0` rode `this.db.exec("PRAGMA wal_checkpoint(TRUNCATE);")` e `this.db.exec("VACUUM;")`. Chame `this.prune(true)` no fim de init() e, em save(), depois do insert: `this.writes++; if (this.writes % this.pruneEvery === 0) this.prune(false);`.
5. Em C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\inspector\activity-db.test.ts acrescente: (a) com `new ActivityDatabase({ filePath: ":memory:", maxRows: 5, pruneEvery: 1 })` gravar 12 entradas com times crescentes deixa só as 5 mais novas em getRecent(); (b) com textCap: 100, uma entrada com payload de 1000 caracteres volta de getRecent com payload de 100 caracteres mais o marcador 'characters omitted', e o output volta com o marcador no começo e os últimos 100 caracteres; (c) banco em arquivo (fs.mkdtempSync + path.join(dir, 'a.sqlite')): grava uma entrada com time = Date.now() - 10 dias e outra de agora, fecha e reabre o arquivo: só a de agora sobrevive; limpe o diretório no fim.

**BDD (estado esperado ao concluir)**
- Dado maxRows 5, Quando gravo 12 entradas, Então getRecent devolve só as 5 mais novas.
- Dado uma entrada de 10 dias atrás num arquivo, Quando reabro o banco, Então ela foi apagada e a de hoje permanece.
- Dado um payload de 1000 caracteres e textCap 100, Quando leio, Então o payload tem 100 caracteres mais o marcador.
- Dado entradas curtas, Quando leio, Então ficam idênticas às gravadas (teste existente passa).

**Verificação** (comandos a rodar, com o resultado esperado)
- npx tsc --noEmit → sem erros
- npx vitest run tests/inspector → todos passam

**Prompt para o subagente**
```text
Você é um subagente de implementação em TypeScript. Objetivo desta etapa: limitar o activity.sqlite por contagem (3000 linhas) e idade (7 dias) e truncar payload, response e output gravados a 4000 caracteres.

CONTEXTO COMPLETO
Projeto: plugin do Obsidian chamado AI Ecosystem (núcleo da suíte de plugins de IA), escrito em TypeScript, com servidor MCP e REST local, executor de scripts, índice e descoberta de tools (tools_find, tools_describe, tools_run), hooks do Claude Code gravados nas settings do cofre, configuração guiada de módulos, telas (formulários) e um inspetor de requisições. Raiz do repositório (RAIZ): C:\Users\Trabalho\Documents\obsidian-ai-ecosystem. Testes com vitest (pasta tests), sem Obsidian real (há um mock em tests\mocks\obsidian.ts).
Objetivo geral da demanda: implementar 16 melhorias aceitas numa auditoria do núcleo, na ordem: (1) teto de saída do ecosystem_run_script; (2) ecosystem_status compacto; (3) script_id no executor; (4) lote no tools_run; (5) diagnóstico que percebe módulo defasado; (6) cancelamento do run_script; (7) remover a aprovação do tools_run e o código morto; (8) limitar o activity.sqlite; (9) setup_status, list_scripts e diagnóstico enxutos; (10) resumo dos módulos no início da sessão; (11) tela_gerenciar e setup oculto sem pendência; (12) setup_save em lote; (13) descrição curta do run_script; (14) falha do módulo só por exceção; (15) catálogo por manifest.version; (16) despachante único dos hooks de proteção.
Regras globais:
1. Idioma: o código, os comentários e os nomes de identificadores ficam em inglês (como já está nos arquivos); as mensagens do diagnóstico, do hook e dos achados ficam em português quando o arquivo já estiver em português; o README tem uma parte em inglês e uma em português espelhadas.
2. Estilo do código: TypeScript estrito, 2 espaços, aspas duplas, ponto e vírgula, `import type` para tipos, sem dependências novas e sem alterar package.json.
3. Os diretórios src/runner, src/server, src/registry, src/hooks, src/core, src/setup, src/tool-index são código Node puro: não importam o pacote "obsidian".
4. O script src/hooks/script/ai-ecosystem-hook.mjs é Node puro, sem dependências, e nunca pode atrapalhar o agente: qualquer problema termina com saída 0 e sem texto.
5. Comandos, sempre a partir de C:\Users\Trabalho\Documents\obsidian-ai-ecosystem: typecheck `npx tsc --noEmit`; testes `npx vitest run` (um arquivo: `npx vitest run tests\pasta\arquivo.test.ts`); lint `npx eslint .`; build `npm run build`.
6. Linha de base antes das mudanças: tsc sem erros; 54 arquivos de teste e 918 testes passando; eslint com 0 erros e 19 avisos (nenhum erro ou aviso novo pode surgir).
7. Cada etapa altera só os arquivos listados nela. Não faça commit, push, deploy nem mexa na pasta .git; não rode `npm install`; não escreva nem leia segredos, tokens ou arquivos .env.
8. Se algo não bater com o descrito (arquivo, função ou assinatura inexistente, teste quebrado por motivo alheio à etapa), pare e relate em vez de improvisar.

O QUE JÁ EXISTE E É RELEVANTE PARA ESTA ETAPA
C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\inspector\activity-db.ts define a classe ActivityDatabase (node:sqlite DatabaseSync, modo WAL) com opções `ActivityDatabaseOptions { filePath }` (':memory:' vale), tabela activity_log (id TEXT PK, time INTEGER, kind, method, target, module_id, client, status, duration_ms, request_headers, payload, response, output, alert, running, tokens_*), métodos save(entry: ActivityEntry), update(entry), getRecent(limit), clear(), close(). A classe LiveLogger (C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\inspector\live-logger.ts) chama save/update a cada evento. Hoje nada apaga linhas: em 6 dias o arquivo chegou a 13.902 linhas (11,5 MB mais 4,1 MB de WAL), ~7,3 MB só de respostas. Os testes existentes ficam em C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\inspector\activity-db.test.ts (usam new ActivityDatabase({ filePath: ':memory:' })).

ARQUIVOS
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\inspector\activity-db.ts`
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\inspector\activity-db.test.ts`
- Não tocar: qualquer outro arquivo

REGRAS DESTA ETAPA
1. Entradas devolvidas por getRecent para textos curtos (< 4000) continuam idênticas (o teste existente que compara com toEqual deve passar sem mudança).
2. Nenhuma exceção de poda pode escapar: tudo em try/catch com console.warn, como o resto da classe.
3. Constantes padrão: MAX_ROWS = 3000, MAX_AGE_MS = 7 dias, TEXT_CAP = 4000, PRUNE_EVERY = 200 gravações.

O QUE FAZER, NESTA ORDEM
1. Acrescente a ActivityDatabaseOptions os campos opcionais `maxRows?: number; maxAgeMs?: number; textCap?: number; pruneEvery?: number;` e guarde-os (com os padrões acima) em campos privados da classe, mais `private writes = 0;`.
2. Crie métodos privados `clipText(text: string, keep: "start" | "end"): string`: se `text.length <= this.textCap` devolve o texto; senão, para 'start' devolve `text.slice(0, cap) + "\n[... " + (text.length - cap) + " characters omitted]"` e para 'end' devolve `"[... " + (text.length - cap) + " characters omitted]\n" + text.slice(text.length - cap)`.
3. Em save() e update() grave `this.clipText(entry.payload ?? "", "start")`, `this.clipText(entry.response ?? "", "start")` e `this.clipText(entry.output ?? "", "end")` no lugar dos três campos atuais.
4. Crie `private prune(initial: boolean): void` (try/catch com console.warn): `const cutoff = Date.now() - this.maxAgeMs;`; `const byAge = this.db.prepare("DELETE FROM activity_log WHERE time < ?").run(cutoff);`; `const byCount = this.db.prepare("DELETE FROM activity_log WHERE id IN (SELECT id FROM activity_log ORDER BY time DESC, id DESC LIMIT -1 OFFSET ?)").run(this.maxRows);`; se `initial && Number(byAge.changes) + Number(byCount.changes) > 0` rode `this.db.exec("PRAGMA wal_checkpoint(TRUNCATE);")` e `this.db.exec("VACUUM;")`. Chame `this.prune(true)` no fim de init() e, em save(), depois do insert: `this.writes++; if (this.writes % this.pruneEvery === 0) this.prune(false);`.
5. Em C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\inspector\activity-db.test.ts acrescente: (a) com `new ActivityDatabase({ filePath: ":memory:", maxRows: 5, pruneEvery: 1 })` gravar 12 entradas com times crescentes deixa só as 5 mais novas em getRecent(); (b) com textCap: 100, uma entrada com payload de 1000 caracteres volta de getRecent com payload de 100 caracteres mais o marcador 'characters omitted', e o output volta com o marcador no começo e os últimos 100 caracteres; (c) banco em arquivo (fs.mkdtempSync + path.join(dir, 'a.sqlite')): grava uma entrada com time = Date.now() - 10 dias e outra de agora, fecha e reabre o arquivo: só a de agora sobrevive; limpe o diretório no fim.

O QUE NÃO FAZER
- Não altere live-logger.ts nem ecosystem.ts nesta etapa.
- Não mude o esquema da tabela.

CRITÉRIOS DE ACEITE
- Dado maxRows 5, Quando gravo 12 entradas, Então getRecent devolve só as 5 mais novas.
- Dado uma entrada de 10 dias atrás num arquivo, Quando reabro o banco, Então ela foi apagada e a de hoje permanece.
- Dado um payload de 1000 caracteres e textCap 100, Quando leio, Então o payload tem 100 caracteres mais o marcador.
- Dado entradas curtas, Quando leio, Então ficam idênticas às gravadas (teste existente passa).

VERIFICAÇÃO (rode a partir de C:\Users\Trabalho\Documents\obsidian-ai-ecosystem e cole a saída real)
- npx tsc --noEmit → sem erros
- npx vitest run tests/inspector → todos passam

Se qualquer coisa não bater com o descrito (arquivo, função ou assinatura inexistente, comportamento diferente do dito acima, teste quebrado por motivo alheio a esta etapa), PARE e relate em vez de improvisar.
RELATÓRIO FINAL: liste os arquivos alterados ou criados (caminho absoluto), cole a saída real de cada comando de verificação (não resuma) e descreva qualquer desvio ou dúvida.
```

## Etapa 12: Texto da tela do inspetor e caminho pelo configDir [Haiku 5.5 | esforço: baixo]

**Objetivo:** corrigir a frase que diz que o histórico nunca vai para o disco e usar o configDir no caminho do activity.sqlite.
**Depende de:** Etapa 11 (Podar e truncar o activity.sqlite)
**Paralelizável com:** nenhuma

**Arquivos**
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\core\ecosystem.ts` (só a linha do dbPath)
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\i18n\settings.ts` (a chave nos dois idiomas)
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\README.md` (as duas frases do inspetor)
- Não tocar: qualquer outro arquivo

**Regras de implementação**
1. O caminho usa nodePath.join e `deps.configDir ?? ".obsidian"`.
2. Não altere outras chaves de i18n.

**Passos**
1. ecosystem.ts: troque a construção de dbPath por `const dbPath = nodePath.join(deps.vaultBasePath, deps.configDir ?? ".obsidian", "plugins", "ai-ecosystem", "activity.sqlite");` (confira que nodePath é o nome do import de node:path nesse arquivo; se for outro, use o nome existente).
2. i18n/settings.ts inglês: `"Entries shown in the inspector. A trimmed copy of the recent history (at most 3000 entries and 7 days, long texts cut to 4000 characters) is also kept in activity.sqlite in the plugin folder, so it survives a restart."`. Português: `"Entradas mostradas no inspetor. Uma cópia reduzida do histórico recente (no máximo 3000 entradas e 7 dias, textos longos cortados em 4000 caracteres) também fica em activity.sqlite na pasta do plugin, para sobreviver a um reinício."`. Troque também o rótulo da chave `settings.inspector.maxEntries` ('Entries kept in memory' / equivalente em português) para `Entries shown` e `Entradas mostradas`.
3. README.md: troque a frase em inglês por `Recent history is also kept, trimmed (at most 3000 entries and 7 days, long texts cut to 4000 characters), in `activity.sqlite` inside the plugin folder, so it survives a restart; the limit setting is how many entries the inspector shows.` e a de português por `O histórico recente também fica, reduzido (no máximo 3000 entradas e 7 dias, textos longos cortados em 4000 caracteres), em `activity.sqlite` na pasta do plugin, para sobreviver a um reinício; o limite das configurações é quantas entradas o inspetor mostra.`.

**BDD (estado esperado ao concluir)**
- Dado deps.configDir = 'cfg', Quando o núcleo cria o banco, Então o arquivo fica em <cofre>/cfg/plugins/ai-ecosystem/activity.sqlite.
- Dado as chaves de i18n, Quando rodo o teste de i18n, Então os dois idiomas continuam com as mesmas chaves.

**Verificação** (comandos a rodar, com o resultado esperado)
- npx tsc --noEmit → sem erros
- npx vitest run tests/core tests/settings tests/inspector → todos passam

**Prompt para o subagente**
```text
Você é um subagente de implementação em TypeScript. Objetivo desta etapa: corrigir a frase que diz que o histórico nunca vai para o disco e usar o configDir no caminho do activity.sqlite.

CONTEXTO COMPLETO
Projeto: plugin do Obsidian chamado AI Ecosystem (núcleo da suíte de plugins de IA), escrito em TypeScript, com servidor MCP e REST local, executor de scripts, índice e descoberta de tools (tools_find, tools_describe, tools_run), hooks do Claude Code gravados nas settings do cofre, configuração guiada de módulos, telas (formulários) e um inspetor de requisições. Raiz do repositório (RAIZ): C:\Users\Trabalho\Documents\obsidian-ai-ecosystem. Testes com vitest (pasta tests), sem Obsidian real (há um mock em tests\mocks\obsidian.ts).
Objetivo geral da demanda: implementar 16 melhorias aceitas numa auditoria do núcleo, na ordem: (1) teto de saída do ecosystem_run_script; (2) ecosystem_status compacto; (3) script_id no executor; (4) lote no tools_run; (5) diagnóstico que percebe módulo defasado; (6) cancelamento do run_script; (7) remover a aprovação do tools_run e o código morto; (8) limitar o activity.sqlite; (9) setup_status, list_scripts e diagnóstico enxutos; (10) resumo dos módulos no início da sessão; (11) tela_gerenciar e setup oculto sem pendência; (12) setup_save em lote; (13) descrição curta do run_script; (14) falha do módulo só por exceção; (15) catálogo por manifest.version; (16) despachante único dos hooks de proteção.
Regras globais:
1. Idioma: o código, os comentários e os nomes de identificadores ficam em inglês (como já está nos arquivos); as mensagens do diagnóstico, do hook e dos achados ficam em português quando o arquivo já estiver em português; o README tem uma parte em inglês e uma em português espelhadas.
2. Estilo do código: TypeScript estrito, 2 espaços, aspas duplas, ponto e vírgula, `import type` para tipos, sem dependências novas e sem alterar package.json.
3. Os diretórios src/runner, src/server, src/registry, src/hooks, src/core, src/setup, src/tool-index são código Node puro: não importam o pacote "obsidian".
4. O script src/hooks/script/ai-ecosystem-hook.mjs é Node puro, sem dependências, e nunca pode atrapalhar o agente: qualquer problema termina com saída 0 e sem texto.
5. Comandos, sempre a partir de C:\Users\Trabalho\Documents\obsidian-ai-ecosystem: typecheck `npx tsc --noEmit`; testes `npx vitest run` (um arquivo: `npx vitest run tests\pasta\arquivo.test.ts`); lint `npx eslint .`; build `npm run build`.
6. Linha de base antes das mudanças: tsc sem erros; 54 arquivos de teste e 918 testes passando; eslint com 0 erros e 19 avisos (nenhum erro ou aviso novo pode surgir).
7. Cada etapa altera só os arquivos listados nela. Não faça commit, push, deploy nem mexa na pasta .git; não rode `npm install`; não escreva nem leia segredos, tokens ou arquivos .env.
8. Se algo não bater com o descrito (arquivo, função ou assinatura inexistente, teste quebrado por motivo alheio à etapa), pare e relate em vez de improvisar.

O QUE JÁ EXISTE E É RELEVANTE PARA ESTA ETAPA
C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\core\ecosystem.ts, no construtor da classe Ecosystem, monta o caminho do banco do inspetor como ``${deps.vaultBasePath}/.obsidian/plugins/ai-ecosystem/activity.sqlite`` (com a pasta .obsidian fixa), mas o cofre pode ter outra pasta de configuração (deps.configDir, string opcional; o arquivo já usa `nodePath` importado de node:path e a variável `deps.configDir` em outras linhas). C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\i18n\settings.ts tem a chave `settings.inspector.maxEntriesDesc` em inglês (`"History is kept in memory only and is never written to disk."`) e em português (`"O histórico fica só na memória e nunca é gravado em disco."`). O C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\README.md tem, na seção do inspetor, em inglês: `History is kept in memory only (configurable limit) and is never written to disk.` e a versão em português correspondente (procure por 'nunca é gravado em disco'). A etapa anterior fez o banco manter no máximo 3000 linhas e 7 dias e cortar textos longos em 4000 caracteres.

ARQUIVOS
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\core\ecosystem.ts` (só a linha do dbPath)
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\i18n\settings.ts` (a chave nos dois idiomas)
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\README.md` (as duas frases do inspetor)
- Não tocar: qualquer outro arquivo

REGRAS DESTA ETAPA
1. O caminho usa nodePath.join e `deps.configDir ?? ".obsidian"`.
2. Não altere outras chaves de i18n.

O QUE FAZER, NESTA ORDEM
1. ecosystem.ts: troque a construção de dbPath por `const dbPath = nodePath.join(deps.vaultBasePath, deps.configDir ?? ".obsidian", "plugins", "ai-ecosystem", "activity.sqlite");` (confira que nodePath é o nome do import de node:path nesse arquivo; se for outro, use o nome existente).
2. i18n/settings.ts inglês: `"Entries shown in the inspector. A trimmed copy of the recent history (at most 3000 entries and 7 days, long texts cut to 4000 characters) is also kept in activity.sqlite in the plugin folder, so it survives a restart."`. Português: `"Entradas mostradas no inspetor. Uma cópia reduzida do histórico recente (no máximo 3000 entradas e 7 dias, textos longos cortados em 4000 caracteres) também fica em activity.sqlite na pasta do plugin, para sobreviver a um reinício."`. Troque também o rótulo da chave `settings.inspector.maxEntries` ('Entries kept in memory' / equivalente em português) para `Entries shown` e `Entradas mostradas`.
3. README.md: troque a frase em inglês por `Recent history is also kept, trimmed (at most 3000 entries and 7 days, long texts cut to 4000 characters), in `activity.sqlite` inside the plugin folder, so it survives a restart; the limit setting is how many entries the inspector shows.` e a de português por `O histórico recente também fica, reduzido (no máximo 3000 entradas e 7 dias, textos longos cortados em 4000 caracteres), em `activity.sqlite` na pasta do plugin, para sobreviver a um reinício; o limite das configurações é quantas entradas o inspetor mostra.`.

O QUE NÃO FAZER
- Não altere activity-db.ts.
- Não mude outras linhas do README.

CRITÉRIOS DE ACEITE
- Dado deps.configDir = 'cfg', Quando o núcleo cria o banco, Então o arquivo fica em <cofre>/cfg/plugins/ai-ecosystem/activity.sqlite.
- Dado as chaves de i18n, Quando rodo o teste de i18n, Então os dois idiomas continuam com as mesmas chaves.

VERIFICAÇÃO (rode a partir de C:\Users\Trabalho\Documents\obsidian-ai-ecosystem e cole a saída real)
- npx tsc --noEmit → sem erros
- npx vitest run tests/core tests/settings tests/inspector → todos passam

Se qualquer coisa não bater com o descrito (arquivo, função ou assinatura inexistente, comportamento diferente do dito acima, teste quebrado por motivo alheio a esta etapa), PARE e relate em vez de improvisar.
RELATÓRIO FINAL: liste os arquivos alterados ou criados (caminho absoluto), cole a saída real de cada comando de verificação (não resuma) e descreva qualquer desvio ou dúvida.
```

## Etapa 13: ecosystem_setup_status sem bloco e perguntas quando já configurado [Haiku 5.5 | esforço: médio]

**Objetivo:** omitir bloco_claude_md e perguntas na resposta de ecosystem_setup_status de um módulo já configurado, com completo:true para vê-los.
**Depende de:** Etapa 12 (Texto da tela do inspetor e caminho pelo configDir)
**Paralelizável com:** nenhuma

**Arquivos**
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\setup\setup-manager.ts`
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\setup\setup-tools.ts`
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\setup\tools.test.ts`
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\setup\helpers.ts` (só a assinatura de setupStatus)
- Não tocar: qualquer outro arquivo

**Regras de implementação**
1. Módulo com estado diferente de 'configurado' (pendente_configuracao, desativado) continua recebendo tudo.
2. Quando omitir, não calcule buildQuestions nem buildGuideBlock (economia de trabalho).
3. O campo novo de aviso chama-se `nota` e só existe quando algo foi omitido.

**Passos**
1. Em setup-manager.ts mude SetupStatus para `perguntas?: QuestionView[];` e `bloco_claude_md?: string;` e acrescente `nota?: string;`. Mude a assinatura para `async status(moduleId: string, options: { completo?: boolean } = {})`.
2. Em status(): `const compact = state.estado === "configurado" && options.completo !== true;`. Quando `compact`, NÃO chame buildQuestions nem buildGuideBlock e acrescente `nota: "perguntas and bloco_claude_md are left out: the module is already configured. Pass completo: true to get them."`; caso contrário monte tudo como hoje. As demais chaves não mudam. Ajuste qualquer outro uso de `status.perguntas` ou `status.bloco_claude_md` no src que o compilador apontar.
3. Em setup-tools.ts acrescente ao inputSchema de ecosystem_setup_status `completo: { type: "boolean", default: false, description: "Also return perguntas and bloco_claude_md for a module that is already configured (to change its answers). Default false." }`, passe `{ completo: args.completo === true }` a `setup.status(modulo, ...)` e acrescente à descrição: `For a module that is already configured the questions and the usage block are left out unless completo is true.`.
4. Em C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\setup\helpers.ts mude `setupStatus` para aceitar um terceiro parâmetro `completo = false` e enviá-lo como argumento `completo` à tool (só quando true).
5. Em C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\setup\tools.test.ts rode o arquivo, e nos testes que leem perguntas ou bloco_claude_md de um módulo já configurado passe `true` no terceiro parâmetro de setupStatus; acrescente: (a) módulo configurado sem completo → sem as chaves perguntas e bloco_claude_md e com nota; (b) com completo true → ambas presentes; (c) módulo pendente → ambas presentes.

**BDD (estado esperado ao concluir)**
- Dado um módulo já configurado, Quando chamo ecosystem_setup_status, Então a resposta não tem perguntas nem bloco_claude_md e traz nota.
- Dado o mesmo módulo, Quando chamo com completo: true, Então perguntas e bloco_claude_md vêm completos.
- Dado um módulo pendente de configuração, Quando chamo, Então perguntas e bloco_claude_md vêm como antes.

**Verificação** (comandos a rodar, com o resultado esperado)
- npx tsc --noEmit → sem erros
- npx vitest run tests/setup → todos passam

**Prompt para o subagente**
```text
Você é um subagente de implementação em TypeScript. Objetivo desta etapa: omitir bloco_claude_md e perguntas na resposta de ecosystem_setup_status de um módulo já configurado, com completo:true para vê-los.

CONTEXTO COMPLETO
Projeto: plugin do Obsidian chamado AI Ecosystem (núcleo da suíte de plugins de IA), escrito em TypeScript, com servidor MCP e REST local, executor de scripts, índice e descoberta de tools (tools_find, tools_describe, tools_run), hooks do Claude Code gravados nas settings do cofre, configuração guiada de módulos, telas (formulários) e um inspetor de requisições. Raiz do repositório (RAIZ): C:\Users\Trabalho\Documents\obsidian-ai-ecosystem. Testes com vitest (pasta tests), sem Obsidian real (há um mock em tests\mocks\obsidian.ts).
Objetivo geral da demanda: implementar 16 melhorias aceitas numa auditoria do núcleo, na ordem: (1) teto de saída do ecosystem_run_script; (2) ecosystem_status compacto; (3) script_id no executor; (4) lote no tools_run; (5) diagnóstico que percebe módulo defasado; (6) cancelamento do run_script; (7) remover a aprovação do tools_run e o código morto; (8) limitar o activity.sqlite; (9) setup_status, list_scripts e diagnóstico enxutos; (10) resumo dos módulos no início da sessão; (11) tela_gerenciar e setup oculto sem pendência; (12) setup_save em lote; (13) descrição curta do run_script; (14) falha do módulo só por exceção; (15) catálogo por manifest.version; (16) despachante único dos hooks de proteção.
Regras globais:
1. Idioma: o código, os comentários e os nomes de identificadores ficam em inglês (como já está nos arquivos); as mensagens do diagnóstico, do hook e dos achados ficam em português quando o arquivo já estiver em português; o README tem uma parte em inglês e uma em português espelhadas.
2. Estilo do código: TypeScript estrito, 2 espaços, aspas duplas, ponto e vírgula, `import type` para tipos, sem dependências novas e sem alterar package.json.
3. Os diretórios src/runner, src/server, src/registry, src/hooks, src/core, src/setup, src/tool-index são código Node puro: não importam o pacote "obsidian".
4. O script src/hooks/script/ai-ecosystem-hook.mjs é Node puro, sem dependências, e nunca pode atrapalhar o agente: qualquer problema termina com saída 0 e sem texto.
5. Comandos, sempre a partir de C:\Users\Trabalho\Documents\obsidian-ai-ecosystem: typecheck `npx tsc --noEmit`; testes `npx vitest run` (um arquivo: `npx vitest run tests\pasta\arquivo.test.ts`); lint `npx eslint .`; build `npm run build`.
6. Linha de base antes das mudanças: tsc sem erros; 54 arquivos de teste e 918 testes passando; eslint com 0 erros e 19 avisos (nenhum erro ou aviso novo pode surgir).
7. Cada etapa altera só os arquivos listados nela. Não faça commit, push, deploy nem mexa na pasta .git; não rode `npm install`; não escreva nem leia segredos, tokens ou arquivos .env.
8. Se algo não bater com o descrito (arquivo, função ou assinatura inexistente, teste quebrado por motivo alheio à etapa), pare e relate em vez de improvisar.

O QUE JÁ EXISTE E É RELEVANTE PARA ESTA ETAPA
A tool ecosystem_setup_status fica em C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\setup\setup-tools.ts e chama `setup.status(modulo)` de C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\setup\setup-manager.ts. SetupManager.status(moduleId): Promise<SetupResult<{ status: SetupStatus }>> monta o objeto SetupStatus com modulo, nome, estado, origem, node_disponivel, detectado, respostas, perguntas (`buildQuestions(...)`), pre_requisitos, claude_md, `bloco_claude_md` (`buildGuideBlock(...)`) e tools_do_modulo. A interface SetupStatus declara `perguntas: QuestionView[]` e `bloco_claude_md: string`. Mesmo com o módulo já configurado a resposta traz ~7 mil caracteres (22 mil no Inspector) por causa do bloco e das perguntas. As skills de configuração (`configurar-<modulo>`) usam perguntas e bloco de módulos pendentes. Os testes ficam em C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\setup\tools.test.ts, com helpers em C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\setup\helpers.ts (`setupStatus(r, modulo)` chama a tool e devolve o JSON; `callTool`, `startRig`, `configureCore`).

ARQUIVOS
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\setup\setup-manager.ts`
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\setup\setup-tools.ts`
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\setup\tools.test.ts`
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\setup\helpers.ts` (só a assinatura de setupStatus)
- Não tocar: qualquer outro arquivo

REGRAS DESTA ETAPA
1. Módulo com estado diferente de 'configurado' (pendente_configuracao, desativado) continua recebendo tudo.
2. Quando omitir, não calcule buildQuestions nem buildGuideBlock (economia de trabalho).
3. O campo novo de aviso chama-se `nota` e só existe quando algo foi omitido.

O QUE FAZER, NESTA ORDEM
1. Em setup-manager.ts mude SetupStatus para `perguntas?: QuestionView[];` e `bloco_claude_md?: string;` e acrescente `nota?: string;`. Mude a assinatura para `async status(moduleId: string, options: { completo?: boolean } = {})`.
2. Em status(): `const compact = state.estado === "configurado" && options.completo !== true;`. Quando `compact`, NÃO chame buildQuestions nem buildGuideBlock e acrescente `nota: "perguntas and bloco_claude_md are left out: the module is already configured. Pass completo: true to get them."`; caso contrário monte tudo como hoje. As demais chaves não mudam. Ajuste qualquer outro uso de `status.perguntas` ou `status.bloco_claude_md` no src que o compilador apontar.
3. Em setup-tools.ts acrescente ao inputSchema de ecosystem_setup_status `completo: { type: "boolean", default: false, description: "Also return perguntas and bloco_claude_md for a module that is already configured (to change its answers). Default false." }`, passe `{ completo: args.completo === true }` a `setup.status(modulo, ...)` e acrescente à descrição: `For a module that is already configured the questions and the usage block are left out unless completo is true.`.
4. Em C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\setup\helpers.ts mude `setupStatus` para aceitar um terceiro parâmetro `completo = false` e enviá-lo como argumento `completo` à tool (só quando true).
5. Em C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\setup\tools.test.ts rode o arquivo, e nos testes que leem perguntas ou bloco_claude_md de um módulo já configurado passe `true` no terceiro parâmetro de setupStatus; acrescente: (a) módulo configurado sem completo → sem as chaves perguntas e bloco_claude_md e com nota; (b) com completo true → ambas presentes; (c) módulo pendente → ambas presentes.

O QUE NÃO FAZER
- Não altere as skills em src/setup/skills.
- Não mude questions.ts nem guide-block.ts.

CRITÉRIOS DE ACEITE
- Dado um módulo já configurado, Quando chamo ecosystem_setup_status, Então a resposta não tem perguntas nem bloco_claude_md e traz nota.
- Dado o mesmo módulo, Quando chamo com completo: true, Então perguntas e bloco_claude_md vêm completos.
- Dado um módulo pendente de configuração, Quando chamo, Então perguntas e bloco_claude_md vêm como antes.

VERIFICAÇÃO (rode a partir de C:\Users\Trabalho\Documents\obsidian-ai-ecosystem e cole a saída real)
- npx tsc --noEmit → sem erros
- npx vitest run tests/setup → todos passam

Se qualquer coisa não bater com o descrito (arquivo, função ou assinatura inexistente, comportamento diferente do dito acima, teste quebrado por motivo alheio a esta etapa), PARE e relate em vez de improvisar.
RELATÓRIO FINAL: liste os arquivos alterados ou criados (caminho absoluto), cole a saída real de cada comando de verificação (não resuma) e descreva qualquer desvio ou dúvida.
```

## Etapa 14: ecosystem_list_scripts só com caminhos [Haiku 5.5 | esforço: médio]

**Objetivo:** fazer a tool ecosystem_list_scripts listar só os caminhos (sem repetir a linguagem), mantendo o corpo da rota GET /scripts como está.
**Depende de:** Etapa 13 (ecosystem_setup_status sem bloco e perguntas quando já configurado)
**Paralelizável com:** nenhuma

**Arquivos**
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\runner\script-tools.ts`
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\runner\script-tools.test.ts`
- Não tocar: qualquer outro arquivo

**Regras de implementação**
1. O corpo REST de GET /scripts continua exatamente igual.
2. A linguagem se infere pela extensão (inferLanguage), então não precisa ir na lista da tool MCP.

**Passos**
1. Mova a lógica de `list()` para uma função exportada `export async function listScriptsData(deps: ScriptToolsDeps): Promise<{ scripts: ListedScript[]; restrictionsOn: boolean }>` (mesmo corpo) e faça a listTool e a rota usarem essa função.
2. O handler da listTool passa a devolver texto com uma linha por script contendo só `s.path` (a mensagem de 'No scripts are available...' continua igual quando a lista é vazia) e `structuredContent: { scripts: scripts.map((s) => s.path), restrictionsOn }`. Atualize a descrição da tool para `Lists the vault scripts that ecosystem_run_script can run (one path per line, relative to the vault root; the language comes from the extension). Includes files in the allowed script folders and scripts declared by #mcp/script notes.`.
3. O handler de GET /scripts passa a chamar `listScriptsData(deps)` e devolver `{ status: 200, body }` com o objeto completo (ListedScript[]), em vez de usar o structuredContent da tool.
4. Em C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\runner\script-tools.test.ts adapte o teste 'lists scripts with structured content' (texto só com caminhos, sem '(python)' etc.; structuredContent.scripts é lista de strings) e confirme que o teste de GET /scripts continua esperando objetos com path e language.

**BDD (estado esperado ao concluir)**
- Dado dois scripts nas pastas permitidas, Quando chamo ecosystem_list_scripts, Então o texto tem uma linha por script só com o caminho e structuredContent.scripts é uma lista de strings.
- Dado os mesmos scripts, Quando chamo GET /scripts, Então o corpo traz objetos { path, language } como antes.
- Dado nenhum script, Quando chamo a tool, Então a mensagem 'No scripts are available...' continua igual.

**Verificação** (comandos a rodar, com o resultado esperado)
- npx tsc --noEmit → sem erros
- npx vitest run tests/runner tests/integration → todos passam

**Prompt para o subagente**
```text
Você é um subagente de implementação em TypeScript. Objetivo desta etapa: fazer a tool ecosystem_list_scripts listar só os caminhos (sem repetir a linguagem), mantendo o corpo da rota GET /scripts como está.

CONTEXTO COMPLETO
Projeto: plugin do Obsidian chamado AI Ecosystem (núcleo da suíte de plugins de IA), escrito em TypeScript, com servidor MCP e REST local, executor de scripts, índice e descoberta de tools (tools_find, tools_describe, tools_run), hooks do Claude Code gravados nas settings do cofre, configuração guiada de módulos, telas (formulários) e um inspetor de requisições. Raiz do repositório (RAIZ): C:\Users\Trabalho\Documents\obsidian-ai-ecosystem. Testes com vitest (pasta tests), sem Obsidian real (há um mock em tests\mocks\obsidian.ts).
Objetivo geral da demanda: implementar 16 melhorias aceitas numa auditoria do núcleo, na ordem: (1) teto de saída do ecosystem_run_script; (2) ecosystem_status compacto; (3) script_id no executor; (4) lote no tools_run; (5) diagnóstico que percebe módulo defasado; (6) cancelamento do run_script; (7) remover a aprovação do tools_run e o código morto; (8) limitar o activity.sqlite; (9) setup_status, list_scripts e diagnóstico enxutos; (10) resumo dos módulos no início da sessão; (11) tela_gerenciar e setup oculto sem pendência; (12) setup_save em lote; (13) descrição curta do run_script; (14) falha do módulo só por exceção; (15) catálogo por manifest.version; (16) despachante único dos hooks de proteção.
Regras globais:
1. Idioma: o código, os comentários e os nomes de identificadores ficam em inglês (como já está nos arquivos); as mensagens do diagnóstico, do hook e dos achados ficam em português quando o arquivo já estiver em português; o README tem uma parte em inglês e uma em português espelhadas.
2. Estilo do código: TypeScript estrito, 2 espaços, aspas duplas, ponto e vírgula, `import type` para tipos, sem dependências novas e sem alterar package.json.
3. Os diretórios src/runner, src/server, src/registry, src/hooks, src/core, src/setup, src/tool-index são código Node puro: não importam o pacote "obsidian".
4. O script src/hooks/script/ai-ecosystem-hook.mjs é Node puro, sem dependências, e nunca pode atrapalhar o agente: qualquer problema termina com saída 0 e sem texto.
5. Comandos, sempre a partir de C:\Users\Trabalho\Documents\obsidian-ai-ecosystem: typecheck `npx tsc --noEmit`; testes `npx vitest run` (um arquivo: `npx vitest run tests\pasta\arquivo.test.ts`); lint `npx eslint .`; build `npm run build`.
6. Linha de base antes das mudanças: tsc sem erros; 54 arquivos de teste e 918 testes passando; eslint com 0 erros e 19 avisos (nenhum erro ou aviso novo pode surgir).
7. Cada etapa altera só os arquivos listados nela. Não faça commit, push, deploy nem mexa na pasta .git; não rode `npm install`; não escreva nem leia segredos, tokens ou arquivos .env.
8. Se algo não bater com o descrito (arquivo, função ou assinatura inexistente, teste quebrado por motivo alheio à etapa), pare e relate em vez de improvisar.

O QUE JÁ EXISTE E É RELEVANTE PARA ESTA ETAPA
Em C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\runner\script-tools.ts, createScriptTools(deps) define uma função interna `list()` que devolve { scripts: ListedScript[] ({ path, language }), restrictionsOn } usando listAllowedScripts. O handler da listTool devolve texto com uma linha `${s.path} (${s.language})` por script e structuredContent `{ scripts, restrictionsOn }` (que repete tudo). A rota GET /scripts em createScriptRoutes obtém seu corpo chamando o handler da listTool e devolvendo `res.structuredContent` (corpo REST: { scripts: ListedScript[], restrictionsOn }), que NÃO pode mudar. Os testes ficam em C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\runner\script-tools.test.ts (describes 'ecosystem_list_scripts' e 'script routes').

ARQUIVOS
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\runner\script-tools.ts`
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\runner\script-tools.test.ts`
- Não tocar: qualquer outro arquivo

REGRAS DESTA ETAPA
1. O corpo REST de GET /scripts continua exatamente igual.
2. A linguagem se infere pela extensão (inferLanguage), então não precisa ir na lista da tool MCP.

O QUE FAZER, NESTA ORDEM
1. Mova a lógica de `list()` para uma função exportada `export async function listScriptsData(deps: ScriptToolsDeps): Promise<{ scripts: ListedScript[]; restrictionsOn: boolean }>` (mesmo corpo) e faça a listTool e a rota usarem essa função.
2. O handler da listTool passa a devolver texto com uma linha por script contendo só `s.path` (a mensagem de 'No scripts are available...' continua igual quando a lista é vazia) e `structuredContent: { scripts: scripts.map((s) => s.path), restrictionsOn }`. Atualize a descrição da tool para `Lists the vault scripts that ecosystem_run_script can run (one path per line, relative to the vault root; the language comes from the extension). Includes files in the allowed script folders and scripts declared by #mcp/script notes.`.
3. O handler de GET /scripts passa a chamar `listScriptsData(deps)` e devolver `{ status: 200, body }` com o objeto completo (ListedScript[]), em vez de usar o structuredContent da tool.
4. Em C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\runner\script-tools.test.ts adapte o teste 'lists scripts with structured content' (texto só com caminhos, sem '(python)' etc.; structuredContent.scripts é lista de strings) e confirme que o teste de GET /scripts continua esperando objetos com path e language.

O QUE NÃO FAZER
- Não altere a tool de execução nesta etapa.
- Não mude outros arquivos.

CRITÉRIOS DE ACEITE
- Dado dois scripts nas pastas permitidas, Quando chamo ecosystem_list_scripts, Então o texto tem uma linha por script só com o caminho e structuredContent.scripts é uma lista de strings.
- Dado os mesmos scripts, Quando chamo GET /scripts, Então o corpo traz objetos { path, language } como antes.
- Dado nenhum script, Quando chamo a tool, Então a mensagem 'No scripts are available...' continua igual.

VERIFICAÇÃO (rode a partir de C:\Users\Trabalho\Documents\obsidian-ai-ecosystem e cole a saída real)
- npx tsc --noEmit → sem erros
- npx vitest run tests/runner tests/integration → todos passam

Se qualquer coisa não bater com o descrito (arquivo, função ou assinatura inexistente, comportamento diferente do dito acima, teste quebrado por motivo alheio a esta etapa), PARE e relate em vez de improvisar.
RELATÓRIO FINAL: liste os arquivos alterados ou criados (caminho absoluto), cole a saída real de cada comando de verificação (não resuma) e descreva qualquer desvio ou dúvida.
```

## Etapa 15: ecosystem_diagnostico só com avisos e contagem [Haiku 5.5 | esforço: médio]

**Objetivo:** fazer ecosystem_diagnostico listar só os achados aviso e erro (com a contagem dos ok), com completo:true para ver tudo.
**Depende de:** Etapa 14 (ecosystem_list_scripts só com caminhos)
**Paralelizável com:** nenhuma

**Arquivos**
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\core\diagnostic.ts`
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\core\diagnostic.test.ts`
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\setup\kit-skill.test.ts` (só se algum teste depender das linhas ok)
- Não tocar: qualquer outro arquivo

**Regras de implementação**
1. buildDiagnostic continua devolvendo o relatório completo (só a saída da tool é filtrada).
2. O cabeçalho com a contagem de ok é mantido.

**Passos**
1. Em diagnostic.ts crie `export function compactReport(report: DiagnosticReport, completo: boolean): DiagnosticReport` que devolve o mesmo relatório quando `completo` e, senão, o relatório com `achados` filtrados para severidade diferente de 'ok' (resumo igual).
2. formatDiagnosticText(report) passa a escrever as linhas de todos os achados que receber (sem mudar o formato). Quando o relatório recebido não tiver nenhum achado e `resumo.ok > 0`, acrescente depois do cabeçalho a linha `Nenhum aviso ou erro. Use completo: true para listar os itens ok.`. (Isso só aparece no modo compacto.)
3. Na tool: inputSchema ganha `completo: { type: "boolean", default: false, description: "Also list the items that are ok. Default: only warnings and errors, with the count of ok items." }`; o handler faz `const report = compactReport(await buildDiagnostic(deps), args.completo === true);` e usa esse relatório no texto, no JSON e no structuredContent. Atualize a descrição da tool com a frase `Only warnings and errors are listed (completo: true lists everything).`.
4. Adapte C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\core\diagnostic.test.ts: os testes que contam linhas ok devem passar completo ou usar buildDiagnostic direto; acrescente: sem completo a saída só tem linhas [aviso] e [erro] e a contagem de ok no cabeçalho; com completo: true as linhas [ok] aparecem; relatório 100% ok mostra a linha 'Nenhum aviso ou erro.'; a verificação de sentinelas (nada sensível na saída) continua valendo nos dois modos. Rode também tests/setup/kit-skill.test.ts e ajuste só o que depender de linhas ok.

**BDD (estado esperado ao concluir)**
- Dado um cofre com 2 avisos e 5 itens ok, Quando chamo ecosystem_diagnostico, Então o texto tem o cabeçalho com '5 ok' e só 2 linhas de achados.
- Dado o mesmo cofre, Quando chamo com completo: true, Então as linhas [ok] também aparecem.
- Dado um cofre sem avisos, Quando chamo, Então aparece 'Nenhum aviso ou erro.'.
- Dado formato json sem completo, Quando chamo, Então achados só traz aviso e erro.

**Verificação** (comandos a rodar, com o resultado esperado)
- npx tsc --noEmit → sem erros
- npx vitest run tests/core tests/setup → todos passam

**Prompt para o subagente**
```text
Você é um subagente de implementação em TypeScript. Objetivo desta etapa: fazer ecosystem_diagnostico listar só os achados aviso e erro (com a contagem dos ok), com completo:true para ver tudo.

CONTEXTO COMPLETO
Projeto: plugin do Obsidian chamado AI Ecosystem (núcleo da suíte de plugins de IA), escrito em TypeScript, com servidor MCP e REST local, executor de scripts, índice e descoberta de tools (tools_find, tools_describe, tools_run), hooks do Claude Code gravados nas settings do cofre, configuração guiada de módulos, telas (formulários) e um inspetor de requisições. Raiz do repositório (RAIZ): C:\Users\Trabalho\Documents\obsidian-ai-ecosystem. Testes com vitest (pasta tests), sem Obsidian real (há um mock em tests\mocks\obsidian.ts).
Objetivo geral da demanda: implementar 16 melhorias aceitas numa auditoria do núcleo, na ordem: (1) teto de saída do ecosystem_run_script; (2) ecosystem_status compacto; (3) script_id no executor; (4) lote no tools_run; (5) diagnóstico que percebe módulo defasado; (6) cancelamento do run_script; (7) remover a aprovação do tools_run e o código morto; (8) limitar o activity.sqlite; (9) setup_status, list_scripts e diagnóstico enxutos; (10) resumo dos módulos no início da sessão; (11) tela_gerenciar e setup oculto sem pendência; (12) setup_save em lote; (13) descrição curta do run_script; (14) falha do módulo só por exceção; (15) catálogo por manifest.version; (16) despachante único dos hooks de proteção.
Regras globais:
1. Idioma: o código, os comentários e os nomes de identificadores ficam em inglês (como já está nos arquivos); as mensagens do diagnóstico, do hook e dos achados ficam em português quando o arquivo já estiver em português; o README tem uma parte em inglês e uma em português espelhadas.
2. Estilo do código: TypeScript estrito, 2 espaços, aspas duplas, ponto e vírgula, `import type` para tipos, sem dependências novas e sem alterar package.json.
3. Os diretórios src/runner, src/server, src/registry, src/hooks, src/core, src/setup, src/tool-index são código Node puro: não importam o pacote "obsidian".
4. O script src/hooks/script/ai-ecosystem-hook.mjs é Node puro, sem dependências, e nunca pode atrapalhar o agente: qualquer problema termina com saída 0 e sem texto.
5. Comandos, sempre a partir de C:\Users\Trabalho\Documents\obsidian-ai-ecosystem: typecheck `npx tsc --noEmit`; testes `npx vitest run` (um arquivo: `npx vitest run tests\pasta\arquivo.test.ts`); lint `npx eslint .`; build `npm run build`.
6. Linha de base antes das mudanças: tsc sem erros; 54 arquivos de teste e 918 testes passando; eslint com 0 erros e 19 avisos (nenhum erro ou aviso novo pode surgir).
7. Cada etapa altera só os arquivos listados nela. Não faça commit, push, deploy nem mexa na pasta .git; não rode `npm install`; não escreva nem leia segredos, tokens ou arquivos .env.
8. Se algo não bater com o descrito (arquivo, função ou assinatura inexistente, teste quebrado por motivo alheio à etapa), pare e relate em vez de improvisar.

O QUE JÁ EXISTE E É RELEVANTE PARA ESTA ETAPA
Em C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\core\diagnostic.ts, buildDiagnostic(deps) devolve DiagnosticReport { versao, resumo: Record<Severity, number>, achados: Finding[] } com todos os achados (inclusive os ok, ~19 linhas). formatDiagnosticText(report) escreve a linha de cabeçalho 'Diagnóstico do AI Ecosystem X: N ok, M avisos, K erros.' e uma linha '[severidade] mensagem -> ação' por achado. createDiagnosticTool(deps) cria a tool com inputSchema `{ formato: 'texto' | 'json' }` e devolve texto (ou JSON.stringify do relatório) e `structuredContent: { ...report }`. A skill /kit e o README descrevem a tool. Os testes ficam em C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\core\diagnostic.test.ts (e podem aparecer expectativas de '[ok]' também em C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\setup\kit-skill.test.ts e C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\integration).

ARQUIVOS
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\core\diagnostic.ts`
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\core\diagnostic.test.ts`
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\setup\kit-skill.test.ts` (só se algum teste depender das linhas ok)
- Não tocar: qualquer outro arquivo

REGRAS DESTA ETAPA
1. buildDiagnostic continua devolvendo o relatório completo (só a saída da tool é filtrada).
2. O cabeçalho com a contagem de ok é mantido.

O QUE FAZER, NESTA ORDEM
1. Em diagnostic.ts crie `export function compactReport(report: DiagnosticReport, completo: boolean): DiagnosticReport` que devolve o mesmo relatório quando `completo` e, senão, o relatório com `achados` filtrados para severidade diferente de 'ok' (resumo igual).
2. formatDiagnosticText(report) passa a escrever as linhas de todos os achados que receber (sem mudar o formato). Quando o relatório recebido não tiver nenhum achado e `resumo.ok > 0`, acrescente depois do cabeçalho a linha `Nenhum aviso ou erro. Use completo: true para listar os itens ok.`. (Isso só aparece no modo compacto.)
3. Na tool: inputSchema ganha `completo: { type: "boolean", default: false, description: "Also list the items that are ok. Default: only warnings and errors, with the count of ok items." }`; o handler faz `const report = compactReport(await buildDiagnostic(deps), args.completo === true);` e usa esse relatório no texto, no JSON e no structuredContent. Atualize a descrição da tool com a frase `Only warnings and errors are listed (completo: true lists everything).`.
4. Adapte C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\core\diagnostic.test.ts: os testes que contam linhas ok devem passar completo ou usar buildDiagnostic direto; acrescente: sem completo a saída só tem linhas [aviso] e [erro] e a contagem de ok no cabeçalho; com completo: true as linhas [ok] aparecem; relatório 100% ok mostra a linha 'Nenhum aviso ou erro.'; a verificação de sentinelas (nada sensível na saída) continua valendo nos dois modos. Rode também tests/setup/kit-skill.test.ts e ajuste só o que depender de linhas ok.

O QUE NÃO FAZER
- Não altere os textos das mensagens de cada achado.
- Não altere as skills de /kit.

CRITÉRIOS DE ACEITE
- Dado um cofre com 2 avisos e 5 itens ok, Quando chamo ecosystem_diagnostico, Então o texto tem o cabeçalho com '5 ok' e só 2 linhas de achados.
- Dado o mesmo cofre, Quando chamo com completo: true, Então as linhas [ok] também aparecem.
- Dado um cofre sem avisos, Quando chamo, Então aparece 'Nenhum aviso ou erro.'.
- Dado formato json sem completo, Quando chamo, Então achados só traz aviso e erro.

VERIFICAÇÃO (rode a partir de C:\Users\Trabalho\Documents\obsidian-ai-ecosystem e cole a saída real)
- npx tsc --noEmit → sem erros
- npx vitest run tests/core tests/setup → todos passam

Se qualquer coisa não bater com o descrito (arquivo, função ou assinatura inexistente, comportamento diferente do dito acima, teste quebrado por motivo alheio a esta etapa), PARE e relate em vez de improvisar.
RELATÓRIO FINAL: liste os arquivos alterados ou criados (caminho absoluto), cole a saída real de cada comando de verificação (não resuma) e descreva qualquer desvio ou dúvida.
```

## Etapa 16: Hook de resumo dos módulos no início da sessão [Haiku 5.5 | esforço: alto]

**Objetivo:** criar o hook 'resumo' (SessionStart) que injeta, em até 300 caracteres, os módulos ativos e as pendências, sem somar ao perfil dos hooks por comando.
**Depende de:** Etapa 15 (ecosystem_diagnostico só com avisos e contagem)
**Paralelizável com:** nenhuma

**Arquivos**
- Criar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\hooks\hook-resumo.test.ts`
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\hooks\hook-specs.ts`
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\hooks\script\ai-ecosystem-hook.mjs`
- Não tocar: qualquer outro arquivo

**Regras de implementação**
1. O script nunca pode atrapalhar o agente: qualquer problema termina com allow() (status 0, sem saída).
2. Só roda para o evento SessionStart (campo input.hook_event_name) e só com o núcleo vivo (coreIsAlive) e configurado (modules/ai-ecosystem.json com estado 'configurado'); se o núcleo estiver pendente, o hook de setup já fala com o agente.
3. O texto injetado tem no máximo 300 caracteres.
4. Variável de ambiente AI_ECOSYSTEM_HOOKS === 'off' desliga o resumo (allow()).

**Passos**
1. Em hook-specs.ts: acrescente 'resumo' a HookType e ao regex COMMAND_PATTERN (`(protecao|setup|falha|aprovacao|execucao|resumo)`); crie `export const CORE_SUMMARY_SPEC: HookSpec = { module: ECOSYSTEM_ID, type: "resumo", event: "SessionStart" };` com comentário (core entry: short summary of the active modules at the start of a session) e faça `CORE_SPECS = [CORE_FAILURE_SPEC, CORE_SUMMARY_SPEC]`.
2. No script, acrescente em main() a linha `if (type === "resumo") return summary(stateDir, input);` (junto dos outros tipos) e a função: `function summary(stateDir, input) { if (process.env.AI_ECOSYSTEM_HOOKS === "off") return allow(); if (input.hook_event_name !== "SessionStart") return allow(); if (!coreIsAlive(stateDir)) return allow(); const core = readJson(stateDir, "modules/ai-ecosystem.json"); if (!isObject(core) || core.estado !== "configurado") return allow(); let files; try { files = fs.readdirSync(path.join(stateDir, "modules")).sort(); } catch { return allow(); } const active = []; const pending = []; for (const file of files) { if (!file.endsWith(".json") || file.endsWith(".configurado.json")) continue; const id = file.slice(0, -5); if (id === "ai-ecosystem") continue; const state = readJson(stateDir, "modules/" + file); if (!isObject(state)) continue; if (state.estado === "configurado") active.push(id); else if (state.estado === "pendente_configuracao") pending.push(id); } if (active.length === 0 && pending.length === 0) return allow(); const parts = ["AI Ecosystem ativo."]; if (active.length > 0) parts.push("Módulos: " + active.join(", ") + "."); if (pending.length > 0) parts.push("Pendentes: " + pending.map((id) => id + " (skill configurar-" + id + ")").join(", ") + "."); parts.push("Ache tools com tools_find; ecosystem_status só se precisar de detalhes."); let text = parts.join(" "); if (text.length > 300) text = text.slice(0, 299) + "…"; respond({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: text } }); }` (formate em várias linhas, no estilo do arquivo).
3. Atualize o comentário do cabeçalho do script citando o tipo 'resumo (SessionStart: short summary of the active modules)'.
4. Crie C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\hooks\hook-resumo.test.ts no estilo de C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\hooks\hook-execucao.test.ts (HookWorld de ./helpers; world.module(id, estado) cria modules/<id>.json; world.run('ai-ecosystem', 'resumo', { hook_event_name: 'SessionStart' }); world.heartbeat(null) apaga o heartbeat; HookRun traz status, stdout e context = additionalContext). Leia helpers.ts antes. Casos: (a) núcleo configurado + dois módulos configurados e um pendente → context contém os ids ativos, 'Pendentes: <id> (skill configurar-<id>)', tem ≤ 300 caracteres; (b) só núcleo, sem outros módulos → stdout vazio; (c) núcleo pendente → stdout vazio; (d) sem heartbeat → vazio; (e) hook_event_name 'UserPromptSubmit' → vazio; (f) 40 módulos com ids longos → context com exatamente ≤ 300 caracteres e terminando em '…'; (g) AI_ECOSYSTEM_HOOKS=off → vazio; (h) um modules/x.json corrompido é ignorado sem erro; (i) entrada que não é JSON → status 0 e stdout vazio. Acrescente um teste de spec: CORE_SPECS.map(s => s.type) é ['falha','resumo'] e parseCommand(buildCommand('/v','ai-ecosystem','resumo')) devolve { module: 'ai-ecosystem', type: 'resumo' }.

**BDD (estado esperado ao concluir)**
- Dado o núcleo configurado e módulos ativos e um pendente, Quando uma sessão começa (SessionStart), Então o hook devolve additionalContext com os ativos, o pendente e a skill dele, em até 300 caracteres.
- Dado o núcleo pendente ou sem heartbeat ou outro evento, Quando o hook roda, Então não há saída e o status é 0.
- Dado 40 módulos, Quando o hook roda, Então o texto tem no máximo 300 caracteres e termina com '…'.
- Dado uma entrada que não é JSON, Quando o hook roda, Então sai com status 0 e sem saída.

**Verificação** (comandos a rodar, com o resultado esperado)
- node --check C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\hooks\script\ai-ecosystem-hook.mjs → sem saída (sucesso)
- npx vitest run tests/hooks/hook-resumo.test.ts → todos passam
- npx tsc --noEmit → sem erros

**Prompt para o subagente**
```text
Você é um subagente de implementação em TypeScript. Objetivo desta etapa: criar o hook 'resumo' (SessionStart) que injeta, em até 300 caracteres, os módulos ativos e as pendências, sem somar ao perfil dos hooks por comando.

CONTEXTO COMPLETO
Projeto: plugin do Obsidian chamado AI Ecosystem (núcleo da suíte de plugins de IA), escrito em TypeScript, com servidor MCP e REST local, executor de scripts, índice e descoberta de tools (tools_find, tools_describe, tools_run), hooks do Claude Code gravados nas settings do cofre, configuração guiada de módulos, telas (formulários) e um inspetor de requisições. Raiz do repositório (RAIZ): C:\Users\Trabalho\Documents\obsidian-ai-ecosystem. Testes com vitest (pasta tests), sem Obsidian real (há um mock em tests\mocks\obsidian.ts).
Objetivo geral da demanda: implementar 16 melhorias aceitas numa auditoria do núcleo, na ordem: (1) teto de saída do ecosystem_run_script; (2) ecosystem_status compacto; (3) script_id no executor; (4) lote no tools_run; (5) diagnóstico que percebe módulo defasado; (6) cancelamento do run_script; (7) remover a aprovação do tools_run e o código morto; (8) limitar o activity.sqlite; (9) setup_status, list_scripts e diagnóstico enxutos; (10) resumo dos módulos no início da sessão; (11) tela_gerenciar e setup oculto sem pendência; (12) setup_save em lote; (13) descrição curta do run_script; (14) falha do módulo só por exceção; (15) catálogo por manifest.version; (16) despachante único dos hooks de proteção.
Regras globais:
1. Idioma: o código, os comentários e os nomes de identificadores ficam em inglês (como já está nos arquivos); as mensagens do diagnóstico, do hook e dos achados ficam em português quando o arquivo já estiver em português; o README tem uma parte em inglês e uma em português espelhadas.
2. Estilo do código: TypeScript estrito, 2 espaços, aspas duplas, ponto e vírgula, `import type` para tipos, sem dependências novas e sem alterar package.json.
3. Os diretórios src/runner, src/server, src/registry, src/hooks, src/core, src/setup, src/tool-index são código Node puro: não importam o pacote "obsidian".
4. O script src/hooks/script/ai-ecosystem-hook.mjs é Node puro, sem dependências, e nunca pode atrapalhar o agente: qualquer problema termina com saída 0 e sem texto.
5. Comandos, sempre a partir de C:\Users\Trabalho\Documents\obsidian-ai-ecosystem: typecheck `npx tsc --noEmit`; testes `npx vitest run` (um arquivo: `npx vitest run tests\pasta\arquivo.test.ts`); lint `npx eslint .`; build `npm run build`.
6. Linha de base antes das mudanças: tsc sem erros; 54 arquivos de teste e 918 testes passando; eslint com 0 erros e 19 avisos (nenhum erro ou aviso novo pode surgir).
7. Cada etapa altera só os arquivos listados nela. Não faça commit, push, deploy nem mexa na pasta .git; não rode `npm install`; não escreva nem leia segredos, tokens ou arquivos .env.
8. Se algo não bater com o descrito (arquivo, função ou assinatura inexistente, teste quebrado por motivo alheio à etapa), pare e relate em vez de improvisar.

O QUE JÁ EXISTE E É RELEVANTE PARA ESTA ETAPA
O núcleo grava hooks do Claude Code que chamam `node <cofre>/.claude/ai-ecosystem/hooks/ai-ecosystem-hook.mjs <modulo> <tipo>`. Em C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\hooks\hook-specs.ts: HookType = 'protecao' | 'setup' | 'falha' | 'aprovacao' | 'execucao'; HookEvent inclui 'SessionStart'; CORE_FAILURE_SPEC; CORE_SPECS = [CORE_FAILURE_SPEC]; COMMAND_PATTERN reconhece os tipos pelo comando. O hook manager (C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\hooks\hook-manager.ts, installCore) instala `[...CORE_SPECS]` nas settings quando o Node existe. O script C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\hooks\script\ai-ecosystem-hook.mjs lê o estado em <cofre>/.claude/ai-ecosystem/ (variável `stateDir`): `modules/<id>.json` (campo `estado`: 'configurado' | 'pendente_configuracao' | 'desativado', `nome` opcional), `heartbeat` (função coreIsAlive(stateDir)). As funções utilitárias do script: `readJson(stateDir, rel)`, `isObject`, `respond(output)`, `allow()` (sai sem saída), `coreIsAlive(stateDir)`, `setup(stateDir, moduleId, input)` (exemplo de resposta de SessionStart: `respond({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: order } })`). A função main() despacha por tipo. O estado do núcleo ('ai-ecosystem') começa 'pendente_configuracao' e o hook de setup já cuida disso. Hoje, sem pendência, nada é injetado e o agente gasta chamadas de status e list_scripts para se situar. SessionStart roda uma vez por sessão, então não pesa no custo por comando.

ARQUIVOS
- Criar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\hooks\hook-resumo.test.ts`
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\hooks\hook-specs.ts`
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\hooks\script\ai-ecosystem-hook.mjs`
- Não tocar: qualquer outro arquivo

REGRAS DESTA ETAPA
1. O script nunca pode atrapalhar o agente: qualquer problema termina com allow() (status 0, sem saída).
2. Só roda para o evento SessionStart (campo input.hook_event_name) e só com o núcleo vivo (coreIsAlive) e configurado (modules/ai-ecosystem.json com estado 'configurado'); se o núcleo estiver pendente, o hook de setup já fala com o agente.
3. O texto injetado tem no máximo 300 caracteres.
4. Variável de ambiente AI_ECOSYSTEM_HOOKS === 'off' desliga o resumo (allow()).

O QUE FAZER, NESTA ORDEM
1. Em hook-specs.ts: acrescente 'resumo' a HookType e ao regex COMMAND_PATTERN (`(protecao|setup|falha|aprovacao|execucao|resumo)`); crie `export const CORE_SUMMARY_SPEC: HookSpec = { module: ECOSYSTEM_ID, type: "resumo", event: "SessionStart" };` com comentário (core entry: short summary of the active modules at the start of a session) e faça `CORE_SPECS = [CORE_FAILURE_SPEC, CORE_SUMMARY_SPEC]`.
2. No script, acrescente em main() a linha `if (type === "resumo") return summary(stateDir, input);` (junto dos outros tipos) e a função: `function summary(stateDir, input) { if (process.env.AI_ECOSYSTEM_HOOKS === "off") return allow(); if (input.hook_event_name !== "SessionStart") return allow(); if (!coreIsAlive(stateDir)) return allow(); const core = readJson(stateDir, "modules/ai-ecosystem.json"); if (!isObject(core) || core.estado !== "configurado") return allow(); let files; try { files = fs.readdirSync(path.join(stateDir, "modules")).sort(); } catch { return allow(); } const active = []; const pending = []; for (const file of files) { if (!file.endsWith(".json") || file.endsWith(".configurado.json")) continue; const id = file.slice(0, -5); if (id === "ai-ecosystem") continue; const state = readJson(stateDir, "modules/" + file); if (!isObject(state)) continue; if (state.estado === "configurado") active.push(id); else if (state.estado === "pendente_configuracao") pending.push(id); } if (active.length === 0 && pending.length === 0) return allow(); const parts = ["AI Ecosystem ativo."]; if (active.length > 0) parts.push("Módulos: " + active.join(", ") + "."); if (pending.length > 0) parts.push("Pendentes: " + pending.map((id) => id + " (skill configurar-" + id + ")").join(", ") + "."); parts.push("Ache tools com tools_find; ecosystem_status só se precisar de detalhes."); let text = parts.join(" "); if (text.length > 300) text = text.slice(0, 299) + "…"; respond({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: text } }); }` (formate em várias linhas, no estilo do arquivo).
3. Atualize o comentário do cabeçalho do script citando o tipo 'resumo (SessionStart: short summary of the active modules)'.
4. Crie C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\hooks\hook-resumo.test.ts no estilo de C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\hooks\hook-execucao.test.ts (HookWorld de ./helpers; world.module(id, estado) cria modules/<id>.json; world.run('ai-ecosystem', 'resumo', { hook_event_name: 'SessionStart' }); world.heartbeat(null) apaga o heartbeat; HookRun traz status, stdout e context = additionalContext). Leia helpers.ts antes. Casos: (a) núcleo configurado + dois módulos configurados e um pendente → context contém os ids ativos, 'Pendentes: <id> (skill configurar-<id>)', tem ≤ 300 caracteres; (b) só núcleo, sem outros módulos → stdout vazio; (c) núcleo pendente → stdout vazio; (d) sem heartbeat → vazio; (e) hook_event_name 'UserPromptSubmit' → vazio; (f) 40 módulos com ids longos → context com exatamente ≤ 300 caracteres e terminando em '…'; (g) AI_ECOSYSTEM_HOOKS=off → vazio; (h) um modules/x.json corrompido é ignorado sem erro; (i) entrada que não é JSON → status 0 e stdout vazio. Acrescente um teste de spec: CORE_SPECS.map(s => s.type) é ['falha','resumo'] e parseCommand(buildCommand('/v','ai-ecosystem','resumo')) devolve { module: 'ai-ecosystem', type: 'resumo' }.

O QUE NÃO FAZER
- Não altere hook-manager.ts (a instalação sai de CORE_SPECS sozinha).
- Os outros testes que quebrarem por causa da nova entrada ficam para a próxima etapa: apenas relate quais são.
- Não mude o comportamento de protecao, setup, falha.

CRITÉRIOS DE ACEITE
- Dado o núcleo configurado e módulos ativos e um pendente, Quando uma sessão começa (SessionStart), Então o hook devolve additionalContext com os ativos, o pendente e a skill dele, em até 300 caracteres.
- Dado o núcleo pendente ou sem heartbeat ou outro evento, Quando o hook roda, Então não há saída e o status é 0.
- Dado 40 módulos, Quando o hook roda, Então o texto tem no máximo 300 caracteres e termina com '…'.
- Dado uma entrada que não é JSON, Quando o hook roda, Então sai com status 0 e sem saída.

VERIFICAÇÃO (rode a partir de C:\Users\Trabalho\Documents\obsidian-ai-ecosystem e cole a saída real)
- node --check C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\hooks\script\ai-ecosystem-hook.mjs → sem saída (sucesso)
- npx vitest run tests/hooks/hook-resumo.test.ts → todos passam
- npx tsc --noEmit → sem erros

Se qualquer coisa não bater com o descrito (arquivo, função ou assinatura inexistente, comportamento diferente do dito acima, teste quebrado por motivo alheio a esta etapa), PARE e relate em vez de improvisar.
RELATÓRIO FINAL: liste os arquivos alterados ou criados (caminho absoluto), cole a saída real de cada comando de verificação (não resuma) e descreva qualquer desvio ou dúvida.
```

## Etapa 17: Ajustar os testes afetados pelo hook de resumo [Haiku 5.5 | esforço: alto]

**Objetivo:** fazer a suíte inteira passar com a nova entrada 'resumo' (SessionStart) instalada pelo núcleo, ajustando só expectativas de testes.
**Depende de:** Etapa 16 (Hook de resumo dos módulos no início da sessão)
**Paralelizável com:** nenhuma

**Arquivos**
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\hooks\hook-manager.test.ts`
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\hooks\ecosystem-hooks.test.ts`
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\setup\tools.test.ts`
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\setup\helpers.ts`
- Alterar: (qualquer outro arquivo em C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\hooks ou C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\setup que falhar por causa da entrada 'resumo')
- Não tocar: qualquer outro arquivo

**Regras de implementação**
1. Só edite arquivos de teste, e só expectativas que dependem da existência da entrada 'resumo' (a entrada é intencional).
2. Se um teste falhar por outro motivo (bug real em src), NÃO o mascare: relate-o.
3. Ao ajustar uma contagem ou lista, prefira confirmar o tipo 'resumo' explicitamente em vez de só trocar o número.

**Passos**
1. Rode `npx vitest run tests/hooks tests/setup` e liste os testes que falham.
2. Para cada falha causada pela nova entrada, ajuste a expectativa: contagens de grupos de SessionStart (+1 do núcleo), listas de comandos (inclua o comando do tipo resumo), comparações de `settings().hooks` por igualdade exata.
3. Rode a suíte inteira (`npx vitest run`) e confirme que não há mais falhas. Se algum teste de outra pasta falhar, relate o nome e o motivo, sem ajustá-lo se não tiver relação com a entrada resumo.

**BDD (estado esperado ao concluir)**
- Dado o código atual, Quando rodo `npx vitest run`, Então todos os arquivos de teste passam.
- Dado os testes ajustados, Então pelo menos um deles confere que o núcleo instala o tipo 'resumo' no SessionStart.

**Verificação** (comandos a rodar, com o resultado esperado)
- npx vitest run → todos os testes passam
- npx tsc --noEmit → sem erros

**Prompt para o subagente**
```text
Você é um subagente de implementação em TypeScript. Objetivo desta etapa: fazer a suíte inteira passar com a nova entrada 'resumo' (SessionStart) instalada pelo núcleo, ajustando só expectativas de testes.

CONTEXTO COMPLETO
Projeto: plugin do Obsidian chamado AI Ecosystem (núcleo da suíte de plugins de IA), escrito em TypeScript, com servidor MCP e REST local, executor de scripts, índice e descoberta de tools (tools_find, tools_describe, tools_run), hooks do Claude Code gravados nas settings do cofre, configuração guiada de módulos, telas (formulários) e um inspetor de requisições. Raiz do repositório (RAIZ): C:\Users\Trabalho\Documents\obsidian-ai-ecosystem. Testes com vitest (pasta tests), sem Obsidian real (há um mock em tests\mocks\obsidian.ts).
Objetivo geral da demanda: implementar 16 melhorias aceitas numa auditoria do núcleo, na ordem: (1) teto de saída do ecosystem_run_script; (2) ecosystem_status compacto; (3) script_id no executor; (4) lote no tools_run; (5) diagnóstico que percebe módulo defasado; (6) cancelamento do run_script; (7) remover a aprovação do tools_run e o código morto; (8) limitar o activity.sqlite; (9) setup_status, list_scripts e diagnóstico enxutos; (10) resumo dos módulos no início da sessão; (11) tela_gerenciar e setup oculto sem pendência; (12) setup_save em lote; (13) descrição curta do run_script; (14) falha do módulo só por exceção; (15) catálogo por manifest.version; (16) despachante único dos hooks de proteção.
Regras globais:
1. Idioma: o código, os comentários e os nomes de identificadores ficam em inglês (como já está nos arquivos); as mensagens do diagnóstico, do hook e dos achados ficam em português quando o arquivo já estiver em português; o README tem uma parte em inglês e uma em português espelhadas.
2. Estilo do código: TypeScript estrito, 2 espaços, aspas duplas, ponto e vírgula, `import type` para tipos, sem dependências novas e sem alterar package.json.
3. Os diretórios src/runner, src/server, src/registry, src/hooks, src/core, src/setup, src/tool-index são código Node puro: não importam o pacote "obsidian".
4. O script src/hooks/script/ai-ecosystem-hook.mjs é Node puro, sem dependências, e nunca pode atrapalhar o agente: qualquer problema termina com saída 0 e sem texto.
5. Comandos, sempre a partir de C:\Users\Trabalho\Documents\obsidian-ai-ecosystem: typecheck `npx tsc --noEmit`; testes `npx vitest run` (um arquivo: `npx vitest run tests\pasta\arquivo.test.ts`); lint `npx eslint .`; build `npm run build`.
6. Linha de base antes das mudanças: tsc sem erros; 54 arquivos de teste e 918 testes passando; eslint com 0 erros e 19 avisos (nenhum erro ou aviso novo pode surgir).
7. Cada etapa altera só os arquivos listados nela. Não faça commit, push, deploy nem mexa na pasta .git; não rode `npm install`; não escreva nem leia segredos, tokens ou arquivos .env.
8. Se algo não bater com o descrito (arquivo, função ou assinatura inexistente, teste quebrado por motivo alheio à etapa), pare e relate em vez de improvisar.

O QUE JÁ EXISTE E É RELEVANTE PARA ESTA ETAPA
A etapa anterior fez o núcleo instalar, junto com a entrada 'falha' (PostToolUseFailure), uma segunda entrada do tipo 'resumo' no evento SessionStart (comando `node "<cofre>/.claude/ai-ecosystem/hooks/ai-ecosystem-hook.mjs" ai-ecosystem resumo`, sem matcher, timeout 10) através de CORE_SPECS em C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\hooks\hook-specs.ts. Outras entradas de SessionStart já existem para a configuração de módulos (tipo setup, módulos diferentes). Testes que conferem o formato exato de `settings().hooks`, a lista de comandos instalados ou a contagem de grupos de SessionStart podem agora falhar. Os testes de hooks ficam em C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\hooks e os de setup em C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\setup (helpers em C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\setup\helpers.ts: hookCommands, hasHook, settingsFile).

ARQUIVOS
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\hooks\hook-manager.test.ts`
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\hooks\ecosystem-hooks.test.ts`
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\setup\tools.test.ts`
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\setup\helpers.ts`
- Alterar: (qualquer outro arquivo em C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\hooks ou C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\setup que falhar por causa da entrada 'resumo')
- Não tocar: qualquer outro arquivo

REGRAS DESTA ETAPA
1. Só edite arquivos de teste, e só expectativas que dependem da existência da entrada 'resumo' (a entrada é intencional).
2. Se um teste falhar por outro motivo (bug real em src), NÃO o mascare: relate-o.
3. Ao ajustar uma contagem ou lista, prefira confirmar o tipo 'resumo' explicitamente em vez de só trocar o número.

O QUE FAZER, NESTA ORDEM
1. Rode `npx vitest run tests/hooks tests/setup` e liste os testes que falham.
2. Para cada falha causada pela nova entrada, ajuste a expectativa: contagens de grupos de SessionStart (+1 do núcleo), listas de comandos (inclua o comando do tipo resumo), comparações de `settings().hooks` por igualdade exata.
3. Rode a suíte inteira (`npx vitest run`) e confirme que não há mais falhas. Se algum teste de outra pasta falhar, relate o nome e o motivo, sem ajustá-lo se não tiver relação com a entrada resumo.

O QUE NÃO FAZER
- Não altere nenhum arquivo em src.
- Não apague testes: ajuste as expectativas.

CRITÉRIOS DE ACEITE
- Dado o código atual, Quando rodo `npx vitest run`, Então todos os arquivos de teste passam.
- Dado os testes ajustados, Então pelo menos um deles confere que o núcleo instala o tipo 'resumo' no SessionStart.

VERIFICAÇÃO (rode a partir de C:\Users\Trabalho\Documents\obsidian-ai-ecosystem e cole a saída real)
- npx vitest run → todos os testes passam
- npx tsc --noEmit → sem erros

Se qualquer coisa não bater com o descrito (arquivo, função ou assinatura inexistente, comportamento diferente do dito acima, teste quebrado por motivo alheio a esta etapa), PARE e relate em vez de improvisar.
RELATÓRIO FINAL: liste os arquivos alterados ou criados (caminho absoluto), cole a saída real de cada comando de verificação (não resuma) e descreva qualquer desvio ou dúvida.
```

## Etapa 18: Fundir tela_criar e tela_editar em tela_gerenciar [Haiku 5.5 | esforço: alto]

**Objetivo:** criar a tool tela_gerenciar (acao criar, editar ou guia) no lugar de tela_criar e tela_editar, com o guia de campos só quando pedido.
**Depende de:** Etapa 17 (Ajustar os testes afetados pelo hook de resumo)
**Paralelizável com:** nenhuma

**Arquivos**
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\screens\tools.ts`
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\core\builtin-module.ts` (só CORE_TOOL_METADATA)
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\screens\model.ts` (só RESERVED_SLUGS)
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\core\builtin-module.test.ts`
- Não tocar: qualquer outro arquivo

**Regras de implementação**
1. tela_listar e tela_remover não mudam.
2. A ordem das tools de infraestrutura passa a ser tela_gerenciar, tela_listar, tela_remover.
3. service.create e service.edit NÃO são alterados.
4. A descrição da tela_gerenciar não inclui o FIELD_GUIDE; o guia só sai quando acao é 'guia'.

**Passos**
1. Em tools.ts substitua os objetos tela_criar e tela_editar por um único objeto `name: "tela_gerenciar"`, `title: "Create or edit a screen"`, descrição `Creates (acao criar) or replaces (acao editar) a screen, a form the user fills in inside Obsidian, as the tool tela_<slug>. The user sees a preview of the screen and its JSON definition and must approve it; nothing is saved before that. Call it with acao guia first to get the list of field types. Returns { status: "aprovado" | "recusado" | "expirado" | "cancelado" }; waits up to 5 minutes.`, inputSchema `{ type: "object", properties: { acao: { type: "string", enum: ["criar", "editar", "guia"] }, slug: { type: "string", pattern: SLUG_PATTERN.source, description: "Only for editar: slug of the screen to replace (it cannot change)." }, definicao: DEFINITION_SCHEMA }, required: ["acao"], additionalProperties: false }`, annotations `{ title: "Create or edit a screen", readOnlyHint: false, destructiveHint: false, openWorldHint: false }` e o handler: `(args, ctx) => { const { acao, ...rest } = args; if (acao === "guia") return Promise.resolve({ content: [{ type: "text", text: FIELD_GUIDE }] }); if (acao === "criar") return service.create(rest, ctx); if (acao === "editar") return service.edit(rest, ctx); return Promise.resolve({ content: [{ type: "text", text: "Invalid arguments: acao must be criar, editar or guia." }], isError: true }); }`. A tela_gerenciar fica na posição de tela_criar (primeira), seguida de tela_listar e tela_remover.
2. Atualize o comentário do topo de tools.ts: `the three infrastructure tools (tela_gerenciar, tela_listar, tela_remover)`.
3. Em builtin-module.ts, em CORE_TOOL_METADATA, apague as entradas tela_criar e tela_editar e crie `tela_gerenciar: { categoria: "telas", tags: ["tela", "formulario", "criar", "editar", "screen", "form"], resumo: "Cria ou edita uma tela (formulário); acao guia lista os tipos de campo", efeito: "cofre" }`. No comentário de BuiltinModuleDeps.screens troque 'tela_criar...' por 'tela_gerenciar...'.
4. Em model.ts: `export const RESERVED_SLUGS: readonly string[] = ["criar", "editar", "gerenciar", "listar", "remover"];` (mantém criar e editar por compatibilidade) e atualize o comentário para citar tela_gerenciar.
5. Em C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\core\builtin-module.test.ts atualize a lista de chaves de CORE_TOOL_METADATA (de 11 para 10: tela_gerenciar no lugar de tela_criar e tela_editar, mantendo a ordem alfabética do teste) e o título do teste ('covers the 10 core tools...').

**BDD (estado esperado ao concluir)**
- Dado o serviço de telas, Quando chamo tela_gerenciar com acao 'guia', Então o texto devolvido é o guia de campos e nada é gravado.
- Dado acao 'criar' com uma definicao válida, Quando chamo, Então a mesma prévia e aprovação de antes acontecem (service.create é chamado sem a chave acao).
- Dado acao 'editar' com slug e definicao, Quando chamo, Então service.edit é chamado com slug e definicao.
- Dado acao 'xyz', Quando chamo, Então isError com 'acao must be criar, editar or guia.'.
- Dado createScreenInfraTools, Então a ordem dos nomes é tela_gerenciar, tela_listar, tela_remover.

**Verificação** (comandos a rodar, com o resultado esperado)
- npx tsc --noEmit → sem erros
- npx vitest run tests/core/builtin-module.test.ts → todos passam

**Prompt para o subagente**
```text
Você é um subagente de implementação em TypeScript. Objetivo desta etapa: criar a tool tela_gerenciar (acao criar, editar ou guia) no lugar de tela_criar e tela_editar, com o guia de campos só quando pedido.

CONTEXTO COMPLETO
Projeto: plugin do Obsidian chamado AI Ecosystem (núcleo da suíte de plugins de IA), escrito em TypeScript, com servidor MCP e REST local, executor de scripts, índice e descoberta de tools (tools_find, tools_describe, tools_run), hooks do Claude Code gravados nas settings do cofre, configuração guiada de módulos, telas (formulários) e um inspetor de requisições. Raiz do repositório (RAIZ): C:\Users\Trabalho\Documents\obsidian-ai-ecosystem. Testes com vitest (pasta tests), sem Obsidian real (há um mock em tests\mocks\obsidian.ts).
Objetivo geral da demanda: implementar 16 melhorias aceitas numa auditoria do núcleo, na ordem: (1) teto de saída do ecosystem_run_script; (2) ecosystem_status compacto; (3) script_id no executor; (4) lote no tools_run; (5) diagnóstico que percebe módulo defasado; (6) cancelamento do run_script; (7) remover a aprovação do tools_run e o código morto; (8) limitar o activity.sqlite; (9) setup_status, list_scripts e diagnóstico enxutos; (10) resumo dos módulos no início da sessão; (11) tela_gerenciar e setup oculto sem pendência; (12) setup_save em lote; (13) descrição curta do run_script; (14) falha do módulo só por exceção; (15) catálogo por manifest.version; (16) despachante único dos hooks de proteção.
Regras globais:
1. Idioma: o código, os comentários e os nomes de identificadores ficam em inglês (como já está nos arquivos); as mensagens do diagnóstico, do hook e dos achados ficam em português quando o arquivo já estiver em português; o README tem uma parte em inglês e uma em português espelhadas.
2. Estilo do código: TypeScript estrito, 2 espaços, aspas duplas, ponto e vírgula, `import type` para tipos, sem dependências novas e sem alterar package.json.
3. Os diretórios src/runner, src/server, src/registry, src/hooks, src/core, src/setup, src/tool-index são código Node puro: não importam o pacote "obsidian".
4. O script src/hooks/script/ai-ecosystem-hook.mjs é Node puro, sem dependências, e nunca pode atrapalhar o agente: qualquer problema termina com saída 0 e sem texto.
5. Comandos, sempre a partir de C:\Users\Trabalho\Documents\obsidian-ai-ecosystem: typecheck `npx tsc --noEmit`; testes `npx vitest run` (um arquivo: `npx vitest run tests\pasta\arquivo.test.ts`); lint `npx eslint .`; build `npm run build`.
6. Linha de base antes das mudanças: tsc sem erros; 54 arquivos de teste e 918 testes passando; eslint com 0 erros e 19 avisos (nenhum erro ou aviso novo pode surgir).
7. Cada etapa altera só os arquivos listados nela. Não faça commit, push, deploy nem mexa na pasta .git; não rode `npm install`; não escreva nem leia segredos, tokens ou arquivos .env.
8. Se algo não bater com o descrito (arquivo, função ou assinatura inexistente, teste quebrado por motivo alheio à etapa), pare e relate em vez de improvisar.

O QUE JÁ EXISTE E É RELEVANTE PARA ESTA ETAPA
C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\screens\tools.ts exporta createScreenInfraTools(service: ScreenService): HubTool[] que devolve, nesta ordem, tela_criar, tela_listar, tela_editar e tela_remover. tela_criar tem descrição com o texto `FIELD_GUIDE` (~1,5 mil caracteres, constante do arquivo), inputSchema `{ definicao: DEFINITION_SCHEMA }` (required definicao) e handler `service.create(args, ctx)`; tela_editar tem a mesma descrição, inputSchema `{ slug, definicao }` (required slug e definicao) e handler `service.edit(args, ctx)`. Os dois repetem ~3,6 mil caracteres cada. ScreenService.create(args) usa rejectUnknown(args, ['definicao']) e ScreenService.edit(args) usa rejectUnknown(args, ['slug','definicao']): argumentos desconhecidos (como acao) são recusados, então a tool fundida precisa tirar `acao` antes de repassar. C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\core\builtin-module.ts tem CORE_TOOL_METADATA com as entradas `tela_criar` (categoria 'telas', efeito 'cofre', resumo 'Cria uma tela (formulário) no Obsidian; salva só depois da aprovação do usuário') e `tela_editar`. C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\screens\model.ts tem `export const RESERVED_SLUGS: readonly string[] = ["criar", "listar", "editar", "remover"];` (slugs que colidiriam com as tools de infraestrutura tela_<slug>). O teste C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\core\builtin-module.test.ts confere a lista de 11 chaves de CORE_TOOL_METADATA ('covers the 11 core tools...'). Outros testes e textos que citam tela_criar/tela_editar serão ajustados nas duas etapas seguintes; nesta etapa só a compilação e o teste do builtin-module precisam passar.

ARQUIVOS
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\screens\tools.ts`
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\core\builtin-module.ts` (só CORE_TOOL_METADATA)
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\screens\model.ts` (só RESERVED_SLUGS)
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\core\builtin-module.test.ts`
- Não tocar: qualquer outro arquivo

REGRAS DESTA ETAPA
1. tela_listar e tela_remover não mudam.
2. A ordem das tools de infraestrutura passa a ser tela_gerenciar, tela_listar, tela_remover.
3. service.create e service.edit NÃO são alterados.
4. A descrição da tela_gerenciar não inclui o FIELD_GUIDE; o guia só sai quando acao é 'guia'.

O QUE FAZER, NESTA ORDEM
1. Em tools.ts substitua os objetos tela_criar e tela_editar por um único objeto `name: "tela_gerenciar"`, `title: "Create or edit a screen"`, descrição `Creates (acao criar) or replaces (acao editar) a screen, a form the user fills in inside Obsidian, as the tool tela_<slug>. The user sees a preview of the screen and its JSON definition and must approve it; nothing is saved before that. Call it with acao guia first to get the list of field types. Returns { status: "aprovado" | "recusado" | "expirado" | "cancelado" }; waits up to 5 minutes.`, inputSchema `{ type: "object", properties: { acao: { type: "string", enum: ["criar", "editar", "guia"] }, slug: { type: "string", pattern: SLUG_PATTERN.source, description: "Only for editar: slug of the screen to replace (it cannot change)." }, definicao: DEFINITION_SCHEMA }, required: ["acao"], additionalProperties: false }`, annotations `{ title: "Create or edit a screen", readOnlyHint: false, destructiveHint: false, openWorldHint: false }` e o handler: `(args, ctx) => { const { acao, ...rest } = args; if (acao === "guia") return Promise.resolve({ content: [{ type: "text", text: FIELD_GUIDE }] }); if (acao === "criar") return service.create(rest, ctx); if (acao === "editar") return service.edit(rest, ctx); return Promise.resolve({ content: [{ type: "text", text: "Invalid arguments: acao must be criar, editar or guia." }], isError: true }); }`. A tela_gerenciar fica na posição de tela_criar (primeira), seguida de tela_listar e tela_remover.
2. Atualize o comentário do topo de tools.ts: `the three infrastructure tools (tela_gerenciar, tela_listar, tela_remover)`.
3. Em builtin-module.ts, em CORE_TOOL_METADATA, apague as entradas tela_criar e tela_editar e crie `tela_gerenciar: { categoria: "telas", tags: ["tela", "formulario", "criar", "editar", "screen", "form"], resumo: "Cria ou edita uma tela (formulário); acao guia lista os tipos de campo", efeito: "cofre" }`. No comentário de BuiltinModuleDeps.screens troque 'tela_criar...' por 'tela_gerenciar...'.
4. Em model.ts: `export const RESERVED_SLUGS: readonly string[] = ["criar", "editar", "gerenciar", "listar", "remover"];` (mantém criar e editar por compatibilidade) e atualize o comentário para citar tela_gerenciar.
5. Em C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\core\builtin-module.test.ts atualize a lista de chaves de CORE_TOOL_METADATA (de 11 para 10: tela_gerenciar no lugar de tela_criar e tela_editar, mantendo a ordem alfabética do teste) e o título do teste ('covers the 10 core tools...').

O QUE NÃO FAZER
- Não altere service.ts (create e edit ficam como estão).
- Não ajuste ainda os outros testes de telas e textos (próximas etapas); relate quais falham.

CRITÉRIOS DE ACEITE
- Dado o serviço de telas, Quando chamo tela_gerenciar com acao 'guia', Então o texto devolvido é o guia de campos e nada é gravado.
- Dado acao 'criar' com uma definicao válida, Quando chamo, Então a mesma prévia e aprovação de antes acontecem (service.create é chamado sem a chave acao).
- Dado acao 'editar' com slug e definicao, Quando chamo, Então service.edit é chamado com slug e definicao.
- Dado acao 'xyz', Quando chamo, Então isError com 'acao must be criar, editar or guia.'.
- Dado createScreenInfraTools, Então a ordem dos nomes é tela_gerenciar, tela_listar, tela_remover.

VERIFICAÇÃO (rode a partir de C:\Users\Trabalho\Documents\obsidian-ai-ecosystem e cole a saída real)
- npx tsc --noEmit → sem erros
- npx vitest run tests/core/builtin-module.test.ts → todos passam

Se qualquer coisa não bater com o descrito (arquivo, função ou assinatura inexistente, comportamento diferente do dito acima, teste quebrado por motivo alheio a esta etapa), PARE e relate em vez de improvisar.
RELATÓRIO FINAL: liste os arquivos alterados ou criados (caminho absoluto), cole a saída real de cada comando de verificação (não resuma) e descreva qualquer desvio ou dúvida.
```

## Etapa 19: Atualizar textos e README que citam tela_criar e tela_editar [Haiku 5.5 | esforço: baixo]

**Objetivo:** trocar as menções a tela_criar e tela_editar por tela_gerenciar nos textos do código e no README.
**Depende de:** Etapa 18 (Fundir tela_criar e tela_editar em tela_gerenciar)
**Paralelizável com:** nenhuma

**Arquivos**
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\screens\service.ts` (comentários e uma mensagem)
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\i18n\screens.ts`
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\setup\guide-block.ts`
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\types\index.ts` (um comentário)
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\README.md` (dois parágrafos)
- Não tocar: qualquer outro arquivo

**Regras de implementação**
1. Só texto, exceto o literal de tools em guide-block.ts.
2. A mensagem de slug duplicado fica: `A screen with the slug "X" already exists. Use tela_gerenciar with acao editar to change it or choose another slug.`.

**Passos**
1. service.ts: ajuste o comentário do topo (`tela_gerenciar / tela_remover`), o comentário de seção e a mensagem de slug duplicado conforme a regra acima (preserve a interpolação do slug).
2. i18n/screens.ts: `"No screens yet. Ask an agent to create one with tela_gerenciar."` e `"Nenhuma tela ainda. Peça a um agente para criar uma com tela_gerenciar."`.
3. guide-block.ts: `tools: ["tela_gerenciar", "tela_listar"]`.
4. types/index.ts: `/** Screens the agent can create (tela_gerenciar). */`.
5. README.md em inglês: `**Screens.** `tela_gerenciar` (create or edit, `acao` criar, editar or guia for the field types), `tela_listar` and `tela_remover` let an agent define forms that open in Obsidian.` seguido do resto do parágrafo atual sem mudança (a partir de 'A new or changed screen is shown as a preview'); em português: `**Telas.** `tela_gerenciar` (criar ou editar, `acao` criar, editar ou guia para os tipos de campo), `tela_listar` e `tela_remover` deixam um agente definir formulários que abrem no Obsidian.` seguido do resto do parágrafo atual (a partir de 'Uma tela nova ou alterada').

**BDD (estado esperado ao concluir)**
- Dado o repositório, Quando busco 'tela_criar' e 'tela_editar' em src e README.md, Então só restam ocorrências intencionais da lista de slugs reservados em model.ts.
- Dado o código, Quando rodo o compilador, Então não há erros.

**Verificação** (comandos a rodar, com o resultado esperado)
- npx tsc --noEmit → sem erros
- grep -rn "tela_criar\|tela_editar" C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\README.md → nenhuma ocorrência em src além de model.ts (reservados) e nenhuma no README

**Prompt para o subagente**
```text
Você é um subagente de implementação em TypeScript. Objetivo desta etapa: trocar as menções a tela_criar e tela_editar por tela_gerenciar nos textos do código e no README.

CONTEXTO COMPLETO
Projeto: plugin do Obsidian chamado AI Ecosystem (núcleo da suíte de plugins de IA), escrito em TypeScript, com servidor MCP e REST local, executor de scripts, índice e descoberta de tools (tools_find, tools_describe, tools_run), hooks do Claude Code gravados nas settings do cofre, configuração guiada de módulos, telas (formulários) e um inspetor de requisições. Raiz do repositório (RAIZ): C:\Users\Trabalho\Documents\obsidian-ai-ecosystem. Testes com vitest (pasta tests), sem Obsidian real (há um mock em tests\mocks\obsidian.ts).
Objetivo geral da demanda: implementar 16 melhorias aceitas numa auditoria do núcleo, na ordem: (1) teto de saída do ecosystem_run_script; (2) ecosystem_status compacto; (3) script_id no executor; (4) lote no tools_run; (5) diagnóstico que percebe módulo defasado; (6) cancelamento do run_script; (7) remover a aprovação do tools_run e o código morto; (8) limitar o activity.sqlite; (9) setup_status, list_scripts e diagnóstico enxutos; (10) resumo dos módulos no início da sessão; (11) tela_gerenciar e setup oculto sem pendência; (12) setup_save em lote; (13) descrição curta do run_script; (14) falha do módulo só por exceção; (15) catálogo por manifest.version; (16) despachante único dos hooks de proteção.
Regras globais:
1. Idioma: o código, os comentários e os nomes de identificadores ficam em inglês (como já está nos arquivos); as mensagens do diagnóstico, do hook e dos achados ficam em português quando o arquivo já estiver em português; o README tem uma parte em inglês e uma em português espelhadas.
2. Estilo do código: TypeScript estrito, 2 espaços, aspas duplas, ponto e vírgula, `import type` para tipos, sem dependências novas e sem alterar package.json.
3. Os diretórios src/runner, src/server, src/registry, src/hooks, src/core, src/setup, src/tool-index são código Node puro: não importam o pacote "obsidian".
4. O script src/hooks/script/ai-ecosystem-hook.mjs é Node puro, sem dependências, e nunca pode atrapalhar o agente: qualquer problema termina com saída 0 e sem texto.
5. Comandos, sempre a partir de C:\Users\Trabalho\Documents\obsidian-ai-ecosystem: typecheck `npx tsc --noEmit`; testes `npx vitest run` (um arquivo: `npx vitest run tests\pasta\arquivo.test.ts`); lint `npx eslint .`; build `npm run build`.
6. Linha de base antes das mudanças: tsc sem erros; 54 arquivos de teste e 918 testes passando; eslint com 0 erros e 19 avisos (nenhum erro ou aviso novo pode surgir).
7. Cada etapa altera só os arquivos listados nela. Não faça commit, push, deploy nem mexa na pasta .git; não rode `npm install`; não escreva nem leia segredos, tokens ou arquivos .env.
8. Se algo não bater com o descrito (arquivo, função ou assinatura inexistente, teste quebrado por motivo alheio à etapa), pare e relate em vez de improvisar.

O QUE JÁ EXISTE E É RELEVANTE PARA ESTA ETAPA
A etapa anterior criou a tool tela_gerenciar (acao criar, editar ou guia) no lugar de tela_criar e tela_editar. Restam menções antigas em: C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\screens\service.ts (comentário de cabeçalho e o comentário `// ---- tela_criar / tela_editar / tela_remover ---` e a mensagem de erro `A screen with the slug "X" already exists. Use tela_editar to change it or choose another slug.`); C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\i18n\screens.ts (duas strings `screens.settings.empty`: 'Ask an agent to create one with tela_criar.' e a versão em português 'Peça a um agente para criar uma com tela_criar.'); C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\setup\guide-block.ts (uma linha com `tools: ["tela_criar", "tela_listar"]`); C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\types\index.ts (comentário `/** Screens the agent can create (tela_criar). */`); C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\README.md linhas em inglês `**Screens.** `tela_criar`, `tela_listar`, `tela_editar` and `tela_remover` let an agent...` e em português `**Telas.** `tela_criar`, `tela_listar`, `tela_editar` e `tela_remover` deixam um agente...`.

ARQUIVOS
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\screens\service.ts` (comentários e uma mensagem)
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\i18n\screens.ts`
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\setup\guide-block.ts`
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\types\index.ts` (um comentário)
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\README.md` (dois parágrafos)
- Não tocar: qualquer outro arquivo

REGRAS DESTA ETAPA
1. Só texto, exceto o literal de tools em guide-block.ts.
2. A mensagem de slug duplicado fica: `A screen with the slug "X" already exists. Use tela_gerenciar with acao editar to change it or choose another slug.`.

O QUE FAZER, NESTA ORDEM
1. service.ts: ajuste o comentário do topo (`tela_gerenciar / tela_remover`), o comentário de seção e a mensagem de slug duplicado conforme a regra acima (preserve a interpolação do slug).
2. i18n/screens.ts: `"No screens yet. Ask an agent to create one with tela_gerenciar."` e `"Nenhuma tela ainda. Peça a um agente para criar uma com tela_gerenciar."`.
3. guide-block.ts: `tools: ["tela_gerenciar", "tela_listar"]`.
4. types/index.ts: `/** Screens the agent can create (tela_gerenciar). */`.
5. README.md em inglês: `**Screens.** `tela_gerenciar` (create or edit, `acao` criar, editar or guia for the field types), `tela_listar` and `tela_remover` let an agent define forms that open in Obsidian.` seguido do resto do parágrafo atual sem mudança (a partir de 'A new or changed screen is shown as a preview'); em português: `**Telas.** `tela_gerenciar` (criar ou editar, `acao` criar, editar ou guia para os tipos de campo), `tela_listar` e `tela_remover` deixam um agente definir formulários que abrem no Obsidian.` seguido do resto do parágrafo atual (a partir de 'Uma tela nova ou alterada').

O QUE NÃO FAZER
- Não altere tests (próxima etapa).
- Não mude outros trechos do README.

CRITÉRIOS DE ACEITE
- Dado o repositório, Quando busco 'tela_criar' e 'tela_editar' em src e README.md, Então só restam ocorrências intencionais da lista de slugs reservados em model.ts.
- Dado o código, Quando rodo o compilador, Então não há erros.

VERIFICAÇÃO (rode a partir de C:\Users\Trabalho\Documents\obsidian-ai-ecosystem e cole a saída real)
- npx tsc --noEmit → sem erros
- grep -rn "tela_criar\|tela_editar" C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\README.md → nenhuma ocorrência em src além de model.ts (reservados) e nenhuma no README

Se qualquer coisa não bater com o descrito (arquivo, função ou assinatura inexistente, comportamento diferente do dito acima, teste quebrado por motivo alheio a esta etapa), PARE e relate em vez de improvisar.
RELATÓRIO FINAL: liste os arquivos alterados ou criados (caminho absoluto), cole a saída real de cada comando de verificação (não resuma) e descreva qualquer desvio ou dúvida.
```

## Etapa 20: Ajustar os testes de telas para tela_gerenciar [Haiku 5.5 | esforço: médio]

**Objetivo:** fazer os testes de telas e do bloco de guia usarem tela_gerenciar e cobrir as três ações.
**Depende de:** Etapa 19 (Atualizar textos e README que citam tela_criar e tela_editar)
**Paralelizável com:** nenhuma

**Arquivos**
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\screens\ecosystem.test.ts`
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\screens\service.test.ts`
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\setup\guide-block.test.ts`
- Não tocar: qualquer outro arquivo

**Regras de implementação**
1. Só testes.
2. Quando um teste chamava tela_criar com {definicao}, passe a chamar tela_gerenciar com {acao:'criar', definicao}; tela_editar com {slug, definicao} vira tela_gerenciar com {acao:'editar', slug, definicao}.
3. Mantenha a cobertura: nenhum teste é apagado sem substituto.

**Passos**
1. tests/screens/ecosystem.test.ts: troque as listas de nomes (`tela_criar`...`tela_editar` → `tela_gerenciar`, `tela_listar`, `tela_remover` nessa ordem; o título passa a 'offers the three infrastructure tools...') e as chamadas callTool.
2. tests/screens/service.test.ts: ajuste as listas de nomes (`["tela_gerenciar", "tela_listar", "tela_remover", ...]`), as chamadas diretas ao serviço continuam com service.create/service.edit (o serviço não mudou) e a expectativa da mensagem de slug duplicado vira `toContain("tela_gerenciar")`; renomeie os describes para refletir 'tela_gerenciar (criar)' e 'tela_gerenciar (editar) e tela_remover'.
3. tests/screens/service.test.ts ou ecosystem.test.ts (onde já há um rig da tool): acrescente testes da tool: (a) acao 'guia' devolve texto que contém 'texto_longo' e 'destino_nome' e não cria nada; (b) acao 'xyz' devolve isError com 'acao must be criar, editar or guia'; (c) acao 'criar' sem definicao devolve isError (mensagem do serviço); (d) tela_gerenciar acao editar com slug de tela inexistente devolve o erro do serviço; (e) a descrição da tela_gerenciar tem menos de 900 caracteres (o guia não está nela).
4. tests/setup/guide-block.test.ts: troque 'tela_criar' por 'tela_gerenciar' na lista.
5. Rode `npx vitest run` completo e corrija qualquer outro teste que ainda cite os nomes antigos.

**BDD (estado esperado ao concluir)**
- Dado a tool tela_gerenciar, Quando chamo com acao 'guia', Então recebo o guia de campos sem criar nada.
- Dado uma definição válida, Quando chamo com acao 'criar' e depois 'editar', Então os fluxos de prévia e aprovação funcionam como antes.
- Dado a suíte inteira, Quando a rodo, Então todos os testes passam.

**Verificação** (comandos a rodar, com o resultado esperado)
- npx vitest run → todos passam
- npx tsc --noEmit → sem erros

**Prompt para o subagente**
```text
Você é um subagente de implementação em TypeScript. Objetivo desta etapa: fazer os testes de telas e do bloco de guia usarem tela_gerenciar e cobrir as três ações.

CONTEXTO COMPLETO
Projeto: plugin do Obsidian chamado AI Ecosystem (núcleo da suíte de plugins de IA), escrito em TypeScript, com servidor MCP e REST local, executor de scripts, índice e descoberta de tools (tools_find, tools_describe, tools_run), hooks do Claude Code gravados nas settings do cofre, configuração guiada de módulos, telas (formulários) e um inspetor de requisições. Raiz do repositório (RAIZ): C:\Users\Trabalho\Documents\obsidian-ai-ecosystem. Testes com vitest (pasta tests), sem Obsidian real (há um mock em tests\mocks\obsidian.ts).
Objetivo geral da demanda: implementar 16 melhorias aceitas numa auditoria do núcleo, na ordem: (1) teto de saída do ecosystem_run_script; (2) ecosystem_status compacto; (3) script_id no executor; (4) lote no tools_run; (5) diagnóstico que percebe módulo defasado; (6) cancelamento do run_script; (7) remover a aprovação do tools_run e o código morto; (8) limitar o activity.sqlite; (9) setup_status, list_scripts e diagnóstico enxutos; (10) resumo dos módulos no início da sessão; (11) tela_gerenciar e setup oculto sem pendência; (12) setup_save em lote; (13) descrição curta do run_script; (14) falha do módulo só por exceção; (15) catálogo por manifest.version; (16) despachante único dos hooks de proteção.
Regras globais:
1. Idioma: o código, os comentários e os nomes de identificadores ficam em inglês (como já está nos arquivos); as mensagens do diagnóstico, do hook e dos achados ficam em português quando o arquivo já estiver em português; o README tem uma parte em inglês e uma em português espelhadas.
2. Estilo do código: TypeScript estrito, 2 espaços, aspas duplas, ponto e vírgula, `import type` para tipos, sem dependências novas e sem alterar package.json.
3. Os diretórios src/runner, src/server, src/registry, src/hooks, src/core, src/setup, src/tool-index são código Node puro: não importam o pacote "obsidian".
4. O script src/hooks/script/ai-ecosystem-hook.mjs é Node puro, sem dependências, e nunca pode atrapalhar o agente: qualquer problema termina com saída 0 e sem texto.
5. Comandos, sempre a partir de C:\Users\Trabalho\Documents\obsidian-ai-ecosystem: typecheck `npx tsc --noEmit`; testes `npx vitest run` (um arquivo: `npx vitest run tests\pasta\arquivo.test.ts`); lint `npx eslint .`; build `npm run build`.
6. Linha de base antes das mudanças: tsc sem erros; 54 arquivos de teste e 918 testes passando; eslint com 0 erros e 19 avisos (nenhum erro ou aviso novo pode surgir).
7. Cada etapa altera só os arquivos listados nela. Não faça commit, push, deploy nem mexa na pasta .git; não rode `npm install`; não escreva nem leia segredos, tokens ou arquivos .env.
8. Se algo não bater com o descrito (arquivo, função ou assinatura inexistente, teste quebrado por motivo alheio à etapa), pare e relate em vez de improvisar.

O QUE JÁ EXISTE E É RELEVANTE PARA ESTA ETAPA
A tool tela_gerenciar (acao: 'criar' | 'editar' | 'guia'; args `definicao` e, para editar, `slug`) substituiu tela_criar e tela_editar; a ordem das tools de infraestrutura é tela_gerenciar, tela_listar, tela_remover. A mensagem de slug duplicado agora diz 'Use tela_gerenciar with acao editar to change it or choose another slug.'. O guia de campos só vem com acao 'guia'. Os testes que ainda usam os nomes antigos: C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\screens\ecosystem.test.ts (lista de nomes de tools no teste 'offers the four infrastructure tools...' e chamadas callTool(r, 'tela_criar', { definicao: ... })), C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\screens\service.test.ts (describes 'tela_criar' e 'tela_editar and tela_remover', listas ['tela_criar','tela_listar','tela_editar','tela_remover', ...] em toolNames() e createScreenTools(...).map(...), e a expectativa `toContain("tela_editar")` do teste 'refuses a slug that already exists and points to tela_editar'), C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\setup\guide-block.test.ts (a lista de tools `[..., "tela_criar"]`).

ARQUIVOS
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\screens\ecosystem.test.ts`
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\screens\service.test.ts`
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\setup\guide-block.test.ts`
- Não tocar: qualquer outro arquivo

REGRAS DESTA ETAPA
1. Só testes.
2. Quando um teste chamava tela_criar com {definicao}, passe a chamar tela_gerenciar com {acao:'criar', definicao}; tela_editar com {slug, definicao} vira tela_gerenciar com {acao:'editar', slug, definicao}.
3. Mantenha a cobertura: nenhum teste é apagado sem substituto.

O QUE FAZER, NESTA ORDEM
1. tests/screens/ecosystem.test.ts: troque as listas de nomes (`tela_criar`...`tela_editar` → `tela_gerenciar`, `tela_listar`, `tela_remover` nessa ordem; o título passa a 'offers the three infrastructure tools...') e as chamadas callTool.
2. tests/screens/service.test.ts: ajuste as listas de nomes (`["tela_gerenciar", "tela_listar", "tela_remover", ...]`), as chamadas diretas ao serviço continuam com service.create/service.edit (o serviço não mudou) e a expectativa da mensagem de slug duplicado vira `toContain("tela_gerenciar")`; renomeie os describes para refletir 'tela_gerenciar (criar)' e 'tela_gerenciar (editar) e tela_remover'.
3. tests/screens/service.test.ts ou ecosystem.test.ts (onde já há um rig da tool): acrescente testes da tool: (a) acao 'guia' devolve texto que contém 'texto_longo' e 'destino_nome' e não cria nada; (b) acao 'xyz' devolve isError com 'acao must be criar, editar or guia'; (c) acao 'criar' sem definicao devolve isError (mensagem do serviço); (d) tela_gerenciar acao editar com slug de tela inexistente devolve o erro do serviço; (e) a descrição da tela_gerenciar tem menos de 900 caracteres (o guia não está nela).
4. tests/setup/guide-block.test.ts: troque 'tela_criar' por 'tela_gerenciar' na lista.
5. Rode `npx vitest run` completo e corrija qualquer outro teste que ainda cite os nomes antigos.

O QUE NÃO FAZER
- Não altere src.
- Não apague testes sem substituto.

CRITÉRIOS DE ACEITE
- Dado a tool tela_gerenciar, Quando chamo com acao 'guia', Então recebo o guia de campos sem criar nada.
- Dado uma definição válida, Quando chamo com acao 'criar' e depois 'editar', Então os fluxos de prévia e aprovação funcionam como antes.
- Dado a suíte inteira, Quando a rodo, Então todos os testes passam.

VERIFICAÇÃO (rode a partir de C:\Users\Trabalho\Documents\obsidian-ai-ecosystem e cole a saída real)
- npx vitest run → todos passam
- npx tsc --noEmit → sem erros

Se qualquer coisa não bater com o descrito (arquivo, função ou assinatura inexistente, comportamento diferente do dito acima, teste quebrado por motivo alheio a esta etapa), PARE e relate em vez de improvisar.
RELATÓRIO FINAL: liste os arquivos alterados ou criados (caminho absoluto), cole a saída real de cada comando de verificação (não resuma) e descreva qualquer desvio ou dúvida.
```

## Etapa 21: Opção do servidor MCP para esconder tools do tools/list no modo completo [Haiku 5.5 | esforço: médio]

**Objetivo:** dar ao servidor MCP a opção isListedWhenComplete, que decide quais tools aparecem no tools/list de um cliente em modo completo.
**Depende de:** Etapa 20 (Ajustar os testes de telas para tela_gerenciar)
**Paralelizável com:** nenhuma

**Arquivos**
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\server\mcp-host.ts`
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\server\server-host.ts`
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\server\mcp.test.ts`
- Não tocar: qualquer outro arquivo

**Regras de implementação**
1. O padrão (opção ausente) é listar tudo, como hoje.
2. A opção só vale em modo completo (o modo indexado continua usando isListedWhenIndexed).

**Passos**
1. mcp-host.ts: acrescente a McpHostOptions `/** In "completo" mode, false to leave a tool out of tools/list (tools/call still accepts it by name). */ isListedWhenComplete?: (tool: RegisteredTool, clientKind: ClientKind) => boolean;` e um método privado `isListedWhenComplete(registered, kind)` igual ao isListedWhenIndexed (try/catch, padrão true).
2. No case tools/list troque o filtro final por `(indexed ? this.isListedWhenIndexed(registered, kind) : this.isListedWhenComplete(registered, kind))` (mantendo o !this.isHidden antes).
3. server-host.ts: acrescente o campo opcional `isListedWhenComplete?: McpHostOptions["isListedWhenComplete"];` às opções do servidor e `isListedWhenComplete: opts.isListedWhenComplete,` ao criar o McpHost.
4. tests/server/mcp.test.ts: acrescente testes seguindo o padrão do arquivo: (a) sem a opção, tools/list lista todas as tools registradas; (b) com a opção devolvendo false para uma tool, ela some do tools/list e tools/call ainda a executa pelo nome; (c) opção que lança exceção → a tool continua listada.

**BDD (estado esperado ao concluir)**
- Dado a opção isListedWhenComplete devolvendo false para a tool X, Quando um cliente em modo completo pede tools/list, Então X não aparece.
- Dado o mesmo cenário, Quando o cliente chama X por tools/call, Então ela executa.
- Dado nenhuma opção, Quando pede tools/list, Então todas as tools aparecem como hoje.

**Verificação** (comandos a rodar, com o resultado esperado)
- npx tsc --noEmit → sem erros
- npx vitest run tests/server → todos passam

**Prompt para o subagente**
```text
Você é um subagente de implementação em TypeScript. Objetivo desta etapa: dar ao servidor MCP a opção isListedWhenComplete, que decide quais tools aparecem no tools/list de um cliente em modo completo.

CONTEXTO COMPLETO
Projeto: plugin do Obsidian chamado AI Ecosystem (núcleo da suíte de plugins de IA), escrito em TypeScript, com servidor MCP e REST local, executor de scripts, índice e descoberta de tools (tools_find, tools_describe, tools_run), hooks do Claude Code gravados nas settings do cofre, configuração guiada de módulos, telas (formulários) e um inspetor de requisições. Raiz do repositório (RAIZ): C:\Users\Trabalho\Documents\obsidian-ai-ecosystem. Testes com vitest (pasta tests), sem Obsidian real (há um mock em tests\mocks\obsidian.ts).
Objetivo geral da demanda: implementar 16 melhorias aceitas numa auditoria do núcleo, na ordem: (1) teto de saída do ecosystem_run_script; (2) ecosystem_status compacto; (3) script_id no executor; (4) lote no tools_run; (5) diagnóstico que percebe módulo defasado; (6) cancelamento do run_script; (7) remover a aprovação do tools_run e o código morto; (8) limitar o activity.sqlite; (9) setup_status, list_scripts e diagnóstico enxutos; (10) resumo dos módulos no início da sessão; (11) tela_gerenciar e setup oculto sem pendência; (12) setup_save em lote; (13) descrição curta do run_script; (14) falha do módulo só por exceção; (15) catálogo por manifest.version; (16) despachante único dos hooks de proteção.
Regras globais:
1. Idioma: o código, os comentários e os nomes de identificadores ficam em inglês (como já está nos arquivos); as mensagens do diagnóstico, do hook e dos achados ficam em português quando o arquivo já estiver em português; o README tem uma parte em inglês e uma em português espelhadas.
2. Estilo do código: TypeScript estrito, 2 espaços, aspas duplas, ponto e vírgula, `import type` para tipos, sem dependências novas e sem alterar package.json.
3. Os diretórios src/runner, src/server, src/registry, src/hooks, src/core, src/setup, src/tool-index são código Node puro: não importam o pacote "obsidian".
4. O script src/hooks/script/ai-ecosystem-hook.mjs é Node puro, sem dependências, e nunca pode atrapalhar o agente: qualquer problema termina com saída 0 e sem texto.
5. Comandos, sempre a partir de C:\Users\Trabalho\Documents\obsidian-ai-ecosystem: typecheck `npx tsc --noEmit`; testes `npx vitest run` (um arquivo: `npx vitest run tests\pasta\arquivo.test.ts`); lint `npx eslint .`; build `npm run build`.
6. Linha de base antes das mudanças: tsc sem erros; 54 arquivos de teste e 918 testes passando; eslint com 0 erros e 19 avisos (nenhum erro ou aviso novo pode surgir).
7. Cada etapa altera só os arquivos listados nela. Não faça commit, push, deploy nem mexa na pasta .git; não rode `npm install`; não escreva nem leia segredos, tokens ou arquivos .env.
8. Se algo não bater com o descrito (arquivo, função ou assinatura inexistente, teste quebrado por motivo alheio à etapa), pare e relate em vez de improvisar.

O QUE JÁ EXISTE E É RELEVANTE PARA ESTA ETAPA
C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\server\mcp-host.ts define McpHostOptions com opções como `isToolHidden`, `getToolExposure` e `isListedWhenIndexed?: (tool: RegisteredTool, clientKind: ClientKind) => boolean` (usada só quando o cliente está em modo 'indexado'). No case `"tools/list"` de execute(): `const visible = this.opts.registry.listTools().filter((registered) => !this.isHidden(registered, kind) && (!indexed || this.isListedWhenIndexed(registered, kind)));`. O método privado `isListedWhenIndexed(registered, kind)` chama a opção dentro de try/catch e devolve true em caso de erro ou opção ausente. C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\server\server-host.ts repassa as opções ao McpHost (campos `isListedWhenIndexed: McpHostOptions["isListedWhenIndexed"]` na interface de opções do servidor e `isListedWhenIndexed: opts.isListedWhenIndexed,` ao criar o McpHost). tools/call continua aceitando qualquer tool pelo nome nos dois modos (a opção só afeta a LISTA). Os testes do servidor MCP ficam em C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\server\mcp.test.ts e C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\server\client-kind.test.ts (veja como eles criam um servidor com registro de módulos de teste).

ARQUIVOS
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\server\mcp-host.ts`
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\server\server-host.ts`
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\server\mcp.test.ts`
- Não tocar: qualquer outro arquivo

REGRAS DESTA ETAPA
1. O padrão (opção ausente) é listar tudo, como hoje.
2. A opção só vale em modo completo (o modo indexado continua usando isListedWhenIndexed).

O QUE FAZER, NESTA ORDEM
1. mcp-host.ts: acrescente a McpHostOptions `/** In "completo" mode, false to leave a tool out of tools/list (tools/call still accepts it by name). */ isListedWhenComplete?: (tool: RegisteredTool, clientKind: ClientKind) => boolean;` e um método privado `isListedWhenComplete(registered, kind)` igual ao isListedWhenIndexed (try/catch, padrão true).
2. No case tools/list troque o filtro final por `(indexed ? this.isListedWhenIndexed(registered, kind) : this.isListedWhenComplete(registered, kind))` (mantendo o !this.isHidden antes).
3. server-host.ts: acrescente o campo opcional `isListedWhenComplete?: McpHostOptions["isListedWhenComplete"];` às opções do servidor e `isListedWhenComplete: opts.isListedWhenComplete,` ao criar o McpHost.
4. tests/server/mcp.test.ts: acrescente testes seguindo o padrão do arquivo: (a) sem a opção, tools/list lista todas as tools registradas; (b) com a opção devolvendo false para uma tool, ela some do tools/list e tools/call ainda a executa pelo nome; (c) opção que lança exceção → a tool continua listada.

O QUE NÃO FAZER
- Não altere ecosystem.ts nesta etapa.
- Não mude o comportamento do modo indexado.

CRITÉRIOS DE ACEITE
- Dado a opção isListedWhenComplete devolvendo false para a tool X, Quando um cliente em modo completo pede tools/list, Então X não aparece.
- Dado o mesmo cenário, Quando o cliente chama X por tools/call, Então ela executa.
- Dado nenhuma opção, Quando pede tools/list, Então todas as tools aparecem como hoje.

VERIFICAÇÃO (rode a partir de C:\Users\Trabalho\Documents\obsidian-ai-ecosystem e cole a saída real)
- npx tsc --noEmit → sem erros
- npx vitest run tests/server → todos passam

Se qualquer coisa não bater com o descrito (arquivo, função ou assinatura inexistente, comportamento diferente do dito acima, teste quebrado por motivo alheio a esta etapa), PARE e relate em vez de improvisar.
RELATÓRIO FINAL: liste os arquivos alterados ou criados (caminho absoluto), cole a saída real de cada comando de verificação (não resuma) e descreva qualquer desvio ou dúvida.
```

## Etapa 22: Esconder as tools de setup do tools/list quando não há pendência [Haiku 5.5 | esforço: alto]

**Objetivo:** no modo completo, listar ecosystem_setup_status/save/complete só enquanto algum módulo (ou o núcleo) espera a primeira configuração, avisando os clientes quando isso muda.
**Depende de:** Etapa 21 (Opção do servidor MCP para esconder tools do tools/list no modo completo)
**Paralelizável com:** nenhuma

**Arquivos**
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\core\ecosystem.ts`
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\setup\setup-manager.ts`
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\setup\tools.test.ts`
- Não tocar: qualquer outro arquivo

**Regras de implementação**
1. Sem this.hooks (hooks desativados ou sem pasta), as tools de setup continuam listadas (o teste de integração 'initializes MCP and lists the built-in tools' depende disso).
2. Só as três tools ecosystem_setup_* do núcleo são afetadas; tools/call por nome continua funcionando sempre.
3. Só vale para o modo completo (o indexado já tem sua regra).

**Passos**
1. ecosystem.ts: crie o método público `isListedWhenComplete(registered: RegisteredTool): boolean`: `if (registered.moduleId !== ECOSYSTEM_ID || !registered.tool.name.startsWith("ecosystem_setup_")) return true; if (!this.hooks) return true; return this.hooks.isSetupPending();` (com um comentário curto) e passe `isListedWhenComplete: (registered) => this.isListedWhenComplete(registered),` nas opções do servidor, ao lado de isListedWhenIndexed.
2. setup-manager.ts: no fim de beginCatalogInstall(), depois de `this.states.reset(...)`, chame `this.deps.notifyToolsChanged();` para os clientes reabrirem a lista (as tools de setup voltam a aparecer).
3. tests/setup/tools.test.ts: acrescente um describe 'setup tools in tools/list (modo completo)' com testes usando o rig com hooks ligados (startRig) e `rpc(r, 'tools/list')` para pegar os nomes: (a) antes de configurar o núcleo as três ecosystem_setup_* aparecem; (b) depois de `configureCore(r)` (sem outro módulo pendente) elas NÃO aparecem; (c) mesmo escondidas, `callTool(r, 'ecosystem_setup_status', { modulo: 'ai-ecosystem' })` funciona (sem isError); (d) depois de instalar um módulo do catálogo (use o helper installFromCatalog do arquivo) elas voltam a aparecer. Se o rig tiver modo indexado por padrão, use o modo completo (veja como os outros testes do arquivo escolhem). Rode também tests/screens e tests/integration e ajuste só o que listava as tools de setup sem pendência.

**BDD (estado esperado ao concluir)**
- Dado o núcleo ainda não configurado, Quando o cliente pede tools/list, Então as três ecosystem_setup_* aparecem.
- Dado nenhum módulo pendente, Quando pede tools/list, Então elas não aparecem, mas continuam executando por tools/call.
- Dado a instalação de um módulo pelo catálogo, Quando ela começa, Então os clientes recebem list_changed e as tools de setup reaparecem.
- Dado hooks desativados (sem this.hooks), Quando pede tools/list, Então as tools de setup continuam listadas.

**Verificação** (comandos a rodar, com o resultado esperado)
- npx tsc --noEmit → sem erros
- npx vitest run tests/setup tests/screens tests/integration → todos passam

**Prompt para o subagente**
```text
Você é um subagente de implementação em TypeScript. Objetivo desta etapa: no modo completo, listar ecosystem_setup_status/save/complete só enquanto algum módulo (ou o núcleo) espera a primeira configuração, avisando os clientes quando isso muda.

CONTEXTO COMPLETO
Projeto: plugin do Obsidian chamado AI Ecosystem (núcleo da suíte de plugins de IA), escrito em TypeScript, com servidor MCP e REST local, executor de scripts, índice e descoberta de tools (tools_find, tools_describe, tools_run), hooks do Claude Code gravados nas settings do cofre, configuração guiada de módulos, telas (formulários) e um inspetor de requisições. Raiz do repositório (RAIZ): C:\Users\Trabalho\Documents\obsidian-ai-ecosystem. Testes com vitest (pasta tests), sem Obsidian real (há um mock em tests\mocks\obsidian.ts).
Objetivo geral da demanda: implementar 16 melhorias aceitas numa auditoria do núcleo, na ordem: (1) teto de saída do ecosystem_run_script; (2) ecosystem_status compacto; (3) script_id no executor; (4) lote no tools_run; (5) diagnóstico que percebe módulo defasado; (6) cancelamento do run_script; (7) remover a aprovação do tools_run e o código morto; (8) limitar o activity.sqlite; (9) setup_status, list_scripts e diagnóstico enxutos; (10) resumo dos módulos no início da sessão; (11) tela_gerenciar e setup oculto sem pendência; (12) setup_save em lote; (13) descrição curta do run_script; (14) falha do módulo só por exceção; (15) catálogo por manifest.version; (16) despachante único dos hooks de proteção.
Regras globais:
1. Idioma: o código, os comentários e os nomes de identificadores ficam em inglês (como já está nos arquivos); as mensagens do diagnóstico, do hook e dos achados ficam em português quando o arquivo já estiver em português; o README tem uma parte em inglês e uma em português espelhadas.
2. Estilo do código: TypeScript estrito, 2 espaços, aspas duplas, ponto e vírgula, `import type` para tipos, sem dependências novas e sem alterar package.json.
3. Os diretórios src/runner, src/server, src/registry, src/hooks, src/core, src/setup, src/tool-index são código Node puro: não importam o pacote "obsidian".
4. O script src/hooks/script/ai-ecosystem-hook.mjs é Node puro, sem dependências, e nunca pode atrapalhar o agente: qualquer problema termina com saída 0 e sem texto.
5. Comandos, sempre a partir de C:\Users\Trabalho\Documents\obsidian-ai-ecosystem: typecheck `npx tsc --noEmit`; testes `npx vitest run` (um arquivo: `npx vitest run tests\pasta\arquivo.test.ts`); lint `npx eslint .`; build `npm run build`.
6. Linha de base antes das mudanças: tsc sem erros; 54 arquivos de teste e 918 testes passando; eslint com 0 erros e 19 avisos (nenhum erro ou aviso novo pode surgir).
7. Cada etapa altera só os arquivos listados nela. Não faça commit, push, deploy nem mexa na pasta .git; não rode `npm install`; não escreva nem leia segredos, tokens ou arquivos .env.
8. Se algo não bater com o descrito (arquivo, função ou assinatura inexistente, teste quebrado por motivo alheio à etapa), pare e relate em vez de improvisar.

O QUE JÁ EXISTE E É RELEVANTE PARA ESTA ETAPA
A etapa anterior criou a opção `isListedWhenComplete(tool: RegisteredTool, clientKind)` do servidor MCP (McpHostOptions e ServerOptions em C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\server). Em C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\core\ecosystem.ts a classe Ecosystem monta as opções do servidor num objeto que já tem `isListedWhenIndexed: (registered) => this.isListedWhenIndexed(registered)` e um método público `isListedWhenIndexed(registered: RegisteredTool): boolean` que, para o modo indexado, retorna true enquanto `this.hooks?.isSetupPending()` for verdadeiro para as tools `ecosystem_setup_*` do núcleo (moduleId === ECOSYSTEM_ID e nome começando com 'ecosystem_setup_'). `this.hooks` (HookManager) só existe quando há pasta absoluta do cofre e os hooks não estão desativados. HookManager.isSetupPending() é true enquanto algum módulo registrado tem estado 'pendente_configuracao' (o núcleo começa pendente). Em C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\setup\setup-manager.ts, SetupManager.complete() já chama `this.deps.notifyToolsChanged()` (que dispara notifications/tools/list_changed) ao concluir; beginCatalogInstall(moduleId, name) marca o módulo pendente mas NÃO avisa a lista. Os testes de setup usam o rig de C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\setup\helpers.ts (startRig, configureCore, enableModule, rpc(r, 'tools/list'), callTool).

ARQUIVOS
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\core\ecosystem.ts`
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\setup\setup-manager.ts`
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\setup\tools.test.ts`
- Não tocar: qualquer outro arquivo

REGRAS DESTA ETAPA
1. Sem this.hooks (hooks desativados ou sem pasta), as tools de setup continuam listadas (o teste de integração 'initializes MCP and lists the built-in tools' depende disso).
2. Só as três tools ecosystem_setup_* do núcleo são afetadas; tools/call por nome continua funcionando sempre.
3. Só vale para o modo completo (o indexado já tem sua regra).

O QUE FAZER, NESTA ORDEM
1. ecosystem.ts: crie o método público `isListedWhenComplete(registered: RegisteredTool): boolean`: `if (registered.moduleId !== ECOSYSTEM_ID || !registered.tool.name.startsWith("ecosystem_setup_")) return true; if (!this.hooks) return true; return this.hooks.isSetupPending();` (com um comentário curto) e passe `isListedWhenComplete: (registered) => this.isListedWhenComplete(registered),` nas opções do servidor, ao lado de isListedWhenIndexed.
2. setup-manager.ts: no fim de beginCatalogInstall(), depois de `this.states.reset(...)`, chame `this.deps.notifyToolsChanged();` para os clientes reabrirem a lista (as tools de setup voltam a aparecer).
3. tests/setup/tools.test.ts: acrescente um describe 'setup tools in tools/list (modo completo)' com testes usando o rig com hooks ligados (startRig) e `rpc(r, 'tools/list')` para pegar os nomes: (a) antes de configurar o núcleo as três ecosystem_setup_* aparecem; (b) depois de `configureCore(r)` (sem outro módulo pendente) elas NÃO aparecem; (c) mesmo escondidas, `callTool(r, 'ecosystem_setup_status', { modulo: 'ai-ecosystem' })` funciona (sem isError); (d) depois de instalar um módulo do catálogo (use o helper installFromCatalog do arquivo) elas voltam a aparecer. Se o rig tiver modo indexado por padrão, use o modo completo (veja como os outros testes do arquivo escolhem). Rode também tests/screens e tests/integration e ajuste só o que listava as tools de setup sem pendência.

O QUE NÃO FAZER
- Não altere mcp-host.ts nem server-host.ts (feitos na etapa anterior).
- Não mude isListedWhenIndexed.

CRITÉRIOS DE ACEITE
- Dado o núcleo ainda não configurado, Quando o cliente pede tools/list, Então as três ecosystem_setup_* aparecem.
- Dado nenhum módulo pendente, Quando pede tools/list, Então elas não aparecem, mas continuam executando por tools/call.
- Dado a instalação de um módulo pelo catálogo, Quando ela começa, Então os clientes recebem list_changed e as tools de setup reaparecem.
- Dado hooks desativados (sem this.hooks), Quando pede tools/list, Então as tools de setup continuam listadas.

VERIFICAÇÃO (rode a partir de C:\Users\Trabalho\Documents\obsidian-ai-ecosystem e cole a saída real)
- npx tsc --noEmit → sem erros
- npx vitest run tests/setup tests/screens tests/integration → todos passam

Se qualquer coisa não bater com o descrito (arquivo, função ou assinatura inexistente, comportamento diferente do dito acima, teste quebrado por motivo alheio a esta etapa), PARE e relate em vez de improvisar.
RELATÓRIO FINAL: liste os arquivos alterados ou criados (caminho absoluto), cole a saída real de cada comando de verificação (não resuma) e descreva qualquer desvio ou dúvida.
```

## Etapa 23: ecosystem_setup_save em lote [Haiku 5.5 | esforço: médio]

**Objetivo:** fazer ecosystem_setup_save aceitar respostas:{chave:valor} para gravar várias respostas de uma vez.
**Depende de:** Etapa 22 (Esconder as tools de setup do tools/list quando não há pendência)
**Paralelizável com:** nenhuma

**Arquivos**
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\setup\setup-tools.ts`
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\setup\tools.test.ts`
- Não tocar: qualquer outro arquivo

**Regras de implementação**
1. O uso com chave e valor continua idêntico (mesma resposta).
2. Os itens do lote são gravados na ordem das chaves do objeto e um item recusado não impede os seguintes.
3. Máximo de 20 respostas por chamada.

**Passos**
1. Tire `required: ["modulo", "chave", "valor"]` do inputSchema e deixe `required: ["modulo"]`; acrescente a propriedade `respostas: { type: "object", description: "Several answers at once, as { key: value }. Use instead of chave and valor.", additionalProperties: true }` e ajuste a descrição da tool com `Pass respostas to save several answers in one call.`.
2. No handler, depois de validar modulo: se `args.respostas !== undefined`: se vier também `chave` ou `valor` → `failure("Give chave and valor, or respostas, not both.")`; se `respostas` não for objeto simples ou estiver vazio ou tiver mais de 20 chaves → `failure("respostas must be an object with 1 to 20 answers.")`. Para cada par (na ordem de Object.entries) chame `await setup.save(modulo, chave, valor)`; junte as chaves salvas em `salvas` e as recusadas em `recusadas: Record<string, string>` (chave → erro). Resposta: `json({ ok: Object.keys(recusadas).length === 0, modulo, salvas, ...(Object.keys(recusadas).length ? { recusadas } : {}) }, Object.keys(recusadas).length > 0)`.
3. O caminho de uma resposta só (chave e valor) fica como está.
4. Em C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\setup\tools.test.ts acrescente no describe 'ecosystem_setup_save: core keys': (a) callTool(r, 'ecosystem_setup_save', { modulo: 'ai-ecosystem', respostas: { agentes: ['claude-code'], modo_hooks: 'avisar', claude_md: 'permitido' } }) devolve ok true e salvas com as 3 chaves, e o estado guarda as respostas (mesma forma de conferir dos testes vizinhos); (b) com uma chave inválida (modo_hooks: 'x') e duas válidas: isError, salvas com as 2 válidas e recusadas com a chave inválida; (c) respostas junto com chave → isError 'not both'; (d) respostas vazia → isError.

**BDD (estado esperado ao concluir)**
- Dado respostas com 3 chaves válidas do núcleo, Quando chamo ecosystem_setup_save, Então as 3 ficam gravadas e a resposta lista as 3 em salvas.
- Dado respostas com uma chave inválida, Quando chamo, Então as válidas são gravadas, a inválida aparece em recusadas e o resultado é isError.
- Dado chave e valor (uso antigo), Quando chamo, Então a resposta continua {ok:true, modulo, chave}.

**Verificação** (comandos a rodar, com o resultado esperado)
- npx tsc --noEmit → sem erros
- npx vitest run tests/setup → todos passam

**Prompt para o subagente**
```text
Você é um subagente de implementação em TypeScript. Objetivo desta etapa: fazer ecosystem_setup_save aceitar respostas:{chave:valor} para gravar várias respostas de uma vez.

CONTEXTO COMPLETO
Projeto: plugin do Obsidian chamado AI Ecosystem (núcleo da suíte de plugins de IA), escrito em TypeScript, com servidor MCP e REST local, executor de scripts, índice e descoberta de tools (tools_find, tools_describe, tools_run), hooks do Claude Code gravados nas settings do cofre, configuração guiada de módulos, telas (formulários) e um inspetor de requisições. Raiz do repositório (RAIZ): C:\Users\Trabalho\Documents\obsidian-ai-ecosystem. Testes com vitest (pasta tests), sem Obsidian real (há um mock em tests\mocks\obsidian.ts).
Objetivo geral da demanda: implementar 16 melhorias aceitas numa auditoria do núcleo, na ordem: (1) teto de saída do ecosystem_run_script; (2) ecosystem_status compacto; (3) script_id no executor; (4) lote no tools_run; (5) diagnóstico que percebe módulo defasado; (6) cancelamento do run_script; (7) remover a aprovação do tools_run e o código morto; (8) limitar o activity.sqlite; (9) setup_status, list_scripts e diagnóstico enxutos; (10) resumo dos módulos no início da sessão; (11) tela_gerenciar e setup oculto sem pendência; (12) setup_save em lote; (13) descrição curta do run_script; (14) falha do módulo só por exceção; (15) catálogo por manifest.version; (16) despachante único dos hooks de proteção.
Regras globais:
1. Idioma: o código, os comentários e os nomes de identificadores ficam em inglês (como já está nos arquivos); as mensagens do diagnóstico, do hook e dos achados ficam em português quando o arquivo já estiver em português; o README tem uma parte em inglês e uma em português espelhadas.
2. Estilo do código: TypeScript estrito, 2 espaços, aspas duplas, ponto e vírgula, `import type` para tipos, sem dependências novas e sem alterar package.json.
3. Os diretórios src/runner, src/server, src/registry, src/hooks, src/core, src/setup, src/tool-index são código Node puro: não importam o pacote "obsidian".
4. O script src/hooks/script/ai-ecosystem-hook.mjs é Node puro, sem dependências, e nunca pode atrapalhar o agente: qualquer problema termina com saída 0 e sem texto.
5. Comandos, sempre a partir de C:\Users\Trabalho\Documents\obsidian-ai-ecosystem: typecheck `npx tsc --noEmit`; testes `npx vitest run` (um arquivo: `npx vitest run tests\pasta\arquivo.test.ts`); lint `npx eslint .`; build `npm run build`.
6. Linha de base antes das mudanças: tsc sem erros; 54 arquivos de teste e 918 testes passando; eslint com 0 erros e 19 avisos (nenhum erro ou aviso novo pode surgir).
7. Cada etapa altera só os arquivos listados nela. Não faça commit, push, deploy nem mexa na pasta .git; não rode `npm install`; não escreva nem leia segredos, tokens ou arquivos .env.
8. Se algo não bater com o descrito (arquivo, função ou assinatura inexistente, teste quebrado por motivo alheio à etapa), pare e relate em vez de improvisar.

O QUE JÁ EXISTE E É RELEVANTE PARA ESTA ETAPA
Em C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\setup\setup-tools.ts a tool ecosystem_setup_save tem inputSchema `{ modulo, chave, valor }` com `required: ["modulo", "chave", "valor"]` e o handler valida `modulo` (moduleArg), exige `chave` string e `valor` presente (`"valor" in args`), chama `setup.save(modulo, args.chave, args.valor)` (SetupManager.save devolve { ok: true } ou { ok: false, error }) e responde `json({ ok: true, modulo, chave })` ou `failure(result.error)`. As funções locais json(value, isError) e failure(error, faltando?) existem no arquivo. Os testes de ecosystem_setup_save ficam em C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\setup\tools.test.ts (describes 'ecosystem_setup_save: core keys' e 'ecosystem_setup_save: modules'; helpers setupSave(r, modulo, chave, valor) e callTool(r, nome, args) em C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\setup\helpers.ts). As chaves do núcleo são agentes, arquivo_settings, modo_hooks e claude_md.

ARQUIVOS
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\setup\setup-tools.ts`
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\setup\tools.test.ts`
- Não tocar: qualquer outro arquivo

REGRAS DESTA ETAPA
1. O uso com chave e valor continua idêntico (mesma resposta).
2. Os itens do lote são gravados na ordem das chaves do objeto e um item recusado não impede os seguintes.
3. Máximo de 20 respostas por chamada.

O QUE FAZER, NESTA ORDEM
1. Tire `required: ["modulo", "chave", "valor"]` do inputSchema e deixe `required: ["modulo"]`; acrescente a propriedade `respostas: { type: "object", description: "Several answers at once, as { key: value }. Use instead of chave and valor.", additionalProperties: true }` e ajuste a descrição da tool com `Pass respostas to save several answers in one call.`.
2. No handler, depois de validar modulo: se `args.respostas !== undefined`: se vier também `chave` ou `valor` → `failure("Give chave and valor, or respostas, not both.")`; se `respostas` não for objeto simples ou estiver vazio ou tiver mais de 20 chaves → `failure("respostas must be an object with 1 to 20 answers.")`. Para cada par (na ordem de Object.entries) chame `await setup.save(modulo, chave, valor)`; junte as chaves salvas em `salvas` e as recusadas em `recusadas: Record<string, string>` (chave → erro). Resposta: `json({ ok: Object.keys(recusadas).length === 0, modulo, salvas, ...(Object.keys(recusadas).length ? { recusadas } : {}) }, Object.keys(recusadas).length > 0)`.
3. O caminho de uma resposta só (chave e valor) fica como está.
4. Em C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\setup\tools.test.ts acrescente no describe 'ecosystem_setup_save: core keys': (a) callTool(r, 'ecosystem_setup_save', { modulo: 'ai-ecosystem', respostas: { agentes: ['claude-code'], modo_hooks: 'avisar', claude_md: 'permitido' } }) devolve ok true e salvas com as 3 chaves, e o estado guarda as respostas (mesma forma de conferir dos testes vizinhos); (b) com uma chave inválida (modo_hooks: 'x') e duas válidas: isError, salvas com as 2 válidas e recusadas com a chave inválida; (c) respostas junto com chave → isError 'not both'; (d) respostas vazia → isError.

O QUE NÃO FAZER
- Não altere setup-manager.ts.
- Não altere as skills de configuração.

CRITÉRIOS DE ACEITE
- Dado respostas com 3 chaves válidas do núcleo, Quando chamo ecosystem_setup_save, Então as 3 ficam gravadas e a resposta lista as 3 em salvas.
- Dado respostas com uma chave inválida, Quando chamo, Então as válidas são gravadas, a inválida aparece em recusadas e o resultado é isError.
- Dado chave e valor (uso antigo), Quando chamo, Então a resposta continua {ok:true, modulo, chave}.

VERIFICAÇÃO (rode a partir de C:\Users\Trabalho\Documents\obsidian-ai-ecosystem e cole a saída real)
- npx tsc --noEmit → sem erros
- npx vitest run tests/setup → todos passam

Se qualquer coisa não bater com o descrito (arquivo, função ou assinatura inexistente, comportamento diferente do dito acima, teste quebrado por motivo alheio a esta etapa), PARE e relate em vez de improvisar.
RELATÓRIO FINAL: liste os arquivos alterados ou criados (caminho absoluto), cole a saída real de cada comando de verificação (não resuma) e descreva qualquer desvio ou dúvida.
```

## Etapa 24: Descrição curta do ecosystem_run_script com as regras na mensagem de recusa [Haiku 5.5 | esforço: médio]

**Objetivo:** encurtar a descrição da tool ecosystem_run_script levando as regras de política para a mensagem de recusa e para as descrições dos parâmetros.
**Depende de:** Etapa 23 (ecosystem_setup_save em lote)
**Paralelizável com:** nenhuma

**Arquivos**
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\runner\script-tools.ts`
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\runner\script-tools.test.ts`
- Não tocar: qualquer outro arquivo

**Regras de implementação**
1. Nenhum comportamento muda: só texto.
2. A descrição nova tem no máximo 300 caracteres.
3. A mensagem de recusa continua começando com 'Script refused (<codigo>): <mensagem>' (testes existentes dependem disso).

**Passos**
1. Troque a descrição da runTool por `Runs a vault script (Python, Node.js, Bash or PowerShell) and returns its exit code, stdout and stderr. Pass a path from ecosystem_list_scripts, or a script_id registered in AI Scripts.` (confira que ficou com ≤ 300 caracteres).
2. Nas propriedades do inputSchema: `env` → `Extra environment variables. Values may be {{secret:NAME}} placeholders, resolved by Environment Keys straight into the process and never returned.`; `timeoutSeconds` → `Timeout in seconds, capped by the maximum in the settings. The process is killed when it expires.`; `code` → `Inline source code to run instead of a file. Refused unless the user turned off the Script Engine restrictions.` (mantenha as demais).
3. No ramo 'refused' do handler da runTool acrescente ao texto, depois da mensagem do motor, a frase `Only scripts in the allowed script folders or declared by #mcp/script notes can run (see ecosystem_list_scripts); inline code needs the Script Engine restrictions turned off.` (o texto fica `Script refused (<codigo>): <mensagem> <frase>`). O structuredContent continua igual.
4. Em C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\runner\script-tools.test.ts: ajuste o teste 'reports refusals as tool errors' se ele comparar o texto inteiro (use toContain para o começo) e acrescente: a descrição da tool tem ≤ 300 caracteres e menciona 'script_id'; a recusa contém 'allowed script folders'; as descrições de env e code citam 'placeholders' e 'restrictions'.

**BDD (estado esperado ao concluir)**
- Dado a tool ecosystem_run_script, Quando leio a descrição, Então ela tem no máximo 300 caracteres.
- Dado um script fora das pastas permitidas, Quando o executo, Então a resposta começa com 'Script refused (' e traz a frase das pastas permitidas.
- Dado o resto do comportamento, Então os testes existentes passam.

**Verificação** (comandos a rodar, com o resultado esperado)
- npx tsc --noEmit → sem erros
- npx vitest run tests/runner tests/integration → todos passam

**Prompt para o subagente**
```text
Você é um subagente de implementação em TypeScript. Objetivo desta etapa: encurtar a descrição da tool ecosystem_run_script levando as regras de política para a mensagem de recusa e para as descrições dos parâmetros.

CONTEXTO COMPLETO
Projeto: plugin do Obsidian chamado AI Ecosystem (núcleo da suíte de plugins de IA), escrito em TypeScript, com servidor MCP e REST local, executor de scripts, índice e descoberta de tools (tools_find, tools_describe, tools_run), hooks do Claude Code gravados nas settings do cofre, configuração guiada de módulos, telas (formulários) e um inspetor de requisições. Raiz do repositório (RAIZ): C:\Users\Trabalho\Documents\obsidian-ai-ecosystem. Testes com vitest (pasta tests), sem Obsidian real (há um mock em tests\mocks\obsidian.ts).
Objetivo geral da demanda: implementar 16 melhorias aceitas numa auditoria do núcleo, na ordem: (1) teto de saída do ecosystem_run_script; (2) ecosystem_status compacto; (3) script_id no executor; (4) lote no tools_run; (5) diagnóstico que percebe módulo defasado; (6) cancelamento do run_script; (7) remover a aprovação do tools_run e o código morto; (8) limitar o activity.sqlite; (9) setup_status, list_scripts e diagnóstico enxutos; (10) resumo dos módulos no início da sessão; (11) tela_gerenciar e setup oculto sem pendência; (12) setup_save em lote; (13) descrição curta do run_script; (14) falha do módulo só por exceção; (15) catálogo por manifest.version; (16) despachante único dos hooks de proteção.
Regras globais:
1. Idioma: o código, os comentários e os nomes de identificadores ficam em inglês (como já está nos arquivos); as mensagens do diagnóstico, do hook e dos achados ficam em português quando o arquivo já estiver em português; o README tem uma parte em inglês e uma em português espelhadas.
2. Estilo do código: TypeScript estrito, 2 espaços, aspas duplas, ponto e vírgula, `import type` para tipos, sem dependências novas e sem alterar package.json.
3. Os diretórios src/runner, src/server, src/registry, src/hooks, src/core, src/setup, src/tool-index são código Node puro: não importam o pacote "obsidian".
4. O script src/hooks/script/ai-ecosystem-hook.mjs é Node puro, sem dependências, e nunca pode atrapalhar o agente: qualquer problema termina com saída 0 e sem texto.
5. Comandos, sempre a partir de C:\Users\Trabalho\Documents\obsidian-ai-ecosystem: typecheck `npx tsc --noEmit`; testes `npx vitest run` (um arquivo: `npx vitest run tests\pasta\arquivo.test.ts`); lint `npx eslint .`; build `npm run build`.
6. Linha de base antes das mudanças: tsc sem erros; 54 arquivos de teste e 918 testes passando; eslint com 0 erros e 19 avisos (nenhum erro ou aviso novo pode surgir).
7. Cada etapa altera só os arquivos listados nela. Não faça commit, push, deploy nem mexa na pasta .git; não rode `npm install`; não escreva nem leia segredos, tokens ou arquivos .env.
8. Se algo não bater com o descrito (arquivo, função ou assinatura inexistente, teste quebrado por motivo alheio à etapa), pare e relate em vez de improvisar.

O QUE JÁ EXISTE E É RELEVANTE PARA ESTA ETAPA
Em C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\runner\script-tools.ts a runTool (name 'ecosystem_run_script') tem uma descrição longa (549 caracteres) com as regras: só roda scripts de pastas permitidas ou declarados por notas #mcp/script (ver ecosystem_list_scripts); código inline (argumento code) só com as restrições do Script Engine desligadas; valores de env podem usar {{secret:NAME}} resolvidos pelo Environment Keys direto no processo sem voltar; o processo morre no timeout. As descrições dos parâmetros path, args, cwd, timeoutSeconds, env, language, code, script_id e max_chars estão no inputSchema. Quando o motor recusa um script, o handler devolve `Script refused (${outcome.code}): ${outcome.message}` com `structuredContent: { refused, reason }` e isError. Em modo completo (clientes sem o índice) essa descrição vai inteira para o contexto do agente a cada sessão.

ARQUIVOS
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\runner\script-tools.ts`
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\runner\script-tools.test.ts`
- Não tocar: qualquer outro arquivo

REGRAS DESTA ETAPA
1. Nenhum comportamento muda: só texto.
2. A descrição nova tem no máximo 300 caracteres.
3. A mensagem de recusa continua começando com 'Script refused (<codigo>): <mensagem>' (testes existentes dependem disso).

O QUE FAZER, NESTA ORDEM
1. Troque a descrição da runTool por `Runs a vault script (Python, Node.js, Bash or PowerShell) and returns its exit code, stdout and stderr. Pass a path from ecosystem_list_scripts, or a script_id registered in AI Scripts.` (confira que ficou com ≤ 300 caracteres).
2. Nas propriedades do inputSchema: `env` → `Extra environment variables. Values may be {{secret:NAME}} placeholders, resolved by Environment Keys straight into the process and never returned.`; `timeoutSeconds` → `Timeout in seconds, capped by the maximum in the settings. The process is killed when it expires.`; `code` → `Inline source code to run instead of a file. Refused unless the user turned off the Script Engine restrictions.` (mantenha as demais).
3. No ramo 'refused' do handler da runTool acrescente ao texto, depois da mensagem do motor, a frase `Only scripts in the allowed script folders or declared by #mcp/script notes can run (see ecosystem_list_scripts); inline code needs the Script Engine restrictions turned off.` (o texto fica `Script refused (<codigo>): <mensagem> <frase>`). O structuredContent continua igual.
4. Em C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\runner\script-tools.test.ts: ajuste o teste 'reports refusals as tool errors' se ele comparar o texto inteiro (use toContain para o começo) e acrescente: a descrição da tool tem ≤ 300 caracteres e menciona 'script_id'; a recusa contém 'allowed script folders'; as descrições de env e code citam 'placeholders' e 'restrictions'.

O QUE NÃO FAZER
- Não altere a lógica do motor.
- Não mude os nomes dos parâmetros.

CRITÉRIOS DE ACEITE
- Dado a tool ecosystem_run_script, Quando leio a descrição, Então ela tem no máximo 300 caracteres.
- Dado um script fora das pastas permitidas, Quando o executo, Então a resposta começa com 'Script refused (' e traz a frase das pastas permitidas.
- Dado o resto do comportamento, Então os testes existentes passam.

VERIFICAÇÃO (rode a partir de C:\Users\Trabalho\Documents\obsidian-ai-ecosystem e cole a saída real)
- npx tsc --noEmit → sem erros
- npx vitest run tests/runner tests/integration → todos passam

Se qualquer coisa não bater com o descrito (arquivo, função ou assinatura inexistente, comportamento diferente do dito acima, teste quebrado por motivo alheio a esta etapa), PARE e relate em vez de improvisar.
RELATÓRIO FINAL: liste os arquivos alterados ou criados (caminho absoluto), cole a saída real de cada comando de verificação (não resuma) e descreva qualquer desvio ou dúvida.
```

## Etapa 25: Só marcar falha do módulo quando ele lança exceção ou está indisponível [Haiku 5.5 | esforço: alto]

**Objetivo:** fazer o servidor MCP e o tools_run chamarem onToolResult com 'falhou' só quando o handler lança exceção ou o módulo está indisponível, não quando a tool devolve isError por argumento errado.
**Depende de:** Etapa 24 (Descrição curta do ecosystem_run_script com as regras na mensagem de recusa)
**Paralelizável com:** nenhuma

**Arquivos**
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\server\mcp-host.ts`
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\tool-index\discovery-tools.ts`
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\core\ecosystem.ts` (só renomear o parâmetro nos dois lugares)
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\server\client-kind.test.ts`
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\tool-index\federation.test.ts`
- Não tocar: qualquer outro arquivo

**Regras de implementação**
1. O segundo parâmetro do callback passa a chamar-se `failed`: true só quando o handler lançou exceção ou o módulo está indisponível (runner ausente).
2. Uma tool que devolve isError: true sem lançar exceção NÃO é falha do módulo (failed false).
3. HookManager.recordToolResult não muda (ele já recebe um booleano).

**Passos**
1. mcp-host.ts: em callTool() declare `let threw = false;` antes do try, ponha `threw = true;` no catch e chame `this.opts.onToolResult?.(found.moduleId, threw)`. Atualize o comentário de onToolResult em McpHostOptions para: `Called after every tools/call. failed is true only when the handler threw (a tool answer with isError is not a failure of the module). Errors thrown here never affect the request.` e o nome do parâmetro para failed.
2. discovery-tools.ts: altere `safe` para devolver `{ result: HubToolResult; threw: boolean }` (threw true no catch), `report` passa a chamar `deps.onToolResult?.(moduleId, threw)` (no try/catch já existente) e devolve `result`; renomeie o parâmetro do callback em DiscoveryToolsDeps para failed com o mesmo comentário. No ramo do runner ausente, antes do return, chame `try { deps.onToolResult?.(entry.moduleId, true); } catch { /* the marker is only a hint */ }`.
3. ecosystem.ts: renomeie o parâmetro `isError` para `failed` nos dois lugares onde passa onToolResult para recordToolResult (e confira `HookManager.recordToolResult(moduleId: string, isError: boolean)`: renomeie o parâmetro para failed e o comentário 'A tool call ended: failures set the module marker...' para refletir 'failed').
4. tests/server/client-kind.test.ts e tests/tool-index/federation.test.ts: ajuste o nome do parâmetro nos callbacks (sem mudar a lógica) e acrescente em federation.test.ts: (a) handler que devolve `{ content: [...], isError: true }` sem lançar → results == [['ai-git-tools', false]]; (b) id só do índice sem serviço runner → results contém ['environment-variables', true] e a resposta é isError; (c) o teste de exceção continua com true. Em mcp.test.ts ou client-kind.test.ts (onde já há onToolResult via servidor) acrescente: tool que devolve isError sem lançar → failed false; tool que lança → failed true.

**BDD (estado esperado ao concluir)**
- Dado uma tool que devolve isError por argumento faltando, Quando é chamada, Então onToolResult recebe failed false e a proteção do módulo não é desligada.
- Dado uma tool cujo handler lança exceção, Quando é chamada, Então onToolResult recebe failed true.
- Dado um id só do índice cujo módulo não tem runner, Quando chamado pelo tools_run, Então onToolResult recebe failed true.
- Dado uma chamada que dá certo, Quando termina, Então failed é false (o marcador de falha do módulo é limpo).

**Verificação** (comandos a rodar, com o resultado esperado)
- npx tsc --noEmit → sem erros
- npx vitest run tests/server tests/tool-index tests/hooks tests/integration → todos passam

**Prompt para o subagente**
```text
Você é um subagente de implementação em TypeScript. Objetivo desta etapa: fazer o servidor MCP e o tools_run chamarem onToolResult com 'falhou' só quando o handler lança exceção ou o módulo está indisponível, não quando a tool devolve isError por argumento errado.

CONTEXTO COMPLETO
Projeto: plugin do Obsidian chamado AI Ecosystem (núcleo da suíte de plugins de IA), escrito em TypeScript, com servidor MCP e REST local, executor de scripts, índice e descoberta de tools (tools_find, tools_describe, tools_run), hooks do Claude Code gravados nas settings do cofre, configuração guiada de módulos, telas (formulários) e um inspetor de requisições. Raiz do repositório (RAIZ): C:\Users\Trabalho\Documents\obsidian-ai-ecosystem. Testes com vitest (pasta tests), sem Obsidian real (há um mock em tests\mocks\obsidian.ts).
Objetivo geral da demanda: implementar 16 melhorias aceitas numa auditoria do núcleo, na ordem: (1) teto de saída do ecosystem_run_script; (2) ecosystem_status compacto; (3) script_id no executor; (4) lote no tools_run; (5) diagnóstico que percebe módulo defasado; (6) cancelamento do run_script; (7) remover a aprovação do tools_run e o código morto; (8) limitar o activity.sqlite; (9) setup_status, list_scripts e diagnóstico enxutos; (10) resumo dos módulos no início da sessão; (11) tela_gerenciar e setup oculto sem pendência; (12) setup_save em lote; (13) descrição curta do run_script; (14) falha do módulo só por exceção; (15) catálogo por manifest.version; (16) despachante único dos hooks de proteção.
Regras globais:
1. Idioma: o código, os comentários e os nomes de identificadores ficam em inglês (como já está nos arquivos); as mensagens do diagnóstico, do hook e dos achados ficam em português quando o arquivo já estiver em português; o README tem uma parte em inglês e uma em português espelhadas.
2. Estilo do código: TypeScript estrito, 2 espaços, aspas duplas, ponto e vírgula, `import type` para tipos, sem dependências novas e sem alterar package.json.
3. Os diretórios src/runner, src/server, src/registry, src/hooks, src/core, src/setup, src/tool-index são código Node puro: não importam o pacote "obsidian".
4. O script src/hooks/script/ai-ecosystem-hook.mjs é Node puro, sem dependências, e nunca pode atrapalhar o agente: qualquer problema termina com saída 0 e sem texto.
5. Comandos, sempre a partir de C:\Users\Trabalho\Documents\obsidian-ai-ecosystem: typecheck `npx tsc --noEmit`; testes `npx vitest run` (um arquivo: `npx vitest run tests\pasta\arquivo.test.ts`); lint `npx eslint .`; build `npm run build`.
6. Linha de base antes das mudanças: tsc sem erros; 54 arquivos de teste e 918 testes passando; eslint com 0 erros e 19 avisos (nenhum erro ou aviso novo pode surgir).
7. Cada etapa altera só os arquivos listados nela. Não faça commit, push, deploy nem mexa na pasta .git; não rode `npm install`; não escreva nem leia segredos, tokens ou arquivos .env.
8. Se algo não bater com o descrito (arquivo, função ou assinatura inexistente, teste quebrado por motivo alheio à etapa), pare e relate em vez de improvisar.

O QUE JÁ EXISTE E É RELEVANTE PARA ESTA ETAPA
Hoje `McpHostOptions.onToolResult?: (moduleId: string, isError: boolean) => void` (C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\server\mcp-host.ts) é chamado no fim de callTool() com `result.isError === true`, e o mesmo contrato vale em `DiscoveryToolsDeps.onToolResult` (C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\tool-index\discovery-tools.ts), onde a função report(moduleId, call) usa safe(call) (exceção vira resultado '`Error: msg`' com isError) e depois chama `deps.onToolResult?.(moduleId, result.isError === true)`. O destino é `HookManager.recordToolResult(moduleId, isError)` (C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\hooks\hook-manager.ts; com isError true grava o marcador de falha do módulo em falhas.json e o hook de proteção do módulo se afasta por 10 minutos; com false limpa o marcador). Assim qualquer isError, até um argumento que faltou, desliga a proteção do módulo por 10 minutos. Em callTool() o handler é chamado dentro de try/catch: `catch (err) { result = { content: [{ type: 'text', text: 'Error: ' + message }], isError: true }; }`. Em discovery-tools.ts, quando o id está no índice mas o módulo não tem serviço runner (`!runner || typeof runner.run !== 'function'`), a resposta é texto de erro 'The tool X is in the index of the module ..., but that module is not running it now (inactive or outdated).' sem chamar onToolResult. C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\core\ecosystem.ts passa `onToolResult: (moduleId, isError) => this.hooks?.recordToolResult(moduleId, isError)` em dois lugares (opções do servidor e deps de discovery). Testes que usam o callback: C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\server\client-kind.test.ts (linha com `onToolResult: (moduleId, isError) => {`), C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\tool-index\federation.test.ts (`results.push([moduleId, isError])` e as expectativas `toEqual([['ai-git-tools', false]])` e `[['ai-git-tools', true]]` nos testes 'tools_run runs the registered handler...' e 'turns a throwing handler...') e C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\hooks\hook-manager.test.ts (recordToolResult direto, que não muda).

ARQUIVOS
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\server\mcp-host.ts`
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\tool-index\discovery-tools.ts`
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\core\ecosystem.ts` (só renomear o parâmetro nos dois lugares)
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\server\client-kind.test.ts`
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\tool-index\federation.test.ts`
- Não tocar: qualquer outro arquivo

REGRAS DESTA ETAPA
1. O segundo parâmetro do callback passa a chamar-se `failed`: true só quando o handler lançou exceção ou o módulo está indisponível (runner ausente).
2. Uma tool que devolve isError: true sem lançar exceção NÃO é falha do módulo (failed false).
3. HookManager.recordToolResult não muda (ele já recebe um booleano).

O QUE FAZER, NESTA ORDEM
1. mcp-host.ts: em callTool() declare `let threw = false;` antes do try, ponha `threw = true;` no catch e chame `this.opts.onToolResult?.(found.moduleId, threw)`. Atualize o comentário de onToolResult em McpHostOptions para: `Called after every tools/call. failed is true only when the handler threw (a tool answer with isError is not a failure of the module). Errors thrown here never affect the request.` e o nome do parâmetro para failed.
2. discovery-tools.ts: altere `safe` para devolver `{ result: HubToolResult; threw: boolean }` (threw true no catch), `report` passa a chamar `deps.onToolResult?.(moduleId, threw)` (no try/catch já existente) e devolve `result`; renomeie o parâmetro do callback em DiscoveryToolsDeps para failed com o mesmo comentário. No ramo do runner ausente, antes do return, chame `try { deps.onToolResult?.(entry.moduleId, true); } catch { /* the marker is only a hint */ }`.
3. ecosystem.ts: renomeie o parâmetro `isError` para `failed` nos dois lugares onde passa onToolResult para recordToolResult (e confira `HookManager.recordToolResult(moduleId: string, isError: boolean)`: renomeie o parâmetro para failed e o comentário 'A tool call ended: failures set the module marker...' para refletir 'failed').
4. tests/server/client-kind.test.ts e tests/tool-index/federation.test.ts: ajuste o nome do parâmetro nos callbacks (sem mudar a lógica) e acrescente em federation.test.ts: (a) handler que devolve `{ content: [...], isError: true }` sem lançar → results == [['ai-git-tools', false]]; (b) id só do índice sem serviço runner → results contém ['environment-variables', true] e a resposta é isError; (c) o teste de exceção continua com true. Em mcp.test.ts ou client-kind.test.ts (onde já há onToolResult via servidor) acrescente: tool que devolve isError sem lançar → failed false; tool que lança → failed true.

O QUE NÃO FAZER
- Não altere o script de hooks nesta etapa (próxima).
- Não mude a lógica de HookManager além do nome do parâmetro.

CRITÉRIOS DE ACEITE
- Dado uma tool que devolve isError por argumento faltando, Quando é chamada, Então onToolResult recebe failed false e a proteção do módulo não é desligada.
- Dado uma tool cujo handler lança exceção, Quando é chamada, Então onToolResult recebe failed true.
- Dado um id só do índice cujo módulo não tem runner, Quando chamado pelo tools_run, Então onToolResult recebe failed true.
- Dado uma chamada que dá certo, Quando termina, Então failed é false (o marcador de falha do módulo é limpo).

VERIFICAÇÃO (rode a partir de C:\Users\Trabalho\Documents\obsidian-ai-ecosystem e cole a saída real)
- npx tsc --noEmit → sem erros
- npx vitest run tests/server tests/tool-index tests/hooks tests/integration → todos passam

Se qualquer coisa não bater com o descrito (arquivo, função ou assinatura inexistente, comportamento diferente do dito acima, teste quebrado por motivo alheio a esta etapa), PARE e relate em vez de improvisar.
RELATÓRIO FINAL: liste os arquivos alterados ou criados (caminho absoluto), cole a saída real de cada comando de verificação (não resuma) e descreva qualquer desvio ou dúvida.
```

## Etapa 26: Hook de falha ignora erro de argumento e lote [Haiku 5.5 | esforço: médio]

**Objetivo:** fazer o hook PostToolUseFailure não marcar o módulo como em falha quando o erro é de argumento ('Invalid arguments', 'Unknown tool') nem quando a chamada é um lote do tools_run.
**Depende de:** Etapa 25 (Só marcar falha do módulo quando ele lança exceção ou está indisponível)
**Paralelizável com:** nenhuma

**Arquivos**
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\hooks\script\ai-ecosystem-hook.mjs` (só a função failure)
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\hooks\hook-execucao.test.ts` (só o describe da falha)
- Não tocar: qualquer outro arquivo

**Regras de implementação**
1. Na dúvida, o comportamento atual (marcar) continua: só os dois filtros abaixo são novos.
2. Nenhum outro tipo de hook muda.

**Passos**
1. Em failure(), logo depois de `if (parts.length < 3 || parts[0] !== "mcp") return allow();` e de calcular `let tool`, acrescente: `const message = typeof input.error === "string" ? input.error.trim() : ""; if (/^(Invalid arguments|Unknown tool)/.test(message)) return allow(); if (tool === "tools_run" && isObject(input.tool_input) && Array.isArray(input.tool_input.calls)) return allow();` (antes da troca de tool pelo id e da leitura de tools.json; coloque os dois filtros antes do restante).
2. Em hook-execucao.test.ts, no describe 'hook script: falha through tools_run', acrescente: (a) erro 'Invalid arguments: id is required.' em tool_name tools_run com id git_push NÃO grava falhas.json; (b) 'Unknown tool: x. Find the right id with tools_find.' idem; (c) tools_run com tool_input {calls:[{id:'git_push'}]} idem; (d) um erro qualquer ('Error: boom') continua marcando o módulo; (e) falha direta de outra tool com erro 'Invalid arguments: x' não marca.

**BDD (estado esperado ao concluir)**
- Dado um PostToolUseFailure com error 'Invalid arguments: ...', Quando o hook roda, Então falhas.json não é criado nem alterado.
- Dado um tools_run com calls, Quando o hook de falha roda, Então não marca nenhum módulo.
- Dado um erro comum ('Error: boom'), Quando o hook roda, Então o módulo da tool continua marcado.

**Verificação** (comandos a rodar, com o resultado esperado)
- node --check C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\hooks\script\ai-ecosystem-hook.mjs → sem saída (sucesso)
- npx vitest run tests/hooks → todos passam

**Prompt para o subagente**
```text
Você é um subagente de implementação em TypeScript. Objetivo desta etapa: fazer o hook PostToolUseFailure não marcar o módulo como em falha quando o erro é de argumento ('Invalid arguments', 'Unknown tool') nem quando a chamada é um lote do tools_run.

CONTEXTO COMPLETO
Projeto: plugin do Obsidian chamado AI Ecosystem (núcleo da suíte de plugins de IA), escrito em TypeScript, com servidor MCP e REST local, executor de scripts, índice e descoberta de tools (tools_find, tools_describe, tools_run), hooks do Claude Code gravados nas settings do cofre, configuração guiada de módulos, telas (formulários) e um inspetor de requisições. Raiz do repositório (RAIZ): C:\Users\Trabalho\Documents\obsidian-ai-ecosystem. Testes com vitest (pasta tests), sem Obsidian real (há um mock em tests\mocks\obsidian.ts).
Objetivo geral da demanda: implementar 16 melhorias aceitas numa auditoria do núcleo, na ordem: (1) teto de saída do ecosystem_run_script; (2) ecosystem_status compacto; (3) script_id no executor; (4) lote no tools_run; (5) diagnóstico que percebe módulo defasado; (6) cancelamento do run_script; (7) remover a aprovação do tools_run e o código morto; (8) limitar o activity.sqlite; (9) setup_status, list_scripts e diagnóstico enxutos; (10) resumo dos módulos no início da sessão; (11) tela_gerenciar e setup oculto sem pendência; (12) setup_save em lote; (13) descrição curta do run_script; (14) falha do módulo só por exceção; (15) catálogo por manifest.version; (16) despachante único dos hooks de proteção.
Regras globais:
1. Idioma: o código, os comentários e os nomes de identificadores ficam em inglês (como já está nos arquivos); as mensagens do diagnóstico, do hook e dos achados ficam em português quando o arquivo já estiver em português; o README tem uma parte em inglês e uma em português espelhadas.
2. Estilo do código: TypeScript estrito, 2 espaços, aspas duplas, ponto e vírgula, `import type` para tipos, sem dependências novas e sem alterar package.json.
3. Os diretórios src/runner, src/server, src/registry, src/hooks, src/core, src/setup, src/tool-index são código Node puro: não importam o pacote "obsidian".
4. O script src/hooks/script/ai-ecosystem-hook.mjs é Node puro, sem dependências, e nunca pode atrapalhar o agente: qualquer problema termina com saída 0 e sem texto.
5. Comandos, sempre a partir de C:\Users\Trabalho\Documents\obsidian-ai-ecosystem: typecheck `npx tsc --noEmit`; testes `npx vitest run` (um arquivo: `npx vitest run tests\pasta\arquivo.test.ts`); lint `npx eslint .`; build `npm run build`.
6. Linha de base antes das mudanças: tsc sem erros; 54 arquivos de teste e 918 testes passando; eslint com 0 erros e 19 avisos (nenhum erro ou aviso novo pode surgir).
7. Cada etapa altera só os arquivos listados nela. Não faça commit, push, deploy nem mexa na pasta .git; não rode `npm install`; não escreva nem leia segredos, tokens ou arquivos .env.
8. Se algo não bater com o descrito (arquivo, função ou assinatura inexistente, teste quebrado por motivo alheio à etapa), pare e relate em vez de improvisar.

O QUE JÁ EXISTE E É RELEVANTE PARA ESTA ETAPA
No script C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\hooks\script\ai-ecosystem-hook.mjs a função `failure(stateDir, input)` trata o tipo 'falha' (PostToolUseFailure do Claude Code, entrada com `tool_name` (mcp__<servidor>__<tool>), `tool_input` e `error` (texto do erro)). Ela calcula o nome da tool a partir do tool_name, troca por `tool_input.id` quando a tool é tools_run (a falha pertence ao módulo da tool executada), procura o módulo em tools.json e grava `falhas.json[módulo] = Date.now()`. A etapa anterior fez o servidor MCP só reportar falha por exceção ou módulo indisponível, mas o Claude Code também dispara este hook para qualquer resultado isError (inclusive 'Invalid arguments: ...' e 'Unknown tool: ...', textos devolvidos pelo núcleo), o que ainda desliga a proteção do módulo por 10 minutos. O tools_run agora aceita `tool_input.calls` (lote de até 10 {id,args}); nesse caso não há `id` e a tool resolvida seria o próprio tools_run. Os testes do hook de falha: C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\hooks\ecosystem-hooks.test.ts (testes do tipo falha) e o describe 'hook script: falha through tools_run' de C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\hooks\hook-execucao.test.ts (world.json('tools.json', ...), world.run('ai-ecosystem','falha', {...}), world.readJson('falhas.json')).

ARQUIVOS
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\hooks\script\ai-ecosystem-hook.mjs` (só a função failure)
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\hooks\hook-execucao.test.ts` (só o describe da falha)
- Não tocar: qualquer outro arquivo

REGRAS DESTA ETAPA
1. Na dúvida, o comportamento atual (marcar) continua: só os dois filtros abaixo são novos.
2. Nenhum outro tipo de hook muda.

O QUE FAZER, NESTA ORDEM
1. Em failure(), logo depois de `if (parts.length < 3 || parts[0] !== "mcp") return allow();` e de calcular `let tool`, acrescente: `const message = typeof input.error === "string" ? input.error.trim() : ""; if (/^(Invalid arguments|Unknown tool)/.test(message)) return allow(); if (tool === "tools_run" && isObject(input.tool_input) && Array.isArray(input.tool_input.calls)) return allow();` (antes da troca de tool pelo id e da leitura de tools.json; coloque os dois filtros antes do restante).
2. Em hook-execucao.test.ts, no describe 'hook script: falha through tools_run', acrescente: (a) erro 'Invalid arguments: id is required.' em tool_name tools_run com id git_push NÃO grava falhas.json; (b) 'Unknown tool: x. Find the right id with tools_find.' idem; (c) tools_run com tool_input {calls:[{id:'git_push'}]} idem; (d) um erro qualquer ('Error: boom') continua marcando o módulo; (e) falha direta de outra tool com erro 'Invalid arguments: x' não marca.

O QUE NÃO FAZER
- Não altere outras funções do script.
- Não altere src fora do script.

CRITÉRIOS DE ACEITE
- Dado um PostToolUseFailure com error 'Invalid arguments: ...', Quando o hook roda, Então falhas.json não é criado nem alterado.
- Dado um tools_run com calls, Quando o hook de falha roda, Então não marca nenhum módulo.
- Dado um erro comum ('Error: boom'), Quando o hook roda, Então o módulo da tool continua marcado.

VERIFICAÇÃO (rode a partir de C:\Users\Trabalho\Documents\obsidian-ai-ecosystem e cole a saída real)
- node --check C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\hooks\script\ai-ecosystem-hook.mjs → sem saída (sucesso)
- npx vitest run tests/hooks → todos passam

Se qualquer coisa não bater com o descrito (arquivo, função ou assinatura inexistente, comportamento diferente do dito acima, teste quebrado por motivo alheio a esta etapa), PARE e relate em vez de improvisar.
RELATÓRIO FINAL: liste os arquivos alterados ou criados (caminho absoluto), cole a saída real de cada comando de verificação (não resuma) e descreva qualquer desvio ou dúvida.
```

## Etapa 27: Catálogo compara a versão do manifest, não a tag [Haiku 5.5 | esforço: baixo]

**Objetivo:** fazer o card do catálogo comparar a versão instalada com manifest.version do release, não com o nome da tag.
**Depende de:** Etapa 26 (Hook de falha ignora erro de argumento e lote)
**Paralelizável com:** nenhuma

**Arquivos**
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\catalog\installer-service.ts`
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\catalog\catalog-view.ts`
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\catalog\installer-service.test.ts`
- Não tocar: qualquer outro arquivo

**Regras de implementação**
1. O download continua usando a tag (latest.version).
2. Só a versão mostrada e comparada no catálogo passa a ser a do manifest.

**Passos**
1. installer-service.ts: exporte `export function latestVersionOf(release: LatestRelease | undefined): string | undefined { return release && "manifest" in release ? release.manifest.version : undefined; }`.
2. catalog-view.ts: importe latestVersionOf de './installer-service' (junto dos imports existentes dessa origem) e troque a linha de latestVersion por `const latestVersion = latestVersionOf(release);`. Confira que noRelease e o restante do renderCard continuam iguais.
3. tests/catalog/installer-service.test.ts: acrescente testes: latestVersionOf devolve manifest.version quando a tag é 'v1.2.0' e manifest.version '1.2.0'; devolve undefined para {error} e para undefined; e um teste de getState: instalado '1.2.0' com latest = latestVersionOf({version:'v1.2.0', manifest:{id:'x', version:'1.2.0'}}) resulta em kind 'active' (ou 'installed-disabled' conforme o cenário do teste vizinho) e NÃO 'update-available'.

**BDD (estado esperado ao concluir)**
- Dado um release com tag 'v1.2.0' e manifest.version '1.2.0', Quando o plugin instalado está na 1.2.0, Então o card não fica em 'atualização disponível'.
- Dado um release com manifest.version '1.3.0' e instalado '1.2.0', Quando calculo o estado, Então é 'update-available'.
- Dado um erro de release, Quando chamo latestVersionOf, Então devolve undefined.

**Verificação** (comandos a rodar, com o resultado esperado)
- npx tsc --noEmit → sem erros
- npx vitest run tests/catalog → todos passam
- npx eslint C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\catalog → 0 erros

**Prompt para o subagente**
```text
Você é um subagente de implementação em TypeScript. Objetivo desta etapa: fazer o card do catálogo comparar a versão instalada com manifest.version do release, não com o nome da tag.

CONTEXTO COMPLETO
Projeto: plugin do Obsidian chamado AI Ecosystem (núcleo da suíte de plugins de IA), escrito em TypeScript, com servidor MCP e REST local, executor de scripts, índice e descoberta de tools (tools_find, tools_describe, tools_run), hooks do Claude Code gravados nas settings do cofre, configuração guiada de módulos, telas (formulários) e um inspetor de requisições. Raiz do repositório (RAIZ): C:\Users\Trabalho\Documents\obsidian-ai-ecosystem. Testes com vitest (pasta tests), sem Obsidian real (há um mock em tests\mocks\obsidian.ts).
Objetivo geral da demanda: implementar 16 melhorias aceitas numa auditoria do núcleo, na ordem: (1) teto de saída do ecosystem_run_script; (2) ecosystem_status compacto; (3) script_id no executor; (4) lote no tools_run; (5) diagnóstico que percebe módulo defasado; (6) cancelamento do run_script; (7) remover a aprovação do tools_run e o código morto; (8) limitar o activity.sqlite; (9) setup_status, list_scripts e diagnóstico enxutos; (10) resumo dos módulos no início da sessão; (11) tela_gerenciar e setup oculto sem pendência; (12) setup_save em lote; (13) descrição curta do run_script; (14) falha do módulo só por exceção; (15) catálogo por manifest.version; (16) despachante único dos hooks de proteção.
Regras globais:
1. Idioma: o código, os comentários e os nomes de identificadores ficam em inglês (como já está nos arquivos); as mensagens do diagnóstico, do hook e dos achados ficam em português quando o arquivo já estiver em português; o README tem uma parte em inglês e uma em português espelhadas.
2. Estilo do código: TypeScript estrito, 2 espaços, aspas duplas, ponto e vírgula, `import type` para tipos, sem dependências novas e sem alterar package.json.
3. Os diretórios src/runner, src/server, src/registry, src/hooks, src/core, src/setup, src/tool-index são código Node puro: não importam o pacote "obsidian".
4. O script src/hooks/script/ai-ecosystem-hook.mjs é Node puro, sem dependências, e nunca pode atrapalhar o agente: qualquer problema termina com saída 0 e sem texto.
5. Comandos, sempre a partir de C:\Users\Trabalho\Documents\obsidian-ai-ecosystem: typecheck `npx tsc --noEmit`; testes `npx vitest run` (um arquivo: `npx vitest run tests\pasta\arquivo.test.ts`); lint `npx eslint .`; build `npm run build`.
6. Linha de base antes das mudanças: tsc sem erros; 54 arquivos de teste e 918 testes passando; eslint com 0 erros e 19 avisos (nenhum erro ou aviso novo pode surgir).
7. Cada etapa altera só os arquivos listados nela. Não faça commit, push, deploy nem mexa na pasta .git; não rode `npm install`; não escreva nem leia segredos, tokens ou arquivos .env.
8. Se algo não bater com o descrito (arquivo, função ou assinatura inexistente, teste quebrado por motivo alheio à etapa), pare e relate em vez de improvisar.

O QUE JÁ EXISTE E É RELEVANTE PARA ESTA ETAPA
Em C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\catalog\installer-service.ts o tipo `LatestRelease = { version: string; manifest: PluginManifestLike } | { error: string }` guarda em `version` o nome da TAG (usado para baixar os arquivos do release) e em `manifest.version` a versão declarada no manifest.json do release. InstallerService.getState(entry, latest?: string) compara `compareVersions(latest, installedVersion) > 0` para decidir 'update-available'. Em C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\catalog\catalog-view.ts, renderCard() faz `const latestVersion = release && "version" in release ? release.version : undefined;` (tag), então, se a tag diferir de manifest.version (ex.: 'v1.2.0' ou '1.2'), o card fica em 'atualização disponível' para sempre. Os testes ficam em C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\catalog\installer-service.test.ts (veja como criam o serviço com fetchJson de teste).

ARQUIVOS
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\catalog\installer-service.ts`
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\catalog\catalog-view.ts`
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\catalog\installer-service.test.ts`
- Não tocar: qualquer outro arquivo

REGRAS DESTA ETAPA
1. O download continua usando a tag (latest.version).
2. Só a versão mostrada e comparada no catálogo passa a ser a do manifest.

O QUE FAZER, NESTA ORDEM
1. installer-service.ts: exporte `export function latestVersionOf(release: LatestRelease | undefined): string | undefined { return release && "manifest" in release ? release.manifest.version : undefined; }`.
2. catalog-view.ts: importe latestVersionOf de './installer-service' (junto dos imports existentes dessa origem) e troque a linha de latestVersion por `const latestVersion = latestVersionOf(release);`. Confira que noRelease e o restante do renderCard continuam iguais.
3. tests/catalog/installer-service.test.ts: acrescente testes: latestVersionOf devolve manifest.version quando a tag é 'v1.2.0' e manifest.version '1.2.0'; devolve undefined para {error} e para undefined; e um teste de getState: instalado '1.2.0' com latest = latestVersionOf({version:'v1.2.0', manifest:{id:'x', version:'1.2.0'}}) resulta em kind 'active' (ou 'installed-disabled' conforme o cenário do teste vizinho) e NÃO 'update-available'.

O QUE NÃO FAZER
- Não mude a URL de download (usa a tag).
- Não altere catalog-service.ts.

CRITÉRIOS DE ACEITE
- Dado um release com tag 'v1.2.0' e manifest.version '1.2.0', Quando o plugin instalado está na 1.2.0, Então o card não fica em 'atualização disponível'.
- Dado um release com manifest.version '1.3.0' e instalado '1.2.0', Quando calculo o estado, Então é 'update-available'.
- Dado um erro de release, Quando chamo latestVersionOf, Então devolve undefined.

VERIFICAÇÃO (rode a partir de C:\Users\Trabalho\Documents\obsidian-ai-ecosystem e cole a saída real)
- npx tsc --noEmit → sem erros
- npx vitest run tests/catalog → todos passam
- npx eslint C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\catalog → 0 erros

Se qualquer coisa não bater com o descrito (arquivo, função ou assinatura inexistente, comportamento diferente do dito acima, teste quebrado por motivo alheio a esta etapa), PARE e relate em vez de improvisar.
RELATÓRIO FINAL: liste os arquivos alterados ou criados (caminho absoluto), cole a saída real de cada comando de verificação (não resuma) e descreva qualquer desvio ou dúvida.
```

## Etapa 28: Refatorar a proteção do script em avaliar e aplicar [Haiku 5.5 | esforço: alto]

**Objetivo:** separar a função protect do script em evaluateProtection (decide sem sair do processo) e block (aplica trava e nega), sem mudar nenhum comportamento.
**Depende de:** Etapa 27 (Catálogo compara a versão do manifest, não a tag)
**Paralelizável com:** nenhuma

**Arquivos**
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\hooks\script\ai-ecosystem-hook.mjs` (só a função protect)
- Não tocar: qualquer outro arquivo

**Regras de implementação**
1. Nenhuma mudança observável: mesmas saídas, mesmos efeitos em arquivos (falhas.json, bloqueios.json), mesma ordem de verificações.
2. evaluateProtection nunca chama process.exit, allow(), respond() nem escreve arquivos.
3. Todas as saídas 'allow' viram o mesmo objeto de decisão {kind:'allow'}.

**Passos**
1. Crie `function evaluateProtection(stateDir, moduleId, input)` com TODO o corpo atual de protect até (e incluindo) a chamada de matchRule e a decisão por modo, trocando cada `return allow();` por `return { kind: "allow" };`, o ramo 'avisar' por `return { kind: "remind", message };` e o ramo 'bloquear' por `return { kind: "block", message };` (o ramo 'bloquear' é o que vem depois do modo avisar; ele não aplica trava aqui).
2. Crie `function block(stateDir, input, message)` com o que resta do protect no ramo bloquear: `const toolName = typeof input.tool_name === "string" ? input.tool_name : ""; const toolInput = isObject(input.tool_input) ? input.tool_input : {};`, a checagem de `isCorrupt(stateDir, "bloqueios.json")` (reescreve {} e `return allow();`), a de `repeatedThreeTimes(...)` (`return respond(remind("Liberado pela trava de repetição ..."))` com o texto idêntico ao atual) e a resposta deny final.
3. Reescreva `function protect(stateDir, moduleId, input)` como: `const decision = evaluateProtection(stateDir, moduleId, input); if (decision.kind === "allow") return allow(); if (decision.kind === "remind") return respond(remind(decision.message)); return block(stateDir, input, decision.message);`.
4. Confira que toolName e toolInput continuam sendo calculados em evaluateProtection para o matchRule (podem ser calculados nos dois lugares).
5. Rode `node --check` no script e a suíte de hooks inteira; ela tem de passar SEM nenhuma alteração de teste.

**BDD (estado esperado ao concluir)**
- Dado a suíte de testes de hooks, Quando a rodo depois da refatoração, Então todos os testes passam sem nenhuma alteração em tests.
- Dado um comando que viola a regra no modo bloquear, Quando o hook protecao roda, Então a saída é a mesma negação de antes e a 3ª tentativa idêntica em 10 minutos libera com o lembrete.
- Dado o modo avisar, Quando a regra casa, Então a saída é o mesmo additionalContext de antes.

**Verificação** (comandos a rodar, com o resultado esperado)
- node --check C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\hooks\script\ai-ecosystem-hook.mjs → sem saída (sucesso)
- npx vitest run tests/hooks → todos passam sem alterar tests

**Prompt para o subagente**
```text
Você é um subagente de implementação em TypeScript. Objetivo desta etapa: separar a função protect do script em evaluateProtection (decide sem sair do processo) e block (aplica trava e nega), sem mudar nenhum comportamento.

CONTEXTO COMPLETO
Projeto: plugin do Obsidian chamado AI Ecosystem (núcleo da suíte de plugins de IA), escrito em TypeScript, com servidor MCP e REST local, executor de scripts, índice e descoberta de tools (tools_find, tools_describe, tools_run), hooks do Claude Code gravados nas settings do cofre, configuração guiada de módulos, telas (formulários) e um inspetor de requisições. Raiz do repositório (RAIZ): C:\Users\Trabalho\Documents\obsidian-ai-ecosystem. Testes com vitest (pasta tests), sem Obsidian real (há um mock em tests\mocks\obsidian.ts).
Objetivo geral da demanda: implementar 16 melhorias aceitas numa auditoria do núcleo, na ordem: (1) teto de saída do ecosystem_run_script; (2) ecosystem_status compacto; (3) script_id no executor; (4) lote no tools_run; (5) diagnóstico que percebe módulo defasado; (6) cancelamento do run_script; (7) remover a aprovação do tools_run e o código morto; (8) limitar o activity.sqlite; (9) setup_status, list_scripts e diagnóstico enxutos; (10) resumo dos módulos no início da sessão; (11) tela_gerenciar e setup oculto sem pendência; (12) setup_save em lote; (13) descrição curta do run_script; (14) falha do módulo só por exceção; (15) catálogo por manifest.version; (16) despachante único dos hooks de proteção.
Regras globais:
1. Idioma: o código, os comentários e os nomes de identificadores ficam em inglês (como já está nos arquivos); as mensagens do diagnóstico, do hook e dos achados ficam em português quando o arquivo já estiver em português; o README tem uma parte em inglês e uma em português espelhadas.
2. Estilo do código: TypeScript estrito, 2 espaços, aspas duplas, ponto e vírgula, `import type` para tipos, sem dependências novas e sem alterar package.json.
3. Os diretórios src/runner, src/server, src/registry, src/hooks, src/core, src/setup, src/tool-index são código Node puro: não importam o pacote "obsidian".
4. O script src/hooks/script/ai-ecosystem-hook.mjs é Node puro, sem dependências, e nunca pode atrapalhar o agente: qualquer problema termina com saída 0 e sem texto.
5. Comandos, sempre a partir de C:\Users\Trabalho\Documents\obsidian-ai-ecosystem: typecheck `npx tsc --noEmit`; testes `npx vitest run` (um arquivo: `npx vitest run tests\pasta\arquivo.test.ts`); lint `npx eslint .`; build `npm run build`.
6. Linha de base antes das mudanças: tsc sem erros; 54 arquivos de teste e 918 testes passando; eslint com 0 erros e 19 avisos (nenhum erro ou aviso novo pode surgir).
7. Cada etapa altera só os arquivos listados nela. Não faça commit, push, deploy nem mexa na pasta .git; não rode `npm install`; não escreva nem leia segredos, tokens ou arquivos .env.
8. Se algo não bater com o descrito (arquivo, função ou assinatura inexistente, teste quebrado por motivo alheio à etapa), pare e relate em vez de improvisar.

O QUE JÁ EXISTE E É RELEVANTE PARA ESTA ETAPA
O script C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\hooks\script\ai-ecosystem-hook.mjs trata o tipo 'protecao' (PreToolUse) na função `protect(stateDir, moduleId, input)`: confere coreIsAlive, o estado do módulo ('configurado'), falhas.json (TTL de 10 minutos), config.json (modo via resolveMode; 'off' sai), monta o ambiente `env` e chama `matchRule(moduleId, toolName, toolInput, env)` que devolve a mensagem da regra ou undefined; no modo 'avisar' responde `respond(remind(message))`; no modo 'bloquear' confere bloqueios.json corrompido (reescreve {} e deixa passar), a trava de repetição `repeatedThreeTimes(stateDir, toolName, toolInput)` (3ª tentativa idêntica em 10 minutos libera com um lembrete) e senão `respond({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: message } })`. As funções allow(), respond(), remind(context), isCorrupt(stateDir, rel), readJson, writeJson, coreIsAlive, resolveMode(config, moduleId) e matchRule já existem no arquivo. Cada hook roda como um processo Node por comando; a meta final (próximas etapas) é um despachante único. Esta etapa prepara o terreno SEM mudar comportamento. Os testes de protecao estão em C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\hooks (hook-script.test.ts, ecosystem-hooks.test.ts, hook-execucao.test.ts) e cobrem os modos, a trava, a corrupção de arquivos e as mensagens.

ARQUIVOS
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\hooks\script\ai-ecosystem-hook.mjs` (só a função protect)
- Não tocar: qualquer outro arquivo

REGRAS DESTA ETAPA
1. Nenhuma mudança observável: mesmas saídas, mesmos efeitos em arquivos (falhas.json, bloqueios.json), mesma ordem de verificações.
2. evaluateProtection nunca chama process.exit, allow(), respond() nem escreve arquivos.
3. Todas as saídas 'allow' viram o mesmo objeto de decisão {kind:'allow'}.

O QUE FAZER, NESTA ORDEM
1. Crie `function evaluateProtection(stateDir, moduleId, input)` com TODO o corpo atual de protect até (e incluindo) a chamada de matchRule e a decisão por modo, trocando cada `return allow();` por `return { kind: "allow" };`, o ramo 'avisar' por `return { kind: "remind", message };` e o ramo 'bloquear' por `return { kind: "block", message };` (o ramo 'bloquear' é o que vem depois do modo avisar; ele não aplica trava aqui).
2. Crie `function block(stateDir, input, message)` com o que resta do protect no ramo bloquear: `const toolName = typeof input.tool_name === "string" ? input.tool_name : ""; const toolInput = isObject(input.tool_input) ? input.tool_input : {};`, a checagem de `isCorrupt(stateDir, "bloqueios.json")` (reescreve {} e `return allow();`), a de `repeatedThreeTimes(...)` (`return respond(remind("Liberado pela trava de repetição ..."))` com o texto idêntico ao atual) e a resposta deny final.
3. Reescreva `function protect(stateDir, moduleId, input)` como: `const decision = evaluateProtection(stateDir, moduleId, input); if (decision.kind === "allow") return allow(); if (decision.kind === "remind") return respond(remind(decision.message)); return block(stateDir, input, decision.message);`.
4. Confira que toolName e toolInput continuam sendo calculados em evaluateProtection para o matchRule (podem ser calculados nos dois lugares).
5. Rode `node --check` no script e a suíte de hooks inteira; ela tem de passar SEM nenhuma alteração de teste.

O QUE NÃO FAZER
- Não crie o despachante ainda (próxima etapa).
- Não altere src fora do script nem tests.

CRITÉRIOS DE ACEITE
- Dado a suíte de testes de hooks, Quando a rodo depois da refatoração, Então todos os testes passam sem nenhuma alteração em tests.
- Dado um comando que viola a regra no modo bloquear, Quando o hook protecao roda, Então a saída é a mesma negação de antes e a 3ª tentativa idêntica em 10 minutos libera com o lembrete.
- Dado o modo avisar, Quando a regra casa, Então a saída é o mesmo additionalContext de antes.

VERIFICAÇÃO (rode a partir de C:\Users\Trabalho\Documents\obsidian-ai-ecosystem e cole a saída real)
- node --check C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\hooks\script\ai-ecosystem-hook.mjs → sem saída (sucesso)
- npx vitest run tests/hooks → todos passam sem alterar tests

Se qualquer coisa não bater com o descrito (arquivo, função ou assinatura inexistente, comportamento diferente do dito acima, teste quebrado por motivo alheio a esta etapa), PARE e relate em vez de improvisar.
RELATÓRIO FINAL: liste os arquivos alterados ou criados (caminho absoluto), cole a saída real de cada comando de verificação (não resuma) e descreva qualquer desvio ou dúvida.
```

## Etapa 29: Tipo despacho no script e DISPATCH_SPEC [Haiku 5.5 | esforço: alto]

**Objetivo:** criar o tipo de hook 'despacho', que roda as proteções de todos os módulos num único processo, e a especificação DISPATCH_SPEC.
**Depende de:** Etapa 28 (Refatorar a proteção do script em avaliar e aplicar)
**Paralelizável com:** nenhuma

**Arquivos**
- Criar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\hooks\hook-despacho.test.ts`
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\hooks\hook-specs.ts`
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\hooks\script\ai-ecosystem-hook.mjs`
- Não tocar: qualquer outro arquivo

**Regras de implementação**
1. Cada módulo é avaliado exatamente como no hook individual (mesma função evaluateProtection); o despachante só combina as decisões.
2. Combinação: o primeiro 'block' (na ordem fixa dos módulos) vence e passa por block() uma única vez (uma só contagem da trava de repetição); sem block, os lembretes ('remind') de todos os módulos que casaram são juntados com uma quebra de linha num único additionalContext; sem nada, allow().
3. O módulo cujo estado tem hooksRemovidos === true é ignorado pelo despachante.
4. Os hooks individuais (tipo protecao) continuam funcionando exatamente como antes (entradas antigas das settings).

**Passos**
1. hook-specs.ts: acrescente 'despacho' a HookType e ao COMMAND_PATTERN. Depois de PROTECTION_SPECS crie `export const DISPATCH_MATCHER = Array.from(new Set(Object.values(PROTECTION_SPECS).flatMap((spec) => (spec.matcher ?? "").split("|")))).join("|");` (resultado esperado 'Grep|Glob|Bash|PowerShell|Write') e `export const DISPATCH_SPEC: HookSpec = { module: ECOSYSTEM_ID, type: "despacho", event: "PreToolUse", matcher: DISPATCH_MATCHER };` com comentário (one entry that runs the protection of every module in a single process). NÃO inclua DISPATCH_SPEC em CORE_SPECS.
2. Script: acrescente a tabela `const PROTECTION_MODULES = [["ai-vault-search", "Grep|Glob|Bash|PowerShell"], ["environment-variables", "Bash|PowerShell"], ["ai-scripts", "Bash|PowerShell"], ["ai-templates", "Write"], ["ai-git-tools", "Bash|PowerShell"]];` com o comentário 'same table as PROTECTION_SPECS in hook-specs.ts (a test keeps them in sync)'.
3. Script: acrescente em main() a linha `if (type === "despacho") return dispatch(stateDir, input);` e a função: `function dispatch(stateDir, input) { if (!coreIsAlive(stateDir)) return allow(); const toolName = typeof input.tool_name === "string" ? input.tool_name : ""; const reminders = []; let blocked; for (const [id, matcher] of PROTECTION_MODULES) { if (!new RegExp("^(?:" + matcher + ")$").test(toolName)) continue; const state = readJson(stateDir, "modules/" + id + ".json"); if (isObject(state) && state.hooksRemovidos === true) continue; const decision = evaluateProtection(stateDir, id, input); if (decision.kind === "remind") reminders.push(decision.message); else if (decision.kind === "block" && blocked === undefined) blocked = decision.message; } if (blocked !== undefined) return block(stateDir, input, blocked); if (reminders.length > 0) return respond(remind(reminders.join("\n"))); allow(); }` (formate no estilo do arquivo). Atualize o comentário do cabeçalho com o tipo despacho.
4. Crie C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\hooks\hook-despacho.test.ts: (a) spec: DISPATCH_MATCHER é 'Grep|Glob|Bash|PowerShell|Write', DISPATCH_SPEC.type 'despacho', parseCommand(buildCommand('/v','ai-ecosystem','despacho')) devolve { module: 'ai-ecosystem', type: 'despacho' }, CORE_SPECS não contém o despacho, e HOOK_SCRIPT_SOURCE (de ../../src/hooks/hook-script) contém, para cada id de protectionModuleIds() com o matcher de protectionSpec(id), o texto `["<id>", "<matcher>"]` (garante a tabela em sincronia); (b) paridade: para cada cenário (ai-vault-search com Grep no cofre; environment-variables com curl para host com secret; ai-scripts com python numa pasta de scripts; ai-templates com Write numa pasta de molde; ai-git-tools com git status) monte o mundo como nos testes existentes dessas regras (veja C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\hooks\hook-script.test.ts e hook-execucao.test.ts para os dados de cada módulo), rode `world.tool(<id>, ...)` (hook individual) e o despachante (`world.run('ai-ecosystem', 'despacho', { hook_event_name: 'PreToolUse', tool_name, tool_input })`) e compare decision e reason/context; (c) dois módulos casando no mesmo Bash (ex. ai-scripts negando e ai-git-tools avisando): a negação vence; (d) dois módulos só avisando: um additionalContext com as duas mensagens separadas por quebra de linha; (e) módulo com hooksRemovidos true (escreva o campo no modules/<id>.json via world.json) é ignorado; (f) módulo pendente é ignorado; (g) tool que nenhum matcher cobre (Read) → sem saída; (h) sem heartbeat → sem saída; (i) trava de repetição conta uma vez por tentativa: três chamadas idênticas negadas pelo despachante liberam na 3ª com o lembrete 'Liberado pela trava de repetição'; (j) entrada que não é JSON → status 0 sem saída.

**BDD (estado esperado ao concluir)**
- Dado ai-scripts negando e ai-git-tools avisando para o mesmo Bash, Quando o despachante roda, Então a saída é a negação do ai-scripts.
- Dado dois módulos apenas avisando, Quando o despachante roda, Então há um único additionalContext com as duas mensagens.
- Dado um módulo com hooksRemovidos true, Quando o despachante roda, Então a regra dele não é aplicada.
- Dado cada módulo sozinho, Quando comparo o hook individual com o despachante, Então a decisão e o texto são iguais.
- Dado a suíte antiga de hooks, Quando a rodo, Então continua toda passando.

**Verificação** (comandos a rodar, com o resultado esperado)
- node --check C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\hooks\script\ai-ecosystem-hook.mjs → sem saída (sucesso)
- npx vitest run tests/hooks → todos passam
- npx tsc --noEmit → sem erros

**Prompt para o subagente**
```text
Você é um subagente de implementação em TypeScript. Objetivo desta etapa: criar o tipo de hook 'despacho', que roda as proteções de todos os módulos num único processo, e a especificação DISPATCH_SPEC.

CONTEXTO COMPLETO
Projeto: plugin do Obsidian chamado AI Ecosystem (núcleo da suíte de plugins de IA), escrito em TypeScript, com servidor MCP e REST local, executor de scripts, índice e descoberta de tools (tools_find, tools_describe, tools_run), hooks do Claude Code gravados nas settings do cofre, configuração guiada de módulos, telas (formulários) e um inspetor de requisições. Raiz do repositório (RAIZ): C:\Users\Trabalho\Documents\obsidian-ai-ecosystem. Testes com vitest (pasta tests), sem Obsidian real (há um mock em tests\mocks\obsidian.ts).
Objetivo geral da demanda: implementar 16 melhorias aceitas numa auditoria do núcleo, na ordem: (1) teto de saída do ecosystem_run_script; (2) ecosystem_status compacto; (3) script_id no executor; (4) lote no tools_run; (5) diagnóstico que percebe módulo defasado; (6) cancelamento do run_script; (7) remover a aprovação do tools_run e o código morto; (8) limitar o activity.sqlite; (9) setup_status, list_scripts e diagnóstico enxutos; (10) resumo dos módulos no início da sessão; (11) tela_gerenciar e setup oculto sem pendência; (12) setup_save em lote; (13) descrição curta do run_script; (14) falha do módulo só por exceção; (15) catálogo por manifest.version; (16) despachante único dos hooks de proteção.
Regras globais:
1. Idioma: o código, os comentários e os nomes de identificadores ficam em inglês (como já está nos arquivos); as mensagens do diagnóstico, do hook e dos achados ficam em português quando o arquivo já estiver em português; o README tem uma parte em inglês e uma em português espelhadas.
2. Estilo do código: TypeScript estrito, 2 espaços, aspas duplas, ponto e vírgula, `import type` para tipos, sem dependências novas e sem alterar package.json.
3. Os diretórios src/runner, src/server, src/registry, src/hooks, src/core, src/setup, src/tool-index são código Node puro: não importam o pacote "obsidian".
4. O script src/hooks/script/ai-ecosystem-hook.mjs é Node puro, sem dependências, e nunca pode atrapalhar o agente: qualquer problema termina com saída 0 e sem texto.
5. Comandos, sempre a partir de C:\Users\Trabalho\Documents\obsidian-ai-ecosystem: typecheck `npx tsc --noEmit`; testes `npx vitest run` (um arquivo: `npx vitest run tests\pasta\arquivo.test.ts`); lint `npx eslint .`; build `npm run build`.
6. Linha de base antes das mudanças: tsc sem erros; 54 arquivos de teste e 918 testes passando; eslint com 0 erros e 19 avisos (nenhum erro ou aviso novo pode surgir).
7. Cada etapa altera só os arquivos listados nela. Não faça commit, push, deploy nem mexa na pasta .git; não rode `npm install`; não escreva nem leia segredos, tokens ou arquivos .env.
8. Se algo não bater com o descrito (arquivo, função ou assinatura inexistente, teste quebrado por motivo alheio à etapa), pare e relate em vez de improvisar.

O QUE JÁ EXISTE E É RELEVANTE PARA ESTA ETAPA
A etapa anterior separou, em C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\hooks\script\ai-ecosystem-hook.mjs, `evaluateProtection(stateDir, moduleId, input)` (devolve {kind:'allow'} | {kind:'remind', message} | {kind:'block', message}, sem sair do processo) e `block(stateDir, input, message)` (aplica a trava de repetição e responde a negação ou o lembrete de liberação); `protect` usa as duas. Hoje cada módulo instala a própria entrada de hook PreToolUse (cada uma = um processo Node por comando de shell, 52 a 82 ms cada; 4 de proteção por Bash). Em C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\hooks\hook-specs.ts: HookType = 'protecao' | 'setup' | 'falha' | 'aprovacao' | 'execucao' | 'resumo'; `PROTECTION_SPECS` (privado) mapeia módulo → {event, matcher}: ai-vault-search 'Grep|Glob|Bash|PowerShell', environment-variables 'Bash|PowerShell', ai-scripts 'Bash|PowerShell', ai-templates 'Write', ai-git-tools 'Bash|PowerShell'; protectionModuleIds() lista as chaves; COMMAND_PATTERN reconhece os tipos; HookSpec = { module, type, event, matcher? }; ECOSYSTEM_ID = 'ai-ecosystem'. O estado de cada módulo vive em <estado>/modules/<id>.json (`estado` 'configurado' | 'pendente_configuracao' | 'desativado', `hooksRemovidos?: true` quando o usuário removeu os hooks do módulo). O despachante será UMA entrada com comando `node <script> ai-ecosystem despacho`. Testes de hooks usam C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\hooks\helpers.ts (HookWorld: module(id, estado), json(rel, valor), pastas(...), hosts([...]), config(...), run(modulo, tipo, entrada, env), tool(modulo, nomeDaTool, toolInput, extra, env), heartbeat(null)).

ARQUIVOS
- Criar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\hooks\hook-despacho.test.ts`
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\hooks\hook-specs.ts`
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\hooks\script\ai-ecosystem-hook.mjs`
- Não tocar: qualquer outro arquivo

REGRAS DESTA ETAPA
1. Cada módulo é avaliado exatamente como no hook individual (mesma função evaluateProtection); o despachante só combina as decisões.
2. Combinação: o primeiro 'block' (na ordem fixa dos módulos) vence e passa por block() uma única vez (uma só contagem da trava de repetição); sem block, os lembretes ('remind') de todos os módulos que casaram são juntados com uma quebra de linha num único additionalContext; sem nada, allow().
3. O módulo cujo estado tem hooksRemovidos === true é ignorado pelo despachante.
4. Os hooks individuais (tipo protecao) continuam funcionando exatamente como antes (entradas antigas das settings).

O QUE FAZER, NESTA ORDEM
1. hook-specs.ts: acrescente 'despacho' a HookType e ao COMMAND_PATTERN. Depois de PROTECTION_SPECS crie `export const DISPATCH_MATCHER = Array.from(new Set(Object.values(PROTECTION_SPECS).flatMap((spec) => (spec.matcher ?? "").split("|")))).join("|");` (resultado esperado 'Grep|Glob|Bash|PowerShell|Write') e `export const DISPATCH_SPEC: HookSpec = { module: ECOSYSTEM_ID, type: "despacho", event: "PreToolUse", matcher: DISPATCH_MATCHER };` com comentário (one entry that runs the protection of every module in a single process). NÃO inclua DISPATCH_SPEC em CORE_SPECS.
2. Script: acrescente a tabela `const PROTECTION_MODULES = [["ai-vault-search", "Grep|Glob|Bash|PowerShell"], ["environment-variables", "Bash|PowerShell"], ["ai-scripts", "Bash|PowerShell"], ["ai-templates", "Write"], ["ai-git-tools", "Bash|PowerShell"]];` com o comentário 'same table as PROTECTION_SPECS in hook-specs.ts (a test keeps them in sync)'.
3. Script: acrescente em main() a linha `if (type === "despacho") return dispatch(stateDir, input);` e a função: `function dispatch(stateDir, input) { if (!coreIsAlive(stateDir)) return allow(); const toolName = typeof input.tool_name === "string" ? input.tool_name : ""; const reminders = []; let blocked; for (const [id, matcher] of PROTECTION_MODULES) { if (!new RegExp("^(?:" + matcher + ")$").test(toolName)) continue; const state = readJson(stateDir, "modules/" + id + ".json"); if (isObject(state) && state.hooksRemovidos === true) continue; const decision = evaluateProtection(stateDir, id, input); if (decision.kind === "remind") reminders.push(decision.message); else if (decision.kind === "block" && blocked === undefined) blocked = decision.message; } if (blocked !== undefined) return block(stateDir, input, blocked); if (reminders.length > 0) return respond(remind(reminders.join("\n"))); allow(); }` (formate no estilo do arquivo). Atualize o comentário do cabeçalho com o tipo despacho.
4. Crie C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\hooks\hook-despacho.test.ts: (a) spec: DISPATCH_MATCHER é 'Grep|Glob|Bash|PowerShell|Write', DISPATCH_SPEC.type 'despacho', parseCommand(buildCommand('/v','ai-ecosystem','despacho')) devolve { module: 'ai-ecosystem', type: 'despacho' }, CORE_SPECS não contém o despacho, e HOOK_SCRIPT_SOURCE (de ../../src/hooks/hook-script) contém, para cada id de protectionModuleIds() com o matcher de protectionSpec(id), o texto `["<id>", "<matcher>"]` (garante a tabela em sincronia); (b) paridade: para cada cenário (ai-vault-search com Grep no cofre; environment-variables com curl para host com secret; ai-scripts com python numa pasta de scripts; ai-templates com Write numa pasta de molde; ai-git-tools com git status) monte o mundo como nos testes existentes dessas regras (veja C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\hooks\hook-script.test.ts e hook-execucao.test.ts para os dados de cada módulo), rode `world.tool(<id>, ...)` (hook individual) e o despachante (`world.run('ai-ecosystem', 'despacho', { hook_event_name: 'PreToolUse', tool_name, tool_input })`) e compare decision e reason/context; (c) dois módulos casando no mesmo Bash (ex. ai-scripts negando e ai-git-tools avisando): a negação vence; (d) dois módulos só avisando: um additionalContext com as duas mensagens separadas por quebra de linha; (e) módulo com hooksRemovidos true (escreva o campo no modules/<id>.json via world.json) é ignorado; (f) módulo pendente é ignorado; (g) tool que nenhum matcher cobre (Read) → sem saída; (h) sem heartbeat → sem saída; (i) trava de repetição conta uma vez por tentativa: três chamadas idênticas negadas pelo despachante liberam na 3ª com o lembrete 'Liberado pela trava de repetição'; (j) entrada que não é JSON → status 0 sem saída.

O QUE NÃO FAZER
- Não altere hook-manager.ts (próxima etapa).
- Não inclua DISPATCH_SPEC em CORE_SPECS.

CRITÉRIOS DE ACEITE
- Dado ai-scripts negando e ai-git-tools avisando para o mesmo Bash, Quando o despachante roda, Então a saída é a negação do ai-scripts.
- Dado dois módulos apenas avisando, Quando o despachante roda, Então há um único additionalContext com as duas mensagens.
- Dado um módulo com hooksRemovidos true, Quando o despachante roda, Então a regra dele não é aplicada.
- Dado cada módulo sozinho, Quando comparo o hook individual com o despachante, Então a decisão e o texto são iguais.
- Dado a suíte antiga de hooks, Quando a rodo, Então continua toda passando.

VERIFICAÇÃO (rode a partir de C:\Users\Trabalho\Documents\obsidian-ai-ecosystem e cole a saída real)
- node --check C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\hooks\script\ai-ecosystem-hook.mjs → sem saída (sucesso)
- npx vitest run tests/hooks → todos passam
- npx tsc --noEmit → sem erros

Se qualquer coisa não bater com o descrito (arquivo, função ou assinatura inexistente, comportamento diferente do dito acima, teste quebrado por motivo alheio a esta etapa), PARE e relate em vez de improvisar.
RELATÓRIO FINAL: liste os arquivos alterados ou criados (caminho absoluto), cole a saída real de cada comando de verificação (não resuma) e descreva qualquer desvio ou dúvida.
```

## Etapa 30: Hook manager instala o despachante único e migra as entradas antigas [Haiku 5.5 | esforço: alto]

**Objetivo:** fazer o HookManager instalar uma única entrada 'despacho' em vez de uma entrada por módulo, migrar as entradas antigas na partida e manter o status por módulo.
**Depende de:** Etapa 29 (Tipo despacho no script e DISPATCH_SPEC)
**Paralelizável com:** nenhuma

**Arquivos**
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\hooks\hook-manager.ts`
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\hooks\hook-specs.ts` (só se precisar exportar um helper)
- Não tocar: qualquer outro arquivo

**Regras de implementação**
1. A semântica por módulo para a interface e o diagnóstico NÃO muda: HookModuleRow.installed continua dizendo se o módulo está protegido (agora derivado do despachante).
2. Um módulo conta como protegido pelo despachante quando: existe a entrada despacho (module 'ai-ecosystem', type 'despacho') em alguma das settings, o módulo tem protectionSpec, seu estado é 'configurado' e não tem hooksRemovidos.
3. A migração só roda com Node disponível (dentro do mesmo bloco de installCore) e nunca apaga entradas que não sejam do tipo 'protecao' de módulos com proteção.
4. Entradas antigas por módulo e o despachante nunca podem coexistir depois de uma instalação ou migração (para não rodar a proteção duas vezes).

**Passos**
1. installProtection: mantenha a conferência de Node, o ensure, a lógica de hooksRemovidos e o modo padrão; troque a escrita por: `const file = this.state.getSettingsFile(); const dispatcher = this.merger.install(file, [DISPATCH_SPEC]); if (!dispatcher.ok) return this.record(dispatcher); const legacy = this.removeLegacyProtection(moduleId); if (!legacy.ok) return this.record(legacy); const result = this.record({ ok: true, changed: dispatcher.changed || legacy.changed });` e siga como hoje (onChange e retorno). Crie `private removeLegacyProtection(moduleId: string): HookActionResult` que, para cada arquivo de SETTINGS_FILES, faz `this.merger.remove(file, { module: moduleId, type: "protecao" })` e devolve {ok:false,error} no primeiro erro ou {ok:true, changed} somando os changed.
2. Crie `private dispatcherNeeded(): boolean`: verdadeiro quando algum id de protectionModuleIds() tem `this.states.get(id)` com estado 'configurado' e sem hooksRemovidos. Crie `private dropDispatcherIfUnused(): void` que, se !dispatcherNeeded(), remove em ambas as settings `{ module: ECOSYSTEM_ID, type: "despacho" }` (erro só registrado com this.record quando !ok).
3. removeModule(moduleId): continue removendo as entradas do módulo; ao final (antes de onChange) chame `this.dropDispatcherIfUnused()`. removeByUser(moduleId): chame removeModule, depois setHooksRemovidos(moduleId, true) (como hoje) e depois `this.dropDispatcherIfUnused()` (o estado precisa estar atualizado antes).
4. Migração em installCore(): dentro do try, depois da instalação do CORE_SPECS e da remoção da 'execucao', chame `this.migrateLegacyProtection();`: para cada arquivo de SETTINGS_FILES, liste as entradas (`this.merger.list(file)`; se !ok ignore); as legadas são as com `e.type === "protecao" && protectionSpec(e.module) !== undefined`; se houver alguma, `this.merger.install(file, [DISPATCH_SPEC])` e depois, para cada módulo legado distinto, `this.merger.remove(file, { module, type: "protecao" })`; erros só vão para this.record quando !ok.
5. getStatus(): depois de montar `entries`, calcule `const dispatch = entries.find((e) => e.module === ECOSYSTEM_ID && e.type === "despacho");` e em cada linha: `installed` = entradas legadas do módulo (como hoje) mais, se `dispatch && protectionSpec(id) && stored?.estado === "configurado" && !stored.hooksRemovidos`, uma entrada sintética `{ module: id, type: "protecao", event: dispatch.event, matcher: dispatch.matcher, command: dispatch.command }` (sem duplicar se já houver uma legada de protecao).
6. planInstall(moduleId): `entries` passa a ser `protectionSpec(moduleId) ? [DISPATCH_SPEC] : []` mapeado como hoje (`buildCommand(this.state.vaultPath, spec.module, spec.type)`). Ajuste os imports (DISPATCH_SPEC de './hook-specs').
7. Rode `npx tsc --noEmit`. Não ajuste testes (próxima etapa): relate a lista dos testes de tests/hooks e tests/setup que passaram a falhar e por quê.

**BDD (estado esperado ao concluir)**
- Dado dois módulos com proteção configurados, Quando o núcleo instala as proteções, Então as settings têm UMA entrada PreToolUse do tipo despacho e nenhuma entrada 'protecao' por módulo.
- Dado settings antigas com entradas 'protecao' por módulo, Quando o núcleo inicia, Então elas são trocadas pela entrada única despacho e as entradas do usuário permanecem.
- Dado o botão 'Remover hooks' de um módulo, Quando o usuário o usa, Então o módulo fica com hooksRemovidos e, se for o último, a entrada despacho some.
- Dado o despachante instalado e um módulo configurado, Quando leio getStatus(), Então a linha do módulo tem installed com uma entrada do tipo protecao.

**Verificação** (comandos a rodar, com o resultado esperado)
- npx tsc --noEmit → sem erros
- npx vitest run tests/hooks tests/setup → relatar as falhas esperadas (serão tratadas na próxima etapa)

**Prompt para o subagente**
```text
Você é um subagente de implementação em TypeScript. Objetivo desta etapa: fazer o HookManager instalar uma única entrada 'despacho' em vez de uma entrada por módulo, migrar as entradas antigas na partida e manter o status por módulo.

CONTEXTO COMPLETO
Projeto: plugin do Obsidian chamado AI Ecosystem (núcleo da suíte de plugins de IA), escrito em TypeScript, com servidor MCP e REST local, executor de scripts, índice e descoberta de tools (tools_find, tools_describe, tools_run), hooks do Claude Code gravados nas settings do cofre, configuração guiada de módulos, telas (formulários) e um inspetor de requisições. Raiz do repositório (RAIZ): C:\Users\Trabalho\Documents\obsidian-ai-ecosystem. Testes com vitest (pasta tests), sem Obsidian real (há um mock em tests\mocks\obsidian.ts).
Objetivo geral da demanda: implementar 16 melhorias aceitas numa auditoria do núcleo, na ordem: (1) teto de saída do ecosystem_run_script; (2) ecosystem_status compacto; (3) script_id no executor; (4) lote no tools_run; (5) diagnóstico que percebe módulo defasado; (6) cancelamento do run_script; (7) remover a aprovação do tools_run e o código morto; (8) limitar o activity.sqlite; (9) setup_status, list_scripts e diagnóstico enxutos; (10) resumo dos módulos no início da sessão; (11) tela_gerenciar e setup oculto sem pendência; (12) setup_save em lote; (13) descrição curta do run_script; (14) falha do módulo só por exceção; (15) catálogo por manifest.version; (16) despachante único dos hooks de proteção.
Regras globais:
1. Idioma: o código, os comentários e os nomes de identificadores ficam em inglês (como já está nos arquivos); as mensagens do diagnóstico, do hook e dos achados ficam em português quando o arquivo já estiver em português; o README tem uma parte em inglês e uma em português espelhadas.
2. Estilo do código: TypeScript estrito, 2 espaços, aspas duplas, ponto e vírgula, `import type` para tipos, sem dependências novas e sem alterar package.json.
3. Os diretórios src/runner, src/server, src/registry, src/hooks, src/core, src/setup, src/tool-index são código Node puro: não importam o pacote "obsidian".
4. O script src/hooks/script/ai-ecosystem-hook.mjs é Node puro, sem dependências, e nunca pode atrapalhar o agente: qualquer problema termina com saída 0 e sem texto.
5. Comandos, sempre a partir de C:\Users\Trabalho\Documents\obsidian-ai-ecosystem: typecheck `npx tsc --noEmit`; testes `npx vitest run` (um arquivo: `npx vitest run tests\pasta\arquivo.test.ts`); lint `npx eslint .`; build `npm run build`.
6. Linha de base antes das mudanças: tsc sem erros; 54 arquivos de teste e 918 testes passando; eslint com 0 erros e 19 avisos (nenhum erro ou aviso novo pode surgir).
7. Cada etapa altera só os arquivos listados nela. Não faça commit, push, deploy nem mexa na pasta .git; não rode `npm install`; não escreva nem leia segredos, tokens ou arquivos .env.
8. Se algo não bater com o descrito (arquivo, função ou assinatura inexistente, teste quebrado por motivo alheio à etapa), pare e relate em vez de improvisar.

O QUE JÁ EXISTE E É RELEVANTE PARA ESTA ETAPA
A etapa anterior criou em C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\hooks\hook-specs.ts a constante `DISPATCH_SPEC` ({ module: 'ai-ecosystem', type: 'despacho', event: 'PreToolUse', matcher: 'Grep|Glob|Bash|PowerShell|Write' }) e no script o tipo despacho (roda as proteções de todos os módulos configurados cujo estado não tem `hooksRemovidos: true`). O C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\hooks\hook-manager.ts atual: `installProtection(moduleId, automatic = false)` usa `specs = moduleHookSpecs(moduleId)` (a entrada de protecao do módulo), confere Node, faz `setHooksRemovidos(moduleId, false)` (se não automático) e `this.merger.install(this.state.getSettingsFile(), specs)`; `removeModule(moduleId)` remove todas as entradas do módulo das duas settings (SETTINGS_FILES); `removeByUser(moduleId)` chama removeModule e depois `this.states.setHooksRemovidos(moduleId, true)`; `planInstall(moduleId)` monta HookInstallPlan.entries a partir de moduleHookSpecs; getStatus() monta, por módulo, HookModuleRow com `installed: entries.filter((e) => e.module === id)` (entries = InstalledEntry[] lidos das duas settings por this.merger.list(file)); installCore() instala CORE_SPECS e remove a entrada antiga 'execucao'. this.merger (SettingsMerger) tem install(file, specs), remove(file, {module, type?}), list(file). this.states é o ModuleStateStore (get(id) → {estado, origem, hooksRemovidos?}), protectionModuleIds() e protectionSpec(id) vêm de hook-specs. markDisabledIfOff(moduleId) marca o módulo 'desativado' e depois chama removeModule(moduleId). O resultado de cada operação passa por this.record(result). A interface SettingsMerger.list devolve {ok:true, entries} ou {ok:false, error}.

ARQUIVOS
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\hooks\hook-manager.ts`
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\hooks\hook-specs.ts` (só se precisar exportar um helper)
- Não tocar: qualquer outro arquivo

REGRAS DESTA ETAPA
1. A semântica por módulo para a interface e o diagnóstico NÃO muda: HookModuleRow.installed continua dizendo se o módulo está protegido (agora derivado do despachante).
2. Um módulo conta como protegido pelo despachante quando: existe a entrada despacho (module 'ai-ecosystem', type 'despacho') em alguma das settings, o módulo tem protectionSpec, seu estado é 'configurado' e não tem hooksRemovidos.
3. A migração só roda com Node disponível (dentro do mesmo bloco de installCore) e nunca apaga entradas que não sejam do tipo 'protecao' de módulos com proteção.
4. Entradas antigas por módulo e o despachante nunca podem coexistir depois de uma instalação ou migração (para não rodar a proteção duas vezes).

O QUE FAZER, NESTA ORDEM
1. installProtection: mantenha a conferência de Node, o ensure, a lógica de hooksRemovidos e o modo padrão; troque a escrita por: `const file = this.state.getSettingsFile(); const dispatcher = this.merger.install(file, [DISPATCH_SPEC]); if (!dispatcher.ok) return this.record(dispatcher); const legacy = this.removeLegacyProtection(moduleId); if (!legacy.ok) return this.record(legacy); const result = this.record({ ok: true, changed: dispatcher.changed || legacy.changed });` e siga como hoje (onChange e retorno). Crie `private removeLegacyProtection(moduleId: string): HookActionResult` que, para cada arquivo de SETTINGS_FILES, faz `this.merger.remove(file, { module: moduleId, type: "protecao" })` e devolve {ok:false,error} no primeiro erro ou {ok:true, changed} somando os changed.
2. Crie `private dispatcherNeeded(): boolean`: verdadeiro quando algum id de protectionModuleIds() tem `this.states.get(id)` com estado 'configurado' e sem hooksRemovidos. Crie `private dropDispatcherIfUnused(): void` que, se !dispatcherNeeded(), remove em ambas as settings `{ module: ECOSYSTEM_ID, type: "despacho" }` (erro só registrado com this.record quando !ok).
3. removeModule(moduleId): continue removendo as entradas do módulo; ao final (antes de onChange) chame `this.dropDispatcherIfUnused()`. removeByUser(moduleId): chame removeModule, depois setHooksRemovidos(moduleId, true) (como hoje) e depois `this.dropDispatcherIfUnused()` (o estado precisa estar atualizado antes).
4. Migração em installCore(): dentro do try, depois da instalação do CORE_SPECS e da remoção da 'execucao', chame `this.migrateLegacyProtection();`: para cada arquivo de SETTINGS_FILES, liste as entradas (`this.merger.list(file)`; se !ok ignore); as legadas são as com `e.type === "protecao" && protectionSpec(e.module) !== undefined`; se houver alguma, `this.merger.install(file, [DISPATCH_SPEC])` e depois, para cada módulo legado distinto, `this.merger.remove(file, { module, type: "protecao" })`; erros só vão para this.record quando !ok.
5. getStatus(): depois de montar `entries`, calcule `const dispatch = entries.find((e) => e.module === ECOSYSTEM_ID && e.type === "despacho");` e em cada linha: `installed` = entradas legadas do módulo (como hoje) mais, se `dispatch && protectionSpec(id) && stored?.estado === "configurado" && !stored.hooksRemovidos`, uma entrada sintética `{ module: id, type: "protecao", event: dispatch.event, matcher: dispatch.matcher, command: dispatch.command }` (sem duplicar se já houver uma legada de protecao).
6. planInstall(moduleId): `entries` passa a ser `protectionSpec(moduleId) ? [DISPATCH_SPEC] : []` mapeado como hoje (`buildCommand(this.state.vaultPath, spec.module, spec.type)`). Ajuste os imports (DISPATCH_SPEC de './hook-specs').
7. Rode `npx tsc --noEmit`. Não ajuste testes (próxima etapa): relate a lista dos testes de tests/hooks e tests/setup que passaram a falhar e por quê.

O QUE NÃO FAZER
- Não altere o script nem os testes.
- Não remova moduleHookSpecs (ainda é usada em autoInstall).

CRITÉRIOS DE ACEITE
- Dado dois módulos com proteção configurados, Quando o núcleo instala as proteções, Então as settings têm UMA entrada PreToolUse do tipo despacho e nenhuma entrada 'protecao' por módulo.
- Dado settings antigas com entradas 'protecao' por módulo, Quando o núcleo inicia, Então elas são trocadas pela entrada única despacho e as entradas do usuário permanecem.
- Dado o botão 'Remover hooks' de um módulo, Quando o usuário o usa, Então o módulo fica com hooksRemovidos e, se for o último, a entrada despacho some.
- Dado o despachante instalado e um módulo configurado, Quando leio getStatus(), Então a linha do módulo tem installed com uma entrada do tipo protecao.

VERIFICAÇÃO (rode a partir de C:\Users\Trabalho\Documents\obsidian-ai-ecosystem e cole a saída real)
- npx tsc --noEmit → sem erros
- npx vitest run tests/hooks tests/setup → relatar as falhas esperadas (serão tratadas na próxima etapa)

Se qualquer coisa não bater com o descrito (arquivo, função ou assinatura inexistente, comportamento diferente do dito acima, teste quebrado por motivo alheio a esta etapa), PARE e relate em vez de improvisar.
RELATÓRIO FINAL: liste os arquivos alterados ou criados (caminho absoluto), cole a saída real de cada comando de verificação (não resuma) e descreva qualquer desvio ou dúvida.
```

## Etapa 31: Ajustar e ampliar os testes do hook manager para o despachante [Haiku 5.5 | esforço: alto]

**Objetivo:** fazer a suíte de hooks e de setup passar com o despachante único e cobrir instalação, migração, remoção e status.
**Depende de:** Etapa 30 (Hook manager instala o despachante único e migra as entradas antigas)
**Paralelizável com:** nenhuma

**Arquivos**
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\hooks\hook-manager.test.ts`
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\hooks\ecosystem-hooks.test.ts`
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\setup\helpers.ts` e os testes de C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\setup que falharem
- Não tocar: qualquer outro arquivo

**Regras de implementação**
1. Só testes (e helpers de teste). Se descobrir um bug real em src, relate sem corrigir.
2. Prefira reescrever as expectativas para o contrato novo a esconder o teste: o que valia por módulo ('Bash|PowerShell' do ai-git-tools) vale agora pelo despachante.
3. Cada teste de comportamento antigo (instalar uma vez, remover de ambos os arquivos, modo off mantém a entrada, plano de instalação, Node ausente) deve ter equivalente novo.

**Passos**
1. Rode `npx vitest run tests/hooks tests/setup` e liste as falhas.
2. tests/hooks/hook-manager.test.ts: reescreva 'installs on request, once, and removes from both settings files' (instalação única: dois módulos legados resultam em UMA entrada despacho; installProtection devolve changed false na segunda vez; removeByUser do último módulo remove a entrada despacho e deixa installed vazio; removeByUser de um de dois módulos mantém a entrada despacho e remove só a linha daquele módulo de status), 'installs only the protection entry of AI Git Tools...' (a entrada instalada é a do despachante com o matcher unido e o comando termina em 'ai-ecosystem despacho'; o modo 'off' fica em config.modos; reaplicar não duplica), 'writes the default mode avisar ... and plans its protection entry' (plan.entries traz [matcher 'Grep|Glob|Bash|PowerShell|Write', comando terminando em 'ai-ecosystem despacho']) e os demais testes do describe que dependem do formato antigo.
3. Acrescente testes novos no mesmo arquivo: (a) migração: settings.local.json com entradas antigas 'ai-git-tools protecao' e 'ai-scripts protecao' mais uma entrada do usuário → após started() há uma entrada despacho, nenhuma 'protecao', e a do usuário permanece; (b) idempotência da migração (iniciar duas vezes não duplica); (c) módulo com hooksRemovidos no estado não aparece como instalado em getStatus() e, se for o único, não há entrada despacho depois de removeByUser; (d) módulo desativado (markDisabledIfOff) deixa de contar e o despachante some quando é o último; (e) sem Node nada é escrito (o teste de NODE_MISSING existente continua valendo).
4. tests/hooks/ecosystem-hooks.test.ts e tests/setup: ajuste só o que olhar entradas por módulo (contagens de grupos PreToolUse, comandos com ' protecao'); hasHook/hookCommands em tests/setup/helpers.ts devem aceitar o despachante como prova de proteção de um módulo quando o teste perguntar por 'instalou a proteção' (acrescente um helper `hasProtection(r, moduleId)` se ajudar).
5. Rode `npx vitest run` completo e confirme que passa tudo.

**BDD (estado esperado ao concluir)**
- Dado dois módulos protegidos, Quando o núcleo instala as proteções, Então as settings têm uma única entrada despacho (testado).
- Dado settings antigas com entradas por módulo, Quando o núcleo inicia duas vezes, Então a migração acontece uma vez e as entradas do usuário permanecem (testado).
- Dado o último módulo protegido removido pelo usuário, Quando consulto as settings, Então a entrada despacho não existe mais (testado).
- Dado a suíte inteira, Quando a rodo, Então todos os testes passam.

**Verificação** (comandos a rodar, com o resultado esperado)
- npx vitest run → todos passam
- npx tsc --noEmit → sem erros

**Prompt para o subagente**
```text
Você é um subagente de implementação em TypeScript. Objetivo desta etapa: fazer a suíte de hooks e de setup passar com o despachante único e cobrir instalação, migração, remoção e status.

CONTEXTO COMPLETO
Projeto: plugin do Obsidian chamado AI Ecosystem (núcleo da suíte de plugins de IA), escrito em TypeScript, com servidor MCP e REST local, executor de scripts, índice e descoberta de tools (tools_find, tools_describe, tools_run), hooks do Claude Code gravados nas settings do cofre, configuração guiada de módulos, telas (formulários) e um inspetor de requisições. Raiz do repositório (RAIZ): C:\Users\Trabalho\Documents\obsidian-ai-ecosystem. Testes com vitest (pasta tests), sem Obsidian real (há um mock em tests\mocks\obsidian.ts).
Objetivo geral da demanda: implementar 16 melhorias aceitas numa auditoria do núcleo, na ordem: (1) teto de saída do ecosystem_run_script; (2) ecosystem_status compacto; (3) script_id no executor; (4) lote no tools_run; (5) diagnóstico que percebe módulo defasado; (6) cancelamento do run_script; (7) remover a aprovação do tools_run e o código morto; (8) limitar o activity.sqlite; (9) setup_status, list_scripts e diagnóstico enxutos; (10) resumo dos módulos no início da sessão; (11) tela_gerenciar e setup oculto sem pendência; (12) setup_save em lote; (13) descrição curta do run_script; (14) falha do módulo só por exceção; (15) catálogo por manifest.version; (16) despachante único dos hooks de proteção.
Regras globais:
1. Idioma: o código, os comentários e os nomes de identificadores ficam em inglês (como já está nos arquivos); as mensagens do diagnóstico, do hook e dos achados ficam em português quando o arquivo já estiver em português; o README tem uma parte em inglês e uma em português espelhadas.
2. Estilo do código: TypeScript estrito, 2 espaços, aspas duplas, ponto e vírgula, `import type` para tipos, sem dependências novas e sem alterar package.json.
3. Os diretórios src/runner, src/server, src/registry, src/hooks, src/core, src/setup, src/tool-index são código Node puro: não importam o pacote "obsidian".
4. O script src/hooks/script/ai-ecosystem-hook.mjs é Node puro, sem dependências, e nunca pode atrapalhar o agente: qualquer problema termina com saída 0 e sem texto.
5. Comandos, sempre a partir de C:\Users\Trabalho\Documents\obsidian-ai-ecosystem: typecheck `npx tsc --noEmit`; testes `npx vitest run` (um arquivo: `npx vitest run tests\pasta\arquivo.test.ts`); lint `npx eslint .`; build `npm run build`.
6. Linha de base antes das mudanças: tsc sem erros; 54 arquivos de teste e 918 testes passando; eslint com 0 erros e 19 avisos (nenhum erro ou aviso novo pode surgir).
7. Cada etapa altera só os arquivos listados nela. Não faça commit, push, deploy nem mexa na pasta .git; não rode `npm install`; não escreva nem leia segredos, tokens ou arquivos .env.
8. Se algo não bater com o descrito (arquivo, função ou assinatura inexistente, teste quebrado por motivo alheio à etapa), pare e relate em vez de improvisar.

O QUE JÁ EXISTE E É RELEVANTE PARA ESTA ETAPA
Agora o HookManager (C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\hooks\hook-manager.ts) instala UMA entrada PreToolUse do tipo despacho (`DISPATCH_SPEC`: módulo 'ai-ecosystem', matcher 'Grep|Glob|Bash|PowerShell|Write', comando `node "<cofre>/.claude/ai-ecosystem/hooks/ai-ecosystem-hook.mjs" ai-ecosystem despacho`) no lugar de uma entrada 'protecao' por módulo. installProtection(modulo) instala o despachante e remove a entrada 'protecao' legada do módulo; na partida (installCore) as entradas 'protecao' antigas são migradas (despachante instalado e entradas antigas removidas); removeByUser(modulo) marca hooksRemovidos e remove o despachante quando nenhum módulo com proteção resta ativo; removeModule(modulo) só remove as entradas do módulo e o despachante se ficar sem uso; getStatus() deriva HookModuleRow.installed (uma entrada sintética de tipo 'protecao' com o comando do despachante) para módulos configurados, com proteção e sem hooksRemovidos; planInstall(modulo).entries devolve a entrada do despachante. Os testes que dependem do formato antigo estão em C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\hooks\hook-manager.test.ts (describe 'protection hooks of a module' e outros; helper local modulePre() lê settings().hooks.PreToolUse; started(), registry.add/remove, state(), settings(), vault) e em C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\setup\*.test.ts (helpers hookCommands, hasHook em C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\setup\helpers.ts) e C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\hooks\ecosystem-hooks.test.ts.

ARQUIVOS
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\hooks\hook-manager.test.ts`
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\hooks\ecosystem-hooks.test.ts`
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\setup\helpers.ts` e os testes de C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\setup que falharem
- Não tocar: qualquer outro arquivo

REGRAS DESTA ETAPA
1. Só testes (e helpers de teste). Se descobrir um bug real em src, relate sem corrigir.
2. Prefira reescrever as expectativas para o contrato novo a esconder o teste: o que valia por módulo ('Bash|PowerShell' do ai-git-tools) vale agora pelo despachante.
3. Cada teste de comportamento antigo (instalar uma vez, remover de ambos os arquivos, modo off mantém a entrada, plano de instalação, Node ausente) deve ter equivalente novo.

O QUE FAZER, NESTA ORDEM
1. Rode `npx vitest run tests/hooks tests/setup` e liste as falhas.
2. tests/hooks/hook-manager.test.ts: reescreva 'installs on request, once, and removes from both settings files' (instalação única: dois módulos legados resultam em UMA entrada despacho; installProtection devolve changed false na segunda vez; removeByUser do último módulo remove a entrada despacho e deixa installed vazio; removeByUser de um de dois módulos mantém a entrada despacho e remove só a linha daquele módulo de status), 'installs only the protection entry of AI Git Tools...' (a entrada instalada é a do despachante com o matcher unido e o comando termina em 'ai-ecosystem despacho'; o modo 'off' fica em config.modos; reaplicar não duplica), 'writes the default mode avisar ... and plans its protection entry' (plan.entries traz [matcher 'Grep|Glob|Bash|PowerShell|Write', comando terminando em 'ai-ecosystem despacho']) e os demais testes do describe que dependem do formato antigo.
3. Acrescente testes novos no mesmo arquivo: (a) migração: settings.local.json com entradas antigas 'ai-git-tools protecao' e 'ai-scripts protecao' mais uma entrada do usuário → após started() há uma entrada despacho, nenhuma 'protecao', e a do usuário permanece; (b) idempotência da migração (iniciar duas vezes não duplica); (c) módulo com hooksRemovidos no estado não aparece como instalado em getStatus() e, se for o único, não há entrada despacho depois de removeByUser; (d) módulo desativado (markDisabledIfOff) deixa de contar e o despachante some quando é o último; (e) sem Node nada é escrito (o teste de NODE_MISSING existente continua valendo).
4. tests/hooks/ecosystem-hooks.test.ts e tests/setup: ajuste só o que olhar entradas por módulo (contagens de grupos PreToolUse, comandos com ' protecao'); hasHook/hookCommands em tests/setup/helpers.ts devem aceitar o despachante como prova de proteção de um módulo quando o teste perguntar por 'instalou a proteção' (acrescente um helper `hasProtection(r, moduleId)` se ajudar).
5. Rode `npx vitest run` completo e confirme que passa tudo.

O QUE NÃO FAZER
- Não altere src.
- Não apague testes sem substituto.

CRITÉRIOS DE ACEITE
- Dado dois módulos protegidos, Quando o núcleo instala as proteções, Então as settings têm uma única entrada despacho (testado).
- Dado settings antigas com entradas por módulo, Quando o núcleo inicia duas vezes, Então a migração acontece uma vez e as entradas do usuário permanecem (testado).
- Dado o último módulo protegido removido pelo usuário, Quando consulto as settings, Então a entrada despacho não existe mais (testado).
- Dado a suíte inteira, Quando a rodo, Então todos os testes passam.

VERIFICAÇÃO (rode a partir de C:\Users\Trabalho\Documents\obsidian-ai-ecosystem e cole a saída real)
- npx vitest run → todos passam
- npx tsc --noEmit → sem erros

Se qualquer coisa não bater com o descrito (arquivo, função ou assinatura inexistente, comportamento diferente do dito acima, teste quebrado por motivo alheio a esta etapa), PARE e relate em vez de improvisar.
RELATÓRIO FINAL: liste os arquivos alterados ou criados (caminho absoluto), cole a saída real de cada comando de verificação (não resuma) e descreva qualquer desvio ou dúvida.
```

## Etapa 32: Documentar as mudanças no README (inglês e português) [Haiku 5.5 | esforço: médio]

**Objetivo:** atualizar as duas versões do README com os comportamentos novos das tools e dos hooks.
**Depende de:** Etapa 31 (Ajustar e ampliar os testes do hook manager para o despachante)
**Paralelizável com:** nenhuma

**Arquivos**
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\README.md`
- Não tocar: qualquer outro arquivo

**Regras de implementação**
1. Só o README.md, nos dois idiomas, com o mesmo conteúdo.
2. Edite linhas e parágrafos existentes quando já tratam do assunto; só crie parágrafo novo quando não houver onde encaixar.
3. Texto curto: uma a três frases por mudança.

**Passos**
1. Leia o README inteiro e localize, nos dois idiomas: a tabela de tools do núcleo, a seção de hooks (entradas instaladas por módulo e o hook de falha), a seção das tools de configuração e a descrição do tools_run/descoberta indexada.
2. Atualize as linhas da tabela de tools (status, diagnostico, list_scripts, run_script) com os comportamentos (1) a (5) acima.
3. Atualize o parágrafo das tools de configuração com (6) e (7).
4. Atualize a seção de hooks com (9) e (10) (entrada única despacho que substitui as entradas por módulo, hook resumo, falha só por exceção ou indisponibilidade); remova qualquer frase que diga que cada módulo instala a própria entrada PreToolUse.
5. Acrescente (3) onde o README descreve tools_run/descoberta indexada e (11) onde descreve o catálogo (uma frase).
6. Confira que nenhuma menção a tela_criar/tela_editar sobrou e que os dois idiomas ficaram espelhados.

**BDD (estado esperado ao concluir)**
- Dado o README, Quando busco 'despacho' e 'dispatch', Então a seção de hooks dos dois idiomas descreve a entrada única.
- Dado o README, Quando busco 'max_chars' e 'script_id', Então a tabela de tools dos dois idiomas os cita.
- Dado o README, Quando busco 'tela_criar', Então não há ocorrências.

**Verificação** (comandos a rodar, com o resultado esperado)
- grep -c "max_chars" C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\README.md → pelo menos 2
- grep -c "tela_criar" C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\README.md → 0
- npx tsc --noEmit → sem erros (nada de código mudou)

**Prompt para o subagente**
```text
Você é um subagente de implementação em TypeScript. Objetivo desta etapa: atualizar as duas versões do README com os comportamentos novos das tools e dos hooks.

CONTEXTO COMPLETO
Projeto: plugin do Obsidian chamado AI Ecosystem (núcleo da suíte de plugins de IA), escrito em TypeScript, com servidor MCP e REST local, executor de scripts, índice e descoberta de tools (tools_find, tools_describe, tools_run), hooks do Claude Code gravados nas settings do cofre, configuração guiada de módulos, telas (formulários) e um inspetor de requisições. Raiz do repositório (RAIZ): C:\Users\Trabalho\Documents\obsidian-ai-ecosystem. Testes com vitest (pasta tests), sem Obsidian real (há um mock em tests\mocks\obsidian.ts).
Objetivo geral da demanda: implementar 16 melhorias aceitas numa auditoria do núcleo, na ordem: (1) teto de saída do ecosystem_run_script; (2) ecosystem_status compacto; (3) script_id no executor; (4) lote no tools_run; (5) diagnóstico que percebe módulo defasado; (6) cancelamento do run_script; (7) remover a aprovação do tools_run e o código morto; (8) limitar o activity.sqlite; (9) setup_status, list_scripts e diagnóstico enxutos; (10) resumo dos módulos no início da sessão; (11) tela_gerenciar e setup oculto sem pendência; (12) setup_save em lote; (13) descrição curta do run_script; (14) falha do módulo só por exceção; (15) catálogo por manifest.version; (16) despachante único dos hooks de proteção.
Regras globais:
1. Idioma: o código, os comentários e os nomes de identificadores ficam em inglês (como já está nos arquivos); as mensagens do diagnóstico, do hook e dos achados ficam em português quando o arquivo já estiver em português; o README tem uma parte em inglês e uma em português espelhadas.
2. Estilo do código: TypeScript estrito, 2 espaços, aspas duplas, ponto e vírgula, `import type` para tipos, sem dependências novas e sem alterar package.json.
3. Os diretórios src/runner, src/server, src/registry, src/hooks, src/core, src/setup, src/tool-index são código Node puro: não importam o pacote "obsidian".
4. O script src/hooks/script/ai-ecosystem-hook.mjs é Node puro, sem dependências, e nunca pode atrapalhar o agente: qualquer problema termina com saída 0 e sem texto.
5. Comandos, sempre a partir de C:\Users\Trabalho\Documents\obsidian-ai-ecosystem: typecheck `npx tsc --noEmit`; testes `npx vitest run` (um arquivo: `npx vitest run tests\pasta\arquivo.test.ts`); lint `npx eslint .`; build `npm run build`.
6. Linha de base antes das mudanças: tsc sem erros; 54 arquivos de teste e 918 testes passando; eslint com 0 erros e 19 avisos (nenhum erro ou aviso novo pode surgir).
7. Cada etapa altera só os arquivos listados nela. Não faça commit, push, deploy nem mexa na pasta .git; não rode `npm install`; não escreva nem leia segredos, tokens ou arquivos .env.
8. Se algo não bater com o descrito (arquivo, função ou assinatura inexistente, teste quebrado por motivo alheio à etapa), pare e relate em vez de improvisar.

O QUE JÁ EXISTE E É RELEVANTE PARA ESTA ETAPA
O C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\README.md tem uma parte em inglês e uma parte em português espelhadas (tabela de tools do núcleo com linhas `| `ecosystem_status` | `GET /status` | ... |`, `ecosystem_diagnostico`, `ecosystem_list_scripts`, `ecosystem_run_script`; parágrafos das tools de configuração; seção de hooks; seção do inspetor; seção de telas). Mudanças entregues nas etapas anteriores: (1) ecosystem_run_script devolve no máximo 4000 caracteres de stdout e de stderr (início e fim, o resto num arquivo em <pasta temporária>/ai-ecosystem-runs, caminhos em stdout_file e stderr_file), com max_chars opcional (também na rota POST /scripts/run), e aceita script_id (script de arquivo registrado no AI Scripts) no lugar de path; cancela o processo quando o agente cancela. (2) ecosystem_status devolve só contagens por módulo; detalhe:true lista as tools e modulo filtra um módulo (a rota GET /status continua completa). (3) tools_run aceita calls (até 10 itens {id,args}, em sequência, saída resumida por item). (4) ecosystem_diagnostico avisa módulo defasado (versão do manifest.json diferente da carregada, ou main.js alterado depois do carregamento) e lista só avisos e erros (completo:true lista tudo). (5) ecosystem_list_scripts lista só os caminhos. (6) ecosystem_setup_status omite perguntas e bloco_claude_md de módulo já configurado (completo:true devolve) e ecosystem_setup_save aceita respostas:{chave:valor} (até 20). (7) As tools de setup só aparecem no tools/list enquanto há módulo pendente (continuam chamáveis por nome). (8) tela_gerenciar (acao criar, editar ou guia) substitui tela_criar e tela_editar (já documentado no parágrafo de telas). (9) Hooks: o núcleo instala o hook 'falha' e o hook 'resumo' (SessionStart: resumo de até 300 caracteres com módulos ativos e pendências) e UMA única entrada 'despacho' que roda as proteções de todos os módulos num só processo (as entradas antigas por módulo são migradas); o hook de aprovação do tools_run foi removido (parágrafo já corrigido). (10) Um módulo só é marcado em falha quando o handler lança exceção ou está indisponível (erro de argumento não desliga a proteção). (11) O catálogo compara a versão do manifest.json do release.

ARQUIVOS
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\README.md`
- Não tocar: qualquer outro arquivo

REGRAS DESTA ETAPA
1. Só o README.md, nos dois idiomas, com o mesmo conteúdo.
2. Edite linhas e parágrafos existentes quando já tratam do assunto; só crie parágrafo novo quando não houver onde encaixar.
3. Texto curto: uma a três frases por mudança.

O QUE FAZER, NESTA ORDEM
1. Leia o README inteiro e localize, nos dois idiomas: a tabela de tools do núcleo, a seção de hooks (entradas instaladas por módulo e o hook de falha), a seção das tools de configuração e a descrição do tools_run/descoberta indexada.
2. Atualize as linhas da tabela de tools (status, diagnostico, list_scripts, run_script) com os comportamentos (1) a (5) acima.
3. Atualize o parágrafo das tools de configuração com (6) e (7).
4. Atualize a seção de hooks com (9) e (10) (entrada única despacho que substitui as entradas por módulo, hook resumo, falha só por exceção ou indisponibilidade); remova qualquer frase que diga que cada módulo instala a própria entrada PreToolUse.
5. Acrescente (3) onde o README descreve tools_run/descoberta indexada e (11) onde descreve o catálogo (uma frase).
6. Confira que nenhuma menção a tela_criar/tela_editar sobrou e que os dois idiomas ficaram espelhados.

O QUE NÃO FAZER
- Não altere nenhum arquivo além do README.md.
- Não invente comportamentos que não estejam na lista acima.

CRITÉRIOS DE ACEITE
- Dado o README, Quando busco 'despacho' e 'dispatch', Então a seção de hooks dos dois idiomas descreve a entrada única.
- Dado o README, Quando busco 'max_chars' e 'script_id', Então a tabela de tools dos dois idiomas os cita.
- Dado o README, Quando busco 'tela_criar', Então não há ocorrências.

VERIFICAÇÃO (rode a partir de C:\Users\Trabalho\Documents\obsidian-ai-ecosystem e cole a saída real)
- grep -c "max_chars" C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\README.md → pelo menos 2
- grep -c "tela_criar" C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\README.md → 0
- npx tsc --noEmit → sem erros (nada de código mudou)

Se qualquer coisa não bater com o descrito (arquivo, função ou assinatura inexistente, comportamento diferente do dito acima, teste quebrado por motivo alheio a esta etapa), PARE e relate em vez de improvisar.
RELATÓRIO FINAL: liste os arquivos alterados ou criados (caminho absoluto), cole a saída real de cada comando de verificação (não resuma) e descreva qualquer desvio ou dúvida.
```

## Etapa 33: Verificação geral [Haiku 5.5 | esforço: alto]

**Objetivo:** conferir que tudo compila, passa nos testes e no lint, e que não sobrou resto das mudanças.
**Depende de:** Etapa 32 (Documentar as mudanças no README (inglês e português))
**Paralelizável com:** nenhuma

**Arquivos**
- Alterar: (nenhum arquivo: só verificar e relatar)
- Não tocar: qualquer outro arquivo

**Regras de implementação**
1. Não corrija nada nesta etapa: relate cada problema com arquivo, comando e saída real.
2. Não faça commit, push, deploy.

**Passos**
1. Rode a partir de C:\Users\Trabalho\Documents\obsidian-ai-ecosystem: `npx tsc --noEmit`, `npx vitest run`, `npx eslint .` e `npm run build` (o build escreve main.js, que é ignorado pelo git). Registre o resultado real de cada um.
2. Compare o lint com a linha de base: 0 erros e nenhum aviso novo além dos 19 existentes (se houver diferença, liste os avisos novos).
3. Rode `node --check C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\hooks\script\ai-ecosystem-hook.mjs`.
4. Varra restos com busca em C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src e C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests: 'CORE_RUN_SPEC', 'coreRunApprovalInstalled', 'AGENT_OUTPUT_CHARS', 'tela_criar', 'tela_editar' (só aceitável em RESERVED_SLUGS de src/screens/model.ts), 'findIndexedTool', 'execution(' no script. Liste qualquer ocorrência.
5. Confira os 16 itens um a um e diga para cada um: coberto (com o arquivo onde está) ou não. Itens: 1 teto de saída; 2 status compacto; 3 script_id; 4 lote tools_run; 5 diagnóstico defasado; 6 cancelamento; 7 hook execucao e textos; 8 activity.sqlite; 9 setup_status, list_scripts, diagnóstico compactos; 10 resumo no SessionStart; 11 tela_gerenciar e setup oculto; 12 setup_save em lote; 13 descrição curta; 14 falha só por exceção; 15 catálogo por manifest.version; 16 despachante único.

**BDD (estado esperado ao concluir)**
- Dado o repositório depois de todas as etapas, Quando rodo tsc, vitest, eslint e o build, Então tsc e build passam, todos os testes passam e o lint tem 0 erros.
- Dado a varredura, Então não restam referências a CORE_RUN_SPEC, coreRunApprovalInstalled, AGENT_OUTPUT_CHARS nem às tools tela_criar/tela_editar fora de RESERVED_SLUGS.
- Dado os 16 itens, Então cada um está marcado como coberto ou com o motivo de não estar.

**Verificação** (comandos a rodar, com o resultado esperado)
- npx tsc --noEmit → sem erros
- npx vitest run → todos passam
- npx eslint . → 0 erros, 19 avisos
- npm run build → conclui sem erro

**Prompt para o subagente**
```text
Você é um subagente de implementação em TypeScript. Objetivo desta etapa: conferir que tudo compila, passa nos testes e no lint, e que não sobrou resto das mudanças.

CONTEXTO COMPLETO
Projeto: plugin do Obsidian chamado AI Ecosystem (núcleo da suíte de plugins de IA), escrito em TypeScript, com servidor MCP e REST local, executor de scripts, índice e descoberta de tools (tools_find, tools_describe, tools_run), hooks do Claude Code gravados nas settings do cofre, configuração guiada de módulos, telas (formulários) e um inspetor de requisições. Raiz do repositório (RAIZ): C:\Users\Trabalho\Documents\obsidian-ai-ecosystem. Testes com vitest (pasta tests), sem Obsidian real (há um mock em tests\mocks\obsidian.ts).
Objetivo geral da demanda: implementar 16 melhorias aceitas numa auditoria do núcleo, na ordem: (1) teto de saída do ecosystem_run_script; (2) ecosystem_status compacto; (3) script_id no executor; (4) lote no tools_run; (5) diagnóstico que percebe módulo defasado; (6) cancelamento do run_script; (7) remover a aprovação do tools_run e o código morto; (8) limitar o activity.sqlite; (9) setup_status, list_scripts e diagnóstico enxutos; (10) resumo dos módulos no início da sessão; (11) tela_gerenciar e setup oculto sem pendência; (12) setup_save em lote; (13) descrição curta do run_script; (14) falha do módulo só por exceção; (15) catálogo por manifest.version; (16) despachante único dos hooks de proteção.
Regras globais:
1. Idioma: o código, os comentários e os nomes de identificadores ficam em inglês (como já está nos arquivos); as mensagens do diagnóstico, do hook e dos achados ficam em português quando o arquivo já estiver em português; o README tem uma parte em inglês e uma em português espelhadas.
2. Estilo do código: TypeScript estrito, 2 espaços, aspas duplas, ponto e vírgula, `import type` para tipos, sem dependências novas e sem alterar package.json.
3. Os diretórios src/runner, src/server, src/registry, src/hooks, src/core, src/setup, src/tool-index são código Node puro: não importam o pacote "obsidian".
4. O script src/hooks/script/ai-ecosystem-hook.mjs é Node puro, sem dependências, e nunca pode atrapalhar o agente: qualquer problema termina com saída 0 e sem texto.
5. Comandos, sempre a partir de C:\Users\Trabalho\Documents\obsidian-ai-ecosystem: typecheck `npx tsc --noEmit`; testes `npx vitest run` (um arquivo: `npx vitest run tests\pasta\arquivo.test.ts`); lint `npx eslint .`; build `npm run build`.
6. Linha de base antes das mudanças: tsc sem erros; 54 arquivos de teste e 918 testes passando; eslint com 0 erros e 19 avisos (nenhum erro ou aviso novo pode surgir).
7. Cada etapa altera só os arquivos listados nela. Não faça commit, push, deploy nem mexa na pasta .git; não rode `npm install`; não escreva nem leia segredos, tokens ou arquivos .env.
8. Se algo não bater com o descrito (arquivo, função ou assinatura inexistente, teste quebrado por motivo alheio à etapa), pare e relate em vez de improvisar.

O QUE JÁ EXISTE E É RELEVANTE PARA ESTA ETAPA
Todas as etapas anteriores alteraram o plugin AI Ecosystem. Linha de base antes das mudanças: `npx tsc --noEmit` sem erros; `npx vitest run` com 54 arquivos e 918 testes passando (agora há mais testes); `npx eslint .` com 0 erros e 19 avisos (todos de settings-tab, preferir-update-over-display e no-deprecated, já existentes). Itens entregues: teto de saída e max_chars no ecosystem_run_script (MCP e REST); ecosystem_status compacto; script_id no ecosystem_run_script; lote calls no tools_run; diagnóstico com módulo defasado e modo compacto; cancelamento do run_script; remoção do hook execucao e do código morto; poda do activity.sqlite e textos; setup_status compacto e setup_save em lote; list_scripts só com caminhos; hook resumo; tela_gerenciar; setup oculto no tools/list sem pendência; descrição curta do run_script; falha só por exceção; catálogo por manifest.version; despachante único de proteção.

ARQUIVOS
- Alterar: (nenhum arquivo: só verificar e relatar)
- Não tocar: qualquer outro arquivo

REGRAS DESTA ETAPA
1. Não corrija nada nesta etapa: relate cada problema com arquivo, comando e saída real.
2. Não faça commit, push, deploy.

O QUE FAZER, NESTA ORDEM
1. Rode a partir de C:\Users\Trabalho\Documents\obsidian-ai-ecosystem: `npx tsc --noEmit`, `npx vitest run`, `npx eslint .` e `npm run build` (o build escreve main.js, que é ignorado pelo git). Registre o resultado real de cada um.
2. Compare o lint com a linha de base: 0 erros e nenhum aviso novo além dos 19 existentes (se houver diferença, liste os avisos novos).
3. Rode `node --check C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\hooks\script\ai-ecosystem-hook.mjs`.
4. Varra restos com busca em C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src e C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests: 'CORE_RUN_SPEC', 'coreRunApprovalInstalled', 'AGENT_OUTPUT_CHARS', 'tela_criar', 'tela_editar' (só aceitável em RESERVED_SLUGS de src/screens/model.ts), 'findIndexedTool', 'execution(' no script. Liste qualquer ocorrência.
5. Confira os 16 itens um a um e diga para cada um: coberto (com o arquivo onde está) ou não. Itens: 1 teto de saída; 2 status compacto; 3 script_id; 4 lote tools_run; 5 diagnóstico defasado; 6 cancelamento; 7 hook execucao e textos; 8 activity.sqlite; 9 setup_status, list_scripts, diagnóstico compactos; 10 resumo no SessionStart; 11 tela_gerenciar e setup oculto; 12 setup_save em lote; 13 descrição curta; 14 falha só por exceção; 15 catálogo por manifest.version; 16 despachante único.

O QUE NÃO FAZER
- Não edite nenhum arquivo.
- Não faça commit nem push.

CRITÉRIOS DE ACEITE
- Dado o repositório depois de todas as etapas, Quando rodo tsc, vitest, eslint e o build, Então tsc e build passam, todos os testes passam e o lint tem 0 erros.
- Dado a varredura, Então não restam referências a CORE_RUN_SPEC, coreRunApprovalInstalled, AGENT_OUTPUT_CHARS nem às tools tela_criar/tela_editar fora de RESERVED_SLUGS.
- Dado os 16 itens, Então cada um está marcado como coberto ou com o motivo de não estar.

VERIFICAÇÃO (rode a partir de C:\Users\Trabalho\Documents\obsidian-ai-ecosystem e cole a saída real)
- npx tsc --noEmit → sem erros
- npx vitest run → todos passam
- npx eslint . → 0 erros, 19 avisos
- npm run build → conclui sem erro

Se qualquer coisa não bater com o descrito (arquivo, função ou assinatura inexistente, comportamento diferente do dito acima, teste quebrado por motivo alheio a esta etapa), PARE e relate em vez de improvisar.
RELATÓRIO FINAL: liste os arquivos alterados ou criados (caminho absoluto), cole a saída real de cada comando de verificação (não resuma) e descreva qualquer desvio ou dúvida.
```

## 6. Critérios de aceite finais (BDD)
- Dado o repositório depois de todas as etapas, Quando rodo `npx tsc --noEmit`, `npx vitest run`, `npx eslint .` e `npm run build`, Então todos passam e o lint tem 0 erros e nenhum aviso além dos 19 existentes.
- Dado um script que imprime 10000 caracteres, Quando o executo pela tool ou pela rota REST, Então a resposta tem no máximo ~4000 caracteres por fluxo e a saída completa está num arquivo.
- Dado ecosystem_status sem argumentos, Então a resposta traz contagens por módulo; com detalhe:true traz os nomes das tools.
- Dado script_id de um script de arquivo do AI Scripts, Quando chamo ecosystem_run_script, Então ele roda; e quando o agente cancela a chamada, Então o processo é morto.
- Dado tools_run com calls de até 10 itens, Então cada item roda em sequência com saída resumida.
- Dado um módulo com manifest.json em versão diferente da carregada, Quando rodo o diagnóstico, Então há um aviso de módulo defasado; sem avisos, o diagnóstico lista só a contagem de ok.
- Dado o núcleo iniciando, Então as settings do Claude Code têm o hook falha, o hook resumo e uma única entrada despacho de proteção, e nenhuma entrada execucao ou protecao por módulo.
- Dado o activity.sqlite, Então ele mantém no máximo 3000 linhas e 7 dias, com textos cortados em 4000 caracteres.
- Dado uma tool que devolve erro de argumento, Então a proteção do módulo não é desligada.
- Dado o README, Então os dois idiomas descrevem os comportamentos novos e nenhuma frase diz que o núcleo pergunta aprovação no tools_run.
