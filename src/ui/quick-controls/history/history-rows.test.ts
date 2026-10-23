import { describe, expect, it } from "vitest";
import type { ChatSession } from "../../../io/chat/conversation/chat-history-store";
import type { SignalRecord } from "../../../io/chat/conversation/signal-history-store";
import { mergeSessionRows } from "./history-rows";

const record = (turn_id: string, ts: number, source = "gh"): SignalRecord => ({
  turn_id,
  source,
  event_type: "ci.failed",
  label: null,
  delivery: "urgent",
  ts,
  said: null,
});

const current: ChatSession = {
  startedAt: 1000,
  entries: [
    { role: "user", text: "hi", ts: 1010 },
    { role: "assistant", text: "hello", ts: 1030, turn_id: "t1" },
  ],
};
const older: ChatSession = {
  startedAt: 100,
  entries: [{ role: "user", text: "old", ts: 110 }],
};

describe("mergeSessionRows", () => {
  it("folds a record into the assistant entry with the same turn_id", () => {
    const r = record("t1", 1020);
    expect(mergeSessionRows([current], [r])).toEqual([
      [
        { kind: "chat", entry: current.entries[0], signals: [] },
        { kind: "chat", entry: current.entries[1], signals: [r] },
      ],
    ]);
  });

  it("groups unmatched records of one turn into one signal row at the first record's ts", () => {
    const a = record("t2", 1050, "gh");
    const b = record("t2", 1051, "cal");
    expect(mergeSessionRows([current], [a, b])[0].at(-1)).toEqual({
      kind: "signal",
      records: [a, b],
    });
  });

  it("joins a record older than every session to the oldest session", () => {
    const r = record("t0", 50);
    const rows = mergeSessionRows([current, older], [r]);
    expect(rows[0].every((row) => row.kind === "chat")).toBe(true);
    expect(rows[1][0]).toEqual({ kind: "signal", records: [r] });
  });

  it("joins a record inside the current session's range to the current session", () => {
    const r = record("t3", 1005);
    const rows = mergeSessionRows([current, older], [r]);
    expect(rows[0][0]).toEqual({ kind: "signal", records: [r] });
    expect(rows[1]).toHaveLength(1);
  });
});
