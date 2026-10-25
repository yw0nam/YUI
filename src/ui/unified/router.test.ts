import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Row } from "./merge";
import { createSequence, lastSpeakerOf, targetsFor } from "./router";

const reverse = (ids: string[]) => [...ids].reverse();

describe("targetsFor", () => {
  const base = {
    cast: ["perlica", "natsume"],
    lastSpeaker: undefined,
    mainId: "perlica",
    shuffle: reverse,
  };

  it.each([
    ["everyone shuffles the cast", { mention: "everyone" }, ["natsume", "perlica"]],
    ["a pick goes to its preset", { mention: "natsume" }, ["natsume"]],
    ["no mention goes to the last speaker", { mention: null, lastSpeaker: "natsume" }, ["natsume"]],
    ["no mention and no speaker goes to main", { mention: null }, ["perlica"]],
    [
      "a last speaker who closed falls back to main",
      { mention: null, lastSpeaker: "gone" },
      ["perlica"],
    ],
  ])("%s", (_name, over, expected) => {
    expect(targetsFor({ ...base, ...over })).toEqual(expected);
  });
});

describe("lastSpeakerOf", () => {
  it("is the newest row that is not the user's", () => {
    const row = (who: string): Row => ({ key: who, who, name: who, text: "x", ts: 1 });

    expect(lastSpeakerOf([row("perlica"), row("natsume"), row("user")])).toBe("natsume");
    expect(lastSpeakerOf([row("user")])).toBeUndefined();
  });
});

describe("createSequence", () => {
  const send = {
    sendId: "s1",
    targets: ["natsume", "perlica"],
    text: "hi",
    mention: "everyone" as const,
  };
  let emit: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "info").mockImplementation(() => {});
    emit = vi.fn();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("emits to the next target only when the current one reports done for this send", () => {
    const seq = createSequence({ emit });
    seq.run(send);

    expect(emit.mock.calls).toEqual([
      [{ sendId: "s1", to: "natsume", text: "hi", mention: "everyone" }],
    ]);
    seq.turnDone({ sendId: "s1", preset: "natsume" });
    expect(emit.mock.calls.at(-1)).toEqual([
      { sendId: "s1", to: "perlica", text: "hi", mention: "everyone" },
    ]);
    seq.turnDone({ sendId: "s1", preset: "perlica" });
    expect(emit).toHaveBeenCalledTimes(2);
  });

  it("ignores a done for another send or another preset", () => {
    const seq = createSequence({ emit });
    seq.run(send);

    seq.turnDone({ sendId: "s0", preset: "natsume" });
    seq.turnDone({ sendId: "s1", preset: "perlica" });

    expect(emit).toHaveBeenCalledTimes(1);
  });

  it("ignores a second done for the same send and preset", () => {
    const seq = createSequence({ emit });
    seq.run(send);

    seq.turnDone({ sendId: "s1", preset: "natsume" });
    seq.turnDone({ sendId: "s1", preset: "natsume" });

    expect(emit).toHaveBeenCalledTimes(2);
  });

  it("moves on after 60 seconds without a done", () => {
    const seq = createSequence({ emit });
    seq.run(send);

    vi.advanceTimersByTime(59_999);
    expect(emit).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(emit.mock.calls.at(-1)?.[0]).toMatchObject({ to: "perlica" });
  });

  it("holds a send that arrives while another runs until the first finishes, and reports its start", () => {
    const onStart = vi.fn();
    const seq = createSequence({ emit, onStart });
    seq.run({ sendId: "s1", targets: ["natsume"], text: "one" });
    seq.run({ sendId: "s2", targets: ["perlica"], text: "two" });

    expect(emit).toHaveBeenCalledTimes(1);
    expect(onStart.mock.calls).toEqual([["s1"]]);
    seq.turnDone({ sendId: "s1", preset: "natsume" });
    expect(emit.mock.calls.at(-1)).toEqual([{ sendId: "s2", to: "perlica", text: "two" }]);
    expect(onStart.mock.calls).toEqual([["s1"], ["s2"]]);
  });
});
