# Contrato técnico — Hooks, configuração de módulos e telas

Documento de implementação do plano "Plano de Implementação - Hooks, Configuração de Módulos e Telas" (cofre do autor, `Projetos/AI Ecosystem/Plugin AI Ecosystem/`). Ele fixa os contratos entre o núcleo (`obsidian-ai-ecosystem`) e os módulos, para que cada repositório possa ser alterado em paralelo. Código e comentários em inglês, como no resto do repositório; textos de UI em `i18n` (en + pt).

Regras fixas: nenhum emoji na UI (só `setIcon` com ícones Lucide); usar `app.vault.configDir`, nunca `.obsidian` fixo; nenhum valor secreto em resposta, log, Inspector, nota, teste ou commit; o instalador nunca sobrescreve `.claude/` do usuário.

## 1. Premissas verificadas (fase 0, passo 1) — documentação do Claude Code, 21/10/2026

| Premissa | Resultado | Efeito no desenho |
| --- | --- | --- |
| Entrada do `PreToolUse` | stdin JSON com `session_id`, `transcript_path`, `cwd`, `permission_mode`, `hook_event_name`, `tool_name`, `tool_input`, `tool_use_id` (MCP: `mcp_server`) | o script lê `tool_name`, `tool_input`, `cwd` |
| Negar | exit 0 + stdout `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"..."}}` | usado no modo `bloquear` |
| Lembrete sem decisão | só `hookSpecificOutput.additionalContext`, sem `permissionDecision` (chega ao modelo como system reminder e a chamada segue as regras de permissão normais do usuário). Nunca `allow`: ele aprovaria a chamada e pularia o prompt de permissão do Claude Code. `systemMessage` só aparece ao usuário | usado no modo `avisar` e na trava da 3ª tentativa |
| `PostToolUse` | só roda em **sucesso**. Falha de tool (inclusive MCP com erro) vai para **`PostToolUseFailure`** (campo `error`) | o marcador de falha usa `PostToolUseFailure`; o sucesso é limpo pelo próprio núcleo (ver 4.4) |
| Matchers | só letras/dígitos/`_`/`-`/`|`/`,` = nome exato ou lista; qualquer outro caractere = regex JS sem âncora | `mcp__.*` funciona; `Grep|Glob`, `Bash|PowerShell`, `Write` são listas exatas |
| Ferramentas | `PowerShell` existe (`tool_input.command`); `Write` (`file_path` absoluto, `content`); `Grep` (`pattern`, `path`, `glob`...); `Glob` (`pattern`, `path`) | regras da fase 1 |
| Shell dos hooks no Windows | Git Bash por padrão; PowerShell se não houver Git Bash | **caminho absoluto** do script com barras `/` entre aspas duplas (funciona nos dois shells). `$CLAUDE_PROJECT_DIR` não é usado: no PowerShell ele não expande |
| Campos extras numa entrada de hook | não documentado | entradas do plugin identificadas só pelo comando |
| Quando hooks novos valem | o file watcher do Claude Code recarrega edições diretas do settings | o hook temporário some logo depois do `ecosystem_setup_complete` |
| `tools/list_changed` | o terminal interativo busca a lista nova sem reconectar | as tools aparecem no meio da sessão; a skill confere mesmo assim |
| Perguntas clicáveis (AskUserQuestion) | 1 a 4 perguntas por chamada, 2 a 4 opções, "Other" automático; não existe em subagentes | skills respeitam os limites |
| Skills novas em `.claude/skills/` | pegas no meio da sessão, se a pasta `skills` já existia no início | o núcleo cria `.claude/skills/` na ativação |
| `timeout` do hook | segundos; padrão 600; timeout no PreToolUse não bloqueia | entradas do plugin usam `timeout: 10` |

## 2. Pasta de estado `<cofre>/.claude/ai-ecosystem/`

O plugin escreve com `node:fs` (pasta oculta: o adapter do Obsidian não a vê). Escrita atômica (arquivo `.tmp` + `rename`). Caminhos internos sempre relativos ao cofre, com `/`.

