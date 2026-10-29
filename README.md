# AI Ecosystem

Single local server (REST and MCP) for AI agents such as Claude Code and Antigravity, with a live request inspector, a script runner and one-click setup of companion plugins.

AI Ecosystem is the only plugin of its family that opens a network port. Companion plugins ("modules", for example Environment Keys, AI Templates and Telegram AI Gateway) register their tools and routes into it, so agents talk to one local address.

[Português](#português)

## Disclosures

Read these before you install the plugin.

- **Local server.** The plugin starts an HTTP server that listens on `127.0.0.1` only (never on other network interfaces). Default port: 27150. If it is taken, the plugin tries the alternative port (27160) and then the next ports one by one (up to 20 in total), so each vault starts on a free port even with several vaults open; the port actually used is remembered per vault and tried first on the next start, so MCP clients keep working (if it has to change, a notice says so and **Copy MCP URL** gives the new address). Every endpoint except `GET /health` needs a client token, and requests that carry a browser `Origin` header are refused.
- **Network use.** The plugin makes no background requests. It downloads `catalog.json` and module releases from GitHub (`raw.githubusercontent.com`, `api.github.com` and `github.com`) only when you open the module catalog or click a button there.
- **Scripts.** AI clients can run scripts (Python, Node.js, Bash, PowerShell) stored in your vault. By default only scripts from folders you allow, or from notes tagged `#mcp/script`, can run. An option in the settings removes this restriction; read the warning before you turn it on.
- **Installs other plugins.** The module catalog can download, install, enable and update companion plugins. Only repositories of the `EmanuellCarvalhoPires` owner listed in the catalog are accepted, and only when you click. Nothing is installed or updated automatically, and AI clients cannot trigger it.
- **Writes in your vault's `.claude/` folder.** Hooks, setup skills and a state folder, plus a block in `GEMINI.md`, as described in "Claude Code integration" below. Your own entries are merged, never overwritten.
- **No telemetry.** Nothing about you or your vault is sent anywhere. The inspector history is kept in memory, and a trimmed copy (at most 3000 entries and 7 days, long texts cut to 4000 characters) is also kept in `activity.sqlite` inside the plugin folder, so it survives a restart.
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
| `ecosystem_status` | `GET /status` | Version, server status and counts per module. `detalhe: true` lists the tools and `modulo` filters one module; the REST route `GET /status` stays complete. |
| `ecosystem_diagnostico` | - | Health report of the suite: modules registered vs. expected (missing = not installed), server and port, hooks and their mode, pending setup, templates and scripts loaded, Telegram yes/no and how many secrets exist (a count, never names or values). Each finding is `ok`, `aviso` or `erro` with a next action; `formato`: `texto` (default) or `json`. It warns about a module that is out of date (its `manifest.json` version differs from the loaded one, or its `main.js` changed after it loaded) and lists only warnings and errors (`completo: true` lists everything). |
| `ecosystem_list_scripts` | `GET /scripts` | Scripts that can run (allowed folders and `#mcp/script` notes). Returns only the paths. |
| `ecosystem_run_script` | `POST /scripts/run` | Runs a script and returns exit code, stdout and stderr, each capped at 4000 characters (start and end; the rest goes to a file, with the paths in `stdout_file` and `stderr_file`). `max_chars` changes the limit (also on `POST /scripts/run`); `script_id` (a script registered in AI Scripts) is accepted instead of `path`. The process is cancelled when the agent cancels the call. |
| `tools_find` | - | Searches the tools of every module (FTS5/BM25 text and filters `tag`, `categoria`, `modulo`, `kind`, `efeito`). One line per tool: `id(required*, optional?) \| summary \| effect`. |
| `tools_describe` | - | Schema, effect, approval and example of one tool (`id`) or several (`ids`); `full: false` trims long descriptions. |
| `tools_run` | - | Runs a tool by `id` with `args` through the module that owns it and returns its answer unchanged. `calls` runs up to 10 items `{id, args}` in sequence, with a short answer for each. |

Tools of the installed modules appear next to these in the same MCP server. `GET /health` is public and returns the app name, version, API version and module ids.

**Indexed exposure.** Each module can keep a `tools.db` (SQLite) in its plugin folder (`api.toolIndex.sync`); the core keeps its own. The core attaches the `tools.db` of every registered module and searches them together, plus the registered tools of modules without one. Under **Settings > AI Ecosystem > Tool exposure** each kind of client (Claude Code, Antigravity, other) is **Full** (every tool in `tools/list`, the default) or **Indexed** (only the fixed tools, by default `search_notes` and `get_section`, tools marked `exposicao: "fixa"` and the three discovery tools; while a module waits for its setup, the setup tools stay listed too). Calling a tool by name keeps working in both modes. A module can run index entries that are not MCP tools (for example API tools of vault notes) by registering the service `tool-runner:<module id>` (`IndexedToolRunner`).

## Claude Code integration: hooks, setup and screens

This part writes inside the `.claude/` folder of your vault (Claude Code reads hooks and skills from there). It needs Node.js on your PATH: the hooks are Node scripts. Without Node.js nothing is written to the settings, and the settings tab says so.

**What the core writes without asking** (declared here instead of a confirmation, because it is the plugin itself):

- the skill `.claude/skills/configurar-ai-ecosystem/SKILL.md`, which guides the first setup;
- the welcome skill `.claude/skills/kit/SKILL.md` (`/kit`, see "Welcome kit" below), which is never overwritten once you edited it;
- a temporary hook, on `SessionStart` and `UserPromptSubmit`, that tells the agent to run that skill (so a module installed while a session is already open triggers it on the next message), removed when the setup finishes;
- the summary hook `resumo`, on `SessionStart`: up to 300 characters with the active modules and the pending setups;
- the failure hook `falha`, on `PostToolUseFailure`: it marks a module as failed only when its handler throws an exception or is unavailable (a wrong argument does not turn the protection off), so the protection hooks step aside for ten minutes;
- the state folder `.claude/ai-ecosystem/` (hook script, heartbeat, module states, rule data, backups);
- a block between `<!-- ai-ecosystem:start -->` and `<!-- ai-ecosystem:end -->` in `GEMINI.md` for clients without hooks such as Antigravity. The block is only written once you accepted a module install (or when it is already there); the file is created if it does not exist and the rest of it is never changed. `CLAUDE.md` is never written by the plugin: the setup skill asks you first and the agent edits only that block.

The plugin never overwrites your own entries: it merges into `.claude/settings.local.json` (or `settings.json`, your choice), keeps a backup before each write, checks the JSON afterwards, refuses to touch a file with invalid JSON and removes only entries whose command runs `ai-ecosystem-hook.mjs`.

**Modules installed from the catalog** open a confirmation screen before anything is downloaded. It lists what will be written: the setup skill `configurar-<module>`, the temporary setup hook (command and settings file), the protection rules of the module (run by the single dispatch entry, only after its setup) and the `GEMINI.md` block. **Cancel** installs nothing. After you accept, the module stays pending: **its tools are hidden from Claude Code** (Antigravity and other clients see them) until its setup finishes. The next Claude Code session gets an order to run the setup skill, which asks only what the plugin could not detect, with clickable questions, and never asks for a token or password in the chat.

**Protection hooks** keep the agent on the plugin tools: AI Vault Search (Grep and Glob inside the vault), Environment Keys (`curl`, `wget`, `Invoke-RestMethod` and similar against hosts that have a secret with allowed domains), AI Scripts (running scripts of the allowed folders) and AI Templates (`Write` of a new file where a template exists). Telegram AI Gateway has none. The core installs a single `despacho` (dispatch) entry that runs the protection rules of all modules in one process, replacing the per-module entries (older ones are migrated). Each module has a mode: **block** (default, denies the call and names the right tool), **warn** (adds a reminder for the agent and makes no permission decision, so the normal Claude Code permission prompt still applies) or **off**. The environment variable `AI_ECOSYSTEM_HOOKS=off|avisar|bloquear` overrides the mode for one session. The hooks fail open: any error, a missing or corrupt state file, a plugin that is not running (heartbeat older than 45 seconds) or a module whose handler threw an exception or was unavailable in the last 10 minutes lets the call through, and the third identical retry passes with a notice. Benchmark with `node scripts/bench-hooks.mjs`: about 50 ms (p50) and 60 ms (p95) per run on Windows.

**AI Git Tools** has its own protection rule, run by the `despacho` entry, on `Bash` and `PowerShell`. It reminds the agent to use the module's tools (`git_status`, `git_commit`, `git_pr_criar`...) when a command runs `git` or `gh`, or calls the GitHub or Bitbucket APIs with `curl`, `Invoke-RestMethod` and similar. Its default mode is **warn**, not block: the call goes through with the reminder. You can choose **block** or **off** in the module's setup. The `AI_ECOSYSTEM_HOOKS` variable still overrides the mode for one session. In warn mode a git command that you type yourself in the terminal goes through, and only Claude Code's normal permission prompt stands between it and the repository. Commands that only ask for help (`git --version`, `git help`) never trigger the reminder.

**No approval prompt from the core.** The core installs only its failure hook (`falha`), which marks a module as failed so the protection hooks step aside for ten minutes, and its summary hook (`resumo`) on `SessionStart`. It never asks for approval on `tools_run`: whether a tool asks first is decided by your own Claude Code permission rules. Entries of the retired `execucao` hook left by older versions are removed when the plugin starts. The protection hooks above also give the ready `tools_run` call in their message.

The module's setup skill is `configurar-ai-git-tools`. It asks for the protection mode and for the Bitbucket and GitHub secrets, which are optional: with none chosen, the setup still finishes, and only the pull request and pipeline tools of that provider answer `secret_nao_configurada`.

**Modules that were already active** when you updated (and modules that register without going through the catalog) stay configured and get their protection hooks installed automatically, with no confirmation, in the default mode (block, unless `config.json` says otherwise). Vaults that already have such modules without entries get them on the next load. Without Node.js nothing is written. If you press **Remove hooks** next to a module, the plugin remembers it and does not reinstall them on its own; **Install hooks** brings them back (with the confirmation).

**Setup tools**: `ecosystem_setup_status`, `ecosystem_setup_save` and `ecosystem_setup_complete`. They appear in `tools/list` only while a module is pending, but stay callable by name. They report what was detected, store the answers and finish the setup (marker, removal of the temporary hook, protection hooks, tools shown, `GEMINI.md`). `ecosystem_setup_status` leaves out the questions and the `bloco_claude_md` of a module that is already configured (`completo: true` returns them), and `ecosystem_setup_save` accepts `respostas: {key: value}` (up to 20 at a time). The allowed script folders can be added this way only while AI Scripts is being set up (existing folders of the vault only, and you see a notice); afterwards they change only in the settings.

**Screens.** `tela_gerenciar` (create or edit, `acao` criar, editar or guia for the field types), `tela_listar` and `tela_remover` let an agent define forms that open in Obsidian. A new or changed screen is shown as a preview and saved only after you approve it. Each saved screen becomes its own tool, `tela_<slug>`, with a 5-minute wait (it ends earlier if you send another message or answer). Password and token fields are stored in the Values section of Environment Keys and never returned to the agent, which only sees "filled in". The default limit is 30 screens (a setting).

### Welcome kit

Type `/kit` (or ask "where do I start?") in a Claude Code session and the agent calls `ecosystem_diagnostico`, explains in plain language what is fine and what is missing, lists the templates and scripts you can already use (`list_templates`, `list_ai_scripts`, when those modules are installed) and proposes three practical first steps. It runs nothing before you choose, and never anything that writes outside the vault or sends a message without your pick. The skill file is yours to edit: the plugin only rewrites it while it is still exactly what it wrote (the last line holds a hash of the text). The usage block of `GEMINI.md` lists `ecosystem_diagnostico` too, for clients without skills.

## Request inspector

**Open request inspector** (command or ribbon icon) shows requests, MCP tool calls and script runs as they happen: time, type, endpoint or tool, module, client, status and duration. Click a row for headers, payload, response and streamed script output. You can search, filter by module or client, pause and clear.

Payloads and responses are masked before they are shown or kept. With Environment Keys active, the real secret values are masked. Without it, the inspector falls back to masking Bearer tokens and common key patterns and shows a banner saying the masking is limited. Recent history is also kept, trimmed (at most 3000 entries and 7 days, long texts cut to 4000 characters), in `activity.sqlite` inside the plugin folder, so it survives a restart; the limit setting is how many entries the inspector shows.

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

**Open module catalog** shows the companion plugins as cards with their state (not installed, installing, installed but disabled, active, update available). One click installs and enables a module without restarting Obsidian; if Obsidian's internal installer is not available, the plugin downloads the release files itself, and as a last resort opens the plugin page. The catalog comes from `catalog.json` in this repository, with a copy bundled in the plugin as a fallback. The catalog compares each module's version with the `manifest.json` of its release.

## MCP packages

Below the modules, after a divider, the catalog has an **MCP packages** section. It downloads packages only from repositories of the `EmanuellCarvalhoPires` owner, only from `raw.githubusercontent.com/EmanuellCarvalhoPires/...`, and only when you click. Each package is written to `MCP Tools\<package>\` in the vault and its tools are indexed in the core's `tools.db` (module `ai-ecosystem`, type `api`). Find them with `tools_find` and run them with `tools_run`. Execution stays in Environment Keys, which resolves the secrets, through its `mcp-packages` service.

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

- **Servidor local.** O plugin inicia um servidor HTTP que escuta somente em `127.0.0.1` (nunca em outras interfaces de rede). Porta padrão: 27150. Se ela estiver ocupada, o plugin tenta a porta alternativa (27160) e depois as portas seguintes, uma a uma (até 20 no total), então cada cofre inicia numa porta livre mesmo com vários cofres abertos; a porta realmente usada fica guardada por cofre e é tentada primeiro na próxima vez, para os clientes MCP continuarem funcionando (se ela precisar mudar, um aviso informa e **Copiar URL do MCP** dá o novo endereço). Todo endpoint, exceto `GET /health`, exige um token de cliente, e requisições com cabeçalho `Origin` de navegador são recusadas.
- **Uso de rede.** O plugin não faz requisições em segundo plano. Ele baixa o `catalog.json` e as releases dos módulos do GitHub (`raw.githubusercontent.com`, `api.github.com` e `github.com`) somente quando você abre o catálogo de módulos ou clica em um botão dele.
- **Scripts.** Clientes de IA podem executar scripts (Python, Node.js, Bash, PowerShell) guardados no seu cofre. Por padrão, só rodam scripts de pastas que você permitiu ou de notas com a tag `#mcp/script`. Uma opção nas configurações remove essa restrição; leia o aviso antes de ativá-la.
- **Instala outros plugins.** O catálogo de módulos pode baixar, instalar, ativar e atualizar plugins complementares. Só são aceitos repositórios do dono `EmanuellCarvalhoPires` listados no catálogo, e somente quando você clica. Nada é instalado ou atualizado automaticamente, e clientes de IA não conseguem disparar isso.
- **Grava na pasta `.claude/` do seu cofre.** Hooks, skills de configuração e uma pasta de estado, além de um bloco no `GEMINI.md`, como descrito em "Integração com o Claude Code" abaixo. Suas entradas são mescladas, nunca sobrescritas.
- **Sem telemetria.** Nada sobre você ou seu cofre é enviado a lugar nenhum. O histórico do inspetor fica na memória, e uma cópia reduzida (no máximo 3000 entradas e 7 dias, textos longos cortados em 4000 caracteres) também fica em `activity.sqlite` na pasta do plugin, para sobreviver a um reinício.
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
| `ecosystem_status` | `GET /status` | Versão, status do servidor e contagens por módulo. `detalhe: true` lista as tools e `modulo` filtra um módulo; a rota REST `GET /status` continua completa. |
| `ecosystem_diagnostico` | - | Relatório de saúde da suíte: módulos registrados vs. esperados (ausente = não instalado), servidor e porta, hooks e o modo deles, configuração pendente, templates e scripts carregados, Telegram sim/não e quantos segredos existem (só a contagem, nunca nomes ou valores). Cada achado é `ok`, `aviso` ou `erro` com a próxima ação; `formato`: `texto` (padrão) ou `json`. Avisa quando um módulo está defasado (a versão do `manifest.json` difere da carregada, ou o `main.js` mudou depois do carregamento) e lista só avisos e erros (`completo: true` lista tudo). |
| `ecosystem_list_scripts` | `GET /scripts` | Scripts que podem rodar (pastas permitidas e notas `#mcp/script`). Devolve só os caminhos. |
| `ecosystem_run_script` | `POST /scripts/run` | Executa um script e devolve código de saída, stdout e stderr, cada um limitado a 4000 caracteres (início e fim; o resto vai para um arquivo, com os caminhos em `stdout_file` e `stderr_file`). `max_chars` muda o limite (também em `POST /scripts/run`); `script_id` (um script registrado no AI Scripts) é aceito no lugar de `path`. O processo é cancelado quando o agente cancela a chamada. |
| `tools_find` | - | Busca as tools de todos os módulos (texto FTS5/BM25 e filtros `tag`, `categoria`, `modulo`, `kind`, `efeito`). Uma linha por tool: `id(obrigatorio*, opcional?) \| resumo \| efeito`. |
| `tools_describe` | - | Schema, efeito, aprovação e exemplo de uma tool (`id`) ou de várias (`ids`); `full: false` encurta descrições longas. |
| `tools_run` | - | Executa uma tool pelo `id`, com `args`, pelo módulo dono, e devolve a resposta dela sem alteração. `calls` executa até 10 itens `{id, args}` em sequência, com uma saída resumida para cada um. |

As tools dos módulos instalados aparecem junto com essas, no mesmo servidor MCP.

**Exposição indexada.** Cada módulo pode manter um `tools.db` (SQLite) na pasta do plugin (`api.toolIndex.sync`); o núcleo mantém o dele. O núcleo anexa o `tools.db` de cada módulo registrado e busca em todos juntos, além das tools registradas de módulos sem índice. Em **Configurações > AI Ecosystem > Exposição das tools**, cada tipo de cliente (Claude Code, Antigravity, outros) fica **Completo** (todas as tools no `tools/list`, o padrão) ou **Indexado** (só as tools fixas, por padrão `search_notes` e `get_section`, as marcadas com `exposicao: "fixa"` e as três de descoberta; enquanto um módulo espera a configuração, as tools de configuração também aparecem). A chamada pelo nome continua valendo nos dois modos. Um módulo executa entradas do índice que não são tools MCP (por exemplo, tools de API das notas) registrando o serviço `tool-runner:<id do módulo>` (`IndexedToolRunner`). `GET /health` é público e devolve o nome do app, a versão, a versão da API e os ids dos módulos.

## Integração com o Claude Code: hooks, configuração e telas

Esta parte grava dentro da pasta `.claude/` do seu cofre (o Claude Code lê hooks e skills de lá). Ela precisa do Node.js no PATH: os hooks são scripts Node. Sem o Node.js nada é gravado nas configurações, e a aba de configurações avisa.

**O que o núcleo grava sem perguntar** (declarado aqui no lugar de uma confirmação, porque é o próprio plugin):

- a skill `.claude/skills/configurar-ai-ecosystem/SKILL.md`, que guia a primeira configuração;
- a skill de boas-vindas `.claude/skills/kit/SKILL.md` (`/kit`, veja "Kit de boas-vindas" abaixo), que nunca é sobrescrita depois que você a edita;
- um hook temporário, em `SessionStart` e `UserPromptSubmit`, que manda o agente rodar essa skill (assim um módulo instalado com a sessão já aberta dispara a skill na mensagem seguinte), removido quando a configuração termina;
- o hook de resumo `resumo`, em `SessionStart`: até 300 caracteres com os módulos ativos e as configurações pendentes;
- o hook de falha `falha`, em `PostToolUseFailure`: marca um módulo como falho só quando o handler lança exceção ou está indisponível (erro de argumento não desliga a proteção), para os hooks de proteção ficarem de lado por dez minutos;
- a pasta de estado `.claude/ai-ecosystem/` (script dos hooks, heartbeat, estados dos módulos, dados das regras, cópias de segurança);
- um bloco entre `<!-- ai-ecosystem:start -->` e `<!-- ai-ecosystem:end -->` no `GEMINI.md`, para clientes sem hooks como o Antigravity. O bloco só é gravado depois que você aceitou a instalação de um módulo (ou quando já existe); o arquivo é criado se não existir e o resto dele nunca é alterado. O `CLAUDE.md` nunca é gravado pelo plugin: a skill de configuração pergunta antes e o agente edita só esse bloco.

O plugin nunca sobrescreve as suas entradas: ele mescla em `.claude/settings.local.json` (ou `settings.json`, à sua escolha), guarda uma cópia antes de cada gravação, confere o JSON depois, se recusa a mexer em arquivo com JSON inválido e remove só as entradas cujo comando roda `ai-ecosystem-hook.mjs`.

**Módulos instalados pelo catálogo** abrem uma tela de confirmação antes de baixar qualquer coisa. Ela lista o que será gravado: a skill de configuração `configurar-<módulo>`, o hook temporário (comando e arquivo de configurações), as regras de proteção do módulo (rodadas pela entrada única de despacho, só depois da configuração) e o bloco do `GEMINI.md`. **Cancelar** não instala nada. Depois do aceite o módulo fica pendente: **as tools dele ficam escondidas do Claude Code** (o Antigravity e outros clientes as veem) até a configuração terminar. A próxima sessão do Claude Code recebe a ordem de rodar a skill, que pergunta só o que o plugin não detectou, com perguntas clicáveis, e nunca pede token ou senha no chat.

**Hooks de proteção** mantêm o agente nas tools dos plugins: AI Vault Search (Grep e Glob dentro do cofre), Environment Keys (`curl`, `wget`, `Invoke-RestMethod` e parecidos contra hosts que têm secret com domínios permitidos), AI Scripts (rodar scripts das pastas permitidas) e AI Templates (`Write` de arquivo novo onde existe molde). O Telegram AI Gateway não tem nenhum. O núcleo instala uma única entrada `despacho` (dispatch), que roda as regras de proteção de todos os módulos num só processo, no lugar das entradas por módulo (as antigas são migradas). Cada módulo tem um modo: **bloquear** (padrão, nega a chamada e indica a tool certa), **avisar** (manda um lembrete ao agente sem decidir a permissão, então a confirmação normal do Claude Code continua valendo) ou **desligado**. A variável de ambiente `AI_ECOSYSTEM_HOOKS=off|avisar|bloquear` sobrepõe o modo em uma sessão. Os hooks falham liberando: qualquer erro, arquivo de estado ausente ou corrompido, plugin fora do ar (heartbeat com mais de 45 segundos) ou um módulo cujo handler lançou exceção ou ficou indisponível nos últimos 10 minutos deixa a chamada passar, e a terceira tentativa idêntica passa com um aviso. Medição com `node scripts/bench-hooks.mjs`: cerca de 50 ms (p50) e 60 ms (p95) por execução no Windows.

**AI Git Tools** tem regra de proteção própria, rodada pela entrada `despacho`, em `Bash` e `PowerShell`. Ele lembra o agente de usar as tools do módulo (`git_status`, `git_commit`, `git_pr_criar`...) quando um comando roda `git` ou `gh`, ou chama as APIs do GitHub e do Bitbucket com `curl`, `Invoke-RestMethod` e parecidos. O modo padrão dele é **avisar**, não bloquear: a chamada passa com o lembrete. Você escolhe **bloquear** ou **desligado** na configuração do módulo. A variável `AI_ECOSYSTEM_HOOKS` ainda sobrepõe o modo em uma sessão. No modo avisar, um comando git que você digita no terminal passa, e só a confirmação normal do Claude Code separa o comando do repositório. Comandos só de ajuda (`git --version`, `git help`) nunca disparam o lembrete.

**Sem pedido de aprovação pelo núcleo.** O núcleo instala apenas o hook de falha (`falha`), que marca um módulo como falho para os hooks de proteção saírem do caminho por dez minutos, e o hook de resumo (`resumo`) em `SessionStart`. Ele nunca pede aprovação no `tools_run`: se uma tool pergunta antes é decisão das suas próprias regras de permissão do Claude Code. As entradas do hook `execucao` aposentado deixadas por versões antigas são removidas quando o plugin inicia. Os hooks de proteção acima também trazem, na mensagem, a chamada pronta com `tools_run`.

A skill de configuração do módulo é `configurar-ai-git-tools`. Ela pergunta o modo de proteção e as secrets do Bitbucket e do GitHub, que são opcionais: sem nenhuma escolhida, a configuração termina do mesmo jeito, e só as tools de PR e pipeline daquele provedor respondem `secret_nao_configurada`.

**Módulos que já estavam ativos** quando você atualizou (e módulos que se registram sem passar pelo catálogo) continuam configurados e recebem os hooks de proteção automaticamente, sem confirmação, no modo padrão (bloquear, salvo se o `config.json` disser outro). Cofres que já têm esses módulos sem entradas passam a tê-las no próximo carregamento. Sem o Node.js nada é gravado. Se você apertar **Remover hooks** ao lado de um módulo, o plugin lembra disso e não reinstala sozinho; **Instalar hooks** os traz de volta (com a confirmação).

**Tools de configuração**: `ecosystem_setup_status`, `ecosystem_setup_save` e `ecosystem_setup_complete`. Aparecem no `tools/list` só enquanto há um módulo pendente, mas continuam chamáveis pelo nome. Elas informam o que foi detectado, guardam as respostas e concluem a configuração (marcador, remoção do hook temporário, hooks de proteção, tools liberadas, `GEMINI.md`). `ecosystem_setup_status` deixa de fora as perguntas e o `bloco_claude_md` de um módulo já configurado (`completo: true` os devolve), e `ecosystem_setup_save` aceita `respostas: {chave: valor}` (até 20 de uma vez). As pastas permitidas de scripts só podem ser acrescentadas por aqui enquanto o AI Scripts está sendo configurado (só pastas que já existem no cofre, e você vê um aviso); depois, mudam só nas configurações.

**Telas.** `tela_gerenciar` (criar ou editar, `acao` criar, editar ou guia para os tipos de campo), `tela_listar` e `tela_remover` deixam um agente definir formulários que abrem no Obsidian. Uma tela nova ou alterada aparece como prévia e só é salva depois da sua aprovação. Cada tela salva vira uma tool própria, `tela_<slug>`, com espera de 5 minutos (termina antes se você mandar outra mensagem ou responder). Campos de senha e token são guardados na seção de Valores do Environment Keys e nunca voltam ao agente, que só vê "preenchido". O limite padrão é de 30 telas (configurável).

### Kit de boas-vindas

Digite `/kit` (ou pergunte "por onde começo?") numa sessão do Claude Code e o agente chama `ecosystem_diagnostico`, explica em linguagem simples o que está ok e o que falta, lista os templates e scripts que já dá para usar (`list_templates`, `list_ai_scripts`, quando esses módulos estão instalados) e propõe três primeiros passos práticos. Ele não executa nada antes da sua escolha, e nunca algo que grave fora do cofre ou envie mensagem sem você escolher. O arquivo da skill é seu para editar: o plugin só o reescreve enquanto ele ainda é exatamente o que ele gravou (a última linha guarda um hash do texto). O bloco de uso do `GEMINI.md` também lista `ecosystem_diagnostico`, para clientes sem skills.

## Inspetor de requisições

**Abrir inspetor de requisições** (comando ou ícone da barra lateral) mostra requisições, chamadas de tools MCP e execuções de scripts em tempo real: hora, tipo, endpoint ou tool, módulo, cliente, status e duração. Clique em uma linha para ver cabeçalhos, payload, resposta e a saída do script. Dá para buscar, filtrar por módulo ou cliente, pausar e limpar.

Payloads e respostas são ofuscados antes de serem exibidos ou guardados. Com o Environment Keys ativo, os valores reais das secrets são ofuscados. Sem ele, o inspetor usa uma ofuscação padrão (tokens Bearer e padrões comuns de chaves) e mostra um aviso de que a ofuscação é limitada. O histórico recente também fica, reduzido (no máximo 3000 entradas e 7 dias, textos longos cortados em 4000 caracteres), em `activity.sqlite` na pasta do plugin, para sobreviver a um reinício; o limite das configurações é quantas entradas o inspetor mostra.

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

**Abrir catálogo de módulos** mostra os plugins complementares em cards com o estado de cada um (não instalado, instalando, instalado e desativado, ativo, atualização disponível). Um clique instala e ativa um módulo sem reiniciar o Obsidian; se a rotina interna de instalação do Obsidian não existir, o plugin baixa os arquivos da release por conta própria e, em último caso, abre a página do plugin. O catálogo vem do `catalog.json` deste repositório, com uma cópia embutida no plugin como reserva. O catálogo compara a versão de cada módulo com o `manifest.json` da release.

## Pacotes MCP

Abaixo dos módulos, depois de uma linha divisória, o catálogo tem a seção **Pacotes MCP**. Ela baixa pacotes somente de repositórios do dono `EmanuellCarvalhoPires`, somente de `raw.githubusercontent.com/EmanuellCarvalhoPires/...`, e só quando você clica. Cada pacote é gravado em `MCP Tools\<pacote>\` no cofre, e as tools dele são indexadas no `tools.db` do núcleo (módulo `ai-ecosystem`, tipo `api`). Elas são achadas com `tools_find` e executadas com `tools_run`. A execução continua no Environment Keys, que resolve os segredos, pelo serviço `mcp-packages`.

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
