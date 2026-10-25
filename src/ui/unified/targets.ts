/** Pure: who a message from the unified chat window goes to, and the send that carries it. */

import type { UserTurnRouted } from "../../io/bridge/settings-bridge";
import type { PresetEntry } from "../../settings/preset/active-preset";
import type { Row } from "./merge";

/** The mention that picks every open preset. */
export const EVERYONE = "everyone";

/** A picked recipient: a preset id, or EVERYONE. */
export type Mention = string | typeof EVERYONE;

/** One message to deliver: the targets in order and the text every one of them receives. */
export interface Send {
  sendId: string;
  targets: string[];
  text: string;
  mention?: UserTurnRouted["mention"];
}

/** The preset id of the newest row a preset spoke. */
export function lastSpeakerOf(rows: readonly Row[]): string | undefined {
  return rows.findLast((r) => r.who !== "user")?.who;
}

/** The preset a message with no mention goes to: the last speaker, else main's preset, while it is open. */
export function fallbackTarget(p: {
  cast: readonly string[];
  lastSpeaker: string | undefined;
  mainId: string;
}): string | undefined {
  return [p.lastSpeaker, p.mainId].find((id) => id && p.cast.includes(id)) ?? p.cast[0];
}

/** The presets a message goes to: everyone in a shuffled order, a picked preset, or the fallback. */
export function targetsFor(p: {
  mention: Mention | null;
  cast: readonly string[];
  lastSpeaker: string | undefined;
  mainId: string;
  shuffle: (ids: string[]) => string[];
}): string[] {
  if (p.mention === EVERYONE) return p.shuffle([...p.cast]);
  if (p.mention) return [p.mention];
  const target = fallbackTarget(p);
  return target ? [target] : [];
}

/**
 * The send for what the user typed. The visible mention stays in the text the backend reads.
 * A pick of a preset that is no longer open counts as no pick. Null while no preset is open.
 */
export function buildSend(p: {
  text: string;
  mention: Mention | null;
  cast: readonly PresetEntry[];
  lastSpeaker: string | undefined;
  mainId: string;
  shuffle: (ids: string[]) => string[];
  sendId: string;
}): Send | null {
  if (p.cast.length === 0) return null;
  const everyone = p.mention === EVERYONE;
  const picked = everyone ? undefined : p.cast.find((c) => c.id === p.mention);
  const mention = everyone ? EVERYONE : picked ? "character" : undefined;
  const targets = targetsFor({
    mention: everyone ? EVERYONE : (picked?.id ?? null),
    cast: p.cast.map((c) => c.id),
    lastSpeaker: p.lastSpeaker,
    mainId: p.mainId,
    shuffle: p.shuffle,
  });
  const text = everyone ? `@${EVERYONE} ${p.text}` : picked ? `@${picked.name} ${p.text}` : p.text;
  return { sendId: p.sendId, targets, text, ...(mention ? { mention } : {}) };
}
