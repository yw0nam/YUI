/**
 * Tavern card import — OS file picker → native read/parse → the card for a new preset.
 *
 * Thin layer over the dialog plugin + the Rust `import_card_file` command. Deps are
 * injectable so tests never touch a real Tauri runtime; the real Tauri APIs are lazily
 * imported (non-Tauri/test envs never load them).
 */

import { readCard } from "../../../config/validators/persona/read-card";
import type { Card } from "../../../config/validators/persona/types";
import { loadOpenDialog, type OpenResult, pickedPath } from "../user-asset-import";

/** An imported card, with the native temp thumbnail copy a PNG source left behind. */
export interface ImportedCard {
  card: Card;
  thumbnailTempId?: string;
}

export interface CardImportDeps {
  /** `@tauri-apps/plugin-dialog` open. */
  openDialog(opts: {
    multiple: boolean;
    directory: boolean;
    filters: Array<{ name: string; extensions: string[] }>;
  }): Promise<OpenResult>;
  /** `@tauri-apps/api/core` invoke. */
  invoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T>;
  /** Rolls a temp thumbnail back after an unreadable payload. */
  removeThumbnail(id: string): Promise<void>;
}

/** The `import_card_file` result shape. */
interface ImportedCardFile {
  json: string;
  thumbnailTempId?: string | null;
}

async function defaultDeps(): Promise<CardImportDeps> {
  const [openDialog, { invoke }] = await Promise.all([
    loadOpenDialog(),
    import("@tauri-apps/api/core"),
  ]);
  return {
    openDialog,
    invoke,
    removeThumbnail: (id) => invoke("remove_card_thumbnail", { id }).then(() => undefined),
  };
}

/**
 * Open the card picker and read the chosen file. Returns null when the picker is
 * cancelled. A payload that does not parse into a card rolls the temp thumbnail back
 * and throws `card_unreadable`.
 */
export async function importCardFromFile(deps?: CardImportDeps): Promise<ImportedCard | null> {
  const d = deps ?? (await defaultDeps());
  const result = await d.openDialog({
    multiple: false,
    directory: false,
    filters: [{ name: "Card", extensions: ["json", "png"] }],
  });

  const srcPath = pickedPath(result);
  if (srcPath === null) return null;

  const { json, thumbnailTempId } = await d.invoke<ImportedCardFile>("import_card_file", {
    srcPath,
  });
  let card: Card;
  try {
    const read = readCard(JSON.parse(json));
    if (read.issues.length > 0) throw new Error(read.issues.join("; "));
    card = read.card;
  } catch {
    if (thumbnailTempId) await d.removeThumbnail(thumbnailTempId);
    throw new Error("card_unreadable");
  }
  return thumbnailTempId ? { card, thumbnailTempId } : { card };
}
