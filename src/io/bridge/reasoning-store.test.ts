/**
 * reasoning-store.test.ts — the reasoning text of the latest push cycle.
 *
 * Deltas stream in while a cycle is live and each render closes it. Only the latest cycle is
 * kept: a delta after a finished cycle starts a new text. Nothing here reaches the transcript.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createReasoningStore, type ReasoningState } from "./reasoning-store";

let store: ReturnType<typeof createReasoningStore>;

beforeEach(() => {
  store = createReasoningStore();
});

describe("createReasoningStore", () => {
  it("starts empty and not live", () => {
    expect(store.get()).toEqual({ text: "", live: false });
  });

  it("starts a new text with the first delta of a cycle", () => {
    store.append("A");
    expect(store.get()).toEqual({ text: "A", live: true });
  });

  it("concatenates deltas while live", () => {
    store.append("A");
    store.append("B");
    expect(store.get()).toEqual({ text: "AB", live: true });
  });

  it("replaces the text when a delta arrives after a finished cycle", () => {
    store.append("A");
    store.finish("AB");
    store.append("C");
    expect(store.get()).toEqual({ text: "C", live: true });
  });

  it("holds a whole run: two live cycles, each closed by its own render", () => {
    const seen: ReasoningState[] = [];
    store.subscribe((s) => seen.push(s));

    store.append("A");
    store.finish("AB");
    store.append("C");
    store.finish("ABC");

    expect(seen).toEqual([
      { text: "A", live: true },
      { text: "AB", live: false },
      { text: "C", live: true },
      { text: "ABC", live: false },
    ]);
  });

  it("treats an empty delta as a no-op", () => {
    const spy = vi.fn();
    store.subscribe(spy);

    store.append("");

    expect(store.get()).toEqual({ text: "", live: false });
    expect(spy).not.toHaveBeenCalled();
  });

  it("sets the full text on a render that carries reasoning", () => {
    store.append("A");
    store.finish("ABC");
    expect(store.get()).toEqual({ text: "ABC", live: false });
  });

  it("clears on a render whose reasoning is an empty string", () => {
    store.append("A");
    store.finish("");
    expect(store.get()).toEqual({ text: "", live: false });
  });

  it("keeps the text when a live cycle closes without reasoning", () => {
    store.append("A");
    store.finish(undefined);
    expect(store.get()).toEqual({ text: "A", live: false });
  });

  it("stays empty when a render without reasoning arrives before any delta", () => {
    store.finish(undefined);
    expect(store.get()).toEqual({ text: "", live: false });
  });

  it("sets the text when a render with reasoning arrives before any delta", () => {
    store.finish("X");
    expect(store.get()).toEqual({ text: "X", live: false });
  });

  it("clears a finished text when another render arrives without reasoning", () => {
    store.finish("old");
    store.finish(undefined);
    expect(store.get()).toEqual({ text: "", live: false });
  });

  it("always notifies on finish, even when nothing changed, so the chip can close", () => {
    const spy = vi.fn();
    store.subscribe(spy);

    store.finish("ABC");

    expect(spy).toHaveBeenCalledTimes(1);
    store.finish("ABC");
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("clears a live cycle on interrupt", () => {
    store.append("A");
    store.interrupt();
    expect(store.get()).toEqual({ text: "", live: false });
  });

  it("keeps a finished text on interrupt", () => {
    store.append("A");
    store.finish("AB");
    const spy = vi.fn();
    store.subscribe(spy);

    store.interrupt();

    expect(store.get()).toEqual({ text: "AB", live: false });
    expect(spy).not.toHaveBeenCalled();
  });

  it("replaces the state object on every notifying transition", () => {
    const seen: ReasoningState[] = [];
    store.subscribe((s) => seen.push(s));

    store.append("A");
    store.finish("AB");

    expect(store.get()).toBe(seen.at(-1));
    expect(seen[0]).not.toBe(seen[1]);
  });

  it("stops notifying after the subscription is dropped", () => {
    const spy = vi.fn();
    const off = store.subscribe(spy);
    off();

    store.append("A");

    expect(spy).not.toHaveBeenCalled();
  });
});