| Arquivo | Formato |
| --- | --- |
| `config.json` | `{ "schemaVersion": 1, "vaultPath": "C:/.../Cofre", "settingsFile": "settings.local.json", "modos": { "<moduleId>": "bloquear" \| "avisar" \| "off" } }` (modo ausente = `bloquear`). Campo opcional `"shellSearch": "avisar" \| "bloquear"` (padrão `avisar`): só vale para `ai-vault-search` em modo `bloquear`; Bash e PowerShell só avisam (additionalContext) e Grep/Glob continuam negados. Com `"bloquear"` o terminal também é negado. Modos `avisar` e `off` ignoram o campo. |
| `heartbeat` | texto com `Date.now()`; regravado a cada 15 s; apagado no `onunload`; "morto" se ausente ou > 45 s |
| `hosts.json` | `{ "hosts": ["acme.atlassian.net", "*.atlassian.net", "api.github.com/repos/acme"] }` — padrões `host[/prefixo]`, sem nomes de secret e sem valores |
| `pastas.json` | `{ "scripts": ["scripts"], "templates": ["Knowledge/Logs/*.md"], "foraDoIndice": ["Anexos"], "notasDeTools": ["MCP"] }` — globs relativos ao cofre (`*` = um segmento, `**` = vários) |
| `tools.json` | `{ "<nome da tool MCP>": "<moduleId>" }` — mapa usado pelo hook de falha |
| `falhas.json` | `{ "<moduleId>": <ms da última falha> }` (TTL 10 min) |
| `bloqueios.json` | `{ "<sha1>": { "n": <tentativas>, "t": <ms da 1ª> } }` (janela 10 min; entradas velhas são podadas) |
| `modules/<id>.json` | `{ "estado": "pendente_configuracao" \| "configurado" \| "desativado", "origem": "catalogo" \| "nucleo" \| "legado" \| "manual", "atualizadoEm": "<iso>", "respostas": { ... } }` |
| `modules/<id>.configurado.json` | `{ "concluidoEm": "<iso>" }` — marcador gravado pelo núcleo no `ecosystem_setup_complete` |
| `hooks/ai-ecosystem-hook.mjs` | script único (Node, sem dependências) |
| `backups/` | cópias `settings*.json.<timestamp>.bak` (mantém as 5 últimas) |

## 3. Entradas no settings do Claude Code

Arquivo: `<cofre>/.claude/<settingsFile>` (padrão `settings.local.json`; a skill do núcleo pode trocar para `settings.json`, e o merger move as entradas).

Comando (sempre igual, só muda `<modulo> <tipo>`):

```text
node "C:/Users/x/Cofre/.claude/ai-ecosystem/hooks/ai-ecosystem-hook.mjs" <modulo> <tipo>
```

| Módulo | Evento | Matcher | Tipo |
| --- | --- | --- | --- |
| `ai-vault-search` | `PreToolUse` | `Grep|Glob` | `protecao` |
| `environment-variables` | `PreToolUse` | `Bash|PowerShell` | `protecao` |
| `ai-scripts` | `PreToolUse` | `Bash|PowerShell` | `protecao` |
| `ai-templates` | `PreToolUse` | `Write` | `protecao` |
| `ai-ecosystem` | `PostToolUseFailure` | `mcp__.*` | `falha` |
| `<qualquer>` | `SessionStart` e `UserPromptSubmit` | (sem matcher) | `setup` (temporário; duas entradas com o mesmo comando) |

Cada entrada: `{ "matcher": "...", "hooks": [ { "type": "command", "command": "...", "timeout": 10 } ] }`. O merger:

- lê o arquivo; se o JSON for inválido, **não grava nada** e devolve o erro (a UI mostra o motivo);
- faz backup antes de gravar; grava; relê e valida;
- identifica entradas do plugin por `command` contendo `ai-ecosystem-hook.mjs <modulo> <tipo>` (ou só `<modulo>` para remover tudo de um módulo);
- nunca altera nem reordena entradas que não são do plugin; remove grupos `{matcher, hooks}` que ficarem vazios só se eles tiverem só entradas do plugin;
- é idempotente (instalar duas vezes não duplica) e reescreve o caminho absoluto se o cofre mudou de pasta.

## 4. Script do hook `ai-ecosystem-hook.mjs <modulo> <tipo>`

Regras gerais: só `node:fs`, `node:path`, `node:crypto`; sem rede; lê só os arquivos de estado necessários; **qualquer exceção, arquivo ausente, JSON inválido ou passar de 2 s internos → exit 0 sem saída (libera)**. Variável `AI_ECOSYSTEM_HOOKS=off|avisar|bloquear` sobrepõe o modo.

### 4.1 `protecao` (PreToolUse)

1. Heartbeat ausente ou > 45 s → libera.
2. `modules/<modulo>.json` com estado diferente de `configurado` → libera.
3. `falhas.json[<modulo>]` com menos de 10 min → libera.
4. Modo (`AI_ECOSYSTEM_HOOKS` > `config.modos[<modulo>]` > `bloquear`); `off` → libera.
5. Aplica a regra do módulo (4.2). Se não casar → libera sem saída.
6. Casou: `avisar` → só `additionalContext` com a mensagem (sem `permissionDecision`). `bloquear` → trava de repetição: hash sha1 de `tool_name` + `JSON.stringify(tool_input)` normalizado (chaves ordenadas, espaços colapsados em `command`); se esta for a 2ª tentativa idêntica em 10 min → só `additionalContext` ("liberado pela trava de repetição; prefira ...") e zera o contador; senão incrementa e devolve `deny` com a mensagem.

