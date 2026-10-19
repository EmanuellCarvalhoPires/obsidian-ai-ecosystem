# Roteiro de testes locais no cofre Cofre

Roteiro para validar o AI Ecosystem no cofre "Cofre", com o Environment Keys 2.0 e os outros plugins, antes de qualquer envio à loja. Cada item aponta o critério de aceite que ele cobre:

- **PI-8.x**: seção 8 do Plano de Implementação do AI Ecosystem (critérios de aceite do plugin).
- **PM-5.x**: seção 5 do Plano Mestre (critérios de aceite do ecossistema).

Nos exemplos, `$TOKEN` é o token de um cliente criado em **Configurações > AI Ecosystem > Clientes** e `$PORT` é a porta mostrada em **Servidor**. No PowerShell, use `curl.exe` (e não o alias `curl`) e `$env:TOKEN`.

## 0. Preparação e backup

Faça antes de instalar qualquer coisa no cofre.

1. Feche o Obsidian ou desative os plugins envolvidos.
2. Copie o `data.json` de cada plugin envolvido (`<cofre>/.obsidian/plugins/<id>/data.json`): `environment-variables`, `ai-templates`, `telegram-ai-gateway` e `ai-ecosystem` (se já existir). Guarde em uma pasta fora do cofre, por exemplo `Backups/ai-ecosystem-AAAA-MM-DD/`.
3. Copie as configurações de MCP dos clientes: `~/.claude.json` (Claude Code) e o arquivo de configuração de MCP do Antigravity.
4. Anote a URL de MCP atual (hoje `http://127.0.0.1:27150/mcp`) e o token do cliente em uso.
5. No repositório `obsidian-ai-ecosystem`, rode `npm ci`, `npm test`, `npm run lint` e `npm run build` e confirme que passam (item 16).
6. Instale o build no cofre: `npm run deploy` (com `AIE_DEPLOY_DIR` apontando para `<cofre>/.obsidian/plugins/ai-ecosystem`).

Pare e volte ao backup se algum item de segurança (itens 2, 3, 7, 8 e 9) falhar.

## 1. Conflito de porta com o Environment Keys 1.x (PI-8.4, PM-5.1)

Com o Environment Keys **1.x** ativo (ocupando a porta 27150):

1. Ative o AI Ecosystem.
2. Esperado: aparece um aviso "Port 27150 is used by Environment Keys 1.x. Update Environment Keys to 2.0. AI Ecosystem is using port 27160 for now." (em português, se o Obsidian estiver em português).
3. A barra de status mostra "AI Ecosystem: 127.0.0.1:27160 (alternative)".
4. Em **Configurações > AI Ecosystem > Servidor** o status tem o ícone de alerta, a porta alternativa e o detalhe do conflito.
5. Reinicie o servidor (comando **Restart server**): o mesmo aviso **não** aparece de novo.
6. Atualize o Environment Keys para a 2.0 e recarregue os dois plugins: o AI Ecosystem assume a porta 27150 (a barra de status volta a mostrar 27150, sem aviso).
7. (Opcional) Ocupe a porta 27150 com outro programa (por exemplo `python -m http.server 27150 --bind 127.0.0.1`): o aviso cita o nome do processo e diz que a porta pode ser mudada nas configurações.

## 2. Rota pública e autenticação (PI-8.1)

```bash
curl -i http://127.0.0.1:$PORT/health
curl -i http://127.0.0.1:$PORT/api/v1/ai-ecosystem/status
curl -i -H "Authorization: Bearer token-errado" http://127.0.0.1:$PORT/api/v1/ai-ecosystem/status
curl -i -H "Authorization: Bearer $TOKEN" http://127.0.0.1:$PORT/api/v1/ai-ecosystem/status
```

Esperado: `/health` responde 200 com `app`, `version`, `apiVersion` e `modules` (sem dados sensíveis); as duas chamadas sem token ou com token errado respondem 401; a última responde 200 com versão, status do servidor, módulos e serviços.

## 3. Origin e Host (PI-8.1)

