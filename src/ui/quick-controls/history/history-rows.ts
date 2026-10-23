/** History rows — a session's chat entries merged with the signal records of the turns that ran in it. */
import type {
  ChatHistoryEntry,
  ChatSession,
} from "../../../io/chat/conversation/chat-history-store";
import type { SignalRecord } from "../../../io/chat/conversation/signal-history-store";

export type HistoryRow =
  | { kind: "chat"; entry: ChatHistoryEntry; signals: SignalRecord[] }
  | { kind: "signal"; records: SignalRecord[] };

export const tsOf = (row: HistoryRow): number =>
  row.kind === "chat" ? row.entry.ts : row.records[0].ts;

/** Sessions newest first in, one row list per session out; a record joins the newest session that started at or before it. */
export function mergeSessionRows(sessions: ChatSession[], records: SignalRecord[]): HistoryRow[][] {
  const chat: HistoryRow[][] = sessions.map((s) =>
    s.entries.map((entry) => ({ kind: "chat", entry, signals: [] })),
  );
  const loose: Map<string, SignalRecord[]>[] = sessions.map(() => new Map());
  for (const record of records) {
    let i = sessions.findIndex((s) => s.startedAt !== null && s.startedAt <= record.ts);
    if (i < 0) i = sessions.length - 1;
    if (i < 0) continue;
    const folded = chat[i].find(
      (row) =>
        row.kind === "chat" &&
        row.entry.role === "assistant" &&
        row.entry.turn_id === record.turn_id,
    );
    if (folded?.kind === "chat") folded.signals.push(record);
    else loose[i].set(record.turn_id, [...(loose[i].get(record.turn_id) ?? []), record]);
  }
  return chat.map((rows, i) => {
    const signalRows: HistoryRow[] = [...loose[i].values()].map((r) => ({
      kind: "signal",
      records: r,
    }));
    return [...rows, ...signalRows].sort((a, b) => tsOf(a) - tsOf(b));
  });
}
