/** Pure: every open preset's transcript, and the sends still waiting for their record, as one time-ordered list. */

import type { ChatHistoryEntry } from "../../io/chat/conversation/chat-history-store";
import type { PresetEntry } from "../../settings/preset/active-preset";

export type Transcript = PresetEntry & { entries: ChatHistoryEntry[] };

/** A message the window sent that no transcript records yet. */
export interface PendingSend {
  sendId: string;
  text: string;
  at: number;
}

export interface Row {
  key: string;
  /** "user" or the speaking preset's id. */
  who: string;
  /** The speaking preset's name; empty for the user. */
  name: string;
  text: string;
  ts: number;
  /** An assistant row whose turn called address_character: the recipient's preset id. */
  to?: string;
  pending?: true;
}

/** How long a send stays a pending row when no record arrives. */
export const PENDING_MS = 60_000;

export function mergeTranscripts(
  transcripts: readonly Transcript[],
  pending: readonly PendingSend[],
  now: number,
): Row[] {
  const sorted: Array<{ row: Row; order: [number, number] }> = [];
  const bySend = new Map<string, Row>();
  for (const [castIndex, preset] of transcripts.entries()) {
    for (const [i, e] of preset.entries.entries()) {
      if (e.role === "user" && e.send_id) {
        const known = bySend.get(e.send_id);
        if (known) {
          known.ts = Math.min(known.ts, e.ts);
          continue;
        }
        const row: Row = {
          key: `send:${e.send_id}`,
          who: "user",
          name: "",
          text: e.text,
          ts: e.ts,
        };
        bySend.set(e.send_id, row);
        sorted.push({ row, order: [castIndex, i] });
        continue;
      }
      const row: Row =
        e.role === "user"
          ? { key: `${preset.id}:${i}:${e.ts}`, who: "user", name: "", text: e.text, ts: e.ts }
          : {
              key: `${preset.id}:${i}:${e.ts}`,
              who: preset.id,
              name: preset.name,
              text: e.text,
              ts: e.ts,
              ...(e.to ? { to: e.to } : {}),
            };
      sorted.push({ row, order: [castIndex, i] });
    }
  }
  for (const p of pending) {
    if (bySend.has(p.sendId) || now - p.at >= PENDING_MS) continue;
    const row: Row = {
      key: `send:${p.sendId}`,
      who: "user",
      name: "",
      text: p.text,
      ts: p.at,
      pending: true,
    };
    sorted.push({ row, order: [Number.MAX_SAFE_INTEGER, 0] });
  }
  return sorted
    .sort((a, b) => a.row.ts - b.row.ts || a.order[0] - b.order[0] || a.order[1] - b.order[1])
    .map((s) => s.row);
}
