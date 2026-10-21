import type { StringTable } from "../i18n";

// Strings of the "server" area (port conflict notices). Keys start with "server.".
export const serverStrings: StringTable = {
  en: {
    "server.conflict.envKeys1":
      "Port {port} is used by Environment Keys 1.x. Update Environment Keys to 2.0. AI Ecosystem is using port {altPort} for now.",
    "server.conflict.envKeysTransition":
      "Port {port} is still held by Environment Keys. AI Ecosystem is using port {altPort} for now. Reload Environment Keys or update it to 2.0.",
    "server.conflict.otherVault":
      "Port {port} is busy: it is used by the AI Ecosystem of the vault {vault}. This vault is using port {altPort} instead, found automatically. You can change the port in the settings.",
    "server.conflict.otherVaultUnnamed":
      "Port {port} is busy: it is used by the AI Ecosystem of another vault. This vault is using port {altPort} instead, found automatically. You can change the port in the settings.",
    "server.conflict.process":
      "Port {port} is busy: it is used by {process}. AI Ecosystem is using port {altPort} instead, found automatically. You can change the port in the settings.",
    "server.conflict.unknown":
      "Port {port} is busy: it is used by another program. AI Ecosystem is using port {altPort} instead, found automatically. You can change the port in the settings.",
    "server.conflict.remembered":
      "AI Ecosystem is using port {altPort}, the one this vault used last time, instead of the configured port {port}. Changing the port in the settings makes it start there again.",
    "server.portChanged":
      "This vault was on port {oldPort} before and is now on port {altPort}. MCP clients configured for the old port must use the new URL: copy it with the Copy MCP URL button in the settings or the Copy MCP URL command.",
    "server.conflict.failed": "AI Ecosystem could not start its server. {error}",
  },
  pt: {
    "server.conflict.envKeys1":
      "A porta {port} está sendo usada pelo Environment Keys 1.x. Atualize o Environment Keys para a versão 2.0. Por enquanto, o AI Ecosystem está usando a porta {altPort}.",
    "server.conflict.envKeysTransition":
      "A porta {port} ainda está ocupada pelo Environment Keys. Por enquanto, o AI Ecosystem está usando a porta {altPort}. Recarregue o Environment Keys ou atualize-o para a versão 2.0.",
    "server.conflict.otherVault":
      "A porta {port} está ocupada: é usada pelo AI Ecosystem do cofre {vault}. Este cofre está usando a porta {altPort}, encontrada automaticamente. Você pode mudar a porta nas configurações.",
    "server.conflict.otherVaultUnnamed":
      "A porta {port} está ocupada: é usada pelo AI Ecosystem de outro cofre. Este cofre está usando a porta {altPort}, encontrada automaticamente. Você pode mudar a porta nas configurações.",
    "server.conflict.process":
      "A porta {port} está ocupada: é usada por {process}. O AI Ecosystem está usando a porta {altPort}, encontrada automaticamente. Você pode mudar a porta nas configurações.",
    "server.conflict.unknown":
      "A porta {port} está ocupada: é usada por outro programa. O AI Ecosystem está usando a porta {altPort}, encontrada automaticamente. Você pode mudar a porta nas configurações.",
    "server.conflict.remembered":
      "O AI Ecosystem está usando a porta {altPort}, a que este cofre usou da última vez, em vez da porta configurada {port}. Mudar a porta nas configurações faz o servidor voltar a usá-la.",
    "server.portChanged":
      "Este cofre estava na porta {oldPort} e agora está na porta {altPort}. Os clientes MCP configurados para a porta antiga precisam da nova URL: copie-a com o botão Copiar URL do MCP nas configurações ou com o comando Copiar URL do MCP.",
    "server.conflict.failed": "O AI Ecosystem não conseguiu iniciar o servidor. {error}",
  },
};
