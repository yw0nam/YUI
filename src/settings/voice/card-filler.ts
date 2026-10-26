/**
 * The card's `extensions.yui.filler` wire key: the filler phrase pools a card carries,
 * and the card and extensions transforms import and export apply around it.
 */

import type { Card } from "../../config/validators/persona/types";
import { type FillerSettings, hasAnyPhrase } from "./filler-settings";

/** The card's `extensions.yui.filler`; undefined while the card carries none. */
export function readCardFiller(card: Card): unknown {
  const yui = (card.extensions as Record<string, unknown> | undefined)?.yui;
  return yui !== null && typeof yui === "object"
    ? (yui as Record<string, unknown>).filler
    : undefined;
}

/** A copy of the card without `extensions.yui.filler`; an emptied `yui` goes too, every other key stays. */
export function cardWithoutFiller(card: Card): Card {
  const extensions = { ...(card.extensions as Record<string, unknown>) };
  const yui = { ...((extensions.yui ?? {}) as Record<string, unknown>) };
  delete yui.filler;
  if (Object.keys(yui).length === 0) delete extensions.yui;
  else extensions.yui = yui;
  return { ...card, extensions };
}

/** The extensions with `yui.filler` set from the pools; the key stays out while no pool holds a phrase. */
export function extensionsWithFiller(
  extensions: Record<string, unknown>,
  pools: FillerSettings["customPools"],
): Record<string, unknown> {
  if (!hasAnyPhrase(pools)) return extensions;
  return { ...extensions, yui: { ...((extensions.yui ?? {}) as object), filler: pools } };
}
