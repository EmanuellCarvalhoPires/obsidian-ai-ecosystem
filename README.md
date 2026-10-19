# AI Ecosystem

Single local server (REST and MCP) for AI agents such as Claude Code and Antigravity, with a live request inspector, a script runner and one-click setup of companion plugins.

AI Ecosystem is the only plugin of its family that opens a network port. Companion plugins ("modules", for example Environment Keys, AI Templates and Telegram AI Gateway) register their tools and routes into it, so agents talk to one local address.

[Português](#português)

## Disclosures

Read these before you install the plugin.

- **Local server.** The plugin starts an HTTP server that listens on `127.0.0.1` only (never on other network interfaces). Default port: 27150, with an alternative port (27160) used when the main one is taken. Every endpoint except `GET /health` needs a client token, and requests that carry a browser `Origin` header are refused.
- **Network use.** The plugin makes no background requests. It downloads `catalog.json` and module releases from GitHub (`raw.githubusercontent.com`, `api.github.com` and `github.com`) only when you open the module catalog or click a button there.
- **Scripts.** AI clients can run scripts (Python, Node.js, Bash, PowerShell) stored in your vault. By default only scripts from folders you allow, or from notes tagged `#mcp/script`, can run. An option in the settings removes this restriction; read the warning before you turn it on.
- **Installs other plugins.** The module catalog can download, install, enable and update companion plugins. Only repositories of the `EmanuellCarvalhoPires` owner listed in the catalog are accepted, and only when you click. Nothing is installed or updated automatically, and AI clients cannot trigger it.
- **No telemetry.** Nothing about you or your vault is sent anywhere. The inspector history lives in memory only.
- Desktop only. The plugin needs Node.js (Electron) APIs.

## Setup

1. Install and enable the plugin, then open **Settings > AI Ecosystem**.
2. Under **Clients**, choose **Add client**, name it (for example "Claude Code") and copy the token. It is shown once and only its hash is stored.
3. Connect your client.

**Claude Code**

```bash
claude mcp add --transport http ai-ecosystem http://127.0.0.1:27150/mcp --header "Authorization: Bearer <token>"
```

**Antigravity and other clients configured by file**

```json
{
  "mcpServers": {
    "ai-ecosystem": {
      "type": "http",
      "url": "http://127.0.0.1:27150/mcp",
      "headers": { "Authorization": "Bearer <token>" }
    }
  }
}
```

Use the port shown in the settings if it is not 27150. The **Copy MCP URL** button copies the right address. The new-client window also shows both snippets with your token already filled in.

If you used Environment Keys 1.x, its clients and tokens are imported once when Environment Keys 2.x registers, so existing client configs keep working.

## Built-in tools and routes

| MCP tool | REST route (`/api/v1/ai-ecosystem`) | What it does |
| --- | --- | --- |
| `ecosystem_status` | `GET /status` | Version, server status, registered modules and services. |
| `ecosystem_list_scripts` | `GET /scripts` | Scripts that can run (allowed folders and `#mcp/script` notes). |
| `ecosystem_run_script` | `POST /scripts/run` | Runs a script and returns exit code, stdout and stderr. |

Tools of the installed modules appear next to these in the same MCP server. `GET /health` is public and returns the app name, version, API version and module ids.

## Request inspector

**Open request inspector** (command or ribbon icon) shows requests, MCP tool calls and script runs as they happen: time, type, endpoint or tool, module, client, status and duration. Click a row for headers, payload, response and streamed script output. You can search, filter by module or client, pause and clear.

Payloads and responses are masked before they are shown or kept. With Environment Keys active, the real secret values are masked. Without it, the inspector falls back to masking Bearer tokens and common key patterns and shows a banner saying the masking is limited. History is kept in memory only (configurable limit) and is never written to disk.

## Script Engine and its restrictions

- Languages: Python, Node.js, Bash and PowerShell. Interpreters are detected automatically; you can set a path for each in the settings.
- Scripts run as child processes outside the interface thread, with a timeout (maximum configurable, default 5 minutes) and output streamed to the inspector.
- Environment values may contain `{{secret:NAME}}` placeholders. When Environment Keys is active it resolves them directly into the process environment, so the value never comes back to the AI Ecosystem.
- **Restrictions (on by default):** only files from allowed folders or `#mcp/script` notes run; inline code is refused; every run appears in the inspector with the module and client that asked for it.
- **Remove Script Engine restrictions** (danger zone in the settings) lets any authenticated client run arbitrary code on your computer. Turning it on asks for confirmation, and runs made this way are flagged with an alert in the inspector.

To declare a script from a note, tag the note `#mcp/script` and add a property with a vault-relative path:

```yaml
---
tags: [mcp/script]
script: Tools/report.py
---
```

## Module catalog

**Open module catalog** shows the companion plugins as cards with their state (not installed, installing, installed but disabled, active, update available). One click installs and enables a module without restarting Obsidian; if Obsidian's internal installer is not available, the plugin downloads the release files itself, and as a last resort opens the plugin page. The catalog comes from `catalog.json` in this repository, with a copy bundled in the plugin as a fallback.

## For module authors

### Provider API

Modules reach the API with `app.plugins.getPlugin("ai-ecosystem")?.api` (a frozen object, version `1`):

```ts
interface AIEcosystemAPI {
  readonly apiVersion: number;
  isReady(): boolean;
  registerModule(module: HubModuleRegistration): { ok: true; warnings?: string[] } | { ok: false; reason: string };
  unregisterModule(moduleId: string): boolean;
  updateTools(moduleId: string, tools: HubTool[]): void;      // dynamic tools
  updatePrompts(moduleId: string, prompts: HubPrompt[]): void;
  registerService<T>(name: string, ownerModuleId: string, instance: T): void;
  unregisterService(name: string): void;
  getService<T>(name: string): T | undefined;
  onServiceChange(cb: (name: string, available: boolean) => void): () => void;
  importClients(clients: ClientRecord[], sourceModuleId: string): Promise<number>; // token hashes only
  runScript(options: HubScriptOptions, callerModuleId: string): Promise<ScriptExecutionResult>;
  logActivity(entry: { moduleId: string; client?: string; type: string; target: string; status: number; durationMs: number; payload?: unknown; response?: unknown }): void;
  getServerStatus(): { running: boolean; port: number; activeModules: string[] };
}

interface HubModuleRegistration {
  id: string;            // lowercase letters, digits and "-"
  name: string;
  version: string;
  apiVersion: number;    // Provider API version the module was written for
  routes?: HubRoute[];          // served at /api/v1/<id>/...
  legacyAliases?: HubRoute[];   // routes at the root, e.g. "/v1/request"
  tools?: HubTool[];            // MCP tools, names unique across modules
  prompts?: HubPrompt[];        // MCP prompts
  instructions?: string;        // appended to the MCP server instructions
  onUnload?: () => void;
}
```

Tool and route handlers receive the calling client (`ctx.client`, `req.client`), so the inspector and your module know who called. The full contracts are in `src/types/index.ts`.

### Events

Sent through `app.workspace.on(...)`:

| Event | Payload | When |
| --- | --- | --- |
| `ai-ecosystem:ready` | the API | On every load of the AI Ecosystem. Register again after each one. |
| `ai-ecosystem:unloading` | none | The AI Ecosystem is being disabled or reloaded. Mark yourself as disconnected. |
| `ai-ecosystem:module-registered` / `module-unregistered` | module id | A module was added or removed. |
| `ai-ecosystem:service-changed` | `(name, available)` | A service appeared or disappeared. |
| `ai-ecosystem:server-status` | `ServerStatus` | The server started, stopped or changed port. |

### apiVersion rules

`registerModule` refuses an `apiVersion` this build does not support and returns `{ ok: false, reason }`. Show the reason and ask the user to update the AI Ecosystem (or your module). Within one API version, changes are additive.

### Service Bus

Services are named objects owned by a module (for example Environment Keys registers `secrets`). A service disappears when its owner unregisters or the AI Ecosystem unloads, and `onServiceChange` tells the consumers. Only the owner can replace a service, and the owner must be a registered module.

### Legacy aliases

`legacyAliases` serve routes at the root of the server (for example `POST /v1/request` of Environment Keys 1.x) so existing scripts keep working. `/health`, `/mcp` and `/api/*` are reserved.

### Instructions

`instructions` is a few plain sentences telling agents how to use your tools (for example how to write secret placeholders). It is appended to the instructions the MCP server sends on `initialize`.

### Load-order-tolerant connector

Obsidian does not guarantee plugin load order. Copy [`docs/module-connector.ts`](docs/module-connector.ts) into your plugin. It waits for the layout, registers when the AI Ecosystem is ready, registers again after each reload and tells you when the AI Ecosystem is missing:

```ts
this.connector = new EcosystemConnector(this, {
  buildRegistration: () => ({ id: "my-module", name: "My module", version: this.manifest.version, apiVersion: 1, tools: [/* ... */] }),
  onStatus: (status, detail) => this.updateStatusBar(status, detail),
  onMissing: () => new MissingEcosystemModal(this.app).open(),
  onIncompatible: (reason) => new Notice(reason),
  onConnected: (api) => api.registerService("my-service", "my-module", this.service),
});
this.connector.start();      // in onload()
// this.connector.stop();    // in onunload()
```

### Dependency modal template

When the AI Ecosystem is missing, show this modal. Use an icon from Obsidian (never an emoji), sentence case and your own plugin name:

```ts
import { Modal, Notice, Setting, requestUrl, setIcon } from "obsidian";

const REPO = "EmanuellCarvalhoPires/obsidian-ai-ecosystem";

class MissingEcosystemModal extends Modal {
  onOpen(): void {
    const icon = this.titleEl.createSpan();
    setIcon(icon, "alert-triangle");
    this.titleEl.appendText(" AI Ecosystem is required");
    this.contentEl.createEl("p", {
      text: "My module needs the AI Ecosystem plugin. It provides the local server that agents use to reach this plugin.",
    });
    new Setting(this.contentEl).addButton((btn) =>
      btn.setButtonText("Install and enable AI Ecosystem").setCta().onClick(() => void this.install()),
    );
  }

  private async install(): Promise<void> {
    const plugins = (this.app as unknown as { plugins: Record<string, any> }).plugins;
    try {
      const release = (await requestUrl(`https://api.github.com/repos/${REPO}/releases/latest`)).json as { tag_name: string };
      const manifest = (await requestUrl(`https://github.com/${REPO}/releases/download/${release.tag_name}/manifest.json`)).json;
      await plugins.installPlugin(REPO, release.tag_name, manifest);
      await plugins.loadManifests();
      await plugins.enablePluginAndSave("ai-ecosystem");
      this.close();
    } catch {
      // Internal installer unavailable or offline: open the plugin page instead.
      new Notice("Could not install automatically. Opening the plugin page.");
      activeWindow.open("obsidian://show-plugin?id=ai-ecosystem");
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
```

`app.plugins` is an internal, undocumented API, so always keep the fallback to the plugin page.

## Security model

- The server binds to `127.0.0.1` only and checks the `Host` header (DNS rebinding protection). Requests with an `Origin` header (browsers) are refused.
- Clients authenticate with a Bearer token (`aie_` plus 256 random bits). Only the SHA-256 hash is stored in `data.json`; tokens are compared in constant time and can be revoked at any time.
- Secrets never pass through the AI Ecosystem: the inspector and the Script Engine mask values using Environment Keys, and `{{secret:NAME}}` values go straight into the child process environment.
- Scripts run only from folders you allow unless you turn the restrictions off. Only registered modules can call `runScript`, and clients can only run scripts through the built-in tool.
- The catalog installs only releases from `EmanuellCarvalhoPires` repositories, only on click.

## Development

```bash
npm install
npm run dev        # esbuild in watch mode (main.js and styles.css)
npm test           # vitest
npm run lint       # eslint with eslint-plugin-obsidianmd
npm run build      # type-check and production bundle
npm run deploy     # build and copy main.js, manifest.json and styles.css to a vault
```

`npm run deploy` copies the files to the folder in the `AIE_DEPLOY_DIR` environment variable, or to the first line of a git-ignored `.deploy-target` file (for example `<vault>/.obsidian/plugins/ai-ecosystem`).

Layout: `src/server` (HTTP and MCP), `src/registry` and `src/api` (modules, services, lifecycle), `src/runner` (Script Engine), `src/inspector`, `src/catalog`, `src/core` (wiring, built-in module, notices), `src/settings`, `src/i18n`, `src/styles`. Everything outside the views, modals and settings is plain Node code that is tested without Obsidian.

## Release

1. Set the new version in `manifest.json` and `versions.json`.
2. Create a tag equal to the manifest version (for example `1.0.0`) and push it, or run the **Release** workflow by hand.
3. The workflow runs lint, tests and build, then attaches `main.js`, `manifest.json` and `styles.css` to the GitHub release.

## License

MIT

---

# Português

Servidor local único (REST e MCP) para agentes de IA como Claude Code e Antigravity, com inspetor de requisições ao vivo, execução de scripts e instalação em um clique dos plugins complementares.

O AI Ecosystem é o único plugin da família que abre uma porta de rede. Os plugins complementares ("módulos", como Environment Keys, AI Templates e Telegram AI Gateway) registram nele suas tools e rotas, e os agentes falam com um endereço local só.

## Avisos importantes

Leia antes de instalar o plugin.

- **Servidor local.** O plugin inicia um servidor HTTP que escuta somente em `127.0.0.1` (nunca em outras interfaces de rede). Porta padrão: 27150, com uma porta alternativa (27160) usada quando a principal está ocupada. Todo endpoint, exceto `GET /health`, exige um token de cliente, e requisições com cabeçalho `Origin` de navegador são recusadas.
- **Uso de rede.** O plugin não faz requisições em segundo plano. Ele baixa o `catalog.json` e as releases dos módulos do GitHub (`raw.githubusercontent.com`, `api.github.com` e `github.com`) somente quando você abre o catálogo de módulos ou clica em um botão dele.
- **Scripts.** Clientes de IA podem executar scripts (Python, Node.js, Bash, PowerShell) guardados no seu cofre. Por padrão, só rodam scripts de pastas que você permitiu ou de notas com a tag `#mcp/script`. Uma opção nas configurações remove essa restrição; leia o aviso antes de ativá-la.
- **Instala outros plugins.** O catálogo de módulos pode baixar, instalar, ativar e atualizar plugins complementares. Só são aceitos repositórios do dono `EmanuellCarvalhoPires` listados no catálogo, e somente quando você clica. Nada é instalado ou atualizado automaticamente, e clientes de IA não conseguem disparar isso.
- **Sem telemetria.** Nada sobre você ou seu cofre é enviado a lugar nenhum. O histórico do inspetor fica só na memória.
- Somente desktop. O plugin precisa das APIs do Node.js (Electron).

## Configuração

1. Instale e ative o plugin e abra **Configurações > AI Ecosystem**.
2. Em **Clientes**, escolha **Adicionar cliente**, dê um nome (por exemplo "Claude Code") e copie o token. Ele aparece uma única vez e só o hash dele é guardado.
3. Conecte o seu cliente.

**Claude Code**

```bash
claude mcp add --transport http ai-ecosystem http://127.0.0.1:27150/mcp --header "Authorization: Bearer <token>"
```

**Antigravity e outros clientes configurados por arquivo**

```json
{
  "mcpServers": {
    "ai-ecosystem": {
      "type": "http",
      "url": "http://127.0.0.1:27150/mcp",
      "headers": { "Authorization": "Bearer <token>" }
    }
  }
}
```

Use a porta mostrada nas configurações se não for 27150. O botão **Copiar URL do MCP** copia o endereço certo. A janela de novo cliente também mostra os dois trechos já com o seu token preenchido.

Se você usava o Environment Keys 1.x, os clientes e tokens dele são importados uma vez quando o Environment Keys 2.x se registra, então as configurações atuais continuam funcionando.

## Tools e rotas internas

| Tool MCP | Rota REST (`/api/v1/ai-ecosystem`) | O que faz |
| --- | --- | --- |
| `ecosystem_status` | `GET /status` | Versão, status do servidor, módulos e serviços registrados. |
| `ecosystem_list_scripts` | `GET /scripts` | Scripts que podem rodar (pastas permitidas e notas `#mcp/script`). |
| `ecosystem_run_script` | `POST /scripts/run` | Executa um script e devolve código de saída, stdout e stderr. |

As tools dos módulos instalados aparecem junto com essas, no mesmo servidor MCP. `GET /health` é público e devolve o nome do app, a versão, a versão da API e os ids dos módulos.

## Inspetor de requisições

**Abrir inspetor de requisições** (comando ou ícone da barra lateral) mostra requisições, chamadas de tools MCP e execuções de scripts em tempo real: hora, tipo, endpoint ou tool, módulo, cliente, status e duração. Clique em uma linha para ver cabeçalhos, payload, resposta e a saída do script. Dá para buscar, filtrar por módulo ou cliente, pausar e limpar.

Payloads e respostas são ofuscados antes de serem exibidos ou guardados. Com o Environment Keys ativo, os valores reais das secrets são ofuscados. Sem ele, o inspetor usa uma ofuscação padrão (tokens Bearer e padrões comuns de chaves) e mostra um aviso de que a ofuscação é limitada. O histórico fica só na memória (com limite configurável) e nunca é gravado em disco.

## Script Engine e suas restrições

- Linguagens: Python, Node.js, Bash e PowerShell. Os interpretadores são detectados automaticamente; você pode definir o caminho de cada um nas configurações.
- Os scripts rodam como processos filhos, fora da thread da interface, com tempo limite (máximo configurável, padrão de 5 minutos) e saída em streaming para o inspetor.
- Variáveis de ambiente podem conter placeholders `{{secret:NOME}}`. Com o Environment Keys ativo, ele os resolve direto no ambiente do processo, e o valor nunca volta para o AI Ecosystem.
- **Restrições (ativas por padrão):** só rodam arquivos de pastas permitidas ou de notas `#mcp/script`; código inline é recusado; toda execução aparece no inspetor com o módulo e o cliente que a pediu.
- **Remover restrições do Script Engine** (zona de perigo nas configurações) permite que qualquer cliente autenticado execute código arbitrário no seu computador. Ativar pede confirmação, e as execuções feitas assim aparecem com um alerta no inspetor.

Para declarar um script a partir de uma nota, coloque a tag `#mcp/script` e uma propriedade com o caminho relativo ao cofre:

```yaml
---
tags: [mcp/script]
script: Ferramentas/relatorio.py
---
```

## Catálogo de módulos

**Abrir catálogo de módulos** mostra os plugins complementares em cards com o estado de cada um (não instalado, instalando, instalado e desativado, ativo, atualização disponível). Um clique instala e ativa um módulo sem reiniciar o Obsidian; se a rotina interna de instalação do Obsidian não existir, o plugin baixa os arquivos da release por conta própria e, em último caso, abre a página do plugin. O catálogo vem do `catalog.json` deste repositório, com uma cópia embutida no plugin como reserva.

## Para autores de módulos

### Provider API

Os módulos acessam a API com `app.plugins.getPlugin("ai-ecosystem")?.api` (objeto congelado, versão `1`). As interfaces `AIEcosystemAPI` e `HubModuleRegistration` estão na seção em inglês acima, e os contratos completos em `src/types/index.ts`.

Os handlers de tools e rotas recebem o cliente que chamou (`ctx.client`, `req.client`), para o inspetor e o seu módulo saberem quem chamou.

### Eventos

Enviados por `app.workspace.on(...)`:

| Evento | Payload | Quando |
| --- | --- | --- |
| `ai-ecosystem:ready` | a API | A cada carregamento do AI Ecosystem. Registre-se de novo a cada um. |
| `ai-ecosystem:unloading` | nenhum | O AI Ecosystem está sendo desativado ou recarregado. Marque-se como desconectado. |
| `ai-ecosystem:module-registered` / `module-unregistered` | id do módulo | Um módulo foi adicionado ou removido. |
| `ai-ecosystem:service-changed` | `(nome, disponível)` | Um serviço apareceu ou sumiu. |
| `ai-ecosystem:server-status` | `ServerStatus` | O servidor iniciou, parou ou mudou de porta. |

### Regras de apiVersion

O `registerModule` recusa uma `apiVersion` que esta versão não suporta e devolve `{ ok: false, reason }`. Mostre o motivo e peça para o usuário atualizar o AI Ecosystem (ou o seu módulo). Dentro de uma mesma versão da API, as mudanças só acrescentam.

### Service Bus

Serviços são objetos nomeados que pertencem a um módulo (por exemplo, o Environment Keys registra `secrets`). Um serviço some quando o dono se desregistra ou o AI Ecosystem é descarregado, e `onServiceChange` avisa os consumidores. Só o dono pode substituir um serviço, e o dono precisa ser um módulo registrado.

### Aliases legados

`legacyAliases` serve rotas na raiz do servidor (por exemplo, `POST /v1/request` do Environment Keys 1.x) para os scripts atuais continuarem funcionando. `/health`, `/mcp` e `/api/*` são reservados.

### Instruções

`instructions` são poucas frases em texto simples dizendo aos agentes como usar as suas tools (por exemplo, como escrever placeholders de secrets). Elas são acrescentadas às instruções que o servidor MCP envia no `initialize`.

### Conector tolerante à ordem de carregamento

O Obsidian não garante a ordem de carregamento dos plugins. Copie [`docs/module-connector.ts`](docs/module-connector.ts) para o seu plugin. Ele espera o layout, registra quando o AI Ecosystem está pronto, registra de novo a cada recarga e avisa quando o AI Ecosystem não está instalado. O exemplo de uso está na seção em inglês acima.

### Modelo do modal de dependência

Quando o AI Ecosystem não estiver ativo, mostre um modal com: título com o ícone `alert-triangle` (nunca emoji), texto explicando a dependência e o botão "Instalar e ativar o AI Ecosystem", que chama `app.plugins.installPlugin("EmanuellCarvalhoPires/obsidian-ai-ecosystem", versão, manifest)` e depois `enablePluginAndSave("ai-ecosystem")`. Se isso falhar, abra `obsidian://show-plugin?id=ai-ecosystem`. O código de referência está na seção em inglês acima; traduza os textos para a interface do seu plugin. Como `app.plugins` é uma API interna, mantenha sempre a alternativa de abrir a página do plugin.

## Modelo de segurança

- O servidor escuta somente em `127.0.0.1` e confere o cabeçalho `Host` (proteção contra DNS rebinding). Requisições com cabeçalho `Origin` (navegadores) são recusadas.
- Os clientes se autenticam com um token Bearer (`aie_` mais 256 bits aleatórios). Só o hash SHA-256 fica no `data.json`; os tokens são comparados em tempo constante e podem ser revogados a qualquer momento.
- Secrets nunca passam pelo AI Ecosystem: o inspetor e o Script Engine ofuscam valores usando o Environment Keys, e os valores `{{secret:NOME}}` vão direto para o ambiente do processo filho.
- Scripts só rodam de pastas permitidas, a menos que você desligue as restrições. Só módulos registrados podem chamar `runScript`, e clientes só executam scripts pela tool interna.
- O catálogo só instala releases de repositórios de `EmanuellCarvalhoPires`, e somente ao clicar.

## Desenvolvimento

```bash
npm install
npm run dev        # esbuild em modo watch (main.js e styles.css)
npm test           # vitest
npm run lint       # eslint com eslint-plugin-obsidianmd
npm run build      # checagem de tipos e bundle de produção
npm run deploy     # build e cópia de main.js, manifest.json e styles.css para um cofre
```

O `npm run deploy` copia os arquivos para a pasta da variável de ambiente `AIE_DEPLOY_DIR` ou para a primeira linha de um arquivo `.deploy-target` ignorado pelo git (por exemplo, `<cofre>/.obsidian/plugins/ai-ecosystem`).

## Lançamento

1. Defina a nova versão em `manifest.json` e `versions.json`.
2. Crie uma tag igual à versão do manifest (por exemplo, `1.0.0`) e envie, ou rode o workflow **Release** manualmente.
3. O workflow roda lint, testes e build e anexa `main.js`, `manifest.json` e `styles.css` à release do GitHub.

## Licença

MIT
