// The Install button of the module catalog: a confirmation first, then the download, then the
// setup of the module (skill, temporary hook, GEMINI.md). Kept apart from the view so the order
// can be tested: nothing is downloaded before the user accepts. No "obsidian" import.
import type { HookInstallPlan } from "../hooks/hook-manager";
import type { CatalogEntry } from "../types";
import type { InstallResult } from "./installer-service";

/** What the catalog needs from the setup side of the core. */
export interface CatalogSetupHost {
  /** The plan to confirm, or undefined when the hooks are not available (no vault folder). Writes nothing. */
  planInstall(entry: CatalogEntry): Promise<HookInstallPlan | undefined>;
  /** The user accepted: the module is pending from now on. */
  begin(entry: CatalogEntry): void;
  /** The installer finished (ok or not). */
  finish(entry: CatalogEntry, ok: boolean): Promise<{ nodeMissing: boolean }>;
}

export interface InstallFlowOptions {
  entry: CatalogEntry;
  /** Missing when the hooks are not available: the module installs as before, without a confirmation. */
  setup?: CatalogSetupHost;
  /** Shows the plan and answers whether the user accepted. */
  confirm: (plan: HookInstallPlan) => Promise<boolean>;
  /** Downloads and enables the module. */
  install: () => Promise<InstallResult>;
  /** The download started (the card shows "Installing"). */
  onInstalling?: () => void;
}

export type InstallFlowResult =
  | { status: "cancelled" }
  | { status: "done"; result: InstallResult; /** The setup of the module is pending. */ setupPending: boolean; nodeMissing: boolean };

export async function installFromCatalog(options: InstallFlowOptions): Promise<InstallFlowResult> {
  const { entry, setup } = options;
  const plan = setup ? await setup.planInstall(entry) : undefined;
  if (setup && plan && !(await options.confirm(plan))) return { status: "cancelled" };

  const guided = setup !== undefined && plan !== undefined;
  if (guided) setup.begin(entry);
  const pending = options.install();
  options.onInstalling?.();
  const result = await pending;
  const outcome = guided ? await setup.finish(entry, result.ok) : { nodeMissing: false };
  return { status: "done", result, setupPending: guided && result.ok, nodeMissing: outcome.nodeMissing };
}