```bash
curl -i -H "Origin: http://example.com" http://127.0.0.1:$PORT/health
curl -i -H "Host: example.com" http://127.0.0.1:$PORT/health
```

Esperado: a primeira responde 403 (`forbidden_origin`); a segunda responde 421 (`bad_host`). Confirme com `netstat -ano | findstr :27150` (ou a porta em uso) que o endereço de escuta é `127.0.0.1`, e nunca `0.0.0.0`.

## 4. MCP com o Claude Code (PI-8.2, PM-5.2)

1. Em **Clientes**, crie o cliente "Claude Code" e copie o token e o comando do modal.
2. Rode o comando copiado (`claude mcp add --transport http ai-ecosystem http://127.0.0.1:$PORT/mcp --header "Authorization: Bearer $TOKEN"`).
3. No Claude Code, rode `/mcp`: o servidor `ai-ecosystem` aparece conectado.
4. Peça ao Claude Code para listar as tools: aparecem `ecosystem_status`, `ecosystem_list_scripts`, `ecosystem_run_script` e as tools dos módulos ativos (Environment Keys etc.).
5. Peça para chamar `ecosystem_status`: o resultado lista os módulos registrados e os serviços (por exemplo `secrets`).
6. Sem o Claude Code, o mesmo pode ser conferido por `curl`:

```bash
curl -s -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}' \
  http://127.0.0.1:$PORT/mcp
curl -s -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' http://127.0.0.1:$PORT/mcp
curl -s -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"ecosystem_status","arguments":{}}}' http://127.0.0.1:$PORT/mcp
```

7. Instale ou ative outro módulo com o Claude Code conectado: a lista de tools muda sem reconectar (notificação `list_changed`).
8. Confirme que as configurações de MCP antigas (clientes importados do Environment Keys 1.x) continuam funcionando com a nova URL, mudando só o endereço, e que o cliente aparece com a marca "Imported from Environment Keys".

## 5. Antigravity (PI-8.2, PM-5.2)

1. Crie o cliente "Antigravity" e copie o bloco JSON do modal (`type: http`, `url`, `headers.Authorization`).
2. Cole o bloco na configuração de MCP do Antigravity e reinicie o cliente, se preciso.
3. Esperado: o Antigravity lista as mesmas tools do item 4 e consegue chamar `ecosystem_status`.
4. No inspetor, as chamadas aparecem com o cliente "Antigravity".

## 6. Inspetor e ofuscação (PI-8.6)

1. Abra o inspetor (comando **Open request inspector** ou ícone da barra lateral): ele abre na barra lateral direita; abrir de novo reaproveita a mesma aba.
2. Faça chamadas dos itens 2 e 4: cada linha mostra hora, tipo (`GET`, `POST`, `MCP Tool Call`), endpoint ou tool, módulo, cliente, status e tempo. A chamada sem token aparece com status 401.
3. Clique em uma linha: cabeçalhos, payload e resposta aparecem; o cabeçalho `Authorization` aparece ofuscado.
4. Teste busca, filtro por módulo e por cliente, pausar e limpar.
5. **Com o Environment Keys 2.x ativo e o cofre desbloqueado:** faça uma chamada que use uma secret (por exemplo `http_request` com `{{secret:NOME}}`) e confira que o valor real da secret **não** aparece em nenhuma linha, nem no payload, nem na resposta, nem na saída de script.
6. **Sem o serviço de secrets** (desative o Environment Keys): o inspetor mostra o aviso de que a ofuscação é limitada ("Masking is limited to common token patterns...") e continua ocultando tokens Bearer e padrões comuns.
7. Reinicie o Obsidian: o histórico do inspetor está vazio (não é gravado em disco). Procure por trechos de payload no `data.json` do AI Ecosystem: ele só tem configurações, clientes (com hash) e a lista de módulos importados.

## 7. Restrições do Script Engine (PI-8.5)

Crie uma pasta `Scripts` no cofre com `hello.js` (`console.log("ola")`) e `hello.py` (`print("ola")`), e outro `fora.js` em uma pasta que não esteja permitida. Em **Scripts > Allowed script folders** adicione `Scripts`.

