import { describe, expect, it } from "vitest";
import type { ChatHistoryEntry } from "../../io/chat/conversation/chat-history-store";
import { mergeTranscripts } from "./merge";
import { createOpenLines } from "./open-lines";

const user = (text: string, ts: number, send_id?: string): ChatHistoryEntry => ({
  role: "user",
  text,
  ts,
  ...(send_id ? { send_id } : {}),
});
const reply = (text: string, ts: number, to?: string): ChatHistoryEntry => ({
  role: "assistant",
  text,
  ts,
  ...(to ? { to } : {}),
});
const perlica = (entries: ChatHistoryEntry[]) => ({ id: "perlica", name: "Perlica", entries });
const natsume = (entries: ChatHistoryEntry[]) => ({ id: "natsume", name: "Natsume", entries });
const brief = (rows: ReturnType<typeof mergeTranscripts>) => rows.map((r) => [r.who, r.text, r.ts]);

describe("mergeTranscripts", () => {
  it("collapses the user entries that share a send id into one row at the earliest time", () => {
    const rows = mergeTranscripts(
      [
        perlica([user("hi", 105, "s1"), reply("Hello.", 110)]),
        natsume([user("hi", 100, "s1"), reply("Yo.", 120)]),
      ],
      [],
      200,
    );

    expect(brief(rows)).toEqual([
      ["user", "hi", 100],
      ["perlica", "Hello.", 110],
      ["natsume", "Yo.", 120],
    ]);
  });

  it("keeps user entries without a send id apart", () => {
    const rows = mergeTranscripts(
      [perlica([user("hi", 100)]), natsume([user("hi", 100)])],
      [],
      200,
    );

    expect(brief(rows)).toEqual([
      ["user", "hi", 100],
      ["user", "hi", 100],
    ]);
  });

  it("orders equal times by the cast order", () => {
    const rows = mergeTranscripts(
      [perlica([reply("a", 100)]), natsume([reply("b", 100)])],
      [],
      200,
    );

    expect(brief(rows)).toEqual([
      ["perlica", "a", 100],
      ["natsume", "b", 100],
    ]);
  });

  it("carries the recipient of a reply", () => {
    const [row] = mergeTranscripts([perlica([reply("Natsume?", 100, "natsume")])], [], 200);

    expect(row).toMatchObject({ who: "perlica", name: "Perlica", to: "natsume" });
  });

  it("draws a pending send until a recorded user entry has its send id", () => {
    const pending = [{ sendId: "s1", text: "hi", at: 150 }];

    expect(brief(mergeTranscripts([perlica([])], pending, 160))).toEqual([["user", "hi", 150]]);
    expect(mergeTranscripts([perlica([])], pending, 160)[0]?.pending).toBe(true);
    expect(brief(mergeTranscripts([perlica([user("hi", 170, "s1")])], pending, 180))).toEqual([
      ["user", "hi", 170],
    ]);
  });

  it("keeps a queued send however long it waits", () => {
    const pending = [{ sendId: "s1", text: "hi", at: 150, queued: true }];

    expect(brief(mergeTranscripts([perlica([])], pending, 150 + 600_000))).toEqual([
      ["user", "hi", 150],
    ]);
  });

  it("drops a pending send after 60 seconds", () => {
    const pending = [{ sendId: "s1", text: "hi", at: 150 }];

    expect(mergeTranscripts([perlica([])], pending, 150 + 59_999)).toHaveLength(1);
    expect(mergeTranscripts([perlica([])], pending, 150 + 60_000)).toEqual([]);
  });
});

it("appends the open assistant line and hands it off to exactly one recorded row", () => {
  const lines = createOpenLines();
  const transcripts = [perlica([]), natsume([reply("Earlier", 500)])];
  lines.accept({ preset: "perlica", turn_id: "7", op: "begin", baseline: 0 }, 100);
  lines.accept({ preset: "perlica", turn_id: "7", op: "push", delta: "Hello" }, 100);
  expect(mergeTranscripts(transcripts, [], 200, lines.snapshot()).at(-1)).toEqual({
    key: "perlica:open",
    who: "perlica",
    name: "Perlica",
    text: "Hello",
    ts: 200,
    pending: true,
    open: true,
  });
  const landed = [perlica([{ role: "assistant", turn_id: "7", text: "Hello", ts: 600 }])];
  lines.reconcile(landed, 700);
  expect(mergeTranscripts(landed, [], 700, lines.snapshot())).toEqual([
    { key: "perlica:0:600", who: "perlica", name: "Perlica", text: "Hello", ts: 600 },
  ]);
});

it("drops an open line immediately when its record precedes bridge delivery", () => {
  const lines = createOpenLines();
  const transcripts = [perlica([{ role: "assistant", turn_id: "7", text: "Hello", ts: 100 }])];
  lines.accept({ preset: "perlica", turn_id: "7", op: "begin", baseline: 0 }, 200);
  lines.reconcile(transcripts, 200);
  expect(lines.snapshot()).toEqual([]);
  lines.accept({ preset: "perlica", turn_id: "7", op: "push", delta: "Hello" }, 201);
  lines.accept({ preset: "perlica", turn_id: "7", op: "end" }, 202);
  expect(mergeTranscripts(transcripts, [], 203, lines.snapshot())).toEqual([
    { key: "perlica:0:100", who: "perlica", name: "Perlica", text: "Hello", ts: 100 },
  ]);
});
