import type { StringTable } from "../i18n";

// Strings of the "server" area (port conflict notices). Keys start with "server.".
export const serverStrings: StringTable = {
  en: {
    "server.conflict.envKeys1":
      "Port {port} is used by Environment Keys 1.x. Update Environment Keys to 2.0. AI Ecosystem is using port {altPort} for now.",
    "server.conflict.envKeysTransition":
      "Port {port} is still held by Environment Keys. AI Ecosystem is using port {altPort} for now. Reload Environment Keys or update it to 2.0.",
    "server.conflict.otherVault":
      "Port {port} is used by the AI Ecosystem of the vault {vault}. This vault is using the alternative port {altPort}. You can change the port in the settings.",
    "server.conflict.otherVaultUnnamed":
      "Port {port} is used by the AI Ecosystem of another vault. This vault is using the alternative port {altPort}. You can change the port in the settings.",
    "server.conflict.process":
      "Port {port} is used by {process}. AI Ecosystem is using the alternative port {altPort}. You can change the port in the settings.",
    "server.conflict.unknown":
      "Port {port} is used by another program. AI Ecosystem is using the alternative port {altPort}. You can change the port in the settings.",
    "server.conflict.failed": "AI Ecosystem could not start its server. {error}",
  },
  pt: {
    "server.conflict.envKeys1":
      "A porta {port} está sendo usada pelo Environment Keys 1.x. Atualize o Environment Keys para a versão 2.0. Por enquanto, o AI Ecosystem está usando a porta {altPort}.",
    "server.conflict.envKeysTransition":
      "A porta {port} ainda está ocupada pelo Environment Keys. Por enquanto, o AI Ecosystem está usando a porta {altPort}. Recarregue o Environment Keys ou atualize-o para a versão 2.0.",
    "server.conflict.otherVault":
      "A porta {port} está sendo usada pelo AI Ecosystem do cofre {vault}. Este cofre está usando a porta alternativa {altPort}. Você pode mudar a porta nas configurações.",
    "server.conflict.otherVaultUnnamed":
      "A porta {port} está sendo usada pelo AI Ecosystem de outro cofre. Este cofre está usando a porta alternativa {altPort}. Você pode mudar a porta nas configurações.",
    "server.conflict.process":
      "A porta {port} está sendo usada por {process}. O AI Ecosystem está usando a porta alternativa {altPort}. Você pode mudar a porta nas configurações.",
    "server.conflict.unknown":
      "A porta {port} está sendo usada por outro programa. O AI Ecosystem está usando a porta alternativa {altPort}. Você pode mudar a porta nas configurações.",
    "server.conflict.failed": "O AI Ecosystem não conseguiu iniciar o servidor. {error}",
  },
};
