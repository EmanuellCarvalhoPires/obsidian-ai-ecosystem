// Suggestions over the vault for the folder, file, note and tag fields of a screen.
import { AbstractInputSuggest, getAllTags } from "obsidian";
import type { App } from "obsidian";
import type { ScreenField } from "../model";

const MAX_SUGGESTIONS = 50;

/** Vault paths (or tags) a field can take, computed when first needed. */
export function createVaultSource(app: App, field: ScreenField): () => string[] {
  let cached: string[] | undefined;
  return () => {
    if (cached) return cached;
    switch (field.tipo) {
      case "pasta":
        cached = app.vault.getAllFolders(false).map((f) => f.path);
        break;
      case "nota":
        cached = app.vault.getMarkdownFiles().map((f) => f.path);
        break;
      case "arquivo": {
        const wanted = field.extensoes ?? [];
        cached = app.vault
          .getFiles()
          .filter((f) => wanted.length === 0 || wanted.includes(f.extension.toLowerCase()))
          .map((f) => f.path);
        break;
      }
      case "tag": {
        const tags = new Set<string>();
        for (const file of app.vault.getMarkdownFiles()) {
          const cache = app.metadataCache.getFileCache(file);
          for (const tag of (cache ? getAllTags(cache) : null) ?? []) tags.add(tag);
        }
        cached = [...tags].sort();
        break;
      }
      default:
        cached = [];
    }
    return cached.sort((a, b) => a.localeCompare(b));
  };
}

/** Drop-down of vault paths or tags under a text box. Choosing one fills the box. */
export class VaultSuggest extends AbstractInputSuggest<string> {
  constructor(
    app: App,
    private readonly inputEl: HTMLInputElement,
    private readonly source: () => string[],
    private readonly onPick: (value: string) => void,
  ) {
    super(app, inputEl);
  }

  protected getSuggestions(query: string): string[] {
    const needle = query.trim().toLowerCase();
    return this.source()
      .filter((item) => needle === "" || item.toLowerCase().includes(needle))
      .slice(0, MAX_SUGGESTIONS);
  }

  renderSuggestion(value: string, el: HTMLElement): void {
    el.setText(value);
  }

  selectSuggestion(value: string): void {
    this.setValue(value);
    this.inputEl.dispatchEvent(new Event("input"));
    this.onPick(value);
    this.close();
  }
}
