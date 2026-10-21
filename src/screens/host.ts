// What the screen service needs from the Obsidian side: open a window and report how it ended.
// The windows live in src/screens/ui; the service and the tools only know this interface, so they
// run (and are tested) without Obsidian.
import type { FieldIssue, ScreenDefinition, ScreenField } from "./model";
import type { SubmitOptions } from "./values";

/** What a saved screen returns to the agent when the user confirms. */
export interface ScreenResult {
  status: "confirmado";
  /** Values of the fields, by id. Password fields are never here. */
  valores: Record<string, unknown>;
  /** Password fields that were filled in: the value went to Environment Keys, never to the agent. */
  secretos: Record<string, "preenchido">;
}

export type SubmitOutcome =
  | { ok: true; result: ScreenResult }
  | {
      ok: false;
      /** What is wrong with each field. */
      errors?: Record<string, FieldIssue>;
      /** What is wrong with the screen as a whole. */
      form?: FieldIssue;
    };

/** A window that was opened. `result` settles once, when the user finishes or the window closes. */
export interface ScreenSession<T> {
  readonly result: Promise<T>;
  /** Closes the window (no effect when it is already closed). */
  close(): void;
}

export type ScreenModalOutcome = { kind: "submitted"; result: ScreenResult } | { kind: "closed" };

export interface OpenScreenInput {
  definition: ScreenDefinition;
  /** Text the agent wants to show at the top. */
  context?: string;
  /** Pre-filled values (already checked; never a password). */
  initialValues: Record<string, unknown>;
  /** Why a password field cannot be saved right now (Environment Keys missing, locked, name taken). */
  secretIssue(field: ScreenField): FieldIssue | undefined;
  /**
   * Checks the values and, when they are fine, stores the passwords and returns the result. The
   * window stays open on { ok: false } and shows the issues.
   */
  submit(values: Record<string, unknown>, options: SubmitOptions): Promise<SubmitOutcome>;
}

/** create / edit / remove ask for approval; view only shows the screen (settings tab). */
export type PreviewMode = "create" | "edit" | "remove" | "view";

export type PreviewDecision = "aprovado" | "recusado";

export interface OpenPreviewInput {
  mode: PreviewMode;
  definition: ScreenDefinition;
  /** The saved version, for "edit". */
  previous?: ScreenDefinition;
  /** The definition as JSON, shown read-only. */
  json: string;
  /** Shown as a warning: what would block a password field if the screen were used now. */
  secretIssue(field: ScreenField): FieldIssue | undefined;
}

export interface ScreenHost {
  openScreen(input: OpenScreenInput): ScreenSession<ScreenModalOutcome>;
  /** Resolves "recusado" when the window is closed without a decision. */
  openPreview(input: OpenPreviewInput): ScreenSession<PreviewDecision>;
}
