/**
 * Creates a preset from an imported card: the name with a numeric suffix, the card merged
 * into the copied `yui.agent` with the send switch on, the card's filler pools onto the
 * copied filler value, the PNG thumbnail retained onto the entry, the one-shot greeting
 * marker, and activation. The two thumbnail steps are ports
 * the app wiring supplies from io, so this module imports no io. Any failure removes the
 * created preset and discards the thumbnail before the original error rethrows.
 */

import type { FillerLang } from "../../config/validators/filler";
import type { Card } from "../../config/validators/persona/types";
import { createLogger } from "../../logger";
import { coerceAgentSettings } from "../backend/agent-settings";
import { isValidCustomPools, withCustomPools } from "../voice/filler-settings";
import { resolveStorageKey } from "./preset-keys";

const log = createLogger("import-card-preset");

export interface CreatePresetFromCardInput {
  registry: {
    create(name: string): string | null;
    setThumbnail(id: string, url: string): boolean;
    activate(id: string): boolean;
    remove(id: string): boolean;
  };
  card: Card;
  /** Renames the temp thumbnail copy to the preset id and returns its file URL. */
  retainThumbnail?: (presetId: string) => Promise<string>;
  /** Removes both thumbnail copies (temp id and preset id). Idempotent. */
  discardThumbnail?: (presetId: string) => Promise<void>;
  /** The key-value storage the copied `yui.agent` and the greeting marker live in. */
  storage?: Storage;
  /** The filler language a preset without a copied filler value starts from. */
  fillerLocale?: FillerLang;
}

/** The card's `extensions.yui` when it is an object holding a `filler` entry. */
function cardYuiFiller(card: Card): Record<string, unknown> | null {
  const yui = (card.extensions as Record<string, unknown> | undefined)?.yui;
  return yui !== null && typeof yui === "object" && "filler" in yui
    ? (yui as Record<string, unknown>)
    : null;
}

/** The stored card copy with `filler` dropped from `extensions.yui`; an emptied `yui` goes too. */
function withoutCardFiller(card: Card, yui: Record<string, unknown>): Card {
  const rest = { ...yui };
  delete rest.filler;
  const extensions = { ...(card.extensions as Record<string, unknown>) };
  if (Object.keys(rest).length === 0) delete extensions.yui;
  else extensions.yui = rest;
  return { ...card, extensions };
}

export async function createPresetFromCard(input: CreatePresetFromCardInput): Promise<string> {
  const { registry, card, retainThumbnail, discardThumbnail } = input;
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
    const yui = cardYuiFiller(card);
    agent.card = yui ? withoutCardFiller(card, yui) : card;
    kv?.setItem(key, JSON.stringify(agent));

    if (yui) {
      if (isValidCustomPools(yui.filler)) {
        const fillerKey = resolveStorageKey("yui.filler", id);
        let copied: unknown = null;
        try {
          copied = JSON.parse(kv?.getItem(fillerKey) ?? "null") as unknown;
        } catch {
          // An unparsable copied filler value starts the preset from the defaults
        }
        kv?.setItem(
          fillerKey,
          JSON.stringify(withCustomPools(copied, yui.filler, input.fillerLocale)),
        );
      } else {
        log.warn("card_import_filler_invalid", { preset: id });
      }
    }

    if (retainThumbnail) {
      const url = await retainThumbnail(id);
      if (!registry.setThumbnail(id, url)) throw new Error("preset_create_failed");
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
