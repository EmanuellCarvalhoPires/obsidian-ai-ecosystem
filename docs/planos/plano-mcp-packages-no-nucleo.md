# Plano de implementação: Pacotes MCP baixáveis no núcleo do AI Ecosystem

## Sumário
<!-- Linhas calculadas após salvar. -->
- Etapa 1: Catálogo e instalador de pacotes (linhas 75-150)
- Etapa 2: Leitor de mcp.db e construtor do índice (linhas 151-209)
- Etapa 3: Contrato público e McpPackageService (linhas 210-272)
- Etapa 4: Adaptadores do Obsidian e ligação no main.ts do núcleo (linhas 273-328)
- Etapa 5: Integração no Ecosystem (índice e runner) (linhas 329-382)
- Etapa 6: Logos, textos e estilos (linhas 383-488)
- Etapa 7: Seção de pacotes, modal de exclusão e encaixe na tela de módulos (linhas 489-566)
- Etapa 8: Env Keys assina o serviço de pacotes (linhas 567-626)
- Etapa 9: Env Keys remove o download e troca o botão por atalho (linhas 627-695)
- Etapa 10: Documentação dos dois plugins (linhas 696-738)
- Etapa 11: Verificação geral (linhas 739-779)

## 1. Objetivo
Mover do plugin Environment Keys (Env Keys) para o núcleo do plugin AI Ecosystem (o núcleo, dono do servidor local na porta 27150) o download dos pacotes MCP (os "Grupos de MCP" Atlassian: JSM Assets, Automation for Jira, Bitbucket, Confluence, Jira Software, Jira Cloud etc.) e a indexação das tools depois do download. Na tela "Módulos do AI Ecosystem" os pacotes aparecem numa seção própria, abaixo de uma linha divisória que fica logo depois do texto "O catálogo baixa plugins apenas de releases do GitHub...".

Pronto quando: (a) a seção "Pacotes MCP" baixa e exclui pacotes inteiros e tools avulsas pela tela do núcleo; (b) as tools baixadas aparecem em `tools_find` (módulo `ai-ecosystem`, tipo `api`) e rodam por `tools_run`; (c) o Env Keys não tem mais o código de download, mantém os Grupos de MCP e continua executando as tools com os segredos; (d) cofres que já têm pacotes baixados continuam funcionando sem baixar de novo.

## 2. Contexto completo
- **Projeto:** dois plugins Obsidian em TypeScript (vitest, esbuild, ESLint com eslint-plugin-obsidianmd). Núcleo: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem` (v1.6.0). Env Keys: `C:\Users\Trabalho\Documents\obsidian-environment-variables` (v2.3.1). Cofre de teste: `C:\Users\Trabalho\Documents\Cofre` (`npm run deploy` de cada repositório copia o build para `.obsidian\plugins\<id>`).
- **Download hoje (Env Keys):**
  - `src\tools\mcpCatalog.ts`: tipos `McpCatalogEntry`, `McpPackageManifest`, `McpPackageFile`, `groupCatalogEntries`, `fetchCatalog`, `fetchPackageManifest`, `filesToInstall`, `appForEntry`.
  - `src\tools\githubReader.ts`: `HttpGithubReader` (requestUrl) lendo `https://raw.githubusercontent.com/EmanuellCarvalhoPires/environment-keys-mcp-packages/main`.
  - `src\main.ts` (linhas ~1220-1330): `fetchMcpCatalog`, `fetchMcpPackageManifest`, `ensureMcpHubNote`, `downloadMcpPackage`, `ensureServiceTemplate`, `upsertMcpGroupForPackage`, `ensureMcpAppForPackage`, `removeMcpGroup`. Arquivos vão para `MCP Tools\<pacote>\`; o `.db` vira `<entry.id>.db`; notas já existentes são puladas.
  - `src\ui\mcpDownloadModal.ts`: modal "Baixar MCP".
  - `src\tools\mcpDb.ts`: `McpDbManager` lê os `.db` (tabelas `packages`, `tools`, `requests`); `src\tools\apiIndex.ts` transforma as tools em entradas `kind: "api"` que o Env Keys grava no próprio `tools.db`.
- **Estado do núcleo:** `src\catalog\catalog-view.ts` (`CatalogView`) desenha os módulos e termina com `<p class="aie-catalog-footer">`. `src\core\ecosystem.ts` tem `syncCoreIndex()` (grava o `tools.db` do módulo `ai-ecosystem`), `ToolFederation` (`src\tool-index\federation.ts`) e `tools_run` (`src\tool-index\discovery-tools.ts`) que executa entradas indexadas pelo serviço `tool-runner:<moduleId>`. Barramento de serviços: `this.bus`.
- **Decisões já tomadas (não reabrir):**
  1. O núcleo baixa para o mesmo lugar de hoje (`MCP Tools\<pacote>\`, `.db` como `<id>.db`).
  2. "Pacote instalado" = existe um `.db` no cofre com linha na tabela `packages` ou com tools. Nenhum estado novo em `data.json`.
  3. O núcleo lê cada `.db` (somente leitura) e grava as tools no próprio `tools.db` (módulo `ai-ecosystem`, `kind: "api"`), numa única chamada de sync junto com as tools nativas (senão uma apaga as linhas da outra).
  4. A execução continua no Env Keys. O núcleo registra `tool-runner:ai-ecosystem` que só repassa para `tool-runner:environment-variables`.
  5. O núcleo publica o serviço `mcp-packages` (`list()`, `onChange()`). O Env Keys assina, cria/remove os Grupos de MCP (`sourcePackageId`) e continua carregando os `.db` para executar. O Env Keys para de indexar os `.db`.
  6. Os modelos de nota de instância (ex.: "Atlassian instance - Template") continuam sendo criados pelo Env Keys.
  7. Só se aceita catálogo em `https://raw.githubusercontent.com/EmanuellCarvalhoPires/`.
- **Fora do escopo:** mudar o formato dos pacotes no repositório `environment-keys-mcp-packages`; mover a execução das tools; alterar versões (`manifest.json`, `package.json`, `versions.json`); criar release, commit, push ou merge.

## 3. Regras globais de implementação
1. Código e comentários em inglês, comentários curtos e só onde explicam o motivo. Textos de interface em `src\i18n\catalog.ts` (en e pt).
2. UI do Obsidian: nunca emojis; ícones Lucide com `setIcon`. Nada de `innerHTML`; use `createEl`, `createDiv`, `setText`. Cores só por variáveis CSS do Obsidian.
3. Módulos de `src\mcp-packages\` são Node puro (sem `import "obsidian"`), exceto `obsidian-store.ts`.
4. Requisições de rede só com `requestUrl` do Obsidian, nunca `fetch`.
5. Imports no mesmo estilo dos arquivos vizinhos; veja um teste vizinho antes de escrever o seu.
6. Comandos (PowerShell, na raiz do repositório): `npx vitest run <arquivo>`, `npm run typecheck`, `npm run lint`, `npm run build`.
7. Nunca fazer commit, push, merge nem alterar versões.
8. Nunca incluir segredos ou tokens.
9. Se uma verificação não passar e a causa estiver fora da etapa, PARE e relate; não improvise.

## 4. Mapa das etapas
| # | Etapa | Modelo e Esforço | Depende de | Paralelizável com |
| --- | --- | --- | --- | --- |
| 1 | Catálogo e instalador de pacotes | Haiku 5.5 (alto) | nenhuma | 2, 6, 8 |
| 2 | Leitor de mcp.db e construtor do índice | Haiku 5.5 (médio) | nenhuma | 1, 6, 8 |
| 3 | Contrato público e McpPackageService | Haiku 5.5 (alto) | Etapas 1, 2 | 6, 8 |
| 4 | Adaptadores do Obsidian e ligação no main.ts do núcleo | Haiku 5.5 (médio) | Etapas 1, 3 | 5, 6, 8 |
| 5 | Integração no Ecosystem (índice e runner) | Haiku 5.5 (alto) | Etapa 3 | 4, 6, 8 |
| 6 | Logos, textos e estilos | Haiku 5.5 (baixo) | nenhuma | 1 a 5, 8 |
| 7 | Seção de pacotes, modal e encaixe na tela | Haiku 5.5 (alto) | Etapas 3, 4, 6 | 5, 8 |
| 8 | Env Keys assina o serviço de pacotes | Haiku 5.5 (alto) | nenhuma (contrato fixo abaixo) | 1 a 7 |
| 9 | Env Keys remove o download e troca o botão por atalho | Haiku 5.5 (alto) | Etapa 8 | 1 a 7 |
| 10 | Documentação dos dois plugins | Haiku 5.5 (baixo) | Etapas 7, 9 | nenhuma |
| 11 | Verificação geral | Haiku 5.5 (alto) | todas | nenhuma |

Contrato compartilhado (nomes fixos que várias etapas usam):
- Pasta nova do núcleo: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\mcp-packages\` com `catalog.ts`, `package-installer.ts`, `package-db.ts`, `package-index.ts`, `package-service.ts`, `obsidian-store.ts`, `default-logos.ts`.
- Serviço do barramento: `MCP_PACKAGES_SERVICE = "mcp-packages"`; `McpPackagesService { list(): InstalledMcpPackage[]; onChange(listener: () => void): () => void }`.
- `InstalledMcpPackage { id: string; name: string; app: string; tag: string; logo: string; serviceTag?: string; groupId?: string; toolCount: number; dbPath: string }` (`dbPath` relativo ao cofre).
- Comando do núcleo que abre a tela de módulos: `ai-ecosystem:open-catalog`.

## 5. Etapas

## Etapa 1: Catálogo e instalador de pacotes [Haiku 5.5 | esforço: alto]

**Objetivo:** criar o catálogo puro (tipos, leitura do catálogo e do manifesto, seleção de arquivos) e o instalador/removedor que grava os arquivos no cofre por uma interface `McpPackageStore`, com testes.
**Depende de:** nenhuma
**Paralelizável com:** Etapas 2, 6, 8

**Arquivos**
- Criar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\mcp-packages\catalog.ts`
- Criar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\mcp-packages\package-installer.ts`
- Criar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\mcp-packages\catalog.test.ts`
- Criar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\mcp-packages\package-installer.test.ts`
- Não tocar: qualquer outro arquivo

**Regras de implementação**
1. Em `catalog.ts`, portar de `C:\Users\Trabalho\Documents\obsidian-environment-variables\src\tools\mcpCatalog.ts` (linhas 1-167), com os mesmos nomes e a mesma lógica: `McpCatalogEntry`, `McpCatalog`, `McpCatalogGroup`, `groupCatalogEntries`, `McpPackageFileKind`, `McpPackageFile`, `McpPackageManifest`, `GithubReader`, `fetchCatalog`, `fetchPackageManifest`, `McpDownloadSelection`, `filesToInstall`, `SERVICE_APPS`, `appForEntry`. NÃO portar `needsServiceTemplate` nem `serviceTemplateFileName`.
2. Acrescentar em `catalog.ts`: `export const MCP_PACKAGES_CATALOG_URL = "https://raw.githubusercontent.com/EmanuellCarvalhoPires/environment-keys-mcp-packages/main";` e `export function isAllowedCatalogUrl(url: string): boolean` (true só se começa com `https://raw.githubusercontent.com/EmanuellCarvalhoPires/`).
3. Em `package-installer.ts`, exportar exatamente:
```ts
export interface McpPackageStore {
  /** Folder (vault-relative, no trailing slash, "" = root) of the note with this basename. */
  findNoteFolder(basename: string): Promise<string | undefined>;
  exists(path: string): Promise<boolean>;
  ensureFolder(path: string): Promise<void>;
  /** Creates the file; never overwrites. */
  createText(path: string, content: string): Promise<void>;
  /** Creates or overwrites. */
  writeBinary(path: string, data: ArrayBuffer): Promise<void>;
  /** Moves a file or folder to the Obsidian trash. */
  trash(path: string): Promise<void>;
}
export const MCP_HUB_NOTE_NAME = "MCP Tools";
export interface InstallResult { written: number; skipped: number }
```
4. `ensureHubFolder(store)`: se `findNoteFolder("MCP Tools")` achar, devolve a pasta; senão cria `MCP Tools.md` na raiz com as linhas, unidas por `\n`: `---`, `tags:`, `  - moc`, `  - mcp`, `---`, `# MCP Tools`, ``, `Index of the MCP tool packages downloaded through AI Ecosystem.`, ``, `## Related notes`, "```dataview", `LIST FROM [[]] WHERE contains(flat(list(up)), this.file.link)`, `SORT file.name ASC`, "```", `` e devolve `""`.
5. `packageTargetFolder(hubFolder, entry)` = `hubFolder ? \`${hubFolder}/${entry.name}\` : entry.name`. `targetPathOf(folder, entry, file)`: `kind === "database"` vira `${folder}/${entry.id}.db`; os demais `${folder}/${file.path}`. Normalize `\` para `/` e sem `//`.
6. `installPackage(store, reader, entry, manifest, selection, onProgress?)`: usa `filesToInstall`; cria as pastas que faltam com `ensureFolder` (uma vez por pasta); `database`: `reader.fetchBinary(\`${entry.path}/${file.path}\`)` e `writeBinary` (sempre sobrescreve, conta em `written`); demais: se `exists(target)` conta em `skipped`; senão `reader.fetchText` + `createText` e conta em `written`. Chama `onProgress(written + skipped, total)` após cada arquivo.
7. `removePackage(store, hubFolder, entry, manifest | undefined, deleteNotes)`: sempre manda para `trash` o `.db` se existir (caminho do arquivo `database` do manifesto; sem ele, `${folder}/${entry.id}.db`); se `deleteNotes` e há manifesto, manda para `trash` cada arquivo não-database que exista. Nunca apaga pastas.
8. `catalog.ts` não importa "obsidian". `package-installer.ts` só importa de `./catalog`.

