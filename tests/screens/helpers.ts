import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type {
  OpenPreviewInput,
  OpenScreenInput,
  PreviewDecision,
  ScreenHost,
  ScreenModalOutcome,
  ScreenSession,
  SubmitOutcome,
} from "../../src/screens/host";
import type { ScreenDefinition } from "../../src/screens/model";
import { ScreenService } from "../../src/screens/service";
import { ScreenStore } from "../../src/screens/store";
import type { SubmitOptions } from "../../src/screens/values";
import type { HubCallContext, HubToolResult, SecretVaultService } from "../../src/types";

export function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "aie-screens-"));
}

export interface OpenScreen {
  input: OpenScreenInput;
  closed: boolean;
  settle(outcome: ScreenModalOutcome): void;
}

export interface OpenPreview {
  input: OpenPreviewInput;
  closed: boolean;
  settle(decision: PreviewDecision): void;
}

/** Stands in for the Obsidian windows: tests act as the user through the records it keeps. */
export class FakeHost implements ScreenHost {
  readonly screens: OpenScreen[] = [];
  readonly previews: OpenPreview[] = [];
  /** When set, previews are decided as soon as they open. */
  autoPreview: PreviewDecision | undefined;
  /** When set, screens are filled in as soon as they open. */
  autoFill: { values: Record<string, unknown>; options?: SubmitOptions } | undefined;

  openScreen(input: OpenScreenInput): ScreenSession<ScreenModalOutcome> {
    let resolve!: (outcome: ScreenModalOutcome) => void;
    const result = new Promise<ScreenModalOutcome>((r) => {
      resolve = r;
    });
    const record: OpenScreen = {
      input,
      closed: false,
      settle: (outcome) => resolve(outcome),
    };
    this.screens.push(record);
    if (this.autoFill) {
      const fill = this.autoFill;
      void this.confirm(record, fill.values, fill.options);
    }
    return {
      result,
      close: () => {
        record.closed = true;
        resolve({ kind: "closed" });
      },
    };
  }

  openPreview(input: OpenPreviewInput): ScreenSession<PreviewDecision> {
    let resolve!: (decision: PreviewDecision) => void;
    const result = new Promise<PreviewDecision>((r) => {
      resolve = r;
    });
    const record: OpenPreview = { input, closed: false, settle: (d) => resolve(d) };
    this.previews.push(record);
    if (this.autoPreview) resolve(this.autoPreview);
    return {
      result,
      close: () => {
        record.closed = true;
        resolve("recusado");
      },
    };
  }

  /** What the Confirm button does: submit, and close the window when the submit is accepted. */
  async confirm(record: OpenScreen, values: Record<string, unknown>, options: SubmitOptions = {}): Promise<SubmitOutcome> {
    const outcome = await record.input.submit(values, options);
    if (outcome.ok) record.settle({ kind: "submitted", result: outcome.result });
    return outcome;
  }

  last<T>(list: T[]): T {
    const item = list[list.length - 1];
    if (!item) throw new Error("no window was opened");
    return item;
  }
}

export interface FakeSecrets extends SecretVaultService {
  names: Set<string>;
  created: Array<{ name: string; kind: string; value: string; description?: string; createdBy: string }>;
  locked: boolean;
  failWith: "exists" | "locked" | "invalid_name" | "empty" | undefined;
}

export function fakeSecrets(initial: string[] = []): FakeSecrets {
  const secrets: FakeSecrets = {
    names: new Set(initial),
    created: [],
    locked: false,
    failWith: undefined,
    isLocked: () => secrets.locked,
    redact: (text) => text,
    spawnWithSecrets: () => Promise.resolve(),
    nameExists: (name) => secrets.names.has(name),
    createValue: (input) => {
      if (secrets.failWith) return Promise.resolve({ ok: false as const, reason: secrets.failWith });
      secrets.names.add(input.name);
      secrets.created.push({ ...input });
      return Promise.resolve({ ok: true as const });
    },
  };
  return secrets;
}

export interface Rig {
  dir: string;
  host: FakeHost;
  store: ScreenStore;
  service: ScreenService;
  secrets: FakeSecrets | undefined;
  changes: number;
  limit: number;
  waitMs: number | undefined;
}

export function makeRig(options: { secrets?: FakeSecrets | null; limit?: number; waitMs?: number; dir?: string } = {}): Rig {
  const dir = options.dir ?? tempDir();
  const secrets = options.secrets === null ? undefined : (options.secrets ?? fakeSecrets());
  const rig: Rig = {
    dir,
    host: new FakeHost(),
    store: new ScreenStore(path.join(dir, "telas")),
    service: undefined as never,
    secrets,
    changes: 0,
    limit: options.limit ?? 30,
    waitMs: options.waitMs,
  };
  rig.service = new ScreenService({
    store: rig.store,
    host: rig.host,
    getLimit: () => rig.limit,
    getSecrets: () => rig.secrets,
    onChange: () => {
      rig.changes++;
    },
    waitMs: options.waitMs,
    // The global timers are the ones vi.useFakeTimers() replaces.
    timers: { set: (callback, ms) => setTimeout(callback, ms), clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>) },
  });
  return rig;
}

export function removeDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

export const ctx = (signal?: AbortSignal): HubCallContext => ({ client: { id: "c1", name: "Claude Code" }, moduleId: "ai-ecosystem", signal });

export function resultJson(result: HubToolResult): Record<string, unknown> {
  const first = result.content[0];
  if (first?.type !== "text") throw new Error("no text content");
  return JSON.parse(first.text) as Record<string, unknown>;
}

export function resultText(result: HubToolResult): string {
  const first = result.content[0];
  return first?.type === "text" ? first.text : "";
}

export function sampleDefinition(overrides: Partial<ScreenDefinition> = {}): Record<string, unknown> {
  return {
    slug: "cadastro_cliente",
    titulo: "Customer form",
    descricao: "Collects the customer data.",
    campos: [
      { id: "nome", tipo: "texto", rotulo: "Name", obrigatorio: true, min: 2 },
      { id: "idade", tipo: "inteiro", rotulo: "Age", min: 0, max: 130 },
    ],
    ...overrides,
  };
}

export function passwordDefinition(): Record<string, unknown> {
  return {
    slug: "token_api",
    titulo: "API token",
    campos: [
      { id: "servico", tipo: "texto", rotulo: "Service" },
      { id: "token", tipo: "senha", rotulo: "Token", obrigatorio: true, destino_nome: "API_TOKEN", ajuda: "Token of the service" },
    ],
  };
}

/** Saves a definition straight to the store and reloads the service (as after a restart). */
export function seed(rig: Rig, raw: Record<string, unknown>): void {
  rig.store.save(raw as unknown as ScreenDefinition);
  rig.service.load();
}
