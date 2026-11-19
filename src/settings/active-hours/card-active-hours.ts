/** Stub for the red run: every card query answers nothing yet. */

import type { Card } from "../../config/validators/persona/types";
import type { Span } from "./spans";

export function readCardActiveHours(_card: Card): Span[] | undefined {
  return undefined;
}

export function spansInUse(_edited: Span[] | null, _card: Card | undefined): Span[] {
  return undefined as unknown as Span[];
}

export function extensionsWithActiveHours(
  _extensions: Record<string, unknown>,
  _edited: Span[] | null,
): Record<string, unknown> {
  return undefined as unknown as Record<string, unknown>;
}
