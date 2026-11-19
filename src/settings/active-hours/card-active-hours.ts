/**
 * The card's `extensions.yui.active_hours` wire key: the spans a card carries,
 * and the export transform that writes the user's edited spans back into it.
 */

import type { Card } from "../../config/validators/persona/types";
import { isValidSpans, type Span } from "./spans";

/** The card's `extensions.yui.active_hours`; undefined while the card carries none or an invalid one. */
export function readCardActiveHours(card: Card): Span[] | undefined {
  const yui = (card.extensions as Record<string, unknown> | undefined)?.yui;
  const spans =
    yui !== null && typeof yui === "object"
      ? (yui as Record<string, unknown>).active_hours
      : undefined;
  return isValidSpans(spans) ? spans : undefined;
}

/** The spans in use: the user's edited spans, else the card's, else none. */
export function spansInUse(edited: Span[] | null, card: Card | undefined): Span[] {
  if (edited !== null) return edited;
  if (card === undefined) return [];
  return readCardActiveHours(card) ?? [];
}

/** The extensions with `yui.active_hours` set from the edited spans; null keeps the extensions as they are. */
export function extensionsWithActiveHours(
  extensions: Record<string, unknown>,
  edited: Span[] | null,
): Record<string, unknown> {
  if (edited === null) return extensions;
  return { ...extensions, yui: { ...((extensions.yui ?? {}) as object), active_hours: edited } };
}
