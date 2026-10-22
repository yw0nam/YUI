import { describe, expect, it } from "vitest";
import type { ChatHistoryEntry } from "./chat-history-store";
import { createOverheardReader } from "./overheard-reader";
import { createOverheardStore } from "./overheard-store";

const line = (
  ts: number,
  text: string,
  role: ChatHistoryEntry["role"] = "user",
): ChatHistoryEntry => ({
  role,
  text,
  ts,
});

function readerFor(
  transcripts: Record<string, ChatHistoryEntry[]>,
  ids = Object.keys(transcripts),
) {
  const cursors = createOverheardStore();
  const read: string[] = [];
  const reader = createOverheardReader({
    selfPresetId: "me",
    otherPresetIds: () => ids,
    presetName: (id) => id.toUpperCase(),
    transcriptOf: (id) => {
      read.push(id);
      return transcripts[id] ?? [];
    },
    cursors,
  });
  return { reader, cursors, read };
}

describe("createOverheardReader.read", () => {
  it.each([
    {
      name: "nothing after the cursor gives no block",
      cursor: { ts: 300, n: 1 },
      transcript: [line(100, "a"), line(200, "b"), line(300, "c")],
      texts: [],
      next: undefined,
    },
    {
      name: "ten new entries give the newest eight, oldest first",
      cursor: { ts: 0, n: 0 },
      transcript: Array.from({ length: 10 }, (_, i) => line(i + 1, `t${i + 1}`)),
      texts: ["t3", "t4", "t5", "t6", "t7", "t8", "t9", "t10"],
      next: { ts: 10, n: 1 },
    },
    {
      name: "two entries at the cursor's ts with n 1 give only the second",
      cursor: { ts: 100, n: 1 },
      transcript: [line(100, "first"), line(100, "second", "assistant")],
      texts: ["second"],
      next: { ts: 100, n: 2 },
    },
  ])("$name", ({ cursor, transcript, texts, next }) => {
    const { reader, cursors } = readerFor({ perlica: transcript });
    cursors.set("perlica", cursor);
    const blocks = reader.read();
    expect(blocks.flatMap((b) => b.entries.map((e) => e.text))).toEqual(texts);
    expect(blocks.map((b) => b.cursor)).toEqual(next ? [next] : []);
  });

  it("labels a block with the preset's id and name and drops the entry's extra fields", () => {
    const { reader } = readerFor({ perlica: [{ ...line(5, "hi"), guide: "controls" }] });
    expect(reader.read()).toEqual([
      {
        preset: "perlica",
        name: "PERLICA",
        entries: [{ role: "user", text: "hi", ts: 5 }],
        cursor: { ts: 5, n: 1 },
      },
    ]);
  });

  it("never reads this window's own preset and reads a repeated id once", () => {
    const { reader, read } = readerFor({ me: [line(1, "mine")], perlica: [line(2, "theirs")] }, [
      "me",
      "perlica",
      "perlica",
    ]);
    expect(reader.read().map((b) => b.preset)).toEqual(["perlica"]);
    expect(read).toEqual(["perlica"]);
  });
});

describe("createOverheardReader.commit", () => {
  it("makes the next read return nothing until a new entry lands", () => {
    const transcripts = { perlica: [line(1, "a"), line(2, "b")] };
    const { reader } = readerFor(transcripts);
    reader.commit(reader.read());
    expect(reader.read()).toEqual([]);
    transcripts.perlica.push(line(3, "c"));
    expect(reader.read().flatMap((b) => b.entries.map((e) => e.text))).toEqual(["c"]);
  });

  it("does not move the cursor on a read alone", () => {
    const { reader } = readerFor({ perlica: [line(1, "a")] });
    reader.read();
    expect(reader.read()).toHaveLength(1);
  });
});
