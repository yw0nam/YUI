/**
 * Creates a preset from an imported card: the name with a numeric suffix, the card merged
 * into the copied `yui.agent` with the send switch on, the card's filler pools onto the
 * copied filler value, the imported vrm/speaker onto their copied keys, the PNG thumbnail
 * retained onto the entry, the one-shot greeting marker, and activation. The two thumbnail
 * steps are ports the app wiring supplies from io, so this module imports no io. Any
 * failure removes the created preset and discards the thumbnail before the original error rethrows.
 */

import type { FillerLang } from "../../config/validators/filler";
import type { Card } from "../../config/validators/persona/types";
import { createLogger } from "../../logger";
import { coerceAgentSettings } from "../backend/agent-settings";
import { cardWithoutFiller, readCardFiller } from "../voice/card-filler";
import { isValidCustomPools, withCustomPools } from "../voice/filler-settings";
import type { PhotoCrop } from "./photo-crop";
import { resolveStorageKey } from "./preset-keys";

const log = createLogger("import-card-preset");

export interface CreatePresetFromCardInput {
  registry: {
    create(name: string): string | null;
    setThumbnail(id: string, url: string, crop?: PhotoCrop): boolean;
    activate(id: string): boolean;
    remove(id: string): boolean;
  };
  card: Card;
  /** Renames the temp thumbnail copy to the preset id and returns its file URL and default crop. */
  retainThumbnail?: (presetId: string) => Promise<{ url: string; crop?: PhotoCrop }>;
  /** Removes both thumbnail copies (temp id and preset id). Idempotent. */
  discardThumbnail?: (presetId: string) => Promise<void>;
  /** The key-value storage the copied `yui.agent` and the greeting marker live in. */
  storage?: Storage;
  /** The filler language a preset without a copied filler value starts from. */
  fillerLocale: FillerLang;
  /** The card's own thumbnail crop, overriding the retained thumbnail's default framing. */
  crop?: PhotoCrop;
  /** The imported VRM: written to the copied `yui.vrm` key, or removed for null. */
  vrmId?: string | null;
  /** The registered speaker: written to the copied `yui.speaker` key, or removed for null. */
  speakerId?: string | null;
}

/** Writes the card's pools onto the copied filler value; an invalid filler keeps the copy with a warning. */
function applyCardFiller(
  kv: Pick<Storage, "getItem" | "setItem"> | undefined,
  presetId: string,
  filler: unknown,
  locale: FillerLang,
): void {
  if (!isValidCustomPools(filler)) {
    log.warn("card_import_filler_invalid", { preset: presetId });
    return;
  }
  const key = resolveStorageKey("yui.filler", presetId);
  let copied: unknown = null;
  try {
    copied = JSON.parse(kv?.getItem(key) ?? "null") as unknown;
  } catch {
    // An unparsable copied filler value starts the preset from the defaults
  }
  kv?.setItem(key, JSON.stringify(withCustomPools(copied, filler, locale)));
}

/** Writes an imported asset id over the copied preset key; null removes the copy, absent keeps it. */
function writeImportedAsset(
  kv: Pick<Storage, "getItem" | "setItem" | "removeItem"> | undefined,
  presetId: string,
  key: "yui.vrm" | "yui.speaker",
  id: string | null | undefined,
): void {
  if (id === undefined) return;
  const storageKey = resolveStorageKey(key, presetId);
  if (id === null) kv?.removeItem(storageKey);
  else kv?.setItem(storageKey, id);
}

export async function createPresetFromCard(input: CreatePresetFromCardInput): Promise<string> {
  const { registry, card, retainThumbnail, discardThumbnail, crop } = input;
  const kv = input.storage ?? globalThis.localStorage;
  const baseName = card.name.trim() || "Card";

  // create refuses a taken or empty name; the walk tries `base`, `base 2`, `base 3`, …
  let id = registry.create(baseName);
  for (let n = 2; id === null; n++) id = registry.create(`${baseName} ${n}`);

  try {
    const key = resolveStorageKey("yui.agent", id);
    let raw: unknown = null;
    try {
      raw = JSON.parse(kv?.getItem(key) ?? "null") as unknown;
    } catch {
      // An unparsable copied value starts the preset from the defaults
    }
    const agent = coerceAgentSettings(raw);
    agent.send_card = true;
    const filler = readCardFiller(card);
    agent.card = filler === undefined ? card : cardWithoutFiller(card);
    kv?.setItem(key, JSON.stringify(agent));
    if (filler !== undefined) applyCardFiller(kv, id, filler, input.fillerLocale);
    writeImportedAsset(kv, id, "yui.vrm", input.vrmId);
    writeImportedAsset(kv, id, "yui.speaker", input.speakerId);

    if (retainThumbnail) {
      const { url, crop: framed } = await retainThumbnail(id);
      if (!registry.setThumbnail(id, url, crop ?? framed)) throw new Error("preset_create_failed");
    }

    kv?.setItem(resolveStorageKey("yui.greeting-pending", id), "1");
    if (!registry.activate(id)) throw new Error("preset_create_failed");
    return id;
  } catch (err) {
    if (!registry.remove(id)) log.warn("preset_rollback_refused", { preset: id });
    try {
      await discardThumbnail?.(id);
    } catch (cleanupErr) {
      // The cleanup failure must not replace the error the user is shown
      log.warn("thumbnail_discard_failed", { preset: id, error: String(cleanupErr) });
    }
    throw err;
  }
}
