import { describe, expect, it } from "vitest";
import type { Transcript } from "./open-lines";
import { createOpenLines } from "./open-lines";

const cast = (): Transcript[] => [
  { id: "p", name: "Perlica", entries: [] },
  { id: "q", name: "Natsume", entries: [] },
];
function setup() {
  const transcripts = cast();
  const lines = createOpenLines();
  lines.accept({ preset: "p", turn_id: "7", op: "begin", baseline: 0 }, 0);
  return { lines, transcripts };
}
function push(lines: ReturnType<typeof createOpenLines>, delta = "Hello", turn_id = "7") {
  lines.accept({ preset: "p", turn_id, op: "push", delta }, 1);
}

describe("open reply lines", () => {
  it("appears at the first nonempty push and grows without restarting on a repeated begin", () => {
    const { lines } = setup();
    push(lines, "");
    expect(lines.snapshot()).toEqual([]);
    push(lines);
    expect(lines.snapshot()).toEqual([{ preset: "p", turnId: "7", text: "Hello", baseline: 0 }]);
    lines.accept({ preset: "p", turn_id: "7", op: "begin", baseline: 0 }, 2);
    push(lines, " there");
    expect(lines.snapshot()).toEqual([
      { preset: "p", turnId: "7", text: "Hello there", baseline: 0 },
    ]);
  });

  it("keeps ended text until 60 seconds after end, without expiring active speech", () => {
    const { lines, transcripts } = setup();
    push(lines);
    lines.reconcile(transcripts, 100_000);
    expect(lines.snapshot()).toHaveLength(1);
    lines.accept({ preset: "p", turn_id: "7", op: "end" }, 100_000);
    expect(lines.snapshot()).toEqual([
      { preset: "p", turnId: "7", text: "Hello", baseline: 0, endedAt: 100_000 },
    ]);
    expect(lines.expiresAt()).toBe(160_000);
    lines.reconcile(transcripts, 159_999);
    expect(lines.snapshot()).toHaveLength(1);
    lines.reconcile(transcripts, 160_000);
    expect(lines.snapshot()).toEqual([]);
    expect(lines.expiresAt()).toBeUndefined();
  });

  it.each([
    ["7", 0],
    ["8", 1],
  ] as const)("matches assistant records by preset and turn id %s", (turn_id, count) => {
    const { lines, transcripts } = setup();
    push(lines);
    transcripts[1]!.entries.push({ role: "assistant", turn_id: "7", text: "Other preset", ts: 2 });
    transcripts[0]!.entries.push({ role: "user", turn_id: "7", text: "User", ts: 2 });
    lines.reconcile(transcripts, 2);
    expect(lines.snapshot()).toHaveLength(1);
    transcripts[0]!.entries.push({ role: "assistant", turn_id, text: "Recorded", ts: 3 });
    lines.reconcile(transcripts, 3);
    expect(lines.snapshot()).toHaveLength(count);
  });

  it("replaces the preset's old line on a new begin and ignores stale pushes and ends", () => {
    const { lines } = setup();
    push(lines);
    lines.accept({ preset: "p", turn_id: "8", op: "begin", baseline: 0 }, 2);
    push(lines, "stale");
    lines.accept({ preset: "p", turn_id: "7", op: "end" }, 3);
    expect(lines.snapshot()).toEqual([]);
    push(lines, "New", "8");
    expect(lines.snapshot()).toEqual([{ preset: "p", turnId: "8", text: "New", baseline: 0 }]);
  });

  it("drops a line when its preset leaves the cast", () => {
    const { lines, transcripts } = setup();
    push(lines);
    lines.reconcile([transcripts[1]!], 2);
    expect(lines.snapshot()).toEqual([]);
  });

  it("keeps a second utterance of the same push turn until its second record arrives", () => {
    const { lines, transcripts } = setup();
    push(lines);
    lines.accept({ preset: "p", turn_id: "7", op: "end" }, 2);
    transcripts[0]!.entries.push({ role: "assistant", turn_id: "7", text: "Hello", ts: 3 });
    lines.accept({ preset: "p", turn_id: "7", op: "begin", baseline: 1 }, 4);
    push(lines, "Again");
    lines.reconcile(transcripts, 5);
    expect(lines.snapshot()).toEqual([{ preset: "p", turnId: "7", text: "Again", baseline: 1 }]);
    transcripts[0]!.entries.push({ role: "assistant", turn_id: "7", text: "Again", ts: 6 });
    lines.reconcile(transcripts, 6);
    expect(lines.snapshot()).toEqual([]);
  });
});
