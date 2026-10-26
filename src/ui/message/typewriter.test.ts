import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTypewriter } from "./typewriter";

function setup(paced: boolean, now?: () => number) {
  const reveals: Array<[number, boolean]> = [];
  const typer = createTypewriter((revealed, { done }) => reveals.push([revealed, done]), now);
  typer.begin({ paced });
  const last = () => reveals.at(-1);
  return { typer, reveals, last };
}

describe("createTypewriter", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("never reveals past what it received", () => {
    const { typer, reveals } = setup(false);
    typer.received("Hi");
    vi.advanceTimersByTime(1000);
    expect(reveals).toEqual([
      [1, false],
      [2, false],
    ]);
  });

  it("types an unpaced line one character per 40 ms, ignoring sentence starts", () => {
    const { typer, last } = setup(false);
    typer.received("Hello.");
    typer.pace({ text: "Hello.", durationMs: 6000 });
    vi.advanceTimersByTime(39);
    expect(last()).toBeUndefined();
    vi.advanceTimersByTime(1);
    expect(last()).toEqual([1, false]);
    vi.advanceTimersByTime(80);
    expect(last()).toEqual([3, false]);
  });

  it.each([
    ["over its audio", 400, 100],
    ["at 40 ms per character without audio", null, 40],
  ])("types a paced sentence %s, then waits for the next sentence", (_case, durationMs, msPerChar) => {
    const { typer, last } = setup(true);
    typer.received("One. Two.");
    vi.advanceTimersByTime(1000);
    expect(last()).toBeUndefined();
    typer.pace({ text: "One.", durationMs });
    vi.advanceTimersByTime(msPerChar);
    expect(last()).toEqual([1, false]);
    vi.advanceTimersByTime(3 * msPerChar);
    expect(last()).toEqual([4, false]);
    vi.advanceTimersByTime(1000);
    expect(last()).toEqual([4, false]);
  });

  it("types what an earlier sentence still owes at the next sentence's rate, landing with its voice", () => {
    const { typer, last } = setup(true);
    typer.received("One. Two.");
    typer.pace({ text: "One.", durationMs: null });
    vi.advanceTimersByTime(80);
    expect(last()).toEqual([2, false]);
    // The seven characters left share the sentence's 700 ms and land with its end.
    typer.pace({ text: "Two.", durationMs: 700 });
    vi.advanceTimersByTime(699);
    expect(last()).toEqual([8, false]);
    vi.advanceTimersByTime(1);
    expect(last()).toEqual([9, false]);
  });

  it("catches up from the clock when its ticks come late, several characters per tick", () => {
    let t = 0;
    const { typer, last } = setup(false, () => t);
    typer.received("Hello world!");
    t = 400;
    vi.advanceTimersByTime(40);
    expect(last()).toEqual([10, false]);
  });

  it("finishes a paced sentence at its duration however late its ticks come", () => {
    let t = 0;
    const { typer, last } = setup(true, () => t);
    const sentence = "A forty-four character sentence, voiced now.";
    typer.received(sentence);
    typer.pace({ text: sentence, durationMs: 2000 });
    t = 1000;
    vi.advanceTimersByTime(46);
    expect(last()).toEqual([22, false]);
    t = 2000;
    vi.advanceTimersByTime(46);
    expect(last()).toEqual([44, false]);
  });

  it("lands each sentence of a push-style line on its own end", () => {
    const { typer, last } = setup(true);
    typer.received("One\nTwo\nThree\n");
    typer.pace({ text: "One", durationMs: 300 });
    vi.advanceTimersByTime(300);
    expect(last()).toEqual([3, false]);
    typer.pace({ text: "Two", durationMs: 300 });
    vi.advanceTimersByTime(300);
    expect(last()).toEqual([7, false]);
    typer.pace({ text: "Three", durationMs: 500 });
    vi.advanceTimersByTime(500);
    expect(last()).toEqual([13, false]);
  });

  it("moves the ceiling by the sentence's length when its text is not in the line", () => {
    const { typer, last } = setup(true);
    typer.received("[Docs](https://x.test) here.");
    typer.pace({ text: "Docs here.", durationMs: 1000 });
    vi.advanceTimersByTime(5000);
    expect(last()).toEqual([10, false]);
  });

  it("reveals everything on flush, and the rest of the line as it arrives", () => {
    const { typer, last } = setup(true);
    typer.received("Hello");
    typer.flush();
    expect(last()).toEqual([5, false]);
    typer.received("Hello world");
    expect(last()).toEqual([11, false]);
  });

  it("types the rest of a paced line at 40 ms per character once released", () => {
    const { typer, last } = setup(true);
    typer.received("One. Two.");
    typer.pace({ text: "One.", durationMs: 400 });
    vi.advanceTimersByTime(400);
    typer.release();
    expect(last()).toEqual([4, false]);
    vi.advanceTimersByTime(40);
    expect(last()).toEqual([5, false]);
    vi.advanceTimersByTime(160);
    expect(last()).toEqual([9, false]);
  });

  it("reports done once the line ended and all of it shows", () => {
    const { typer, last } = setup(false);
    typer.received("Hi");
    typer.end();
    vi.advanceTimersByTime(40);
    expect(last()).toEqual([1, false]);
    vi.advanceTimersByTime(40);
    expect(last()).toEqual([2, true]);
  });
});
