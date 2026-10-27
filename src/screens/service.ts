// The screen service: keeps the saved screens, runs the preview + approval of tela_gerenciar /
// tela_remover and runs a saved screen when the agent calls its tool.
// Pure Node: the windows come from the ScreenHost the Obsidian side provides.
import * as nodeTimers from "node:timers";
import { ECOSYSTEM_ID } from "../types";
import type { HubCallContext, HubToolResult, SecretVaultService } from "../types";
import { validateDefinition } from "./definition";
import type { OpenPreviewInput, PreviewMode, ScreenHost, ScreenResult, ScreenSession, SubmitOutcome } from "./host";
import { SCREEN_WAIT_MS, screenToolName } from "./model";
import type { FieldIssue, ScreenDefinition, ScreenField } from "./model";
import type { ScreenStore } from "./store";
import { checkInitialValues, validateSubmission } from "./values";
import type { SubmitOptions } from "./values";

const MAX_CONTEXT_CHARS = 2000;

const NODE_TIMERS = {
  set: (callback: () => void, ms: number): unknown => nodeTimers.setTimeout(callback, ms),
  clear: (handle: unknown): void => nodeTimers.clearTimeout(handle as ReturnType<typeof nodeTimers.setTimeout>),
};

export interface ScreenServiceDeps {
  store: ScreenStore;
  host: ScreenHost;
  /** Maximum number of saved screens (settings). */
  getLimit: () => number;
  getSecrets: () => SecretVaultService | undefined;
  /** The set of screens changed: the tools must be registered again. */
  onChange: () => void;
  /** How long a window waits for the user. Default 5 minutes. */
  waitMs?: number;
  /** Timer functions (tests give the faked ones). Default: node:timers. */
  timers?: { set(callback: () => void, ms: number): unknown; clear(handle: unknown): void };
}

type Waited<T> = { kind: "value"; value: T } | { kind: "expired" } | { kind: "aborted" };

export type ReviewStatus = "aprovado" | "recusado" | "expirado" | "cancelado";

export interface ScreenSummary {
  slug: string;
  tool: string;
  titulo: string;
  descricao?: string;
  campos: Array<{ id: string; tipo: string; rotulo: string; obrigatorio?: boolean }>;
}

function json(body: Record<string, unknown>, isError = false): HubToolResult {
  const result: HubToolResult = { content: [{ type: "text", text: JSON.stringify(body, null, 2) }], structuredContent: body };
  if (isError) result.isError = true;
  return result;
}

function failure(message: string, details?: string[]): HubToolResult {
  const text = details && details.length > 0 ? `${message}\n- ${details.join("\n- ")}` : message;
  return { content: [{ type: "text", text }], isError: true };
}

function rejectUnknown(args: Record<string, unknown>, accepted: string[]): string | undefined {
  const extra = Object.keys(args).filter((k) => !accepted.includes(k));
  return extra.length > 0 ? `Unknown argument${extra.length > 1 ? "s" : ""}: ${extra.join(", ")} (accepted: ${accepted.join(", ") || "none"}).` : undefined;
}

export class ScreenService {
  private readonly screens = new Map<string, ScreenDefinition>();
  /**
   * Only one window per key is open at a time ("screen:<slug>" for a saved screen, "manage:<slug>"
   * for a create / edit / remove review). A second call with the same key does not queue: it
   * returns an error at once, so the agent is not left hanging behind another 5 minute wait.
   */
  private readonly busy = new Set<string>();
  private readonly sessions = new Set<ScreenSession<unknown>>();
  private disposed = false;

  constructor(private readonly deps: ScreenServiceDeps) {}

  // ---- saved screens ---------------------------------------------------------

  /** Reads the saved screens from disk. Returns what could not be used. */
  load(): string[] {
    const { definitions, problems } = this.deps.store.load();
    this.screens.clear();
    for (const definition of definitions) this.screens.set(definition.slug, definition);
    return problems;
  }

  list(): ScreenDefinition[] {
    return [...this.screens.values()].sort((a, b) => a.slug.localeCompare(b.slug));
  }

  get(slug: string): ScreenDefinition | undefined {
    return this.screens.get(slug);
  }

