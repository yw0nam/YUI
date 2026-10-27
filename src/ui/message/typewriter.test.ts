import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTypewriter } from "./typewriter";

function setup(now?: () => number) {
  const reveals: Array<[number, boolean]> = [];
  const typer = createTypewriter((revealed, { done }) => reveals.push([revealed, done]), now);
  typer.begin();
  const last = () => reveals.at(-1);
  return { typer, reveals, last };
}

describe("createTypewriter", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("never reveals past what it received", () => {
    const { typer, reveals } = setup();
    typer.received("Hi");
    vi.advanceTimersByTime(1000);
    expect(reveals).toEqual([
      [1, false],
      [2, false],
    ]);
  });

  it("types a line one character per 40 ms", () => {
    const { typer, last } = setup();
    typer.received("Hello.");
    vi.advanceTimersByTime(39);
    expect(last()).toBeUndefined();
    vi.advanceTimersByTime(1);
    expect(last()).toEqual([1, false]);
    vi.advanceTimersByTime(80);
    expect(last()).toEqual([3, false]);
  });

  it("catches up from the clock when its ticks come late, several characters per tick", () => {
    let t = 0;
    const { typer, last } = setup(() => t);
    typer.received("Hello world!");
    t = 400;
    vi.advanceTimersByTime(40);
    expect(last()).toEqual([10, false]);
  });

  it("counts a character that falls due exactly on its tick", () => {
    let t = 0;
    const { typer, last } = setup(() => t);
    typer.received("123456789");
    t = 120;
    vi.advanceTimersByTime(40);
    expect(last()).toEqual([3, false]);
  });

  it("reveals everything on flush, and the rest of the line as it arrives", () => {
    const { typer, last } = setup();
    typer.received("Hello");
    typer.flush();
    expect(last()).toEqual([5, false]);
    typer.received("Hello world");
    expect(last()).toEqual([11, false]);
  });

  it("reports done once the line ended and all of it shows", () => {
    const { typer, last } = setup();
    typer.received("Hi");
    typer.end();
    vi.advanceTimersByTime(40);
    expect(last()).toEqual([1, false]);
    vi.advanceTimersByTime(40);
    expect(last()).toEqual([2, true]);
  });
});