### 4.2 Regras por módulo

- **ai-vault-search** (`Grep`, `Glob`): alvo = `tool_input.path` ou, sem ele, `cwd`; no `Glob` com `pattern` absoluto, o prefixo fixo do padrão. Casa se o alvo está dentro de `vaultPath` (comparação sem diferença de maiúsculas no Windows, barras normalizadas) e **fora** de `foraDoIndice`, `notasDeTools` e `.claude/`, `<configDir>/`. Mensagem: `Use search_notes, list_files ou get_section (AI Vault Search). O terminal só vale se o plugin estiver fora do ar.`
- **environment-variables** (`Bash`, `PowerShell`): `command` contém, como palavra de comando, `curl`, `wget`, `Invoke-RestMethod`, `Invoke-WebRequest`, `irm` ou `iwr` (sem diferença de maiúsculas). Extrai as URLs `https?://...`; casa se alguma tem host (e prefixo de caminho, quando o padrão tem) em `hosts.json` (`*.exemplo.com` casa subdomínios, não o domínio raiz). Mensagem: `Este host tem secret no Environment Keys: use search_vault_tools e run_vault_tool (ou http_request com {{secret:NOME}}).`
- **ai-scripts** (`Bash`, `PowerShell`): `command` roda `python`, `python3`, `py`, `node`, `pwsh`, `powershell -File`, `bash` ou `sh` sobre um arquivo; resolve o arquivo relativo ao `cwd`; casa se ele está dentro de uma pasta de `pastas.scripts`. Mensagem: `Este script está numa pasta permitida: rode com ecosystem_run_script (ou run_ai_script se estiver registrado no AI Scripts).`
- **ai-templates** (`Write`): `file_path` dentro do cofre, **arquivo ainda não existe**, e casa com algum glob de `pastas.templates`. `Edit` nunca é verificado. Mensagem: `Já existe molde para esta nota: use create_note_from_template (AI Templates).`

### 4.3 `setup` (SessionStart e UserPromptSubmit, temporário)

Se o heartbeat está vivo, `modules/<modulo>.json` está em `pendente_configuracao` e **não** existe `modules/<modulo>.configurado.json` → imprime JSON `{"hookSpecificOutput":{"hookEventName":"<evento>","additionalContext":"<ordem>"}}`, com `<evento>` igual ao `hook_event_name` recebido (`SessionStart` por padrão). Ordem no `SessionStart`: `O módulo <Nome> foi instalado e ainda não foi configurado. Antes de qualquer outra coisa, execute a skill configurar-<modulo>.` No `UserPromptSubmit` a ordem é curta e vale para a mensagem atual: `Antes de responder à mensagem do usuário, execute a skill configurar-<modulo>.` Isso faz um módulo instalado com a sessão já aberta disparar a skill em qualquer mensagem. As duas entradas saem juntas (`ecosystem_setup_complete`, desativar e desinstalar removem ambas) e, ao carregar, o núcleo acrescenta a entrada que faltar em módulo pendente. Caso contrário, não imprime nada.

### 4.4 `falha` (PostToolUseFailure, núcleo)

Pega o nome da tool depois do segundo `__` de `tool_name` (`mcp__<servidor>__<tool>`), procura o módulo em `tools.json` e grava `falhas.json[<modulo>] = Date.now()`. Tool desconhecida → nada. O núcleo também grava a falha quando um `tools/call` termina com `isError`, e **apaga** o marcador do módulo quando uma tool dele termina com sucesso (por isso não há hook de `PostToolUse` de sucesso: custaria tempo em toda chamada MCP).

## 5. Serviço `hooks` (Service Bus, dono `ai-ecosystem`)

Os módulos não mexem em `.claude/`: eles alimentam o núcleo pelo serviço. Interface (copiar para `src/ecosystem/types.ts` de cada módulo que usar):