1. Peça ao Claude Code `ecosystem_list_scripts`: lista só `Scripts/hello.js` e `Scripts/hello.py`.
2. `ecosystem_run_script` com `path: "Scripts/hello.js"`: executa e devolve `exitCode: 0` e `ola` em stdout. A linha do inspetor mostra o tipo `Script`, a saída em streaming e o cliente.
3. `ecosystem_run_script` com `code: "console.log(1)"` e `language: "node"`: **recusado** com mensagem clara (código inline só com as restrições desligadas).
4. `ecosystem_run_script` com o caminho de `fora.js` ou com `../fora.js`: **recusado** (pasta não permitida).
5. Os itens 3 e 4 aparecem no inspetor com status 403 e o motivo.
6. Teste um script que passe do tempo limite (por exemplo, `setTimeout` de 10 min com `timeoutSeconds: 2`): o processo é morto e o resultado indica `killed`.
7. Se um interpretador não for encontrado, a mensagem manda definir o caminho em **Scripts** nas configurações; defina o caminho e repita.

## 8. Restrições desligadas e badge de alerta (PI-8.5)

1. Em **Danger zone**, ligue **Remove Script Engine restrictions**: o modal de confirmação explica o risco; **Cancelar** deixa a opção desligada; **Remove restrictions** liga.
2. Rode `ecosystem_run_script` com `code: "console.log(42)"`, `language: "node"`: executa.
3. Rode um script fora das pastas permitidas: executa.
4. No inspetor, essas execuções têm o badge de alerta.
5. Desligue a opção (sem confirmação) e repita o item 7.3: volta a ser recusado.

## 9. Segredos e dados em disco (PM-5.3)

1. Procure em `data.json` de cada plugin, nos logs do Claude Code e no inspetor pelo valor real de uma secret de teste: não pode aparecer em lugar nenhum.
2. Confira que o `data.json` do AI Ecosystem tem só `tokenHash` e `hint` (primeiros caracteres) dos clientes, nunca o token completo.
3. Revogue um cliente (**Revoke** > confirmar): a chamada seguinte com o token dele responde 401.

## 10. Catálogo de módulos e instalação em um clique (PI-8.7)

1. Abra o catálogo (comando **Open module catalog** ou ícone da barra lateral): abre em uma aba nova; abrir de novo reaproveita a aba.
2. Os três cards aparecem com ícones (sem emojis).
3. **Environment Keys**: se estiver instalado e ativo, mostra "Active" e, se ainda não registrou no AI Ecosystem, "Not connected yet". Quando registra, o card passa para "Connected to AI Ecosystem" sem fechar o catálogo.
4. **Telegram AI Gateway** e **AI Templates**: mostram "No release published yet" enquanto não houver release no GitHub, sem erro.
5. Com um módulo que tenha release: **Install** instala e ativa em um clique, sem reiniciar o Obsidian, e o módulo se registra (aparece em **Modules** nas configurações e em `ecosystem_status`).
6. Teste **Update** com uma versão mais nova e a página do plugin (`obsidian://show-plugin?id=...`) quando a instalação interna falhar (por exemplo, offline).
7. Confirme que o plugin não acessa a rede sozinho: sem abrir o catálogo e sem clicar em nada, não há requisições para o GitHub (por exemplo, confira com o monitor de rede do sistema ou o DevTools do Obsidian, aba Network, com o catálogo fechado).

## 11. Ordem de carregamento (PI-8.3, PM-5.5)

Com os quatro plugins instalados, repita o ciclo abaixo em ordens diferentes e confira, a cada passo, que `ecosystem_status` lista todos os módulos ativos e que as tools do Claude Code continuam respondendo.

Cenários:

