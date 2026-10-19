// Port-conflict notices and the text that describes the server status (status bar, settings).
import { Notice } from "obsidian";
import { t } from "../i18n";
import type { PortConflict, ServerStatus } from "../types";

export type ServerState = "running" | "alternative" | "waiting" | "conflict" | "stopped";

export interface ServerPresentation {
  state: ServerState;
  /** Lucide icon id. */
  icon: string;
  title: string;
  detail?: string;
}

/** Explains why the server is not on the configured port (or not running). Undefined when there is nothing to report. */
export function conflictMessage(status: ServerStatus): string | undefined {
  if (!status.running && status.error) return t("server.conflict.failed", { error: status.error });
  const conflict = status.conflict;
  if (!status.running || !status.usingAlternativePort || !conflict) return undefined;
  const vars = { port: conflict.port, altPort: status.port };
  switch (conflict.owner) {
    case "environment-keys-1":
      return t("server.conflict.envKeys1", vars);
    case "environment-keys-transition":
      return t("server.conflict.envKeysTransition", vars);
    case "ai-ecosystem":
      return conflict.ownerVault
        ? t("server.conflict.otherVault", { ...vars, vault: conflict.ownerVault })
        : t("server.conflict.otherVaultUnnamed", vars);
    default:
      return conflict.processName
        ? t("server.conflict.process", { ...vars, process: conflict.processName })
        : t("server.conflict.unknown", vars);
  }
}

export function presentServer(status: ServerStatus): ServerPresentation {
  if (status.running) {
    if (!status.usingAlternativePort) {
      return { state: "running", icon: "circle-check", title: t("core.state.running", { port: status.port }) };
    }
    return {
      state: "alternative",
      icon: "alert-triangle",
      title: t("core.state.alternative", { port: status.port }),
      detail: conflictMessage(status),
    };
  }
  if (status.error) {
    return {
      state: status.conflict ? "conflict" : "stopped",
      icon: status.conflict ? "alert-triangle" : "circle-x",
      title: status.conflict ? t("core.state.conflict") : t("core.state.stopped"),
      detail: status.error,
    };
  }
  if (status.conflict) {
    return { state: "waiting", icon: "loader", title: t("core.state.waiting", { port: status.conflict.port }) };
  }
  return { state: "stopped", icon: "circle-x", title: t("core.state.stopped") };
}

export function statusBarText(status: ServerStatus): string {
  const view = presentServer(status);
  switch (view.state) {
    case "running":
      return t("core.status.running", { port: status.port });
    case "alternative":
      return t("core.status.alternative", { port: status.port });
    case "conflict":
    case "waiting":
      return t("core.status.conflict");
    default:
      return t("core.status.stopped");
  }
}

export function mcpUrl(port: number): string {
  return `http://127.0.0.1:${port}/mcp`;
}

function conflictKey(status: ServerStatus, conflict: PortConflict | undefined): string {
  return JSON.stringify([
    status.running,
    status.port,
    status.usingAlternativePort,
    status.error ?? "",
    conflict?.port ?? 0,
    conflict?.owner ?? "",
    conflict?.ownerVault ?? "",
    conflict?.processName ?? "",
  ]);
}

/** Shows a notice for each distinct conflict once, so restarts in the same state do not repeat it. */
export class ConflictNotifier {
  private readonly shown = new Set<string>();

  constructor(private readonly show: (message: string) => void = (message) => void new Notice(message, 15000)) {}

  notify(status: ServerStatus): boolean {
    const message = conflictMessage(status);
    if (!message) return false;
    const key = conflictKey(status, status.conflict);
    if (this.shown.has(key)) return false;
    this.shown.add(key);
    this.show(message);
    return true;
  }
}