**Passos**
1. Ler `C:\Users\Trabalho\Documents\obsidian-environment-variables\src\tools\mcpCatalog.ts` (1-167) e `C:\Users\Trabalho\Documents\obsidian-environment-variables\src\main.ts` (1220-1330, o `downloadMcpPackage` atual) e um teste vizinho (`C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\catalog\semver.test.ts`).
2. Criar `catalog.ts` e `package-installer.ts` conforme as regras.
3. Criar os dois testes. Em `catalog.test.ts`: `groupCatalogEntries` soma `toolCount` de entradas com o mesmo `groupId`; `filesToInstall` com `"all"`, com `{ toolPath }` (index, tool e requests de pair/pairs, sem duplicatas) e com toolPath inexistente (`[]`); `appForEntry` para `atlassian/instance` e `bitbucket/workspace` (ambos "Atlassian") e sem serviceTag (undefined); `fetchCatalog` com leitor falso (válido; sem `packages` lança "Invalid catalog"); `isAllowedCatalogUrl` aceita a URL padrão e rejeita `https://example.com/x`. Em `package-installer.test.ts`, com store falso em memória (Map; `trash` remove) e reader falso: (a) sem nota "MCP Tools" a nota é criada e `ensureHubFolder` devolve `""`; (b) nota em `Dados` devolve `Dados` sem criar nada; (c) pacote com index, 2 tools e 1 database, com uma nota de tool já existente: `skipped` 1, `.db` gravado como `<id>.db`, `onProgress` termina em (total, total); (d) instalar de novo sobrescreve o `.db` e pula notas; (e) `{ toolPath }` grava só index, a tool e os requests dela; (f) `removePackage` com `deleteNotes` falso manda só o `.db` para a lixeira, com verdadeiro também os arquivos do manifesto.

**BDD (estado esperado ao concluir)**
- Dado duas entradas com o mesmo `groupId`, Quando chamo `groupCatalogEntries`, Então recebo uma linha com `toolCount` somado.
- Dado `{ toolPath: "x" }` fora do manifesto, Quando chamo `filesToInstall`, Então recebo `[]`.
- Dado um cofre sem a nota "MCP Tools", Quando chamo `ensureHubFolder`, Então a nota `MCP Tools.md` é criada na raiz e o retorno é `""`.
- Dado um pacote com index, 2 tools e 1 database, Quando instalo `"all"`, Então o `.db` é gravado como `<id>.db` e as notas existentes são puladas.
- Dado `deleteNotes` falso, Quando removo, Então só o `.db` vai para a lixeira.

**Verificação**
- `Set-Location C:\Users\Trabalho\Documents\obsidian-ai-ecosystem; npx vitest run tests/mcp-packages` → todos passam
- `npm run typecheck` → sem erros

**Prompt para o subagente**
```text
Você é o executor desta etapa. Tarefa: criar, no plugin Obsidian "AI Ecosystem", o catálogo de pacotes MCP (função pura) e o instalador/removedor de pacotes (Node puro), com testes.

CONTEXTO: repositório C:\Users\Trabalho\Documents\obsidian-ai-ecosystem (TypeScript, vitest). Estamos movendo para ele o "Baixar MCP" do Env Keys (C:\Users\Trabalho\Documents\obsidian-environment-variables). Código e comentários em inglês, curtos.

FAÇA:
1. Leia C:\Users\Trabalho\Documents\obsidian-environment-variables\src\tools\mcpCatalog.ts (1-167), o downloadMcpPackage/ensureMcpHubNote em C:\Users\Trabalho\Documents\obsidian-environment-variables\src\main.ts (1220-1330) e C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\catalog\semver.test.ts (estilo de import).
2. Crie C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\mcp-packages\catalog.ts portando, com os mesmos nomes e lógica: McpCatalogEntry, McpCatalog, McpCatalogGroup, groupCatalogEntries, McpPackageFileKind, McpPackageFile, McpPackageManifest, GithubReader { fetchText(path); fetchBinary(path) }, fetchCatalog, fetchPackageManifest, McpDownloadSelection, filesToInstall, SERVICE_APPS (não exportado) e appForEntry. NÃO porte needsServiceTemplate nem serviceTemplateFileName. Acrescente export const MCP_PACKAGES_CATALOG_URL = "https://raw.githubusercontent.com/EmanuellCarvalhoPires/environment-keys-mcp-packages/main" e export function isAllowedCatalogUrl(url: string): boolean (true só se começa com "https://raw.githubusercontent.com/EmanuellCarvalhoPires/"). Sem import de "obsidian".
3. Crie C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\mcp-packages\package-installer.ts exportando exatamente: interface McpPackageStore { findNoteFolder(basename): Promise<string | undefined>; exists(path): Promise<boolean>; ensureFolder(path): Promise<void>; createText(path, content): Promise<void> /* nunca sobrescreve */; writeBinary(path, data: ArrayBuffer): Promise<void> /* cria ou sobrescreve */; trash(path): Promise<void> }; const MCP_HUB_NOTE_NAME = "MCP Tools"; interface InstallResult { written: number; skipped: number }; ensureHubFolder(store): se findNoteFolder("MCP Tools") achar, devolve a pasta; senão cria "MCP Tools.md" na raiz com as linhas (unidas por "\n"): "---", "tags:", "  - moc", "  - mcp", "---", "# MCP Tools", "", "Index of the MCP tool packages downloaded through AI Ecosystem.", "", "## Related notes", "```dataview", "LIST FROM [[]] WHERE contains(flat(list(up)), this.file.link)", "SORT file.name ASC", "```", "" e devolve ""; packageTargetFolder(hubFolder, entry) = hubFolder ? `${hubFolder}/${entry.name}` : entry.name; targetPathOf(folder, entry, file): kind "database" vira `${folder}/${entry.id}.db`, os demais `${folder}/${file.path}`, com "\" trocado por "/"; installPackage(store, reader, entry, manifest, selection, onProgress?): usa filesToInstall; cria pastas com ensureFolder (uma vez cada); database: reader.fetchBinary + writeBinary (sempre sobrescreve, conta em written); demais: se exists conta em skipped, senão fetchText + createText e conta em written; onProgress(written + skipped, total) após cada arquivo; devolve { written, skipped }; removePackage(store, hubFolder, entry, manifest | undefined, deleteNotes): sempre trash do .db se existir (caminho do database do manifesto ou `${folder}/${entry.id}.db`); se deleteNotes e há manifesto, trash dos arquivos não-database que existirem. Nunca apaga pastas.
4. Crie os testes C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\mcp-packages\catalog.test.ts e package-installer.test.ts com store e reader falsos em memória. Cubra: groupCatalogEntries soma toolCount do mesmo groupId; filesToInstall "all", { toolPath } (sem duplicatas) e toolPath inexistente ([]); appForEntry ("atlassian/instance" e "bitbucket/workspace" -> "Atlassian"; sem serviceTag -> undefined); fetchCatalog válido e sem packages (erro "Invalid catalog"); isAllowedCatalogUrl (aceita a padrão, rejeita https://example.com/x); ensureHubFolder cria a nota quando falta e devolve a pasta quando a nota existe em "Dados"; installPackage com index, 2 tools e 1 database (nota existente pulada, .db como <id>.db, onProgress termina em total); reinstalação sobrescreve o .db; { toolPath } grava só index, a tool e seus requests; removePackage com deleteNotes falso só manda o .db para trash.

NÃO FAÇA: não altere outros arquivos; não leia .db aqui; não faça commit nem push; não mude versões.

VERIFIQUE (PowerShell): Set-Location C:\Users\Trabalho\Documents\obsidian-ai-ecosystem; npx vitest run tests/mcp-packages -> passam. npm run typecheck -> sem erros.

Se um arquivo ou símbolo citado não existir como descrito, PARE e relate; não improvise.

RELATÓRIO FINAL: arquivos criados, saída real dos comandos, desvios.
```

## Etapa 2: Leitor de mcp.db e construtor do índice [Haiku 5.5 | esforço: médio]

**Objetivo:** ler um `.db` de pacote em modo somente leitura e transformar as tools em entradas de índice `kind: "api"`, com funções puras e testes.
**Depende de:** nenhuma
**Paralelizável com:** Etapas 1, 6, 8

**Arquivos**
- Criar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\mcp-packages\package-db.ts`
- Criar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\mcp-packages\package-index.ts`
- Criar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\mcp-packages\package-db.test.ts`
- Criar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\mcp-packages\package-index.test.ts`
- Não tocar: qualquer outro arquivo

**Regras de implementação**
1. `package-db.ts`: `import { DatabaseSync } from "node:sqlite";` (como em `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\tool-index\schema.ts`). Abrir com `{ readOnly: true }` e fechar em `finally`. Exportar `McpDbToolRow`, `McpDbRequestRow`, `McpDbPackageRow` copiados de `C:\Users\Trabalho\Documents\obsidian-environment-variables\src\tools\mcpDb.ts` (linhas 9-47). `export interface PackageDbContent { package: McpDbPackageRow | undefined; tools: McpDbToolRow[]; requests: Map<string, McpDbRequestRow> }` e `export function readPackageDb(filePath: string): PackageDbContent`: `package` = primeira linha de `SELECT * FROM packages LIMIT 1` (erro vira undefined); `tools` = `SELECT * FROM tools` (erro vira []); `requests` = `SELECT * FROM requests` indexado por id (erro vira Map vazio). Arquivo que não abre: o erro sobe. Não interpreta JSON.
2. `package-index.ts`, funções puras, sem import de "obsidian". Importa `ToolIndexEntry`, `ToolEffect` de `../types`. Portar de `C:\Users\Trabalho\Documents\obsidian-environment-variables\src\tools\apiIndex.ts` (inteiro), `inputSchema` de `definition.ts` (linhas 235-250) e `exampleOf` de `apiIndex.ts`:
   - `effectOf(writes: boolean, endpoint?: { method: string; path: string }): ToolEffect`: sem endpoint, `writes ? "externo" : "leitura"`; GET/HEAD/OPTIONS, `"leitura"`; POST com path que casa `/\/(search(\/jql)?|jql\/(parse|autocompletedata\/suggestions|match))(\/|\?|$)/i`, `"leitura"`; demais, `"externo"`.
   - `inputSchemaFromParams(params)` e `exampleFromParams(params)`.
   - `slugKey(text)` (minúsculas, não alfanuméricos viram "-", sem "-" nas pontas) e `packageKeys(pkg, folderName, basename): string[]` com slugKey de pkg.id, pkg.name, pkg.app, pkg.group_id, folderName e basename, sem vazios nem repetidos.
   - `buildPackageIndexEntries(content: PackageDbContent, fallbackName: string, keys: string[]): ToolIndexEntry[]`: por linha de `tools`, params = `JSON.parse(params_schema ?? "{}")` (falha: `{}`); tags = `JSON.parse(tags ?? "[]")` (falha: `[]`); writes = alguma tag contém write/create/delete/update; request = `content.requests.get(request_id)` quando não nulo; endpoint = `{ method, path }` do request. Entrada: `name` = row.id; `title`; `description` = (endpoint ? `${METHOD} ${path}. ` : "") + descrição em uma linha (espaços colapsados, máximo 4000, termina em "…" se cortar); `inputSchema`; `kind: "api"`; `categoria` = pkg?.name || pkg?.app || fallbackName; `tags` = `[...new Set(["api", ...(endpoint ? [method.toLowerCase()] : []), ...keys])]`; `resumo` = título (ou descrição) em uma linha de até 100; `efeito`; `exposicao: "indice"`; `exemplo`.

**Passos**
1. Ler os arquivos de origem citados e `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\types\index.ts` (linhas 150-290).
2. Implementar os dois arquivos.
3. Testes de `package-db`: criar `.db` temporários em `os.tmpdir()` (pasta única, apagada no fim) com `DatabaseSync` gravável: (a) completo, com pacote, 2 tools e 1 request, conferido; (b) só com a tabela tools (`package` undefined); (c) sem tabelas (`tools` []); arquivo inexistente lança erro.
4. Testes de `package-index` com `PackageDbContent` montado à mão: GET `/rest/api/3/issue/{id}` (efeito "leitura", descrição começa com "GET /rest/api/3/issue/{id}.", tags com "api" e "get"); POST `/rest/api/3/search/jql` ("leitura"); DELETE ("externo"); tool sem request com tag "write" ("externo") e sem tag ("leitura"); params com um obrigatório sem default e um com default (`required` só o primeiro; exemplo com "<nome>" para o primeiro); params_schema inválido não lança.

**BDD (estado esperado ao concluir)**
- Dado um `.db` completo, Quando leio, Então o pacote, as 2 tools e o request por id estão corretos.
- Dado um `.db` sem tabelas, Quando leio, Então `tools` é `[]` e não lança.
- Dado uma tool com request `GET`, Quando construo a entrada, Então `efeito` é `leitura` e a descrição começa com `GET /rest/api/3/issue/{id}.`.
- Dado uma tool com request `DELETE`, Então `efeito` é `externo`.
- Dado `params_schema` inválido, Então a entrada sai sem lançar.

**Verificação**
- `Set-Location C:\Users\Trabalho\Documents\obsidian-ai-ecosystem; npx vitest run tests/mcp-packages/package-db.test.ts tests/mcp-packages/package-index.test.ts` → passam
- `npm run typecheck` → sem erros