1. Desative e ative cada módulo (Environment Keys, AI Templates, Telegram AI Gateway), um por vez.
2. Desative e ative o AI Ecosystem: os módulos mostram "disconnected" e se registram de novo quando o AI Ecosystem volta (evento `ai-ecosystem:ready`).
3. Desative o AI Ecosystem, depois ative **depois** dos módulos; e ative **antes** dos módulos.
4. Recarregue o AI Ecosystem pelo Obsidian CLI: `obsidian plugin:reload id=ai-ecosystem`. Recarregue também cada módulo: `obsidian plugin:reload id=environment-variables` (e os demais ids).
5. Reinicie o Obsidian (Ctrl+R) com todos ativos.
6. Com o AI Ecosystem desativado, ative um módulo: ele mostra o modal de dependência (ícone de alerta, botão "Install and enable AI Ecosystem"). Use o botão e confirme que o AI Ecosystem é instalado e ativado e o módulo se registra.

Esperado em todos: nenhum erro no console, o Obsidian não trava, o servidor responde, e o conjunto final de módulos registrados é o mesmo.

## 12. Estado do Environment Keys 2.x em transição (PM-5.1)

1. Com o AI Ecosystem **desativado** e o Environment Keys 2.x ativo, o Environment Keys sobe o servidor legado (modo de transição) na porta 27150.
2. Ative o AI Ecosystem: o Environment Keys libera a porta ao receber `ai-ecosystem:ready`, e o AI Ecosystem assume a porta 27150 em até ~10 s, sem aviso de conflito.
3. Desative o AI Ecosystem: o Environment Keys volta ao modo de transição (rollback do plano, seção 10).

## 13. Interface sem emojis (PI-8.8)

1. Percorra configurações, modais (novo cliente, revogar, restrições), inspetor, catálogo, barra de status, comandos e avisos, em português e em inglês: só ícones do Obsidian, nenhum emoji.
2. Procure emojis no código: `npm test` roda o teste `tests/core/i18n.test.ts`, que falha se algum texto da interface tiver emoji.

## 14. Configurações (PI-8.1)

1. Mude a **Port** para outra porta livre: o servidor reinicia sozinho em poucos segundos e a barra de status mostra a nova porta. Valores inválidos (menores que 1024, maiores que 65535, iguais à porta alternativa) mostram erro e não são salvos.
2. **Copy MCP URL** copia `http://127.0.0.1:<porta>/mcp` da porta em uso.
3. Adicione e remova pastas permitidas; o tempo limite máximo e os caminhos dos interpretadores valem na próxima execução.
4. Feche e abra o Obsidian: todas as configurações continuam as mesmas.
5. Cliente novo: o token aparece uma única vez no modal, com os botões de copiar; ao fechar o modal ele não pode mais ser visto.

## 15. Barra de status e comandos

1. A barra de status mostra "AI Ecosystem: 127.0.0.1:<porta>" com o servidor ativo, "stopped" com ele parado e o texto de conflito quando houver; clicar abre as configurações do plugin (também por teclado: Enter ou Espaço).
2. Os comandos **Open request inspector**, **Open module catalog**, **Restart server** e **Copy MCP URL** funcionam pela paleta de comandos, sem atalhos padrão.

## 16. Qualidade (PI-8.9)

No repositório, tudo sem erros:

```bash
npm test
npx tsc --noEmit
npm run lint
npm run build
```

## Rollback

Se algo der errado em qualquer item:

1. Desative o AI Ecosystem. O Environment Keys 2.x volta ao modo de transição (servidor legado) e os outros módulos ficam desconectados, sem travar o Obsidian.
2. Para voltar uma versão do AI Ecosystem, instale a release anterior do GitHub (substitua `main.js`, `manifest.json` e `styles.css` em `<cofre>/.obsidian/plugins/ai-ecosystem`) e recarregue o plugin.
3. Para voltar o Environment Keys para a 1.11.x, reinstale a release anterior. O formato do cofre de secrets da 2.x é o mesmo da 1.x, então nenhuma secret é perdida.
4. Restaure os `data.json` salvos no item 0 (com o Obsidian fechado) e as configurações de MCP dos clientes (`~/.claude.json` e a do Antigravity), apontando de novo para a URL anterior (`http://127.0.0.1:27150/mcp`).
5. Rode o item 2 para confirmar que o servidor antigo voltou a responder.
