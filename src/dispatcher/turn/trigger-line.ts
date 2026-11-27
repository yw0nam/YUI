/** Why she spoke: the line a self-started turn's bubble shows, or null for a turn it does not name. */

import type { BusEnvelope } from "../core/event-bus";

/** Catalog lookup for the line's fixed phrases; ui's `t` satisfies it. */
export type Translate = (key: string, vars?: Record<string, string | number>) => string;

export function triggerLineOf(env: BusEnvelope, translate: Translate): string | null {
  void env;
  void translate;
  return "stub";
}