  summaries(): ScreenSummary[] {
    return this.list().map((d) => {
      const summary: ScreenSummary = {
        slug: d.slug,
        tool: screenToolName(d.slug),
        titulo: d.titulo,
        campos: d.campos.map((f) => {
          const entry: ScreenSummary["campos"][number] = { id: f.id, tipo: f.tipo, rotulo: f.rotulo };
          if (f.obrigatorio) entry.obrigatorio = true;
          return entry;
        }),
      };
      if (d.descricao) summary.descricao = d.descricao;
      return summary;
    });
  }

  /** Removes a screen the user chose to remove (settings tab). Returns false when it did not exist. */
  removeSaved(slug: string): boolean {
    if (!this.screens.has(slug)) return false;
    this.deps.store.remove(slug);
    this.screens.delete(slug);
    this.deps.onChange();
    return true;
  }

  /** Closes every open window (the plugin is unloading). The waiting calls end as cancelled. */
  dispose(): void {
    this.disposed = true;
    for (const session of [...this.sessions]) session.close();
    this.sessions.clear();
  }

  /** Why a password field cannot be saved now, or undefined when it can. */
  secretIssue(field: ScreenField): FieldIssue | undefined {
    if (field.tipo !== "senha" || !field.destino_nome) return undefined;
    const secrets = this.deps.getSecrets();
    if (!secrets || typeof secrets.nameExists !== "function" || typeof secrets.createValue !== "function") return { code: "secret_unavailable" };
    if (secrets.isLocked()) return { code: "secret_locked" };
    if (secrets.nameExists(field.destino_nome)) return { code: "secret_exists", params: { name: field.destino_nome } };
    return undefined;
  }

  // ---- tela_listar ------------------------------------------------------------

  listTool(): HubToolResult {
    const telas = this.summaries();
    return json({ limite: this.deps.getLimit(), total: telas.length, telas });
  }

  // ---- tela_gerenciar / tela_remover -------------------------------------------

  async create(args: Record<string, unknown>, ctx: HubCallContext): Promise<HubToolResult> {
    const unknown = rejectUnknown(args, ["definicao"]);
    if (unknown) return failure(unknown);
    const parsed = this.parse(args.definicao);
    if (!parsed.ok) return failure("The screen definition is not valid:", parsed.errors);
    const definition = parsed.definition;
    if (this.screens.has(definition.slug)) {
      return failure(`A screen with the slug "${definition.slug}" already exists. Use tela_gerenciar with acao editar to change it or choose another slug.`);
    }
    const full = this.limitReached();
    if (full) return failure(full);

    return this.guarded(`manage:${definition.slug}`, async () => {
      const decision = await this.review("create", definition, ctx);
      if (decision !== "aprovado") return json({ status: decision, slug: definition.slug });
      // Someone may have taken the slug or the last place while the window was open.
      if (this.screens.has(definition.slug)) return failure(`A screen with the slug "${definition.slug}" was created meanwhile.`);
      const fullNow = this.limitReached();
      if (fullNow) return failure(fullNow);
      return this.persist(definition);
    });
  }

  async edit(args: Record<string, unknown>, ctx: HubCallContext): Promise<HubToolResult> {
    const unknown = rejectUnknown(args, ["slug", "definicao"]);
    if (unknown) return failure(unknown);
    const slug = args.slug;
    if (typeof slug !== "string" || slug === "") return failure("slug is required (the slug of the screen to change).");
    const previous = this.screens.get(slug);
    if (!previous) return failure(`There is no screen with the slug "${slug}". Use tela_listar to see the saved screens.`);

    let raw = args.definicao;
    if (typeof raw === "string") raw = this.parseJson(raw);
    if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
      const given = (raw as Record<string, unknown>).slug;
      if (given !== undefined && given !== slug) {
        return failure(`The slug of a screen cannot change (got "${JSON.stringify(given)}", the screen is "${slug}"). Create a new screen and remove this one instead.`);
      }
      raw = { ...(raw as Record<string, unknown>), slug };
    }
    const parsed = this.parse(raw);
    if (!parsed.ok) return failure("The screen definition is not valid:", parsed.errors);
    const definition = parsed.definition;

