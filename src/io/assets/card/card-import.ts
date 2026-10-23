/**
 * Tavern card import — the Rust `import_card_file` command (which opens the OS picker
 * itself) → the card for a new preset. Deps are injectable so tests never touch a real
 * Tauri runtime; the real Tauri API is lazily imported (non-Tauri/test envs never load it).
 */

import { readCard } from "../../../config/validators/persona/read-card";
import type { Card } from "../../../config/validators/persona/types";
import { type InvokeFn, loadInvoke } from "../user-asset-import";

/** An imported card, with the native temp thumbnail copy a PNG source left behind. */
export interface ImportedCard {
  card: Card;
  thumbnailTempId?: string;
}

export interface CardImportDeps {
  /** `@tauri-apps/api/core` invoke. */
  invoke: InvokeFn;
  /** Rolls a temp thumbnail back after an unreadable payload. */
  removeThumbnail(id: string): Promise<void>;
}

/** The `import_card_file` result shape. */
interface ImportedCardFile {
  json: string;
  thumbnailTempId?: string | null;
}

async function defaultDeps(): Promise<CardImportDeps> {
  const invoke = await loadInvoke();
  return {
    invoke,
    removeThumbnail: (id) => invoke("remove_card_thumbnail", { id }).then(() => undefined),
  };
}

/**
 * Run the card picker and read the chosen file. Returns null when the picker is
 * dismissed. A payload that does not parse into a card rolls the temp thumbnail back
 * and throws `card_unreadable`.
 */
export async function importCardFromFile(deps?: CardImportDeps): Promise<ImportedCard | null> {
  const d = deps ?? (await defaultDeps());
  const file = await d.invoke<ImportedCardFile | null>("import_card_file");
  if (!file) return null;

  const { json, thumbnailTempId } = file;
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