**Prompt para o subagente**
```text
Você é o executor desta etapa. Tarefa: criar no plugin Obsidian "AI Ecosystem" o leitor somente-leitura de arquivos .db de pacotes MCP e o construtor das entradas de índice das tools, com testes.

CONTEXTO: repositório C:\Users\Trabalho\Documents\obsidian-ai-ecosystem (TypeScript, vitest). Um pacote é um SQLite (.db) com as tabelas packages, tools e requests. Hoje quem o lê e indexa é o Env Keys (C:\Users\Trabalho\Documents\obsidian-environment-variables, src\tools\mcpDb.ts e src\tools\apiIndex.ts). O resultado deve significar o mesmo que o Env Keys gera hoje. Código e comentários em inglês, curtos. Nenhum arquivo desta etapa importa "obsidian".

FAÇA:
1. Leia C:\Users\Trabalho\Documents\obsidian-environment-variables\src\tools\mcpDb.ts (1-200), C:\Users\Trabalho\Documents\obsidian-environment-variables\src\tools\apiIndex.ts (inteiro), C:\Users\Trabalho\Documents\obsidian-environment-variables\src\tools\definition.ts (linhas 235-250), C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\tool-index\schema.ts (uso de DatabaseSync) e os tipos ToolIndexEntry e ToolEffect em C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\types\index.ts (150-290).
2. Crie C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\mcp-packages\package-db.ts: abre com new DatabaseSync(filePath, { readOnly: true }) e fecha num finally; exporta McpDbToolRow, McpDbRequestRow, McpDbPackageRow (copie de mcpDb.ts linhas 9-47), PackageDbContent { package: McpDbPackageRow | undefined; tools: McpDbToolRow[]; requests: Map<string, McpDbRequestRow> } e readPackageDb(filePath): package = primeira linha de "SELECT * FROM packages LIMIT 1" (erro vira undefined); tools = "SELECT * FROM tools" (erro vira []); requests = "SELECT * FROM requests" indexado por id (erro vira Map vazio); arquivo que não abre: erro sobe. Não interprete JSON.
3. Crie C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\mcp-packages\package-index.ts (puro) exportando: effectOf(writes, endpoint?) (sem endpoint: writes ? "externo" : "leitura"; GET/HEAD/OPTIONS: "leitura"; POST com path que casa /\/(search(\/jql)?|jql\/(parse|autocompletedata\/suggestions|match))(\/|\?|$)/i: "leitura"; demais: "externo"); inputSchemaFromParams(params) (lógica de inputSchema de definition.ts); exampleFromParams(params) (lógica de exampleOf de apiIndex.ts); slugKey(text) (minúsculas, não alfanuméricos viram "-", sem "-" nas pontas); packageKeys(pkg, folderName, basename) (slugKey de pkg.id, pkg.name, pkg.app, pkg.group_id, folderName, basename, sem vazios nem repetidos); buildPackageIndexEntries(content, fallbackName, keys): por linha de content.tools: params = JSON.parse(params_schema ?? "{}") (falha: {}); tags = JSON.parse(tags ?? "[]") (falha: []); writes = alguma tag com write/create/delete/update; request = content.requests.get(request_id) quando não nulo; endpoint = { method, path } do request. Entrada: name = row.id; title = row.title; description = (endpoint ? `${METHOD} ${path}. ` : "") + descrição em uma linha (espaços colapsados, máximo 4000, termina em "…" se cortar); inputSchema; kind "api"; categoria = pkg?.name || pkg?.app || fallbackName; tags = [...new Set(["api", ...(endpoint ? [method.toLowerCase()] : []), ...keys])]; resumo = título ou descrição em uma linha de até 100; efeito = effectOf(writes, endpoint); exposicao "indice"; exemplo = exampleFromParams(params).
4. Crie os testes C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\mcp-packages\package-db.test.ts (.db temporários em os.tmpdir(), pasta única apagada no fim; casos: completo; só tabela tools; sem tabelas; arquivo inexistente lança) e package-index.test.ts (PackageDbContent à mão; casos: GET /rest/api/3/issue/{id} -> "leitura", descrição começa com "GET /rest/api/3/issue/{id}.", tags com "api" e "get"; POST /rest/api/3/search/jql -> "leitura"; DELETE -> "externo"; sem request com tag write -> "externo", sem tag -> "leitura"; params com um obrigatório sem default e um com default (required só o primeiro, exemplo com "<nome>" para o primeiro); params_schema inválido não lança).

NÃO FAÇA: não altere outros arquivos; não faça commit nem push; não mude versões.

VERIFIQUE (PowerShell): Set-Location C:\Users\Trabalho\Documents\obsidian-ai-ecosystem; npx vitest run tests/mcp-packages/package-db.test.ts tests/mcp-packages/package-index.test.ts -> passam. npm run typecheck -> sem erros.

Se "node:sqlite" não abrir no teste, PARE e relate a mensagem exata; não troque de biblioteca.

RELATÓRIO FINAL: arquivos criados, saída real dos comandos, desvios.
```

## Etapa 3: Contrato público e McpPackageService [Haiku 5.5 | esforço: alto]

**Objetivo:** declarar o contrato do serviço `mcp-packages` e criar o `McpPackageService`, que descobre os pacotes instalados, instala, remove e fornece as entradas de índice.
**Depende de:** Etapas 1, 2
**Paralelizável com:** Etapas 6, 8

**Arquivos**
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\types\index.ts` (apenas acréscimo no fim)
- Criar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\mcp-packages\package-service.ts`
- Criar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\mcp-packages\package-service.test.ts`
- Não tocar: qualquer outro arquivo

**Regras de implementação**
1. Em `src\types\index.ts`, no fim, sem mudar nada existente, acrescentar com comentários curtos: `export const MCP_PACKAGES_SERVICE = "mcp-packages";`; `export interface InstalledMcpPackage { id; name; app; tag; logo; serviceTag?; groupId?; toolCount: number; dbPath: string /* vault-relative */ }`; `export interface McpPackagesService { list(): InstalledMcpPackage[]; onChange(listener: () => void): () => void }`; `export interface McpPackagesHost extends McpPackagesService { indexEntries(): ToolIndexEntry[] }`.
2. `package-service.ts` exporta `McpPackageServiceDeps { store: McpPackageStore; reader: () => GithubReader; listDbFiles: () => Array<{ path: string; absPath: string }>; catalogUrl?: string }` e `class McpPackageService implements McpPackagesHost`:
   - `fetchCatalog()`: url = `deps.catalogUrl ?? MCP_PACKAGES_CATALOG_URL`; se `!isAllowedCatalogUrl(url)` lança `Error("Catalog URL not allowed")`; senão `fetchCatalog(deps.reader())`. `fetchManifest(entry)` idem com `fetchPackageManifest`.
   - `list()` e `indexEntries()`: devolvem o cache; se nunca houve refresh, fazem um refresh silencioso antes. `isInstalled(entryId)`.
   - `refresh()`: para cada item de `listDbFiles()`, `readPackageDb(absPath)` (erro: console.warn e segue). É pacote quando `package` existe OU `tools.length > 0`. `id` = `package?.id || basename sem extensão`. `name` = `package?.name || package?.app || nome da pasta pai`; `app` = `package?.app ?? ""`; `tag`, `logo` idem; `serviceTag` = `package?.service_tag ?? undefined`; `groupId` = `package?.group_id ?? undefined`; `toolCount` = tools.length; `dbPath` = path. Entradas: `buildPackageIndexEntries(content, name, packageKeys(package, nome da pasta pai, basename))`. Id repetido em dois .db: vale o primeiro. Ordena por `name`. Guarda assinatura (`id|toolCount|updated_at` de cada pacote, concatenados) e só notifica ouvintes quando ela muda.
   - `install(entry, manifest, selection, onProgress?)`: `ensureHubFolder(store)`, `installPackage`, `refresh()`. `remove(entry, manifest | undefined, deleteNotes)`: `ensureHubFolder`, `removePackage`, `refresh()`.
   - `onChange(listener)`: devolve função de cancelamento; exceção de um ouvinte não impede os outros.
3. Sem import de "obsidian".
4. `package-service.test.ts` com store e reader falsos e `.db` temporários reais (`DatabaseSync` em `os.tmpdir()`, pasta única apagada no fim). Cubra: dois pacotes listados e ordenados por nome com toolCount certo; um arquivo corrompido não derruba os outros; `.db` sem tabelas não aparece; ouvinte NÃO é chamado quando refresh não muda e é chamado uma vez quando surge pacote novo; `indexEntries()` tem as entradas `kind: "api"`; install seguido de remove faz `isInstalled` ir de false para true para false (o `listDbFiles` falso lê o store falso, que grava os bytes do .db num temporário); `catalogUrl` "https://example.com/x" faz `fetchCatalog` lançar "Catalog URL not allowed".

**Passos**
1. Ler `src\types\index.ts` (150-290 e o fim), os arquivos das Etapas 1 e 2 e um teste vizinho.
2. Implementar o acréscimo, o serviço e o teste.

**BDD (estado esperado ao concluir)**
- Dado dois `.db` de pacotes, Quando chamo `list()`, Então recebo dois `InstalledMcpPackage` ordenados por nome.
- Dado um `.db` corrompido, Então os outros pacotes continuam listados.
- Dado refresh sem mudança, Então o ouvinte não é chamado; com pacote novo, é chamado uma vez.
- Dado install seguido de remove, Então `isInstalled` vai de false para true para false.
- Dado `catalogUrl` fora do GitHub do autor, Quando chamo `fetchCatalog`, Então lança "Catalog URL not allowed".

**Verificação**
- `Set-Location C:\Users\Trabalho\Documents\obsidian-ai-ecosystem; npx vitest run tests/mcp-packages` → todos passam
- `npm run typecheck` → sem erros

**Prompt para o subagente**
```text
Você é o executor desta etapa. Tarefa: declarar o contrato público do serviço "mcp-packages" e criar o McpPackageService do plugin Obsidian "AI Ecosystem", com testes.

CONTEXTO: repositório C:\Users\Trabalho\Documents\obsidian-ai-ecosystem (TypeScript, vitest). Em C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\mcp-packages\ já existem catalog.ts (MCP_PACKAGES_CATALOG_URL, isAllowedCatalogUrl, fetchCatalog, fetchPackageManifest, GithubReader), package-installer.ts (McpPackageStore, installPackage, removePackage, ensureHubFolder), package-db.ts (readPackageDb, PackageDbContent) e package-index.ts (buildPackageIndexEntries, packageKeys). Leia-os antes. Código e comentários em inglês, curtos. O service NÃO importa "obsidian".

FAÇA:
1. Em C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\types\index.ts acrescente, no fim e sem mudar nada existente: export const MCP_PACKAGES_SERVICE = "mcp-packages"; export interface InstalledMcpPackage { id: string; name: string; app: string; tag: string; logo: string; serviceTag?: string; groupId?: string; toolCount: number; dbPath: string }; export interface McpPackagesService { list(): InstalledMcpPackage[]; onChange(listener: () => void): () => void }; export interface McpPackagesHost extends McpPackagesService { indexEntries(): ToolIndexEntry[] }.
2. Crie C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\mcp-packages\package-service.ts exportando McpPackageServiceDeps { store: McpPackageStore; reader: () => GithubReader; listDbFiles: () => Array<{ path: string; absPath: string }>; catalogUrl?: string } e class McpPackageService implements McpPackagesHost, com:
   - fetchCatalog(): url = deps.catalogUrl ?? MCP_PACKAGES_CATALOG_URL; se !isAllowedCatalogUrl(url) lança Error("Catalog URL not allowed"); senão fetchCatalog(deps.reader()). fetchManifest(entry) usa fetchPackageManifest.
   - list() e indexEntries() devolvem o cache; se nunca houve refresh, fazem refresh silencioso antes. isInstalled(entryId).
   - refresh(): para cada item de listDbFiles(): readPackageDb(absPath) (erro: console.warn e segue). É pacote quando package existe OU tools.length > 0. id = package?.id || basename sem extensão. name = package?.name || package?.app || nome da pasta pai; app = package?.app ?? ""; tag e logo idem; serviceTag = package?.service_tag ?? undefined; groupId = package?.group_id ?? undefined; toolCount = tools.length; dbPath = path. Entradas de índice: buildPackageIndexEntries(content, name, packageKeys(package, nome da pasta pai, basename)). Id repetido: vale o primeiro. Ordena por name. Guarde assinatura (id|toolCount|updated_at concatenados) e notifique os ouvintes só quando mudar.
   - install(entry, manifest, selection, onProgress?): ensureHubFolder(store), installPackage, refresh(). remove(entry, manifest | undefined, deleteNotes): ensureHubFolder, removePackage, refresh().
   - onChange(listener) devolve a função de cancelamento; exceção de um ouvinte não impede os outros.
3. Crie C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\mcp-packages\package-service.test.ts com .db temporários reais (DatabaseSync de "node:sqlite" em os.tmpdir(), pasta única apagada no fim), store e reader falsos. Cubra: dois pacotes listados e ordenados por name com toolCount certo; um arquivo corrompido não derruba os outros; .db sem tabelas não aparece; ouvinte NÃO chamado quando refresh não muda e chamado uma vez quando surge pacote novo; indexEntries() com entradas kind "api" de todos; install seguido de remove faz isInstalled ir de false para true para false (o listDbFiles falso lê o store falso, que grava os bytes em disco temporário); catalogUrl "https://example.com/x" faz fetchCatalog lançar "Catalog URL not allowed".

NÃO FAÇA: não altere outros arquivos além de types\index.ts (só acréscimo); não mexa em ecosystem.ts nem main.ts; não faça commit nem push; não mude versões.

VERIFIQUE (PowerShell): Set-Location C:\Users\Trabalho\Documents\obsidian-ai-ecosystem; npx vitest run tests/mcp-packages -> todos passam. npm run typecheck -> sem erros.

Se algum arquivo ou nome citado não existir como descrito, PARE e relate; não improvise.