```ts
export const HOOKS_SERVICE = "hooks";

export interface HookRuleData {
  /** environment-variables: allowed host patterns of secrets WITHOUT full access / any host. */
  hosts?: string[];
  /** ai-scripts: vault-relative folders whose scripts must run through the plugin. */
  scriptFolders?: string[];
  /** ai-templates: vault-relative target path patterns of the templates ({{...}} becomes *). */
  templateTargets?: string[];
  /** environment-variables: vault-relative folders of tool notes (Grep stays allowed there). */
  toolNoteFolders?: string[];
  /** ai-vault-search: vault-relative folders outside the index (Grep stays allowed there). Becomes pastas.json "foraDoIndice". */
  excludedFolders?: string[];
}

export interface SetupHandler {
  /** Facts the module detects by itself (never secret values). */
  detect?(): Promise<Record<string, unknown>>;
  /** Applies one answer. Returns an error message to refuse it. */
  save?(key: string, value: unknown): Promise<string | void>;
  /** Called by ecosystem_setup_complete. ok:false blocks completion and lists what is missing. */
  validate?(): Promise<{ ok: boolean; missing?: string[] }>;
}

export interface HooksService {
  setRuleData(moduleId: string, data: HookRuleData): void;
  /** Returns an unregister function. */
  registerSetupHandler(moduleId: string, handler: SetupHandler): () => void;
  getModuleState(moduleId: string): "pendente_configuracao" | "configurado" | "desativado" | undefined;
}
```

`setRuleData` substitui os dados daquele módulo e o núcleo regrava `hosts.json`/`pastas.json` (debounce 500 ms). Os módulos chamam no `onConnected` e sempre que os dados mudam. Se o serviço não existir (núcleo antigo), o módulo segue sem erro.

## 6. Mudanças no contrato do núcleo (`src/types/index.ts`)

- `HubTool.availableDuringSetup?: boolean` — a tool continua visível mesmo com o módulo em `pendente_configuracao` (ex.: `env_criar_secret`, usada pelas skills).
- `HubCallContext.signal?: AbortSignal` — abortado quando o cliente manda `notifications/cancelled` com o `requestId` daquela chamada ou fecha a conexão HTTP antes da resposta. Usado pelas tools de tela.
- `HubCallContext.clientKind?: "claude-code" | "antigravity" | "other"` — detectado pelo `clientInfo.name` do `initialize` (guardado por `Mcp-Session-Id`) e, sem ele, pelo nome do token do cliente (`/claude/i`, `/antigravity|gemini/i`).
- `SecretVaultService` (contrato do serviço `secrets`) ganha métodos **opcionais** (seção 8). O núcleo testa a existência antes de usar.

Visibilidade: para `clientKind === "claude-code"`, `tools/list` esconde as tools de módulos em `pendente_configuracao` (exceto `availableDuringSetup`), e `tools/call` delas devolve erro explicando que o módulo aguarda a skill `configurar-<id>`. Outros clientes veem tudo. As tools do núcleo nunca são escondidas.

## 7. Telas (fase 4, núcleo)

- Definição: `{ "slug": "cadastro_cliente", "titulo": "...", "descricao": "...", "campos": [Campo] }`; `slug` casa `^[a-z0-9_]{1,48}$`; tool `tela_<slug>`. Guardadas em `<configDir>/plugins/ai-ecosystem/telas/<slug>.json`. Limite configurável, padrão 30.
- `Campo`: `{ "id": "^[a-z0-9_]{1,40}$", "tipo": <tipo>, "rotulo": "...", "ajuda"?: "...", "obrigatorio"?: bool, "padrao"?: any, ...validações }`.
- Tipos: `texto`, `texto_longo`, `inteiro`, `decimal`, `data`, `hora`, `data_hora`, `selecao`, `selecao_multipla`, `caixa`, `interruptor`, `url`, `email`, `telefone`, `cor`, `intervalo`, `pasta`, `arquivo`, `nota`, `tag`, `lista`, `tabela`, `rotulo`, `separador`, `aprovacao`, `acao`, `senha`. Validações por tipo: `min`/`max` (números, intervalo, tamanho de texto), `passo`, `opcoes` (seleções), `padrao_regex` (texto), `extensoes` (arquivo), `colunas` (tabela), `destino_nome` (senha, obrigatório).
- Tools: `tela_criar(definicao)`, `tela_editar(slug, definicao)`, `tela_remover(slug)` abrem a prévia (tela renderizada + definição) e só gravam com Aprovar; `tela_listar()` lista. Retorno: `{ "status": "aprovado" | "recusado" | "expirado" | "cancelado", ... }`.
- Cada tela gravada vira `tela_<slug>`: entrada `{ "contexto"?: string, "valores_iniciais"?: { "<campo>": valor } }`; saída `{ "status": "confirmado" | "cancelado" | "expirado", "valores": {...}, "secretos": { "<campo>": "preenchido" } }`. Campos `senha` nunca voltam com valor: no Confirmar, o núcleo chama `secrets.createValue` (seção 8); se o nome já existir ou o Environment Keys não estiver disponível/desbloqueado, o Confirmar fica desabilitado com o motivo.
- Espera de 5 min (`ctx.signal` também fecha o modal). O Inspector registra a chamada sem valores de campos `senha` (eles nem passam pela resposta).

