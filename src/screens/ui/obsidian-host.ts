// The ScreenHost for Obsidian: opens the windows and reports how they ended.
import type { App } from "obsidian";
import type { OpenPreviewInput, OpenScreenInput, PreviewDecision, ScreenHost, ScreenModalOutcome, ScreenSession } from "../host";
import { PreviewModal } from "./preview-modal";
import { ScreenModal } from "./screen-modal";

export class ObsidianScreenHost implements ScreenHost {
  constructor(private readonly app: App) {}

  openScreen(input: OpenScreenInput): ScreenSession<ScreenModalOutcome> {
    let settle!: (outcome: ScreenModalOutcome) => void;
    const result = new Promise<ScreenModalOutcome>((resolve) => {
      settle = resolve;
    });
    const modal = new ScreenModal(this.app, input, settle);
    modal.open();
    return { result, close: () => modal.close() };
  }

  openPreview(input: OpenPreviewInput): ScreenSession<PreviewDecision> {
    let settle!: (decision: PreviewDecision) => void;
    const result = new Promise<PreviewDecision>((resolve) => {
      settle = resolve;
    });
    const modal = new PreviewModal(this.app, input, settle);
    modal.open();
    return { result, close: () => modal.close() };
  }
}