RELATÓRIO FINAL: arquivos criados/alterados, saída real dos comandos, desvios.
```

## Etapa 4: Adaptadores do Obsidian e ligação no main.ts do núcleo [Haiku 5.5 | esforço: médio]

**Objetivo:** implementar o `McpPackageStore` e o `GithubReader` sobre a API do Obsidian, listar os `.db` do cofre, e ligar o `McpPackageService` ao `main.ts` do núcleo com atualização automática.
**Depende de:** Etapas 1, 3
**Paralelizável com:** Etapas 5, 6, 8

**Arquivos**
- Criar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\mcp-packages\obsidian-store.ts`
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\main.ts`
- Não tocar: qualquer outro arquivo

**Regras de implementação**
1. `obsidian-store.ts` exporta:
   - `class ObsidianMcpPackageStore implements McpPackageStore` com construtor `(private readonly app: App)`: `findNoteFolder(basename)` acha em `app.vault.getMarkdownFiles()` o arquivo de `basename` e devolve `parent.path` ("/" vira ""), ou undefined; `exists(path)` com `normalizePath`; `ensureFolder(path)` cria cada nível que falta com `createFolder`, ignorando "já existe"; `createText` com `app.vault.create`; `writeBinary` usa `modifyBinary` se houver TFile, senão `createBinary`; `trash` usa `app.fileManager.trashFile` se houver o arquivo.
   - `class HttpGithubReader implements GithubReader` com construtor `(private readonly baseUrl: string)`, mesma lógica de `C:\Users\Trabalho\Documents\obsidian-environment-variables\src\tools\githubReader.ts`: `requestUrl` com `throw: false`; status fora de 200-299 lança `Error(\`${status} fetching ${path}\`)`.
   - `listVaultDbFiles(app: App): Array<{ path: string; absPath: string }>`: arquivos com `extension === "db"`; `absPath` via `getBasePath()` do `FileSystemAdapter`; sem adaptador, `[]`.
2. Nada de `fetch`, `innerHTML` ou `any`.
3. Em `main.ts`: importar `McpPackageService`, `ObsidianMcpPackageStore`, `HttpGithubReader`, `listVaultDbFiles` e `MCP_PACKAGES_CATALOG_URL`. Declarar `private mcpPackages!: McpPackageService;` e `get packages(): McpPackageService { return this.mcpPackages; }`. Em `onload()`, depois de confirmar o `FileSystemAdapter` e ANTES de `new Ecosystem(...)`: `this.mcpPackages = new McpPackageService({ store: new ObsidianMcpPackageStore(this.app), reader: () => new HttpGithubReader(MCP_PACKAGES_CATALOG_URL), listDbFiles: () => listVaultDbFiles(this.app) })` e passe `mcpPackages: this.mcpPackages` nas deps do `Ecosystem`.
4. Atualização automática: `const refreshPackagesSoon = debounce(() => this.mcpPackages?.refresh(), 1000, true);` como campo da classe, ao lado dos outros debounce; `this.registerEvent(this.app.vault.on("create" | "delete" | "rename", (file) => ...))` chamando `refreshPackagesSoon()` quando `file.path` termina em ".db"; `this.app.workspace.onLayoutReady(() => this.mcpPackages.refresh())`. Cancelar `refreshPackagesSoon` em `onunload()`.
5. Não mude mais nada em `main.ts`.

**Passos**
1. Ler `C:\Users\Trabalho\Documents\obsidian-environment-variables\src\tools\githubReader.ts` e `C:\Users\Trabalho\Documents\obsidian-environment-variables\src\main.ts` (1250-1300, como o Env Keys grava arquivos).
2. Ler `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\main.ts` inteiro (1-135 já mostram onload/onunload).
3. Criar `obsidian-store.ts` e editar `main.ts`.

**BDD (estado esperado ao concluir)**
- Dado o projeto, Quando rodo typecheck e lint, Então passam sem avisos novos.
- Dado um cofre sem `FileSystemAdapter`, Quando chamo `listVaultDbFiles`, Então recebo `[]`.
- Dado o código, Então `new Ecosystem({...})` recebe `mcpPackages` e `onunload` cancela o debounce novo.

**Verificação**
- `Set-Location C:\Users\Trabalho\Documents\obsidian-ai-ecosystem; npm run typecheck` → sem erros
- `npx eslint src/mcp-packages/obsidian-store.ts src/main.ts` → sem erros
- `npx vitest run` → passam

**Prompt para o subagente**
```text
Você é o executor desta etapa. Tarefa: criar os adaptadores do Obsidian para o instalador de pacotes MCP e ligar o McpPackageService ao main.ts do plugin "AI Ecosystem".

CONTEXTO: repositório C:\Users\Trabalho\Documents\obsidian-ai-ecosystem (TypeScript, ESLint com eslint-plugin-obsidianmd). Já existem em src\mcp-packages\: catalog.ts (GithubReader, MCP_PACKAGES_CATALOG_URL), package-installer.ts (McpPackageStore), package-service.ts (McpPackageService com construtor McpPackageServiceDeps { store, reader, listDbFiles }). O Ecosystem já aceita a dep opcional mcpPackages. Código e comentários em inglês, curtos.

FAÇA:
1. Leia C:\Users\Trabalho\Documents\obsidian-environment-variables\src\tools\githubReader.ts e C:\Users\Trabalho\Documents\obsidian-environment-variables\src\main.ts (1250-1300, como o Env Keys grava arquivos).
2. Crie C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\mcp-packages\obsidian-store.ts exportando: class ObsidianMcpPackageStore implements McpPackageStore (construtor (private readonly app: App)): findNoteFolder(basename) acha o arquivo de basename em app.vault.getMarkdownFiles() e devolve parent.path ("/" vira ""), ou undefined; exists(path) com normalizePath; ensureFolder(path) cria cada nível que falta com createFolder, ignorando "já existe"; createText com app.vault.create; writeBinary usa modifyBinary se houver TFile, senão createBinary; trash usa app.fileManager.trashFile se o arquivo existir. class HttpGithubReader implements GithubReader (construtor (private readonly baseUrl: string)), igual ao githubReader.ts do Env Keys: requestUrl com throw: false; status fora de 200-299 lança Error(`${status} fetching ${path}`) (fetchBinary: `... fetching binary ${path}`). export function listVaultDbFiles(app: App): Array<{ path; absPath }> com os arquivos de extension "db" e absPath via getBasePath() do FileSystemAdapter (sem adaptador: []). Sem fetch, innerHTML nem any.
3. Em C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\main.ts (leia inteiro antes): importe McpPackageService, ObsidianMcpPackageStore, HttpGithubReader, listVaultDbFiles e MCP_PACKAGES_CATALOG_URL. Declare private mcpPackages!: McpPackageService; e get packages(): McpPackageService. Em onload(), depois de confirmar o FileSystemAdapter e ANTES de new Ecosystem(...): this.mcpPackages = new McpPackageService({ store: new ObsidianMcpPackageStore(this.app), reader: () => new HttpGithubReader(MCP_PACKAGES_CATALOG_URL), listDbFiles: () => listVaultDbFiles(this.app) }); e passe mcpPackages: this.mcpPackages nas deps do new Ecosystem. Crie como campo: private readonly refreshPackagesSoon = debounce(() => this.mcpPackages?.refresh(), 1000, true); registre com this.registerEvent os eventos vault "create", "delete" e "rename" chamando refreshPackagesSoon() quando file.path termina em ".db"; adicione this.app.workspace.onLayoutReady(() => this.mcpPackages.refresh()) junto do onLayoutReady que já existe. Em onunload(), cancele refreshPackagesSoon com os outros cancel(). Não mude mais nada.

NÃO FAÇA: não altere outros arquivos; não crie testes (esta camada depende do Obsidian); não faça commit nem push; não mude versões.

VERIFIQUE (PowerShell): Set-Location C:\Users\Trabalho\Documents\obsidian-ai-ecosystem; npm run typecheck -> sem erros. npx eslint src/mcp-packages/obsidian-store.ts src/main.ts -> sem erros. npx vitest run -> todos passam.

Se algum arquivo ou símbolo citado não existir, PARE e relate; não improvise.

RELATÓRIO FINAL: arquivos criados/alterados, saída real dos comandos, desvios.
```

## Etapa 5: Integração no Ecosystem (índice e runner) [Haiku 5.5 | esforço: alto]

**Objetivo:** fazer o `Ecosystem` mesclar as tools dos pacotes no `tools.db` do núcleo numa única gravação, publicar o serviço `mcp-packages` e o runner `tool-runner:ai-ecosystem` que repassa ao Env Keys, com testes.
**Depende de:** Etapa 3
**Paralelizável com:** Etapas 4, 6, 8

**Arquivos**
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\core\ecosystem.ts`
- Criar ou alterar: um teste em `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\tests\core\` (o que já instancia `new Ecosystem(`; se não houver, `mcp-packages-integration.test.ts`)
- Não tocar: qualquer outro arquivo

**Regras de implementação**
1. Em `EcosystemDeps` acrescentar `mcpPackages?: McpPackagesHost;`.
2. `syncCoreIndex()`: depois das entradas nativas, acrescentar `this.deps.mcpPackages?.indexEntries() ?? []` descartando as cujo `name` já existe nas nativas. Continua UMA só chamada a `sync(ECOSYSTEM_ID, entries)`, com a mesma proteção try/catch.
3. No construtor, num ponto em que `this.bus` já exista, se `deps.mcpPackages` existir: `this.bus.register(MCP_PACKAGES_SERVICE, ECOSYSTEM_ID, { list: () => mp.list(), onChange: (l) => mp.onChange(l) })` (só o contrato público); `this.bus.register(toolRunnerServiceName(ECOSYSTEM_ID), ECOSYSTEM_ID, runner)`, onde `runner: IndexedToolRunner` obtém `this.bus.get<IndexedToolRunner>(toolRunnerServiceName("environment-variables"))`: se não houver ou não tiver `run`, devolve `{ content: [{ type: "text", text: "This tool needs the Environment Keys plugin, which is not active. Enable it and try again." }], isError: true }`; senão devolve `await alvo.run(id, args, { ...ctx, moduleId: "environment-variables" })`; e `mp.onChange(() => this.syncCoreIndex())`.
4. Se `syncCoreIndex()` não roda na inicialização, chame-o no fim de `start()`, antes de `this.server.start()`.
5. Não altere `ToolFederation` (`src\tool-index\federation.ts`).

**Passos**
1. Ler `src\core\ecosystem.ts` inteiro (procure `syncCoreIndex`, `this.bus`, `start(`), `src\tool-index\discovery-tools.ts` (235-310) e os tipos em `src\types\index.ts` (`IndexedToolRunner`, `toolRunnerServiceName`).
2. Implementar.
3. Teste: copie o helper de criação do `Ecosystem` de um teste existente (procure `new Ecosystem(` em `tests`), com `vaultBasePath` temporário, `configDir` e um `mcpPackages` falso com 2 entradas `kind: "api"`.

**BDD (estado esperado ao concluir)**
- Dado um `mcpPackages` com 2 entradas, Quando o Ecosystem inicia, Então `ecosystem.toolIndex.find({ q: "<nome de uma entrada>" })` a encontra com `moduleId` "ai-ecosystem" e kind "api", e as nativas continuam lá.
- Dado `onChange` disparado com 1 entrada a menos, Então essa entrada sai do `tools.db` e as nativas ficam.
- Dado nenhum `tool-runner:environment-variables`, Quando chamo `tool-runner:ai-ecosystem`, Então volta `isError: true` com a mensagem citada.
- Dado um runner falso do Env Keys, Quando chamo o do núcleo, Então ele recebe `ctx.moduleId === "environment-variables"` e o resultado volta igual.
- Dado `deps.mcpPackages` ausente, Então os testes existentes continuam passando.

**Verificação**
- `Set-Location C:\Users\Trabalho\Documents\obsidian-ai-ecosystem; npx vitest run tests/core` → passam
- `npm run typecheck` → sem erros

**Prompt para o subagente**
```text
Você é o executor desta etapa. Tarefa: integrar o gerenciador de pacotes MCP à classe Ecosystem do plugin Obsidian "AI Ecosystem" (índice de tools, serviço público e runner), com teste.

CONTEXTO: repositório C:\Users\Trabalho\Documents\obsidian-ai-ecosystem (TypeScript, vitest). Ecosystem (src\core\ecosystem.ts) grava o tools.db do próprio núcleo (módulo "ai-ecosystem") em syncCoreIndex() com new ToolIndexWriter(this.coreIndexFile).sync(ECOSYSTEM_ID, entries). O sync apaga o que não está na lista, então as tools dos pacotes entram NESSA MESMA chamada. A tool tools_run (src\tool-index\discovery-tools.ts, ~235-310) executa entradas indexadas que não são tools registradas, chamando o serviço do barramento toolRunnerServiceName(moduleId) (interface IndexedToolRunner { run(id, args, ctx) }). A Etapa 3 criou em src\types\index.ts: MCP_PACKAGES_SERVICE, McpPackagesService, McpPackagesHost { indexEntries() }. As tools dos pacotes são executadas pelo Env Keys (id "environment-variables", serviço tool-runner:environment-variables). Código e comentários em inglês, curtos.

FAÇA:
1. Leia src\core\ecosystem.ts inteiro (syncCoreIndex, this.bus, start(), onde syncCoreIndex é chamado), src\tool-index\discovery-tools.ts (235-310) e src\types\index.ts (IndexedToolRunner, toolRunnerServiceName, HubToolResult e os tipos novos do fim).
2. Em ecosystem.ts: (a) em EcosystemDeps acrescente mcpPackages?: McpPackagesHost; (b) em syncCoreIndex(), depois das entradas nativas, acrescente this.deps.mcpPackages?.indexEntries() ?? [] descartando as de name já existente entre as nativas; mantenha UMA chamada de sync(ECOSYSTEM_ID, entries) e a mesma proteção try/catch; (c) no construtor, onde this.bus já existir, se deps.mcpPackages existir: this.bus.register(MCP_PACKAGES_SERVICE, ECOSYSTEM_ID, { list: () => mp.list(), onChange: (l) => mp.onChange(l) }); this.bus.register(toolRunnerServiceName(ECOSYSTEM_ID), ECOSYSTEM_ID, runner), com runner: IndexedToolRunner que pega this.bus.get<IndexedToolRunner>(toolRunnerServiceName("environment-variables")): sem alvo ou sem run devolve { content: [{ type: "text", text: "This tool needs the Environment Keys plugin, which is not active. Enable it and try again." }], isError: true }; com alvo devolve await alvo.run(id, args, { ...ctx, moduleId: "environment-variables" }); e mp.onChange(() => this.syncCoreIndex()); (d) se syncCoreIndex não roda na inicialização, chame no fim de start(), antes de this.server.start().
3. Teste (copie o helper de criação de "new Ecosystem(" de um teste existente em tests; se não houver, crie tests\core\mcp-packages-integration.test.ts): com mcpPackages falso que devolve 2 entradas kind "api": após iniciar, toolIndex.find({ q: <nome de uma entrada> }) a encontra com moduleId "ai-ecosystem" e kind "api", e as nativas continuam; onChange com 1 entrada a menos remove só essa; sem tool-runner:environment-variables, o serviço do núcleo devolve isError true com a mensagem acima; com um runner falso do Env Keys, a chamada chega com ctx.moduleId "environment-variables" e o resultado volta igual; sem deps.mcpPackages nada muda.

NÃO FAÇA: não altere src\tool-index\federation.ts nem outros arquivos além de ecosystem.ts e do teste; não toque main.ts; não faça commit nem push; não mude versões.

VERIFIQUE (PowerShell): Set-Location C:\Users\Trabalho\Documents\obsidian-ai-ecosystem; npx vitest run tests/core -> todos passam. npm run typecheck -> sem erros.

Se o módulo "ai-ecosystem" não for anexado pela federação (a busca falhar), PARE e relate a causa com o trecho responsável; não improvise correção em outros arquivos.

RELATÓRIO FINAL: arquivos alterados, saída real dos comandos, desvios.
```

## Etapa 6: Logos, textos e estilos [Haiku 5.5 | esforço: baixo]

**Objetivo:** levar os logos padrão para o núcleo e criar os textos (en e pt) e os estilos da seção de pacotes.
**Depende de:** nenhuma
**Paralelizável com:** Etapas 1 a 5, 8

**Arquivos**
- Criar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\mcp-packages\default-logos.ts` (cópia de `C:\Users\Trabalho\Documents\obsidian-environment-variables\src\ui\defaultLogos.ts`)
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\i18n\catalog.ts`
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\styles\catalog.css`
- Não tocar: qualquer outro arquivo

**Regras de implementação**
1. Copiar o arquivo de logos e ajustar só os imports; manter `defaultLogoFor(id: string): string`.
2. Acrescentar, nos objetos `en` e `pt` de `catalog.ts`, sem alterar chaves existentes, estas chaves (en | pt):

| chave | en | pt |
| --- | --- | --- |
| `catalog.mcp.title` | MCP packages | Pacotes MCP |
| `catalog.mcp.description` | Ready-made tool packages (Jira, Confluence, Bitbucket and more) downloaded into your vault and indexed here. | Pacotes de tools prontos (Jira, Confluence, Bitbucket e mais) baixados para o cofre e indexados aqui. |
| `catalog.mcp.footer` | MCP packages are downloaded only from GitHub repositories of EmanuellCarvalhoPires, and only when you click. | Os pacotes MCP são baixados apenas de repositórios do GitHub de EmanuellCarvalhoPires, e somente quando você clica. |
| `catalog.mcp.loading` | Loading the packages... | Carregando os pacotes... |
| `catalog.mcp.empty` | No packages available. | Nenhum pacote disponível. |
| `catalog.mcp.error` | Could not load the packages: {error} | Não foi possível carregar os pacotes: {error} |
| `catalog.mcp.retry` | Try again | Tentar de novo |
| `catalog.mcp.download` | Download | Baixar |
| `catalog.mcp.delete` | Delete | Excluir |
| `catalog.mcp.showTools` | Show tools | Mostrar tools |
| `catalog.mcp.hideTools` | Hide tools | Ocultar tools |
| `catalog.mcp.toolCount` | {n} tools | {n} tools |
| `catalog.mcp.requestCount` | {n} requests | {n} requests |
| `catalog.mcp.writes` | Writes | Grava |
| `catalog.mcp.installing` | Downloading... | Baixando... |
| `catalog.mcp.installed` | {written} file(s) written, {skipped} already existed. | {written} arquivo(s) gravado(s), {skipped} já existia(m). |
| `catalog.mcp.deleted` | Package removed. | Pacote removido. |
| `catalog.mcp.loadingTools` | Loading the tools... | Carregando as tools... |
| `catalog.mcp.toolsError` | Could not load the tools: {error} | Não foi possível carregar as tools: {error} |
| `catalog.mcp.otherApp` | Other | Outros |
| `catalog.mcp.needsEnvKeys` | To run the downloaded tools, install and enable Environment Keys. | Para executar as tools baixadas, instale e ative o Environment Keys. |
| `catalog.mcp.deleteTitle` | Delete {name} | Excluir {name} |
| `catalog.mcp.deleteBody` | The package database is removed from the vault and its tools leave the index. | O banco do pacote é removido do cofre e as tools saem do índice. |
| `catalog.mcp.deleteNotes` | Also move the {n} tool and request notes to the trash | Mover também as {n} notas de tools e requests para a lixeira |
| `catalog.mcp.confirmDelete` | Delete | Excluir |
| `catalog.mcp.cancel` | Cancel | Cancelar |

3. Ao fim de `catalog.css`, acrescentar classes que usem só variáveis do Obsidian (nenhuma cor hex/rgb): `.aie-mcp-divider` (border-top 1px var(--background-modifier-border), margem vertical var(--size-4-6)), `.aie-mcp-section`, `.aie-mcp-app` (título de grupo, peso 600), `.aie-mcp-row`, `.aie-mcp-row-head` (flex, centralizado, gap), `.aie-mcp-logo` (24px, raio var(--radius-s), object-fit contain), `.aie-mcp-name` (flex 1), `.aie-mcp-meta` (var(--text-muted), var(--font-ui-smaller)), `.aie-mcp-actions` (flex, gap), `.aie-mcp-tools` (padding-left var(--size-4-8)), `.aie-mcp-progress` (altura 4px, fundo var(--background-modifier-border)), `.aie-mcp-progress-bar` (altura 100%, fundo var(--interactive-accent), largura 0), `.aie-mcp-status` (var(--text-muted)), `.aie-mcp-status-error` (var(--text-error)), `.aie-mcp-badge` (pequeno, fundo var(--background-modifier-hover)).

**Passos**
1. Ler o fim de `src\styles\catalog.css` e a estrutura de `src\i18n\catalog.ts`.
2. Aplicar os itens.

**BDD (estado esperado ao concluir)**
- Dado `en` e `pt`, Então os dois têm exatamente as mesmas chaves `catalog.mcp.*`.
- Dado `defaultLogoFor("atlassian")`, Então devolve string que começa com `data:image`.
- Dado o CSS novo, Então não há cor fixa (hex/rgb).

**Verificação**
- `Set-Location C:\Users\Trabalho\Documents\obsidian-ai-ecosystem; npx vitest run tests/core/i18n.test.ts` → passa
- `npm run typecheck` → sem erros

**Prompt para o subagente**
```text
Você é o executor desta etapa. Tarefa: preparar logos, textos (en e pt) e estilos para a nova seção "Pacotes MCP" do plugin Obsidian "AI Ecosystem".

CONTEXTO: repositório C:\Users\Trabalho\Documents\obsidian-ai-ecosystem (TypeScript). Textos em src\i18n\catalog.ts (objetos en e pt), estilos em src\styles\catalog.css. A UI nunca usa emojis. Outra etapa desenha a seção.

FAÇA:
1. Copie com Copy-Item C:\Users\Trabalho\Documents\obsidian-environment-variables\src\ui\defaultLogos.ts para C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\mcp-packages\default-logos.ts e ajuste só os imports. Deve exportar defaultLogoFor(id: string): string.
2. Em C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\i18n\catalog.ts, nos objetos en e pt, acrescente as chaves catalog.mcp.* listadas abaixo, sem alterar nenhuma chave existente (formato: chave | en | pt):
catalog.mcp.title | MCP packages | Pacotes MCP
catalog.mcp.description | Ready-made tool packages (Jira, Confluence, Bitbucket and more) downloaded into your vault and indexed here. | Pacotes de tools prontos (Jira, Confluence, Bitbucket e mais) baixados para o cofre e indexados aqui.
catalog.mcp.footer | MCP packages are downloaded only from GitHub repositories of EmanuellCarvalhoPires, and only when you click. | Os pacotes MCP são baixados apenas de repositórios do GitHub de EmanuellCarvalhoPires, e somente quando você clica.
catalog.mcp.loading | Loading the packages... | Carregando os pacotes...
catalog.mcp.empty | No packages available. | Nenhum pacote disponível.
catalog.mcp.error | Could not load the packages: {error} | Não foi possível carregar os pacotes: {error}
catalog.mcp.retry | Try again | Tentar de novo
catalog.mcp.download | Download | Baixar
catalog.mcp.delete | Delete | Excluir
catalog.mcp.showTools | Show tools | Mostrar tools
catalog.mcp.hideTools | Hide tools | Ocultar tools
catalog.mcp.toolCount | {n} tools | {n} tools
catalog.mcp.requestCount | {n} requests | {n} requests
catalog.mcp.writes | Writes | Grava
catalog.mcp.installing | Downloading... | Baixando...
catalog.mcp.installed | {written} file(s) written, {skipped} already existed. | {written} arquivo(s) gravado(s), {skipped} já existia(m).
catalog.mcp.deleted | Package removed. | Pacote removido.
catalog.mcp.loadingTools | Loading the tools... | Carregando as tools...
catalog.mcp.toolsError | Could not load the tools: {error} | Não foi possível carregar as tools: {error}
catalog.mcp.otherApp | Other | Outros
catalog.mcp.needsEnvKeys | To run the downloaded tools, install and enable Environment Keys. | Para executar as tools baixadas, instale e ative o Environment Keys.
catalog.mcp.deleteTitle | Delete {name} | Excluir {name}
catalog.mcp.deleteBody | The package database is removed from the vault and its tools leave the index. | O banco do pacote é removido do cofre e as tools saem do índice.
catalog.mcp.deleteNotes | Also move the {n} tool and request notes to the trash | Mover também as {n} notas de tools e requests para a lixeira
catalog.mcp.confirmDelete | Delete | Excluir
catalog.mcp.cancel | Cancel | Cancelar
3. Ao fim de C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\styles\catalog.css acrescente as classes .aie-mcp-divider, .aie-mcp-section, .aie-mcp-app, .aie-mcp-row, .aie-mcp-row-head, .aie-mcp-logo, .aie-mcp-name, .aie-mcp-meta, .aie-mcp-actions, .aie-mcp-tools, .aie-mcp-progress, .aie-mcp-progress-bar, .aie-mcp-status, .aie-mcp-status-error, .aie-mcp-badge, usando só variáveis do Obsidian (ex.: var(--background-modifier-border), var(--text-muted), var(--interactive-accent), var(--text-error), var(--size-4-2)). Nenhuma cor hex ou rgb. Divider: border-top 1px e margem vertical. Logo: 24px, raio var(--radius-s). Progresso: altura 4px; barra com largura 0 por padrão.

NÃO FAÇA: não altere outros arquivos; não crie TypeScript de UI; não use emojis; não faça commit nem push; não mude versões.

VERIFIQUE (PowerShell): Set-Location C:\Users\Trabalho\Documents\obsidian-ai-ecosystem; npx vitest run tests/core/i18n.test.ts -> passa. npm run typecheck -> sem erros.

Se defaultLogos.ts de origem não existir, PARE e relate.

RELATÓRIO FINAL: arquivos criados/alterados, saída real dos comandos, desvios.
```

## Etapa 7: Seção de pacotes, modal de exclusão e encaixe na tela de módulos [Haiku 5.5 | esforço: alto]

**Objetivo:** desenhar a seção "Pacotes MCP" (lista por app, expandir tools, baixar pacote ou tool, excluir com confirmação), encaixá-la na tela de módulos logo abaixo da linha divisória e do rodapé, e atualizar a tela quando os pacotes mudam.
**Depende de:** Etapas 3, 4, 6
**Paralelizável com:** Etapas 5, 8

**Arquivos**
- Criar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\catalog\mcp-delete-modal.ts`
- Criar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\catalog\mcp-packages-section.ts`
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\catalog\catalog-view.ts`
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\main.ts` (só o `registerView` do catálogo e uma assinatura de `onChange`)
- Não tocar: qualquer outro arquivo

**Regras de implementação**
1. `mcp-delete-modal.ts`: `class McpDeleteModal extends Modal`, construtor `(app, opts: { name: string; noteCount: number; onConfirm: (deleteNotes: boolean) => void })`. Título `t("catalog.mcp.deleteTitle", { name })`; texto `catalog.mcp.deleteBody`; um `Setting` com toggle (`catalog.mcp.deleteNotes` com `{ n: noteCount }`, desligado); botões `catalog.mcp.cancel` e `catalog.mcp.confirmDelete` (com `setWarning()`), que chama `onConfirm(valorDoToggle)` e fecha.
2. `mcp-packages-section.ts` exporta:
```ts
export interface McpPackagesSectionDeps { app: App; service: McpPackageService; isEnvKeysActive: () => boolean }
export class McpPackagesSection {
  constructor(deps: McpPackagesSectionDeps)
  mount(container: HTMLElement): void   // draws the divider and the section into container
  dispose(): void                       // invalidates pending async work
}
```
3. `mount()`: guarda o container e desenha nele, nesta ordem: `div.aie-mcp-divider` (a linha), depois `div.aie-mcp-section` com `h3` (`catalog.mcp.title`), `p` (`catalog.mcp.description`), aviso `catalog.mcp.needsEnvKeys` com ícone `info` quando `!isEnvKeysActive()`, o conteúdo e, por último, `p.aie-catalog-footer` com `catalog.mcp.footer`. Estado na instância: `catalog?`, `error?`, `loading`, conjunto de grupos expandidos, `Map<entryId, McpPackageManifest>` como cache. Na primeira chamada dispara `load()` com token; ao terminar redesenha no último container se `container.isConnected`. `mount()` em outro container NÃO reinicia o carregamento nem perde o estado.
4. `load()`: `service.fetchCatalog()`. Erro: `catalog.mcp.error` e botão `catalog.mcp.retry` com ícone `refresh-cw`. Vazio: `catalog.mcp.empty`. Enquanto carrega: `catalog.mcp.loading`.
5. Lista: `groupCatalogEntries(catalog.packages)`, agrupada por app (`appForEntry(group.entries[0])?.name ?? t("catalog.mcp.otherApp")`), com `div.aie-mcp-app` por bloco. Cada grupo é `div.aie-mcp-row`: `row-head` com logo (`img.aie-mcp-logo` quando `defaultLogoFor(group.logo)` não é vazio; senão `span` com `setIcon(span, "package")`), nome, meta `catalog.mcp.toolCount` com `group.toolCount`, botão-ícone `list`/`list-x` (aria-label `showTools`/`hideTools`) que expande, e o botão de ação. Abaixo: barra de progresso (`aie-mcp-progress` > `aie-mcp-progress-bar`, oculta até baixar) e `aie-mcp-status`.
6. Botão de ação: se todas as entradas do grupo estão instaladas (`service.isInstalled(entry.id)`), "Excluir" (ícone `trash-2`, classe `mod-warning`); senão "Baixar" (ícone `download`, `mod-cta`). Baixar: para cada entrada, `manifest = cache ?? await service.fetchManifest(entry)`; `service.install(entry, manifest, "all", onProgress)`, somando o progresso entre entradas como no `mcpDownloadModal.ts` do Env Keys (linhas 160-205); ao fim, status `catalog.mcp.installed` com os totais e redesenha. Excluir: abre `McpDeleteModal` com `noteCount` = soma dos arquivos do manifesto com kind diferente de "database" (busca os manifestos se não houver cache; se falhar, `0` e `undefined` no `remove`); ao confirmar, `service.remove(entry, manifest, deleteNotes)` para cada entrada, status `catalog.mcp.deleted`, redesenha.
7. Expandido: carrega os manifestos (`catalog.mcp.loadingTools`; erro `catalog.mcp.toolsError`) e lista cada arquivo `kind === "tool"` numa linha menor (título, selo `catalog.mcp.writes` quando `file.writes`) com botão "Baixar" que chama `service.install(entry, manifest, { toolPath: file.path }, onProgress)` com barra e status próprios.
8. Botões ficam desabilitados enquanto baixam ou excluem. Erros vão para `aie-mcp-status` com `aie-mcp-status-error` (nada de `Notice` solto).
9. `catalog-view.ts`: `CatalogViewDeps` ganha `mcpPackages?: McpPackagesSectionDeps`; o construtor cria `this.mcpSection`; no FIM de `render()`, depois do `p.aie-catalog-footer` existente (não o mova), chama `this.mcpSection?.mount(root)`; `onClose()` chama `this.mcpSection?.dispose()`. Não mudar cartões nem o rodapé.
10. `main.ts`: no `registerView(CATALOG_VIEW_TYPE, ...)` passar `mcpPackages: { app: this.app, service: this.mcpPackages, isEnvKeysActive: () => this.core.registry.has("environment-variables") }`. Em `onload()`, depois de criar `this.mcpPackages`, `this.register(this.mcpPackages.onChange(() => this.refreshUiSoon()))`. Se `refreshUi()` não redesenhar as views abertas do catálogo, faça-o chamar `refresh()` nelas.
11. Textos por `t()` de `../i18n`, ícones por `setIcon`, nada de `innerHTML`, nada de emojis. Use `createEl`, `createDiv` e `setText`.

**Passos**
1. Ler `src\catalog\catalog-view.ts`, `src\settings\modals.ts` (estilo de Modal), `src\main.ts` (`refreshUi`, `openCatalog`, `registerView`), o modal de origem `C:\Users\Trabalho\Documents\obsidian-environment-variables\src\ui\mcpDownloadModal.ts` e os arquivos das Etapas 3, 4 e 6.
2. Criar os dois arquivos novos e editar `catalog-view.ts` e `main.ts`.

**BDD (estado esperado ao concluir)**
- Dado a tela de módulos aberta, Então abaixo do texto do rodapé aparecem a linha divisória e a seção "Pacotes MCP".
- Dado um pacote baixado ou excluído, Então a seção reflete o novo estado sem reabrir a tela.
- Dado `mount()` chamado em dois containers, Então o catálogo não é carregado de novo.
- Dado o código, Então todo texto passa por `t("catalog.mcp.*")` e todo ícone por `setIcon`.

**Verificação**
- `Set-Location C:\Users\Trabalho\Documents\obsidian-ai-ecosystem; npm run typecheck` → sem erros
- `npx eslint src/catalog/mcp-delete-modal.ts src/catalog/mcp-packages-section.ts src/catalog/catalog-view.ts src/main.ts` → sem erros
- `npx vitest run` → passam
- `Select-String -Path src\catalog\mcp-*.ts -Pattern "innerHTML"` → sem resultados

**Prompt para o subagente**
```text
Você é o executor desta etapa. Tarefa: criar a seção "Pacotes MCP" e o modal de exclusão na tela de módulos do plugin Obsidian "AI Ecosystem", encaixá-la abaixo da linha divisória e do rodapé, e atualizar a tela quando os pacotes mudarem.

CONTEXTO: repositório C:\Users\Trabalho\Documents\obsidian-ai-ecosystem (TypeScript, ESLint eslint-plugin-obsidianmd). A tela é src\catalog\catalog-view.ts (CatalogView, ItemView): render() esvazia e desenha cabeçalho, cartões e, por último, <p class="aie-catalog-footer"> com o texto "O catálogo baixa plugins apenas de releases do GitHub...". A seção de pacotes deve aparecer logo abaixo do rodapé, separada por uma linha divisória. Já existem: src\mcp-packages\package-service.ts (McpPackageService: fetchCatalog, fetchManifest, isInstalled, install(entry, manifest, selection, onProgress?), remove(entry, manifest | undefined, deleteNotes), onChange), src\mcp-packages\catalog.ts (groupCatalogEntries, appForEntry, filesToInstall), src\mcp-packages\default-logos.ts (defaultLogoFor), os textos catalog.mcp.* em src\i18n\catalog.ts e as classes aie-mcp-* em src\styles\catalog.css. src\main.ts já tem this.mcpPackages. Código e comentários em inglês, curtos. Regras: NUNCA emojis; ícones só com setIcon; nada de innerHTML; todo texto por t().

FAÇA:
1. Leia catalog-view.ts, src\settings\modals.ts (estilo de Modal), src\main.ts (refreshUi, openCatalog, registerView), C:\Users\Trabalho\Documents\obsidian-environment-variables\src\ui\mcpDownloadModal.ts (linhas 160-205, progresso) e os arquivos citados acima.
2. Crie src\catalog\mcp-delete-modal.ts: class McpDeleteModal extends Modal, construtor (app, opts: { name; noteCount; onConfirm(deleteNotes: boolean) }). Título t("catalog.mcp.deleteTitle", { name }); texto t("catalog.mcp.deleteBody"); Setting com toggle (t("catalog.mcp.deleteNotes", { n: noteCount }), desligado); botões t("catalog.mcp.cancel") e t("catalog.mcp.confirmDelete") (com setWarning()), que chama onConfirm(valor do toggle) e fecha.
3. Crie src\catalog\mcp-packages-section.ts exportando McpPackagesSectionDeps { app; service: McpPackageService; isEnvKeysActive: () => boolean } e class McpPackagesSection { constructor(deps); mount(container: HTMLElement): void; dispose(): void }:
   - mount(container): guarda o container e desenha: primeiro div.aie-mcp-divider (a linha), depois div.aie-mcp-section com h3 (t("catalog.mcp.title")), p (catalog.mcp.description), aviso t("catalog.mcp.needsEnvKeys") com ícone "info" quando !isEnvKeysActive(), o conteúdo e, por último, p.aie-catalog-footer com t("catalog.mcp.footer"). Estado na instância: catalog?, error?, loading, Set de grupos expandidos, Map entryId -> McpPackageManifest. Na primeira chamada dispara load() com token; ao terminar, redesenha no último container se isConnected. mount() em outro container NÃO reinicia o carregamento nem perde o estado.
   - load(): fetchCatalog(). Erro: t("catalog.mcp.error", { error }) e botão t("catalog.mcp.retry") com ícone "refresh-cw". Vazio: t("catalog.mcp.empty"). Carregando: t("catalog.mcp.loading").
   - Lista: groupCatalogEntries(catalog.packages), agrupada por app (appForEntry(group.entries[0])?.name ?? t("catalog.mcp.otherApp")), um div.aie-mcp-app por bloco. Cada grupo é div.aie-mcp-row com row-head: logo (img.aie-mcp-logo se defaultLogoFor(group.logo) não vazio; senão span com setIcon(span, "package")), nome (.aie-mcp-name), meta t("catalog.mcp.toolCount", { n: group.toolCount }), botão-ícone "list"/"list-x" (aria-label showTools/hideTools) que expande, e o botão de ação. Abaixo: div.aie-mcp-progress > div.aie-mcp-progress-bar (oculta até iniciar; setCssProps({ width })) e div.aie-mcp-status.
   - Botão de ação: se TODAS as entradas estão instaladas (service.isInstalled(entry.id)), "Excluir" (ícone "trash-2", classe mod-warning, texto catalog.mcp.delete); senão "Baixar" (ícone "download", classe mod-cta, texto catalog.mcp.download). Baixar: para cada entrada, manifest = cache ?? await service.fetchManifest(entry); service.install(entry, manifest, "all", onProgress) com progresso somado entre entradas; ao fim status t("catalog.mcp.installed", { written, skipped }) com os totais e redesenha. Excluir: abre McpDeleteModal com noteCount = soma dos arquivos do manifesto com kind diferente de "database" (busca os manifestos se não houver cache; se falhar, 0 e passa undefined como manifest); ao confirmar, service.remove(entry, manifest, deleteNotes) para cada entrada; status t("catalog.mcp.deleted"); redesenha. Botões desabilitados enquanto baixa ou exclui. Erros em .aie-mcp-status com a classe aie-mcp-status-error.
   - Expandido: carrega os manifestos (t("catalog.mcp.loadingTools"); erro t("catalog.mcp.toolsError", { error })) e, em div.aie-mcp-tools, lista cada arquivo kind === "tool" numa linha menor: título (file.title ?? file.name ?? file.path), selo span.aie-mcp-badge t("catalog.mcp.writes") se file.writes, e botão "Baixar" que chama service.install(entry, manifest, { toolPath: file.path }, onProgress) com barra e status próprios da linha.
   - dispose(): invalida o token; trabalho assíncrono pendente não desenha mais.
4. Em src\catalog\catalog-view.ts: importe McpPackagesSection e McpPackagesSectionDeps; em CatalogViewDeps acrescente mcpPackages?: McpPackagesSectionDeps; no construtor crie this.mcpSection (undefined sem deps.mcpPackages); no FIM de render(), depois do p.aie-catalog-footer existente (não o mova), chame this.mcpSection?.mount(root); em onClose() chame this.mcpSection?.dispose().
5. Em src\main.ts: no registerView(CATALOG_VIEW_TYPE, ...) passe mcpPackages: { app: this.app, service: this.mcpPackages, isEnvKeysActive: () => this.core.registry.has("environment-variables") }. Em onload(), depois de this.mcpPackages existir, registre this.register(this.mcpPackages.onChange(() => this.refreshUiSoon())). Leia refreshUi(): se não redesenhar as views abertas do catálogo, faça-o chamar refresh() nelas.

NÃO FAÇA: não altere os cartões de módulos nem o texto do rodapé; não altere outros arquivos; não crie testes; não faça commit nem push; não mude versões.

VERIFIQUE (PowerShell): Set-Location C:\Users\Trabalho\Documents\obsidian-ai-ecosystem; npm run typecheck -> sem erros. npx eslint src/catalog/mcp-delete-modal.ts src/catalog/mcp-packages-section.ts src/catalog/catalog-view.ts src/main.ts -> sem erros. npx vitest run -> todos passam. Select-String -Path src\catalog\mcp-*.ts -Pattern "innerHTML" -> nenhum resultado.

Se algum arquivo ou chave de texto citado não existir, PARE e relate; não improvise.

RELATÓRIO FINAL: arquivos criados/alterados, saída real dos comandos, desvios.
```

## Etapa 8: Env Keys assina o serviço de pacotes [Haiku 5.5 | esforço: alto]

**Objetivo:** o Env Keys passa a obter a lista de pacotes do serviço `mcp-packages` do núcleo e manter os Grupos de MCP, os modelos de instância e os `.db` carregados sincronizados com ela. O código de download continua por enquanto (a remoção fica na Etapa 9).
**Depende de:** nenhuma (usa o contrato fixo)
**Paralelizável com:** Etapas 1 a 7

**Arquivos**
- Alterar: `C:\Users\Trabalho\Documents\obsidian-environment-variables\src\ecosystem\moduleConnector.ts` (tipos e constante do serviço)
- Alterar: `C:\Users\Trabalho\Documents\obsidian-environment-variables\src\main.ts`
- Alterar: `C:\Users\Trabalho\Documents\obsidian-environment-variables\src\tools\mcpCatalog.ts` (só o tipo de parâmetro de `appForEntry`, se preciso)
- Criar: `C:\Users\Trabalho\Documents\obsidian-environment-variables\src\tools\mcpPackagesSync.ts` (função pura)
- Criar: `C:\Users\Trabalho\Documents\obsidian-environment-variables\tests\mcpPackagesSync.test.ts`
- Não tocar: qualquer outro arquivo

**Regras de implementação**
1. Em `moduleConnector.ts`, acrescentar (cópia do contrato do núcleo): `export const MCP_PACKAGES_SERVICE = "mcp-packages";`, `export interface InstalledMcpPackage { id; name; app; tag; logo; serviceTag?; groupId?; toolCount: number; dbPath: string }`, `export interface McpPackagesService { list(): InstalledMcpPackage[]; onChange(listener: () => void): () => void }`.
2. `mcpPackagesSync.ts`: `export function planGroupSync(installed: InstalledMcpPackage[], groups: Array<{ id: string; sourcePackageId?: string }>): { toAdd: InstalledMcpPackage[]; toRemoveGroupIds: string[] }`. `toAdd` = pacotes instalados para os quais nenhum grupo tem `sourcePackageId` igual ao id. `toRemoveGroupIds` = ids de grupos com `sourcePackageId` que NÃO está entre os instalados. Grupos sem `sourcePackageId` (criados à mão) nunca entram.
3. Em `main.ts`, trocar a assinatura de `upsertMcpGroupForPackage` e `ensureMcpAppForPackage` de `McpCatalogEntry` para `Pick<McpCatalogEntry, "id" | "name" | "tag" | "logo" | "serviceTag">`, sem mudar a lógica.
4. Em `main.ts`, `private async syncInstalledMcpPackages(service: McpPackagesService): Promise<void>`: `plan = planGroupSync(service.list(), this.data.mcpGroups)`; para cada `toAdd`, `upsertMcpGroupForPackage(pkg)`; remove de `this.data.mcpGroups` os `toRemoveGroupIds`; se mudou algo, `await this.createServiceTemplates()` e `await this.saveAll()`. SEMPRE ao final, recarregue os `.db` (descubra em `src\tools\registry.ts` e `main.ts` como o `McpDbManager` é recarregado — procure `dbManager` e `refresh` — e dispare o mesmo recarregamento); depois `this.emitServerChange()` e `this.syncEcosystemTools()`.
5. Assinatura: em `handleEcosystemConnected(api)` (perto da linha 760) e no `onunload`: `const svc = api.getService<McpPackagesService>(MCP_PACKAGES_SERVICE)`; se existir, `void this.syncInstalledMcpPackages(svc)` e `this.mcpPackagesUnsub = svc.onChange(() => void this.syncInstalledMcpPackages(svc))`. Registre também `api.onServiceChange((name, available) => ...)` para reassinar quando o serviço aparecer. Se o serviço não existir (núcleo antigo), não faça nada e não lance. Cancele `mcpPackagesUnsub` antes de reassinar e no `onunload`. Nunca remova grupos sem ter obtido a lista de um serviço existente.

**Passos**
1. Ler `src\ecosystem\moduleConnector.ts`, `src\main.ts` (180-220, 690-900 e 1120-1330), `src\tools\registry.ts`, `src\tools\mcpGroups.ts`.
2. Implementar.
3. Teste `tests\mcpPackagesSync.test.ts` (estilo de import de `tests\mcpGroups.test.ts`): 3 instalados e grupos para 2 deles, `toAdd` com 1 e `toRemoveGroupIds` vazio; grupo com `sourcePackageId` não instalado vai para `toRemoveGroupIds`; grupo sem `sourcePackageId` nunca vai; lista vazia remove os grupos de pacote.

**BDD (estado esperado ao concluir)**
- Dado 3 pacotes instalados e grupos para 2, Quando `planGroupSync`, Então `toAdd` tem 1 e `toRemoveGroupIds` é `[]`.
- Dado um grupo com `sourcePackageId` de pacote que sumiu, Então o id está em `toRemoveGroupIds`.
- Dado um grupo criado à mão, Então nunca está em `toRemoveGroupIds`.
- Dado o núcleo sem o serviço, Quando o Env Keys inicia, Então não dá erro e nenhum grupo muda.

**Verificação**
- `Set-Location C:\Users\Trabalho\Documents\obsidian-environment-variables; npx vitest run tests/mcpPackagesSync.test.ts` → passam
- `npm run typecheck` → sem erros
- `npx vitest run` → passam

**Prompt para o subagente**
```text
Você é o executor desta etapa. Tarefa: fazer o plugin Obsidian "Environment Keys" assinar o serviço "mcp-packages" do plugin "AI Ecosystem" e manter os Grupos de MCP, os modelos de instância e os .db carregados sincronizados com os pacotes instalados.

CONTEXTO: repositório C:\Users\Trabalho\Documents\obsidian-environment-variables (TypeScript, vitest). O download de pacotes está sendo movido para C:\Users\Trabalho\Documents\obsidian-ai-ecosystem, que publica o serviço "mcp-packages" com list(): InstalledMcpPackage[] e onChange(listener): () => void. Um Grupo de MCP (McpGroupConfig, src\tools\mcpGroups.ts) liga-se a um pacote por sourcePackageId. Esta etapa NÃO remove código de download (isso é outra etapa); só acrescenta a assinatura. Código e comentários em inglês, curtos.

FAÇA:
1. Leia src\ecosystem\moduleConnector.ts, src\main.ts (180-220, 690-900, 1120-1330), src\tools\registry.ts e src\tools\mcpGroups.ts.
2. Em src\ecosystem\moduleConnector.ts acrescente: export const MCP_PACKAGES_SERVICE = "mcp-packages"; export interface InstalledMcpPackage { id: string; name: string; app: string; tag: string; logo: string; serviceTag?: string; groupId?: string; toolCount: number; dbPath: string }; export interface McpPackagesService { list(): InstalledMcpPackage[]; onChange(listener: () => void): () => void }.
3. Crie src\tools\mcpPackagesSync.ts (puro, sem imports do Obsidian): export function planGroupSync(installed, groups: Array<{ id: string; sourcePackageId?: string }>): { toAdd: InstalledMcpPackage[]; toRemoveGroupIds: string[] }. toAdd = instalados sem grupo cujo sourcePackageId seja o id; toRemoveGroupIds = ids de grupos com sourcePackageId que não está entre os instalados. Grupos sem sourcePackageId nunca entram.
4. Em src\main.ts troque a assinatura de upsertMcpGroupForPackage e ensureMcpAppForPackage para Pick<McpCatalogEntry, "id" | "name" | "tag" | "logo" | "serviceTag"> (sem mudar a lógica). Crie private async syncInstalledMcpPackages(service: McpPackagesService): Promise<void>: plan = planGroupSync(service.list(), this.data.mcpGroups); para cada toAdd chame upsertMcpGroupForPackage(pkg); remova de this.data.mcpGroups os toRemoveGroupIds; se mudou algo, await this.createServiceTemplates() e await this.saveAll(). SEMPRE ao final: faça o Env Keys recarregar os .db (descubra em src\tools\registry.ts e main.ts como o McpDbManager é recarregado, procurando dbManager e refresh, e dispare o mesmo recarregamento); depois this.emitServerChange() e this.syncEcosystemTools().
5. Em handleEcosystemConnected(api) e no onunload: const svc = api.getService<McpPackagesService>(MCP_PACKAGES_SERVICE); se existir, void this.syncInstalledMcpPackages(svc) e this.mcpPackagesUnsub = svc.onChange(() => void this.syncInstalledMcpPackages(svc)). Registre também api.onServiceChange((name, available) => { se name é MCP_PACKAGES_SERVICE e available, cancele a assinatura e reassine }). Sem o serviço (núcleo antigo), não faça nada e não lance. Cancele mcpPackagesUnsub antes de reassinar e no onunload. Nunca remova grupos sem ter obtido a lista de um serviço existente.
6. Crie tests\mcpPackagesSync.test.ts (estilo de import de tests\mcpGroups.test.ts) cobrindo: 3 instalados e grupos para 2 deles -> toAdd com 1 e toRemoveGroupIds []; grupo com sourcePackageId não instalado -> id em toRemoveGroupIds; grupo sem sourcePackageId nunca em toRemoveGroupIds; lista vazia -> todos os grupos de pacote em toRemoveGroupIds.

NÃO FAÇA: não remova o código de download nem o botão "Baixar MCP"; não altere src\tools\apiIndex.ts nem service.ts; não faça commit nem push; não mude versões.

VERIFIQUE (PowerShell): Set-Location C:\Users\Trabalho\Documents\obsidian-environment-variables; npx vitest run tests/mcpPackagesSync.test.ts -> passam. npm run typecheck -> sem erros. npx vitest run -> todos passam.

Se não achar como o registry recarrega os .db, PARE e relate o que encontrou; não improvise.

RELATÓRIO FINAL: arquivos criados/alterados, saída real dos comandos, desvios.
```

## Etapa 9: Env Keys remove o download e troca o botão por atalho [Haiku 5.5 | esforço: alto]

**Objetivo:** tirar do Env Keys tudo o que só servia ao download, parar de indexar os `.db` no `tools.db` dele, e trocar o botão "Baixar MCP" por um atalho para o catálogo do núcleo.
**Depende de:** Etapa 8
**Paralelizável com:** Etapas 1 a 7

**Arquivos**
- Apagar: `C:\Users\Trabalho\Documents\obsidian-environment-variables\src\ui\mcpDownloadModal.ts`, `C:\Users\Trabalho\Documents\obsidian-environment-variables\src\tools\githubReader.ts`
- Alterar: `C:\Users\Trabalho\Documents\obsidian-environment-variables\src\main.ts`, `src\tools\mcpCatalog.ts`, `src\tools\service.ts` (`apiIndexEntries`), `src\tools\apiIndex.ts` (só o filtro), `src\settings.ts`, `src\i18n.ts`, `src\ui\view.ts`
- Alterar: testes que cobrem o código removido ou `apiIndexEntries` em `C:\Users\Trabalho\Documents\obsidian-environment-variables\tests\`
- Alterar (se citarem o download): textos em `src\tools\guide\*.md`
- Não tocar: qualquer outro arquivo

**Regras de implementação**
1. Em `main.ts` remover: `fetchMcpCatalog`, `fetchMcpPackageManifest`, `githubReader`, `ensureMcpHubNote`, `downloadMcpPackage`, `ensureServiceTemplate` e imports sem uso. MANTER: `upsertMcpGroupForPackage`, `ensureMcpAppForPackage`, `createServiceTemplates`, `instancesFolder`, `removeMcpGroup`, `syncInstalledMcpPackages`. Remover `MCP_HUB_NOTE_NAME` só se nada mais usar.
2. `mcpCatalog.ts`: manter só `McpCatalogEntry` (campos usados pelos `Pick`), `SERVICE_APPS` e `appForEntry`; remover `McpCatalog*`, manifestos, `GithubReader`, `fetchCatalog`, `fetchPackageManifest`, `needsServiceTemplate`, `serviceTemplateFileName`, `filesToInstall`, `groupCatalogEntries`, `McpDownloadSelection`. Atualizar o comentário de cabeçalho.
3. `apiIndex.ts`: exportar `withoutPackageDbTools(entries: ToolEntry[]): ToolEntry[]`, que descarta as entradas com `notePath` terminando em ".db" (sem diferenciar maiúsculas). Em `service.ts`, `apiIndexEntries()` aplica o filtro antes de `buildApiIndexEntries`. Não alterar as outras funções de `apiIndex.ts`.
4. `view.ts`: o botão que abria `McpDownloadModal` continua no mesmo lugar e estilo, mas com rótulo `t("view.mcpGroups.openCatalog")`, ícone `package-plus`, e clique que executa o comando `ai-ecosystem:open-catalog` (acesso tipado local a `this.app.commands.executeCommandById`). Se retornar false, `new Notice(t("notice.ecosystemCatalogMissing"))`. Remover o import de `McpDownloadModal`.
5. `i18n.ts`: adicionar `view.mcpGroups.openCatalog` (en "Download MCP", pt "Baixar MCP") e `notice.ecosystemCatalogMissing` (en "Open the AI Ecosystem module catalog (install or update AI Ecosystem first).", pt "Abra o catálogo de módulos do AI Ecosystem (instale ou atualize o AI Ecosystem antes)."); remover as chaves `modal.mcpDownload.*` nos dois idiomas e outras que ficarem sem uso (confira com busca antes).
6. `settings.ts`: remover `mcpCatalogUrl` (interface e valor) e `DEFAULT_MCP_CATALOG_URL`. Confirme que chaves antigas em `data.json` não causam erro.
7. Remover as regras CSS `.ev-mcp-download-*` e `.ev-progress*` somente se nenhuma outra classe as usa (busque antes).
8. Testes: apagar os que testam só código removido; ajustar os que importam símbolos removidos (procure por mcpCatalog, githubReader, filesToInstall, groupCatalogEntries, fetchCatalog, needsServiceTemplate, mcpCatalogUrl).
9. Guias em `src\tools\guide\*.md`: frases que mandem baixar MCP pelo Env Keys passam a apontar para o catálogo do AI Ecosystem.
10. Apagar `mcpDownloadModal.ts` e `githubReader.ts` só depois de confirmar com busca que nada mais os importa.

**Passos**
1. Rodar `npm run typecheck` depois de cada remoção grande; o compilador mostra o que ainda referencia o código removido.
2. Rodar `npx vitest run` e ajustar testes.

**BDD (estado esperado ao concluir)**
- Dado o repositório, Quando busco `downloadMcpPackage|fetchMcpCatalog|McpDownloadModal|HttpGithubReader|mcpCatalogUrl` em `src`, Então não acho nada.
- Dado `apiIndexEntries`, Quando há entradas de nota e de `.db`, Então só as de nota entram.
- Dado o botão "Baixar MCP", Quando clico, Então o catálogo do AI Ecosystem abre; sem o núcleo, aparece o aviso.
- Dado `data.json` antigo com `settings.mcpCatalogUrl`, Quando o plugin carrega, Então não dá erro.

**Verificação**
- `Set-Location C:\Users\Trabalho\Documents\obsidian-environment-variables; npm run typecheck` → sem erros
- `npm run lint` → sem erros
- `npx vitest run` → todos passam
- `npm run build` → gera `main.js`
- `Select-String -Path "src\*.ts","src\*\*.ts" -Pattern "downloadMcpPackage|fetchMcpCatalog|McpDownloadModal|HttpGithubReader|mcpCatalogUrl"` → nenhum resultado

**Prompt para o subagente**
```text
Você é o executor desta etapa. Tarefa: no plugin Obsidian "Environment Keys", remover o código de download de pacotes MCP, parar de indexar os .db no tools.db e trocar o botão "Baixar MCP" por atalho para o catálogo do plugin "AI Ecosystem".

CONTEXTO: repositório C:\Users\Trabalho\Documents\obsidian-environment-variables (TypeScript, vitest, ESLint). O download foi movido para C:\Users\Trabalho\Documents\obsidian-ai-ecosystem, que indexa as tools dos pacotes no próprio tools.db. Permanecem no Env Keys: Grupos de MCP (src\tools\mcpGroups.ts), McpDbManager (src\tools\mcpDb.ts) para executar, run_vault_tool, createServiceTemplates e a assinatura do serviço mcp-packages em src\main.ts (syncInstalledMcpPackages, upsertMcpGroupForPackage, ensureMcpAppForPackage, planGroupSync). Código e comentários em inglês, curtos.

FAÇA:
1. Em src\main.ts remova: fetchMcpCatalog, fetchMcpPackageManifest, githubReader, ensureMcpHubNote, downloadMcpPackage, ensureServiceTemplate e imports sem uso. Mantenha upsertMcpGroupForPackage, ensureMcpAppForPackage, createServiceTemplates, instancesFolder, removeMcpGroup e syncInstalledMcpPackages. Remova MCP_HUB_NOTE_NAME só se nada mais o usar.
2. Confirme por busca que nada mais importa src\ui\mcpDownloadModal.ts e src\tools\githubReader.ts; depois apague os dois.
3. Em src\tools\mcpCatalog.ts mantenha só McpCatalogEntry (campos usados pelos Pick), SERVICE_APPS e appForEntry; remova McpCatalog, McpCatalogGroup, groupCatalogEntries, McpPackage*, GithubReader, fetchCatalog, fetchPackageManifest, needsServiceTemplate, serviceTemplateFileName, McpDownloadSelection e filesToInstall. Atualize o comentário de cabeçalho.
4. Em src\tools\apiIndex.ts exporte withoutPackageDbTools(entries: ToolEntry[]): ToolEntry[] (descarta notePath terminando em ".db", sem diferenciar maiúsculas). Em src\tools\service.ts, apiIndexEntries() aplica esse filtro a this.deps.registry.list() antes de buildApiIndexEntries. Não mude as outras funções de apiIndex.ts.
5. Em src\ui\view.ts: o botão que abria McpDownloadModal continua no mesmo lugar e estilo, com rótulo t("view.mcpGroups.openCatalog"), ícone "package-plus", e clique que executa o comando "ai-ecosystem:open-catalog" por cast local (this.app as unknown as { commands: { executeCommandById(id: string): boolean } }).commands.executeCommandById(...); se retornar false, new Notice(t("notice.ecosystemCatalogMissing")). Remova o import de McpDownloadModal.
6. Em src\i18n.ts acrescente, nos dois idiomas: view.mcpGroups.openCatalog (en "Download MCP", pt "Baixar MCP"); notice.ecosystemCatalogMissing (en "Open the AI Ecosystem module catalog (install or update AI Ecosystem first).", pt "Abra o catálogo de módulos do AI Ecosystem (instale ou atualize o AI Ecosystem antes)."). Remova as chaves modal.mcpDownload.* nos dois idiomas e as que ficarem sem uso (confira antes).
7. Em src\settings.ts remova mcpCatalogUrl (interface e valor padrão) e DEFAULT_MCP_CATALOG_URL. Confirme como o plugin carrega data.json para que chaves antigas não causem erro.
8. Remova as regras CSS .ev-mcp-download-* e .ev-progress* só se nenhuma outra classe as usa (busque "ev-mcp-download" e "ev-progress" antes).
9. Em tests\, apague os testes que cobrem só o código removido e ajuste os que importam símbolos removidos (mcpCatalog, githubReader, filesToInstall, groupCatalogEntries, fetchCatalog, needsServiceTemplate, mcpCatalogUrl). Acrescente um teste para withoutPackageDbTools (notas passam, .db sai).
10. Em src\tools\guide\*.md, reescreva frases que mandem baixar MCP pelo Env Keys para apontar o catálogo do AI Ecosystem (seção Pacotes MCP).

NÃO FAÇA: não remova os Grupos de MCP, o McpDbManager, a execução de tools, createServiceTemplates nem a assinatura do serviço mcp-packages; não faça commit nem push; não mude versões.

VERIFIQUE (PowerShell), em C:\Users\Trabalho\Documents\obsidian-environment-variables: npm run typecheck; npm run lint; npx vitest run; npm run build (gera main.js); Select-String -Path "src\*.ts","src\*\*.ts" -Pattern "downloadMcpPackage|fetchMcpCatalog|McpDownloadModal|HttpGithubReader|mcpCatalogUrl" -> nenhum resultado. Todos sem erro.

Se uma remoção quebrar algo que não dá para resolver sem mudar comportamento mantido, PARE e relate; não improvise.

RELATÓRIO FINAL: arquivos apagados/alterados, saída real dos comandos, desvios.
```

## Etapa 10: Documentação dos dois plugins [Haiku 5.5 | esforço: baixo]

**Objetivo:** atualizar os READMEs e os textos de skill que descrevem onde se baixam os pacotes MCP.
**Depende de:** Etapas 7, 9
**Paralelizável com:** nenhuma

**Arquivos**
- Alterar: `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\README.md`
- Alterar: `C:\Users\Trabalho\Documents\obsidian-environment-variables\README.md`
- Alterar (se citarem o download): `C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\setup\skills\environment-variables.pt.md` e `environment-variables.en.md`
- Não tocar: qualquer outro arquivo

**Regras de implementação**
1. Buscar `Download MCP`, `Baixar MCP`, `MCP packages` e `pacotes MCP` nos dois READMEs e em `src\setup\skills\*.md` do núcleo; alterar só onde o texto diz que o download é feito no Env Keys.
2. README do núcleo: nova seção "MCP packages" com: a seção abaixo dos módulos na tela de módulos (comando "Open module catalog"); origem (só `raw.githubusercontent.com/EmanuellCarvalhoPires/...`); destino (`MCP Tools\<pacote>\`); tools no índice (`tools_find`, módulo `ai-ecosystem`, tipo `api`); execução pelo Environment Keys pelo serviço `mcp-packages`.
3. README do Env Keys: o download passou para o AI Ecosystem; o botão "Baixar MCP" abre o catálogo de módulos; os Grupos de MCP continuam e são criados sozinhos quando o núcleo baixa um pacote.
4. Mesmo idioma e tom de cada arquivo; sem emojis.

**BDD (estado esperado ao concluir)**
- Dado os READMEs, Então nenhum diz que o download é feito dentro do Env Keys, e o do núcleo documenta a seção de pacotes.

**Verificação**
- `Select-String -Path C:\Users\Trabalho\Documents\obsidian-environment-variables\README.md -Pattern "Download MCP|Baixar MCP"` → só menções ao atalho para o catálogo

**Prompt para o subagente**
```text
Você é o executor desta etapa. Tarefa: atualizar a documentação de dois plugins Obsidian após a mudança "o download de pacotes MCP passou do Environment Keys para o AI Ecosystem".

CONTEXTO: repositórios C:\Users\Trabalho\Documents\obsidian-ai-ecosystem (núcleo) e C:\Users\Trabalho\Documents\obsidian-environment-variables (Environment Keys). Na tela de módulos do AI Ecosystem (comando "Open module catalog"), abaixo dos módulos e de uma linha divisória, há a seção "Pacotes MCP": baixa pacotes somente de repositórios do GitHub de EmanuellCarvalhoPires, grava em "MCP Tools\<pacote>\" no cofre e indexa as tools no tools.db do núcleo (módulo "ai-ecosystem", tipo "api", achadas por tools_find e executadas por tools_run). A execução continua no Env Keys, que resolve os segredos, pelo serviço "mcp-packages". O botão "Baixar MCP" do Env Keys agora abre o catálogo do AI Ecosystem, e os Grupos de MCP são criados sozinhos quando o núcleo baixa um pacote. Sem emojis; mantenha idioma e tom de cada arquivo.

FAÇA:
1. Busque nos dois READMEs e em src\setup\skills\*.md do núcleo as menções a "Download MCP", "Baixar MCP", "MCP packages" e "pacotes MCP".
2. README do núcleo: acrescente uma seção curta "MCP packages" com o contexto acima.
3. README do Env Keys: onde disser que o download é feito dentro do Env Keys, corrija para o AI Ecosystem; explique o atalho do botão e a criação automática dos Grupos de MCP.
4. Se environment-variables.pt.md ou .en.md em src\setup\skills mandarem baixar MCP pelo Env Keys, corrija para o catálogo do AI Ecosystem. Se não mencionarem, não altere.

NÃO FAÇA: não altere código; não altere outros arquivos; não faça commit nem push; não mude versões.

VERIFIQUE (PowerShell): Select-String -Path C:\Users\Trabalho\Documents\obsidian-environment-variables\README.md -Pattern "Download MCP|Baixar MCP" -> só menções ao atalho.

RELATÓRIO FINAL: arquivos alterados e uma linha por arquivo.
```

## Etapa 11: Verificação geral [Haiku 5.5 | esforço: alto]

**Objetivo:** provar que os dois repositórios compilam, passam em lint e testes e geram build, e listar o roteiro manual de aceite.
**Depende de:** todas
**Paralelizável com:** nenhuma

**Arquivos**
- Não alterar nenhum arquivo. Se um comando falhar por erro óbvio de etapa anterior, relate em vez de corrigir.

**Verificação**
- Núcleo: `Set-Location C:\Users\Trabalho\Documents\obsidian-ai-ecosystem; npm run typecheck; npm run lint; npx vitest run; npm run build` → tudo verde
- Env Keys: `Set-Location C:\Users\Trabalho\Documents\obsidian-environment-variables; npm run typecheck; npm run lint; npx vitest run; npm run build` → tudo verde
- `Select-String -Path "C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\mcp-packages\*.ts","C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\catalog\mcp-*.ts" -Pattern "innerHTML|\bfetch\("` → nenhum resultado
- `Select-String -Path "C:\Users\Trabalho\Documents\obsidian-ai-ecosystem\src\mcp-packages\*.ts" -Pattern 'from "obsidian"'` → só `obsidian-store.ts`

**Prompt para o subagente**
```text
Você é o executor desta etapa final, somente de verificação. Não altere nenhum arquivo.

CONTEXTO: dois plugins Obsidian em TypeScript foram alterados para mover o download de pacotes MCP do Environment Keys para o AI Ecosystem: C:\Users\Trabalho\Documents\obsidian-ai-ecosystem (novos arquivos em src\mcp-packages\ e src\catalog\mcp-*.ts) e C:\Users\Trabalho\Documents\obsidian-environment-variables.

FAÇA (PowerShell, na ordem, anotando saída e código de saída):
1. Set-Location C:\Users\Trabalho\Documents\obsidian-ai-ecosystem; npm run typecheck; npm run lint; npx vitest run; npm run build
2. Set-Location C:\Users\Trabalho\Documents\obsidian-environment-variables; npm run typecheck; npm run lint; npx vitest run; npm run build
3. Select-String em src\mcp-packages\*.ts e src\catalog\mcp-*.ts por "innerHTML|\bfetch\(" -> nenhum resultado.
4. Select-String em src\mcp-packages\*.ts por from "obsidian" -> só obsidian-store.ts.
5. Select-String nos arquivos novos dos dois repositórios por emojis (faixas Unicode de emoji) -> nenhum.

NÃO FAÇA: não corrija código; não rode npm run deploy; não faça commit nem push. Se um comando falhar, copie a saída completa do erro e pare esse bloco; siga para o próximo repositório.

RELATÓRIO FINAL: tabela comando -> verde/vermelho, com a saída dos que falharam. Termine com o roteiro MANUAL de aceite para o usuário executar no cofre Cofre depois de "npm run deploy" nos dois repositórios e recarregar o Obsidian:
 1. Módulos do AI Ecosystem: abaixo do rodapé aparecem a linha divisória e a seção "Pacotes MCP" com o grupo Atlassian.
 2. Cofre que já tinha pacotes: aparecem como instalados (botão Excluir), sem baixar de novo.
 3. Baixar um pacote: barra de progresso, arquivos em MCP Tools\<pacote>\, e o grupo aparece sozinho em Grupos de MCP do Env Keys.
 4. tools_find por uma tool do pacote: módulo ai-ecosystem, tipo api; tools_run executa (precisa de instância Atlassian configurada).
 5. Expandir um pacote e baixar uma tool avulsa.
 6. Excluir um pacote com e sem mover notas para a lixeira: .db sai, tools somem do tools_find, grupo some do Env Keys.
 7. Desativar o Env Keys: a seção mostra o aviso e tools_run devolve a mensagem de que ele precisa estar ativo.
 8. No Env Keys, "Baixar MCP" abre a tela de módulos do AI Ecosystem.
```

## 6. Critérios de aceite finais (BDD)
- Dado a tela "Módulos do AI Ecosystem", Quando ela abre, Então abaixo do texto "O catálogo baixa plugins apenas de releases do GitHub..." aparece uma linha divisória e a seção "Pacotes MCP" agrupada por app.
- Dado um pacote não instalado, Quando clico em Baixar, Então os arquivos vão para `MCP Tools\<pacote>\`, o `.db` é gravado como `<id>.db`, a barra avança e o botão vira Excluir.
- Dado um cofre que já tinha pacotes baixados pelo Env Keys, Quando o núcleo carrega, Então eles aparecem como instalados e nada é baixado de novo.
- Dado um pacote instalado, Quando uso `tools_find` por uma tool dele, Então ela aparece com módulo `ai-ecosystem` e tipo `api`, e `tools_run` a executa pelo Environment Keys com os segredos resolvidos.
- Dado o Environment Keys inativo, Quando executo uma tool de pacote, Então recebo a mensagem de que ele precisa estar ativo, e a seção mostra o aviso.
- Dado um pacote excluído, Então o `.db` vai para a lixeira, as tools saem do índice e o grupo MCP correspondente some do Env Keys; grupos criados à mão ficam intactos.
- Dado o Env Keys, Então não existe mais o código de download; o botão "Baixar MCP" abre o catálogo do AI Ecosystem; os Grupos de MCP, os modelos de instância e a execução das tools continuam funcionando.
- Dado o catálogo configurado fora de `https://raw.githubusercontent.com/EmanuellCarvalhoPires/`, Então o núcleo recusa baixar.
- Dado os dois repositórios, Então typecheck, lint, testes e build passam, e a UI nova não usa emojis, `innerHTML` nem `fetch`.
