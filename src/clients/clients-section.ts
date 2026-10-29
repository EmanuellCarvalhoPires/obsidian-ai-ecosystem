// Reusable AI Clients connector UI section: used in both the Settings Tab and the Module Catalog View.
// Renders responsive cards for the 4 supported integrations (Claude Code, Codex, Antigravity, Cursor) with
// one-click Connect / Reconnect / Disconnect, plus a dedicated section for manual client tokens.

import { setIcon } from "obsidian";
import type { App } from "obsidian";
import { INTEGRATIONS, normalizeIntegrationId, type Integration } from "./integrations";
import { mcpUrl } from "../core/notices";
import { t } from "../i18n";
import { ConfirmModal, NewClientModal, PromptModal } from "../settings/modals";
import type { AIEcosystemSettings, ClientRecord, IntegrationId, ServerStatus } from "../types";

export interface ClientsSectionHost {
  settings: AIEcosystemSettings;
  getServerStatus(): ServerStatus;
  getServerName?(): string;
  createClient(name: string, integration?: IntegrationId): Promise<{ record: ClientRecord; token: string }>;
  revokeClient(id: string): Promise<void>;
  connectIntegration?(id: IntegrationId): Promise<boolean>;
  disconnectIntegration?(id: IntegrationId): Promise<void>;
  detectIntegration?(id: IntegrationId): Promise<boolean>;
  setMcpServerName?(name: string): Promise<void>;
}

function addClass(el: unknown, cls: string): void {
  if (!el || typeof el !== "object") return;
  const target = el as { addClass?: (c: string) => void; classList?: { add: (c: string) => void } };
  if (typeof target.addClass === "function") {
    target.addClass(cls);
  } else if (target.classList) {
    target.classList.add(cls);
  }
}

function on(el: unknown, event: string, handler: (evt: Event) => void): void {
  if (!el || typeof el !== "object") return;
  if ("addEventListener" in el && typeof (el as HTMLElement).addEventListener === "function") {
    (el as HTMLElement).addEventListener(event, handler);
  }
}

function createEl<K extends keyof HTMLElementTagNameMap>(
  parent: HTMLElement,
  tag: K,
  options?: { text?: string; cls?: string; attr?: Record<string, string> },
): HTMLElement {
  if (typeof parent.createEl === "function") {
    return parent.createEl(tag, options);
  }
  if (tag === "div" || tag === "button") {
    return parent.createDiv?.(options) ?? ({} as HTMLElement);
  }
  return parent.createSpan?.(options) ?? ({} as HTMLElement);
}

