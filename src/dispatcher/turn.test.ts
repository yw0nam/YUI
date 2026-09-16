/**
 * turn.test.ts — turn identity + the "over" definition (ledger, no wiring).
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { userEnv } from "./test-helpers";
import { createTurnLog } from "./turn";

afterEach(() => {
  vi.useRealTimers();
});

describe("turn — ledger", () => {
  it("isOver() is true and current() is null before any turn", () => {
    const log = createTurnLog();
    expect(log.current()).toBeNull();
    expect(log.isOver()).toBe(true);
  });

  it("begin() returns increasing ids; current() reflects the latest", () => {
    const log = createTurnLog();
    const first = log.begin(userEnv());
    expect(log.current()).toBe(first);
    const second = log.begin(userEnv());
    expect(second.id).toBeGreaterThan(first.id);
    expect(log.current()).toBe(second);
  });

  it("a log built later never hands out an id an earlier one already used", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_717_000_000_000);
    const before = createTurnLog();
    before.begin(userEnv());
    const last = before.begin(userEnv());

    // The app restarts; the backend still remembers the ids the old log handed out.
    vi.setSystemTime(1_717_000_000_500);
    const after = createTurnLog();

    expect(after.begin(userEnv()).id).toBeGreaterThan(last.id);
  });

  it("after begin(), isOver() is false (not settled)", () => {
    const log = createTurnLog();
    log.begin(userEnv());
    expect(log.isOver()).toBe(false);
  });

  it("settle(id) with no audio owed makes isOver() true", () => {
    const log = createTurnLog();
    const turn = log.begin(userEnv());
    log.settle(turn.id);
    expect(log.isOver()).toBe(true);
  });

  it("settle(id) while audio is owed leaves isOver() false; setAudioOwed(false) then makes it true", () => {
    const log = createTurnLog();
    const turn = log.begin(userEnv());
    log.setAudioOwed(true);
    log.settle(turn.id);
    expect(log.isOver()).toBe(false);
    log.setAudioOwed(false);
    expect(log.isOver()).toBe(true);
  });

  it("setAudioOwed(true) after settle makes an over turn live again", () => {
    const log = createTurnLog();
    const turn = log.begin(userEnv());
    log.settle(turn.id);
    expect(log.isOver()).toBe(true);
    log.setAudioOwed(true);
    expect(log.isOver()).toBe(false);
  });

  it("staleness guard: settle(firstId) after a second begin() is ignored", () => {
    const log = createTurnLog();
    const first = log.begin(userEnv());
    log.begin(userEnv());
    log.settle(first.id);
    expect(log.isOver()).toBe(false);
  });

  it("begin() resets settled and audioOwed from the previous turn", () => {
    const log = createTurnLog();
    const first = log.begin(userEnv());
    log.setAudioOwed(true);
    log.settle(first.id);
    log.begin(userEnv());
    expect(log.isOver()).toBe(false);
  });

  it("subscribe fires only on the over⟷live boundary, with the right boolean", () => {
    const log = createTurnLog();
    const seen: boolean[] = [];
    log.subscribe((over) => seen.push(over));
    const turn = log.begin(userEnv());
    expect(seen).toEqual([false]);
    log.settle(turn.id);
    expect(seen).toEqual([false, true]);
    log.setAudioOwed(true);
    expect(seen).toEqual([false, true, false]);
    // redundant write — no new value, no callback.
    log.setAudioOwed(true);
    expect(seen).toEqual([false, true, false]);
    log.setAudioOwed(false);
    expect(seen).toEqual([false, true, false, true]);
    // repeat settle — already settled, no boundary crossed.
    log.settle(turn.id);
    expect(seen).toEqual([false, true, false, true]);
  });

  it("unsubscribe stops only that callback; a second subscriber keeps receiving", () => {
    const log = createTurnLog();
    const seenA: boolean[] = [];
    const seenB: boolean[] = [];
    const offA = log.subscribe((over) => seenA.push(over));
    log.subscribe((over) => seenB.push(over));
    const turn = log.begin(userEnv());
    offA();
    log.settle(turn.id);
    expect(seenA).toEqual([false]);
    expect(seenB).toEqual([false, true]);
  });
});

describe("turn — didOweAudio (audio-owed latch)", () => {
  it("is false before any begin()", () => {
    const log = createTurnLog();
    expect(log.didOweAudio()).toBe(false);
  });

  it("is false for a turn that never owed audio", () => {
    const log = createTurnLog();
    const turn = log.begin(userEnv());
    log.settle(turn.id);
    expect(log.didOweAudio()).toBe(false);
  });

  it("latches true after setAudioOwed(true) and stays true after setAudioOwed(false)", () => {
    const log = createTurnLog();
    log.begin(userEnv());
    log.setAudioOwed(true);
    expect(log.didOweAudio()).toBe(true);
    log.setAudioOwed(false);
    expect(log.didOweAudio()).toBe(true);
  });

  it("is reset to false by the next begin()", () => {
    const log = createTurnLog();
    const first = log.begin(userEnv());
    log.setAudioOwed(true);
    log.settle(first.id);
    log.begin(userEnv());
    expect(log.didOweAudio()).toBe(false);
  });
});

describe("turn — didSpeakText (speech-gate record)", () => {
  it("is false before any begin()", () => {
    const log = createTurnLog();
    expect(log.didSpeakText()).toBe(false);
  });

  it("records the speech gate independently of audio", () => {
    const log = createTurnLog();
    log.begin(userEnv());
    log.setSpokeText(true);
    expect(log.didSpeakText()).toBe(true);
    expect(log.didOweAudio()).toBe(false);
  });

  it("is reset to false by the next begin()", () => {
    const log = createTurnLog();
    const first = log.begin(userEnv());
    log.setSpokeText(true);
    log.settle(first.id);
    log.begin(userEnv());
    expect(log.didSpeakText()).toBe(false);
  });
});