    return this.guarded(`manage:${slug}`, async () => {
      const decision = await this.review("edit", definition, ctx, previous);
      if (decision !== "aprovado") return json({ status: decision, slug });
      if (!this.screens.has(slug)) return failure(`The screen "${slug}" was removed meanwhile.`);
      return this.persist(definition);
    });
  }

  async remove(args: Record<string, unknown>, ctx: HubCallContext): Promise<HubToolResult> {
    const unknown = rejectUnknown(args, ["slug"]);
    if (unknown) return failure(unknown);
    const slug = args.slug;
    if (typeof slug !== "string" || slug === "") return failure("slug is required (the slug of the screen to remove).");
    const definition = this.screens.get(slug);
    if (!definition) return failure(`There is no screen with the slug "${slug}". Use tela_listar to see the saved screens.`);

    return this.guarded(`manage:${slug}`, async () => {
      const decision = await this.review("remove", definition, ctx);
      if (decision !== "aprovado") return json({ status: decision, slug });
      this.removeSaved(slug);
      return json({ status: "aprovado", slug, removida: true });
    });
  }

  private parseJson(text: string): unknown {
    try {
      return JSON.parse(text);
    } catch {
      return undefined;
    }
  }

  private parse(raw: unknown): ReturnType<typeof validateDefinition> {
    return validateDefinition(typeof raw === "string" ? this.parseJson(raw) : raw);
  }

  private limitReached(): string | undefined {
    const limit = this.deps.getLimit();
    return this.screens.size >= limit
      ? `The limit of ${limit} saved screens was reached. Remove one with tela_remover (or raise the limit in the AI Ecosystem settings, section Screens).`
      : undefined;
  }

  private persist(definition: ScreenDefinition): HubToolResult {
    try {
      this.deps.store.save(definition);
    } catch (err) {
      return failure(`Could not save the screen: ${err instanceof Error ? err.message : String(err)}`);
    }
    this.screens.set(definition.slug, definition);
    this.deps.onChange();
    return json({ status: "aprovado", slug: definition.slug, tool: screenToolName(definition.slug) });
  }

  private async review(mode: PreviewMode, definition: ScreenDefinition, ctx: HubCallContext, previous?: ScreenDefinition): Promise<ReviewStatus> {
    if (ctx.signal?.aborted || this.disposed) return "cancelado";
    const input: OpenPreviewInput = {
      mode,
      definition,
      json: JSON.stringify(definition, null, 2),
      secretIssue: (field) => this.secretIssue(field),
    };
    if (previous) input.previous = previous;
    const session = this.deps.host.openPreview(input);
    const waited = await this.wait(session, ctx.signal);
    if (waited.kind === "expired") return "expirado";
    if (waited.kind === "aborted") return "cancelado";
    return waited.value;
  }

  // ---- tela_<slug> --------------------------------------------------------------

  /** Runs a saved screen: opens it, waits for the user and returns what was filled in. */
  async call(slug: string, args: Record<string, unknown>, ctx: HubCallContext): Promise<HubToolResult> {
    const definition = this.screens.get(slug);
    if (!definition) return failure(`The screen "${slug}" no longer exists.`);
    const unknown = rejectUnknown(args, ["contexto", "valores_iniciais"]);
    if (unknown) return failure(unknown);

    let context: string | undefined;
    if (args.contexto !== undefined) {
      if (typeof args.contexto !== "string") return failure("contexto must be a text.");
      if (args.contexto.length > MAX_CONTEXT_CHARS) return failure(`contexto is too long (at most ${MAX_CONTEXT_CHARS} characters).`);
      context = args.contexto.trim() || undefined;
    }
    const initial = checkInitialValues(definition, args.valores_iniciais);
    if (!initial.ok) return failure("valores_iniciais is not valid:", initial.errors);

    return this.guarded(`screen:${slug}`, async () => {
      if (ctx.signal?.aborted || this.disposed) return screenStatus("cancelado");
      let finished = false;
      /** Password fields already stored by this call (a retry after a partial failure skips them). */
      const stored = new Set<string>();

      const input = {
        definition,
        initialValues: initial.values,
        secretIssue: (field: ScreenField) => (stored.has(field.id) ? undefined : this.secretIssue(field)),
        submit: (values: Record<string, unknown>, options: SubmitOptions) =>
          finished ? Promise.resolve<SubmitOutcome>({ ok: false, form: { code: "expired" } }) : this.submit(definition, values, options, stored, () => finished),
      };
      const session = this.deps.host.openScreen(context ? { ...input, context } : input);
      const waited = await this.wait(session, ctx.signal);
      finished = true;
      if (waited.kind === "expired") return screenStatus("expirado");
      if (waited.kind === "aborted") return screenStatus("cancelado");
      if (waited.value.kind === "closed") return screenStatus("cancelado");
      const result: ScreenResult = waited.value.result;
      return json({ status: result.status, valores: result.valores, secretos: result.secretos });
    });
  }

  private async submit(
    definition: ScreenDefinition,
    values: Record<string, unknown>,
    options: SubmitOptions,
    stored: Set<string>,
    isFinished: () => boolean,
  ): Promise<SubmitOutcome> {
    const checked = validateSubmission(definition, values, options);
    if (!checked.ok) return { ok: false, errors: checked.errors };

    const fields = definition.campos.filter((f) => f.id in checked.secrets);
    for (const field of fields) {
      const issue = stored.has(field.id) ? undefined : this.secretIssue(field);
      if (issue) return { ok: false, errors: { [field.id]: issue } };
    }
    const secretos: Record<string, "preenchido"> = {};
    for (const field of fields) {
      const name = field.destino_nome ?? "";
      if (!stored.has(field.id)) {
        if (isFinished()) return { ok: false, form: { code: "expired" } };
        const secrets = this.deps.getSecrets();
        let saved: Awaited<ReturnType<NonNullable<SecretVaultService["createValue"]>>> | undefined;
        try {
          saved = await secrets?.createValue?.({
            name,
            kind: "senha",
            value: checked.secrets[field.id] ?? "",
            description: field.ajuda ?? field.rotulo,
            createdBy: ECOSYSTEM_ID,
          });
        } catch {
          saved = undefined;
        }
        if (!saved?.ok) {
          const reason = saved?.reason ?? "error";
          const code = reason === "exists" ? "secret_exists" : reason === "locked" ? "secret_locked" : "secret_failed";
          return { ok: false, errors: { [field.id]: { code, params: { name, reason } } } };
        }
        stored.add(field.id);
      }
      secretos[field.id] = "preenchido";
    }
    return { ok: true, result: { status: "confirmado", valores: checked.values, secretos } };
  }

  // ---- waiting ------------------------------------------------------------------

  private async guarded(key: string, run: () => Promise<HubToolResult>): Promise<HubToolResult> {
    if (this.busy.has(key)) {
      const what = key.startsWith("screen:") ? "This screen is already open in Obsidian" : "A review of this screen is already open in Obsidian";
      return failure(`${what}, waiting for the user. Wait for it to finish (up to 5 minutes) before calling again.`);
    }
    this.busy.add(key);
    try {
      return await run();
    } finally {
      this.busy.delete(key);
    }
  }

  /**
   * Waits for the window, at most `waitMs`. The window is closed when time runs out or the call is
   * cancelled (the client sent notifications/cancelled, e.g. because the user wrote another message).
   */
  private wait<T>(session: ScreenSession<T>, signal: AbortSignal | undefined): Promise<Waited<T>> {
    this.sessions.add(session);
    const timers = this.deps.timers ?? NODE_TIMERS;
    return new Promise<Waited<T>>((resolve, reject) => {
      let done = false;
      const finish = (outcome: Waited<T> | Error): void => {
        if (done) return;
        done = true;
        timers.clear(timer);
        signal?.removeEventListener("abort", onAbort);
        this.sessions.delete(session);
        if (outcome instanceof Error) {
          session.close();
          reject(outcome);
          return;
        }
        if (outcome.kind !== "value") session.close();
        resolve(outcome);
      };
      const onAbort = (): void => finish({ kind: "aborted" });
      const timer = timers.set(() => finish({ kind: "expired" }), this.deps.waitMs ?? SCREEN_WAIT_MS);
      if (signal?.aborted) onAbort();
      else signal?.addEventListener("abort", onAbort, { once: true });
      session.result.then(
        (value) => finish(this.disposed ? { kind: "aborted" } : { kind: "value", value }),
        (err: unknown) => finish(err instanceof Error ? err : new Error(String(err))),
      );
    });
  }
}

function screenStatus(status: "cancelado" | "expirado"): HubToolResult {
  return json({ status, valores: {}, secretos: {} });
}
