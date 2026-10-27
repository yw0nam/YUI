/** Pure: who a message from the unified chat window goes to, and the send that carries it. */

import type { UserTurnRouted } from "../../io/bridge/settings-bridge";
import type { PresetEntry } from "../../settings/preset/active-preset";
import { RESERVED_NAMES } from "../../settings/preset/preset-registry";
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
  via?: UserTurnRouted["via"];
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

/** The pill's mention that still counts: EVERYONE or an id still open, else null — a closed pick is
 * no pick. */
export function countedMention(
  mention: Mention | null,
  cast: readonly PresetEntry[],
): Mention | null {
  if (mention === null) return null;
  if (mention === EVERYONE || cast.some((e) => e.id === mention)) return mention;
  return null;
}

/**
 * The send for what the user typed. The visible mention stays in the text the backend reads, and a
 * leading typed `@name` routes like a pick with its text unchanged. A pick of a preset that is no
 * longer open counts as no pick. Null while no preset is open.
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
  const counted = countedMention(p.mention, p.cast);
  const m = counted ?? typedMention(p.text, p.cast);
  const everyone = m === EVERYONE;
  const picked = everyone ? undefined : p.cast.find((c) => c.id === m);
  const mention = everyone ? EVERYONE : picked ? "character" : undefined;
  const targets = targetsFor({
    mention: everyone ? EVERYONE : (picked?.id ?? null),
    cast: p.cast.map((c) => c.id),
    lastSpeaker: p.lastSpeaker,
    mainId: p.mainId,
    shuffle: p.shuffle,
  });
  const text =
    counted === null
      ? p.text
      : everyone
        ? `@${EVERYONE} ${p.text}`
        : picked
          ? `@${picked.name} ${p.text}`
          : p.text;
  return { sendId: p.sendId, targets, text, ...(mention ? { mention } : {}) };
}

/** The mention a leading typed `@name` names: the longest of the open preset names and the
 * reserved words ending at whitespace or the text's end, a reserved word giving EVERYONE; empty
 * names are skipped, and null when nothing matches. */
export function typedMention(text: string, cast: readonly PresetEntry[]): Mention | null {
  return typedMentionMatch(text, cast)?.mention ?? null;
}

/** The length of the leading typed `@name` token, with one space after it when present; null when
 * the text names no one. */
export function typedMentionLength(text: string, cast: readonly PresetEntry[]): number | null {
  const match = typedMentionMatch(text, cast);
  if (match === null) return null;
  const token = match.length + 1;
  return /^\s/.test(text.slice(token)) ? token + 1 : token;
}

function typedMentionMatch(
  text: string,
  cast: readonly PresetEntry[],
): { mention: Mention; length: number } | null {
  if (!text.startsWith("@")) return null;
  const rest = text.slice(1);
  const isNamed = (name: string): boolean =>
    rest.slice(0, name.length).toLowerCase() === name.toLowerCase() &&
    (rest.length === name.length || /\s/.test(rest[name.length]!));
  const named: Array<{ mention: Mention; length: number }> = [];
  for (const e of cast)
    if (e.name !== "" && isNamed(e.name)) named.push({ mention: e.id, length: e.name.length });
  for (const r of RESERVED_NAMES)
    if (isNamed(r)) named.push({ mention: EVERYONE, length: r.length });
  let longest: { mention: Mention; length: number } | undefined;
  for (const n of named) if (longest === undefined || n.length > longest.length) longest = n;
  return longest ?? null;
}