function formatDate(iso: string | undefined): string {
  if (!iso) return t("settings.clients.never");
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

function addBadge(parent: HTMLElement, text: string, cls = "aie-badge", icon?: string): HTMLElement {
  const el = parent.createSpan ? parent.createSpan({ cls }) : createEl(parent, "span", { cls });
  if (icon && typeof el.createSpan === "function") {
    const iconEl = el.createSpan({ cls: "aie-badge-icon" });
    setIcon(iconEl, icon);
    el.createSpan({ text });
  } else {
    if (typeof el.setText === "function") el.setText(text);
  }
  return el;
}

/** Finds the ClientRecord for a given integration id (either tagged or matching its label). */
export function findConnectedClient(clients: readonly ClientRecord[], id: IntegrationId): ClientRecord | undefined {
  return clients.find((c) => c.integration === id) ?? clients.find((c) => !c.integration && normalizeIntegrationId(c.name) === id);
}

/** Returns clients that do not belong to any built-in integration. */
export function listManualClients(clients: readonly ClientRecord[]): ClientRecord[] {
  const boundIds = new Set<string>();
  for (const integration of INTEGRATIONS) {
    const match = findConnectedClient(clients, integration.id);
    if (match) boundIds.add(match.id);
  }
  return clients.filter((c) => !boundIds.has(c.id));
}

export class ClientsSection {
  private readonly detected = new Map<IntegrationId, boolean>();
  private connecting: IntegrationId | null = null;

  constructor(
    private readonly app: App,
    private readonly host: ClientsSectionHost,
    private readonly refresh: () => void,
  ) {}

  /** Renders the 4 integrations and the manual clients into `container`. */
  renderBody(container: HTMLElement): void {
    const { clients } = this.host.settings;

    // AI Clients Grid (Cards)
    const grid = container.createDiv({ cls: "aie-clients-grid" });
    for (const integration of INTEGRATIONS) {
      this.renderIntegrationCard(grid, integration, findConnectedClient(clients, integration.id));
    }

    // Manual clients registered
    for (const client of listManualClients(clients)) {
      this.renderManualClientCard(grid, client);
    }

    // Add manual client card in the grid
    this.renderAddClientCard(grid);
  }

  private renderIntegrationCard(grid: HTMLElement, integration: Integration, connected: ClientRecord | undefined): void {
    const card = grid.createDiv({ cls: "aie-client-card" });

    // Header: Brand (icon + name) and Status Badge
    const head = card.createDiv({ cls: "aie-client-card-head" });
    const brand = head.createDiv({ cls: "aie-client-card-brand" });
    const iconWrapper = brand.createSpan ? brand.createSpan({ cls: "aie-client-card-icon" }) : createEl(brand, "span", { cls: "aie-client-card-icon" });
    setIcon(iconWrapper, integration.icon);
    brand.createSpan ? brand.createSpan({ cls: "aie-client-card-name", text: integration.label }) : createEl(brand, "span", { cls: "aie-client-card-name", text: integration.label });

    const badgeWrapper = head.createDiv({ cls: "aie-client-card-status" });

    // Body
    const body = card.createDiv({ cls: "aie-client-card-body" });

    // Actions footer
    const actions = card.createDiv({ cls: "aie-client-card-actions" });

    if (connected) {
      addClass(card, "is-connected");
      addBadge(badgeWrapper, t("settings.clients.connected"), "aie-badge aie-badge-ok", "check");

      const tokenLine = body.createDiv({ cls: "aie-client-token-line" });
      createEl(tokenLine, "code", { text: connected.hint ? `Token ${connected.hint}…` : "Token ativo" });
      if (connected.importedFrom) {
        addBadge(tokenLine, t("settings.clients.imported"), "aie-badge aie-badge-subtle");
      }

      const metaLine = body.createDiv({ cls: "aie-client-meta-line" });
      const lastUsed = formatDate(connected.lastUsedAt);
      const metaSpan = metaLine.createSpan ? metaLine.createSpan() : createEl(metaLine, "span");
      if (typeof metaSpan.setText === "function") metaSpan.setText(t("settings.clients.lastUsedLabel", { time: lastUsed }));

      // Reconnect action
      const reconnectBtn = createEl(actions, "button", {
        cls: "aie-btn aie-btn-secondary aie-btn-sm",
        attr: { "aria-label": t("settings.clients.reconnect") },
      });
      const iconSpan = reconnectBtn.createSpan ? reconnectBtn.createSpan({ cls: "aie-btn-icon" }) : createEl(reconnectBtn, "span", { cls: "aie-btn-icon" });
      setIcon(iconSpan, "refresh-cw");
      const textSpan = reconnectBtn.createSpan ? reconnectBtn.createSpan({ text: t("settings.clients.reconnect") }) : createEl(reconnectBtn, "span", { text: t("settings.clients.reconnect") });
      if (typeof textSpan.setText === "function") textSpan.setText(t("settings.clients.reconnect"));

      on(reconnectBtn, "click", () => {
        void (async () => {
          if (this.connecting) return;
          this.connecting = integration.id;
          (reconnectBtn as HTMLButtonElement).disabled = true;
          try {
            if (this.host.connectIntegration) {
              await this.host.connectIntegration(integration.id);
            }
          } finally {
            this.connecting = null;
            this.refresh();
          }
        })();
      });

      // Disconnect action
      const disconnectBtn = createEl(actions, "button", {
        cls: "clickable-icon aie-btn-destructive aie-btn-icon-only",
        attr: { "aria-label": t("settings.clients.disconnect") },
      });
      setIcon(disconnectBtn, "unplug");
      on(disconnectBtn, "click", () => this.confirmDisconnect(integration, connected));
      return;
    }

    if (!this.host.connectIntegration) {
      body.createDiv({ cls: "aie-client-desc", text: t("settings.clients.manualDesc") });
      return;
    }

    const known = this.detected.get(integration.id);
    if (known === undefined) {
      addBadge(badgeWrapper, t("settings.clients.checking"), "aie-badge aie-badge-muted");
      body.createDiv({ cls: "aie-client-desc", text: t("settings.clients.checkingDesc") });

      const check = this.host.detectIntegration ? this.host.detectIntegration(integration.id) : integration.detect();
      void check
        .then((found) => {
          this.detected.set(integration.id, found);
          this.refresh();
        })
        .catch(() => {
          this.detected.set(integration.id, false);
          this.refresh();
        });
      return;
    }

    if (!known) {
      addClass(card, "is-missing");
      addBadge(badgeWrapper, t("settings.clients.notFound"), "aie-badge aie-badge-muted");
      body.createDiv({
        cls: "aie-client-desc aie-text-muted",
        text: t("settings.clients.notFoundDesc"),
      });
    } else {
      addClass(card, "is-available");
      addBadge(badgeWrapper, t("settings.clients.available"), "aie-badge aie-badge-available");
      body.createDiv({
        cls: "aie-client-desc",
        text: t("settings.clients.availableDesc"),
      });
    }

    const isConnecting = this.connecting === integration.id;
    const connectBtn = createEl(actions, "button", {
      cls: `aie-btn aie-btn-sm ${known ? "aie-btn-primary" : "aie-btn-secondary"}`,
    });
    const connectIcon = connectBtn.createSpan ? connectBtn.createSpan({ cls: "aie-btn-icon" }) : createEl(connectBtn, "span", { cls: "aie-btn-icon" });
    setIcon(connectIcon, isConnecting ? "loader-2" : "plug");
    if (isConnecting) addClass(connectIcon, "aie-spin");

    const connectText = connectBtn.createSpan ? connectBtn.createSpan() : createEl(connectBtn, "span");
    if (typeof connectText.setText === "function") {
      connectText.setText(isConnecting ? t("settings.clients.connecting") : t("settings.clients.connect"));
    }
    (connectBtn as HTMLButtonElement).disabled = isConnecting;

    on(connectBtn, "click", () => {
      void (async () => {
        if (this.connecting) return;
        this.connecting = integration.id;
        this.refresh();
        try {
          await this.host.connectIntegration?.(integration.id);
        } finally {
          this.connecting = null;
          this.refresh();
        }
      })();
    });
  }

  private renderAddClientCard(grid: HTMLElement): void {
    const card = grid.createDiv({ cls: "aie-client-card aie-client-card-add is-missing" });

    // Header: Brand (icon + name) and Status Badge
    const head = card.createDiv({ cls: "aie-client-card-head" });
    const brand = head.createDiv({ cls: "aie-client-card-brand" });
    const iconWrapper = brand.createSpan ? brand.createSpan({ cls: "aie-client-card-icon" }) : createEl(brand, "span", { cls: "aie-client-card-icon" });
    setIcon(iconWrapper, "user-plus");
    brand.createSpan
      ? brand.createSpan({ cls: "aie-client-card-name", text: t("settings.clients.manualCardTitle") })
      : createEl(brand, "span", { cls: "aie-client-card-name", text: t("settings.clients.manualCardTitle") });

    const badgeWrapper = head.createDiv({ cls: "aie-client-card-status" });
    addBadge(badgeWrapper, t("settings.clients.manualBadge"), "aie-badge aie-badge-muted");

    // Body
    const body = card.createDiv({ cls: "aie-client-card-body" });
    body.createDiv({
      cls: "aie-client-desc aie-text-muted",
      text: t("settings.clients.manualDesc"),
    });

    // Actions footer
    const actions = card.createDiv({ cls: "aie-client-card-actions" });
    const addBtn = createEl(actions, "button", {
      cls: "aie-btn aie-btn-sm aie-btn-secondary",
    });
    const addIcon = addBtn.createSpan ? addBtn.createSpan({ cls: "aie-btn-icon" }) : createEl(addBtn, "span", { cls: "aie-btn-icon" });
    setIcon(addIcon, "plus");
    const addText = addBtn.createSpan ? addBtn.createSpan() : createEl(addBtn, "span");
    if (typeof addText.setText === "function") {
      addText.setText(t("settings.clients.add"));
    }
    on(addBtn, "click", () => this.promptManualClient());
  }

  private renderManualClientCard(grid: HTMLElement, client: ClientRecord): void {
    const card = grid.createDiv({ cls: "aie-client-card is-connected" });

    // Header
    const head = card.createDiv({ cls: "aie-client-card-head" });
    const brand = head.createDiv({ cls: "aie-client-card-brand" });
    const iconWrapper = brand.createSpan ? brand.createSpan({ cls: "aie-client-card-icon" }) : createEl(brand, "span", { cls: "aie-client-card-icon" });
    setIcon(iconWrapper, "key-round");
    brand.createSpan
      ? brand.createSpan({ cls: "aie-client-card-name", text: client.name })
      : createEl(brand, "span", { cls: "aie-client-card-name", text: client.name });

    const badgeWrapper = head.createDiv({ cls: "aie-client-card-status" });
    addBadge(badgeWrapper, t("settings.clients.connected"), "aie-badge aie-badge-ok", "check");

    // Body
    const body = card.createDiv({ cls: "aie-client-card-body" });
    const tokenLine = body.createDiv({ cls: "aie-client-token-line" });
    createEl(tokenLine, "code", { text: client.hint ? `Token ${client.hint}…` : "Token ativo" });
    addBadge(tokenLine, t("settings.clients.manualBadge"), "aie-badge aie-badge-subtle");

    const metaLine = body.createDiv({ cls: "aie-client-meta-line" });
    const lastUsed = formatDate(client.lastUsedAt);
    const metaSpan = metaLine.createSpan ? metaLine.createSpan() : createEl(metaLine, "span");
    if (typeof metaSpan.setText === "function") {
      metaSpan.setText(t("settings.clients.lastUsedLabel", { time: lastUsed }));
    }

    // Actions footer
    const actions = card.createDiv({ cls: "aie-client-card-actions" });
    const revokeBtn = createEl(actions, "button", {
      cls: "aie-btn aie-btn-secondary aie-btn-sm aie-btn-destructive",
      attr: { "aria-label": t("settings.clients.revoke") },
    });
    const delIcon = revokeBtn.createSpan ? revokeBtn.createSpan({ cls: "aie-btn-icon" }) : createEl(revokeBtn, "span", { cls: "aie-btn-icon" });
    setIcon(delIcon, "trash-2");
    const delText = revokeBtn.createSpan ? revokeBtn.createSpan({ text: t("settings.clients.revoke") }) : createEl(revokeBtn, "span", { text: t("settings.clients.revoke") });
    if (typeof delText.setText === "function") {
      delText.setText(t("settings.clients.revoke"));
    }
    on(revokeBtn, "click", () => this.confirmRevoke(client));
  }

  promptManualClient(): void {
    new PromptModal(this.app, {
      title: t("settings.clients.addTitle"),
      label: t("settings.clients.nameLabel"),
      placeholder: t("settings.clients.namePlaceholder"),
      submitText: t("settings.clients.create"),
      onSubmit: async (name) => {
        const { token } = await this.host.createClient(name);
        this.refresh();
        new NewClientModal(this.app, {
          clientName: name,
          token,
          url: mcpUrl(this.host.getServerStatus().port),
          serverName: this.host.getServerName?.(),
        }).open();
      },
    }).open();
  }

  private confirmDisconnect(integration: Integration, client: ClientRecord): void {
    new ConfirmModal(this.app, {
      title: t("settings.clients.disconnectTitle", { client: integration.label }),
      paragraphs: [t("settings.clients.disconnectText", { client: integration.label })],
      confirmText: t("settings.clients.disconnect"),
      icon: "unplug",
      danger: true,
      onConfirm: async () => {
        if (this.host.disconnectIntegration) {
          await this.host.disconnectIntegration(integration.id);
        } else {
          await this.host.revokeClient(client.id);
        }
        this.refresh();
      },
    }).open();
  }

  private confirmRevoke(client: ClientRecord): void {
    new ConfirmModal(this.app, {
      title: t("settings.clients.revokeTitle", { name: client.name }),
      paragraphs: [t("settings.clients.revokeText")],
      confirmText: t("settings.clients.revoke"),
      icon: "alert-triangle",
      danger: true,
      onConfirm: async () => {
        await this.host.revokeClient(client.id);
        this.refresh();
      },
    }).open();
  }
}
