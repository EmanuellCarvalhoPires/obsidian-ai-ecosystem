import type { StringTable } from "../i18n";

// Strings of the "core" area (commands, ribbon, status bar, notices). Keys start with "core.".
export const coreStrings: StringTable = {
  en: {
    "core.cmd.openInspector": "Open live activity in sidebar",
    "core.cmd.openInspectorTab": "Open live activity in new tab",
    "core.cmd.openCatalog": "Open module catalog",
    "core.cmd.restartServer": "Restart server",
    "core.cmd.copyMcpUrl": "Copy MCP URL",

    "core.ribbon.inspector": "Open live activity",
    "core.ribbon.catalog": "Open module catalog",

    "core.status.running": "AI Ecosystem: 127.0.0.1:{port}",
    "core.status.alternative": "AI Ecosystem: 127.0.0.1:{port} (main port busy)",
    "core.status.remembered": "AI Ecosystem: 127.0.0.1:{port} (last port)",
    "core.status.stopped": "AI Ecosystem: stopped",
    "core.status.conflict": "AI Ecosystem: port conflict",
    "core.status.open": "Open AI Ecosystem settings",

    "core.state.running": "Running on 127.0.0.1:{port}",
    "core.state.alternative": "Running on 127.0.0.1:{port} (the configured port is busy)",
    "core.state.remembered": "Running on 127.0.0.1:{port} (the port used last time, not the configured one)",
    "core.state.waiting": "Waiting for port {port} to be released",
    "core.state.stopped": "Stopped",
    "core.state.conflict": "Port conflict",

    "core.notice.restarted": "AI Ecosystem server restarted on port {port}.",
    "core.notice.notRunning": "The AI Ecosystem server is not running.",
    "core.notice.urlCopied": "MCP URL copied.",
    "core.notice.copyFailed": "Could not copy to the clipboard.",
    "core.notice.saveFailed": "AI Ecosystem could not save its settings.",
    "core.notice.scriptFoldersAdded": "The AI Scripts setup allowed scripts to run from: {folders}. Change this in the AI Ecosystem settings.",
  },
  pt: {
    "core.cmd.openInspector": "Abrir atividade em tempo real na barra lateral",
    "core.cmd.openInspectorTab": "Abrir atividade em tempo real em nova aba",
    "core.cmd.openCatalog": "Abrir catálogo de módulos",
    "core.cmd.restartServer": "Reiniciar servidor",
    "core.cmd.copyMcpUrl": "Copiar URL do MCP",

    "core.ribbon.inspector": "Abrir atividade em tempo real",
    "core.ribbon.catalog": "Abrir catálogo de módulos",

    "core.status.running": "AI Ecosystem: 127.0.0.1:{port}",
    "core.status.alternative": "AI Ecosystem: 127.0.0.1:{port} (porta principal ocupada)",
    "core.status.remembered": "AI Ecosystem: 127.0.0.1:{port} (última porta)",
    "core.status.stopped": "AI Ecosystem: parado",
    "core.status.conflict": "AI Ecosystem: conflito de porta",
    "core.status.open": "Abrir configurações do AI Ecosystem",

    "core.state.running": "Em execução em 127.0.0.1:{port}",
    "core.state.alternative": "Em execução em 127.0.0.1:{port} (a porta configurada está ocupada)",
    "core.state.remembered": "Em execução em 127.0.0.1:{port} (a porta usada da última vez, não a configurada)",
    "core.state.waiting": "Aguardando a liberação da porta {port}",
    "core.state.stopped": "Parado",
    "core.state.conflict": "Conflito de porta",

    "core.notice.restarted": "Servidor do AI Ecosystem reiniciado na porta {port}.",
    "core.notice.notRunning": "O servidor do AI Ecosystem não está em execução.",
    "core.notice.urlCopied": "URL do MCP copiada.",
    "core.notice.copyFailed": "Não foi possível copiar para a área de transferência.",
    "core.notice.saveFailed": "O AI Ecosystem não conseguiu salvar as configurações.",
    "core.notice.scriptFoldersAdded": "A configuração do AI Scripts permitiu rodar scripts destas pastas: {folders}. Mude isso nas configurações do AI Ecosystem.",
  },
};
