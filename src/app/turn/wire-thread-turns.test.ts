import { expect, it, vi } from "vitest";
import type { Thread, ThreadsSnapshot } from "../../contract";
import { wireThreadTurns } from "./wire-thread-turns";

const thread = (over: Partial<Thread>): Thread => ({
  id: "t1",
  source: "codex",
  title: "Build",
  state: "working",
  entries: [],
  created_at: 1,
  updated_at: 1,
  entry_count: 0,
  ...over,
});

it("takes the existing snapshot as the baseline and offers one group for a Thread that later turns input-required", () => {
  let listener: ((snapshot: ThreadsSnapshot) => void) | undefined;
  const offer = vi.fn();
  wireThreadTurns({
    threads: {
      snapshot: () => ({ revision: 1, threads: [thread({ id: "t0", state: "input-required" })] }),
      subscribe: (cb) => {
        listener = cb;
        return () => {};
      },
    },
    level: () => "notable",
    offer,
    withdraw: vi.fn(),
  });
  expect(offer).not.toHaveBeenCalled();
  listener?.({
    revision: 2,
    threads: [thread({ id: "t0", state: "input-required" }), thread({ state: "input-required" })],
  });
  expect(offer.mock.calls.map(([group]) => group.envelope.event_id)).toEqual(["thread:t1"]);
});

it("withdraws the buffered input_required group of a Thread that left input-required", () => {
  let listener: ((snapshot: ThreadsSnapshot) => void) | undefined;
  const withdraw = vi.fn();
  wireThreadTurns({
    threads: {
      snapshot: () => ({ revision: 1, threads: [thread({ state: "input-required" })] }),
      subscribe: (cb) => {
        listener = cb;
        return () => {};
      },
    },
    level: () => "notable",
    offer: vi.fn(),
    withdraw,
  });
  listener?.({ revision: 2, threads: [thread({ state: "working" })] });
  expect(withdraw.mock.calls).toEqual([["thread:t1", "thread.input_required"]]);
});

it("wires nothing without a Threads client", () => {
  const offer = vi.fn();
  const off = wireThreadTurns({
    threads: null,
    level: () => "every",
    offer,
    withdraw: vi.fn(),
  });

  expect(off).not.toThrow();
  expect(offer).not.toHaveBeenCalled();
});