## 8. Environment Keys (fase 5) — extensões do serviço `secrets`

Métodos opcionais acrescentados a `SecretVaultService` (nenhum devolve valor):

```ts
/** True when a secret OR a value already uses this name. */
nameExists?(name: string): boolean;
/** Creates an entry in the "Values" section. Never overwrites. */
createValue?(input: { name: string; kind: ValueKind; value: string; description?: string; createdBy: string }):
  Promise<{ ok: true } | { ok: false; reason: "exists" | "locked" | "invalid_name" | "empty" }>;
/** Like spawnWithSecrets, but also resolves placeholders in args. */
spawnWithSecretsAndArgs?(input: { env: Record<string, string>; args: string[] },
  spawnFn: (resolved: { env: Record<string, string>; args: string[] }) => Promise<void>, callerModuleId: string): Promise<void>;
/** Resolves {{secret:NAME}} of VALUES (not secrets) inside template data. */
resolveTemplateData?(data: unknown, callerModuleId: string): Promise<unknown>;
```

`ValueKind = "texto" | "numero" | "url" | "email" | "json" | "senha"`. Valores e secrets dividem o espaço de nomes. O filtro de saída (`redact`) mascara valores com **6 caracteres ou mais**. Valores entram no `http_request` com a mesma política de aprovação das secrets (host fora dos domínios do valor → aprovação). Tool nova `env_criar_secret` (`availableDuringSetup: true`), parâmetros `nome_sugerido`, `tipo_sugerido`, `dominios_sugeridos`, `descricao` e `additionalProperties: false` (rejeita `valor`).

## 9. Configuração guiada (fases 2 e 3, núcleo)

- Estados: `pendente_configuracao` → `configurado`; `desativado` quando o plugin do módulo é desligado pelo usuário (não no fechamento do Obsidian: o núcleo confere `enabledPlugins` 1 s depois do `module-unregistered`).
- Origem: `catalogo` (instalado pelo botão, depois do modal de confirmação), `nucleo` (o próprio AI Ecosystem, sem confirmação), `legado` (módulo que já estava ativo quando esta versão do núcleo rodou pela primeira vez: fica `configurado` e o núcleo instala sozinho os hooks de proteção, sem tela de confirmação, no modo padrão `bloquear` ou no que o `config.json` indicar), `manual` (módulo que se registrou sem passar pelo catálogo e sem estado: mesmo tratamento do legado). Em cofres que já têm o módulo como `legado`/`manual` + `configurado` sem entradas nas configurações do Claude Code, o núcleo reconcilia ao carregar e a cada registro de módulo e instala as entradas que faltam. Sem Node, nada é gravado (mesma mensagem de antes). O Telegram não tem hook de proteção. Se o usuário apertar "Remover hooks", o núcleo grava `hooksRemovidos: true` em `modules/<id>.json` e não reinstala sozinho; o botão "Instalar hooks" continua disponível (abre o modal de confirmação) e, ao instalar, apaga a marca. Módulos do catálogo seguem o fluxo com confirmação.
- Tools do núcleo (sempre visíveis): `ecosystem_setup_status(modulo)`, `ecosystem_setup_save(modulo, chave, valor)`, `ecosystem_setup_complete(modulo)`.
- `ecosystem_setup_complete`: valida (handler do módulo + pré-requisitos, ex.: Telegram exige Environment Keys configurado) → grava o marcador → remove o hook temporário → registra/mostra as tools → instala os hooks de proteção → estado `configurado` → `tools/list_changed`.
- Skills: `.claude/skills/configurar-<id>/SKILL.md`, geradas pelo núcleo a partir de moldes embutidos (pt e en, pelo idioma do Obsidian).
- `GEMINI.md`: bloco entre `<!-- ai-ecosystem:start -->` e `<!-- ai-ecosystem:end -->` com o guia de uso e as restrições (D7). O núcleo insere/substitui só o bloco; cria o arquivo se não existir.
- `CLAUDE.md`: o núcleo **não** grava. `ecosystem_setup_status` devolve o bloco gerado (mesmos marcadores) e a skill pede permissão ao usuário antes de o agente inserir ou substituir o bloco.
- Node ausente: o modal de confirmação verifica `node --version`; sem Node, o módulo fica pendente, nenhum hook é gravado e a UI aponta https://nodejs.org.
