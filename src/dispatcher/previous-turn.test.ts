/**
 * previous-turn.test.ts — the one-slot record of how the last turn with backend speech ended.
 *
 * Storage and clock are injected; the speaking turn is whatever the injected currentTurn returns
 * at utteranceStart, matching the dispatcher's turnLog.current() at the first backend delta.
 */

import { describe, expect, it } from "vitest";
import type { PreviousTurn } from "../contract";
import type { PersistedStorage } from "../io/persisted-store";
import type { BusEnvelope } from "./event-bus";
import { createPreviousTurn } from "./previous-turn";
import type { Turn } from "./turn";

const NOW = 1_717_000_000_000;

function memoryStorage(initial: unknown = null): PersistedStorage<PreviousTurn> & {
  saved: PreviousTurn[];
} {
  const saved: PreviousTurn[] = [];
  return {
    saved,
    load: () => initial as PreviousTurn | null,
    save: (value) => {
      saved.push(value);
    },
  };
}

function turnOf(id: number, event_name: string): Turn {
  const trigger: BusEnvelope = {
    seq_id: id,
    source: "user_input_source",
    event_name,
    ts: NOW,
    hint_tier: 2,
  };
  return { id, trigger };
}

function makeSlot(current: Turn | null, initial: unknown = null) {
  const storage = memoryStorage(initial);
  const slot = createPreviousTurn({
    currentTurn: () => current,
    storage,
    now: () => NOW,
  });
  return { slot, storage };
}

describe("createPreviousTurn — an utterance that opened and closed", () => {
  it("saves complete for the turn that was speaking", () => {
    const turn = turnOf(1, "user.text_submitted");
    const { slot, storage } = makeSlot(turn);

    slot.utteranceStart();
    slot.utteranceEnd("complete");

    expect(storage.saved).toEqual([
      { event_name: "user.text_submitted", ended: "complete", ts: NOW },
    ]);
    expect(slot.get()).toEqual({ event_name: "user.text_submitted", ended: "complete", ts: NOW });
  });

  it("saves interrupted when the utterance was cut", () => {
    const { slot, storage } = makeSlot(turnOf(2, "time_milestone.first_activity"));

    slot.utteranceStart();
    slot.utteranceEnd("interrupted");

    expect(storage.saved).toEqual([
      { event_name: "time_milestone.first_activity", ended: "interrupted", ts: NOW },
    ]);
  });
});

describe("createPreviousTurn — a call that failed before any speech", () => {
  it.each([
    "network_drop",
    "network_stall",
    "http_4xx_drop",
    "parse_error",
  ] as const)("saves failed for %s", (reason) => {
    const turn = turnOf(3, "agent.done");
    const { slot, storage } = makeSlot(turn);

    slot.callFailed(turn, reason);

    expect(storage.saved).toEqual([{ event_name: "agent.done", ended: "failed", ts: NOW }]);
  });

  it.each(["not_configured", "superseded_by_user"] as const)("saves nothing for %s", (reason) => {
    const turn = turnOf(4, "user.text_submitted");
    const { slot, storage } = makeSlot(turn);

    slot.callFailed(turn, reason);

    expect(storage.saved).toEqual([]);
    expect(slot.get()).toBeUndefined();
  });
});

describe("createPreviousTurn — a failure after the turn already spoke", () => {
  it("keeps the interrupted record of the turn that spoke, and still records a later turn", () => {
    const spoken = turnOf(5, "user.text_submitted");
    const later = turnOf(6, "proactive.tap_bored");
    const storage = memoryStorage();
    let current: Turn = spoken;
    const slot = createPreviousTurn({
      currentTurn: () => current,
      storage,
      now: () => NOW,
    });

    slot.utteranceStart();
    slot.utteranceEnd("interrupted");
    slot.callFailed(spoken, "network_stall");

    expect(slot.get()).toEqual({
      event_name: "user.text_submitted",
      ended: "interrupted",
      ts: NOW,
    });

    current = later;
    slot.callFailed(later, "network_drop");

    expect(slot.get()).toEqual({ event_name: "proactive.tap_bored", ended: "failed", ts: NOW });
  });
});

describe("createPreviousTurn — the speaking turn is fixed at the start", () => {
  it("saves the turn that was current at utteranceStart, not the one current at the end", () => {
    const storage = memoryStorage();
    let current = turnOf(9, "time_milestone.first_activity");
    const slot = createPreviousTurn({
      currentTurn: () => current,
      storage,
      now: () => NOW,
    });

    slot.utteranceStart();
    current = turnOf(10, "user.text_submitted");
    slot.utteranceEnd("interrupted");

    expect(storage.saved).toEqual([
      { event_name: "time_milestone.first_activity", ended: "interrupted", ts: NOW },
    ]);
  });
});

describe("createPreviousTurn — nothing to record", () => {
  it("an utteranceEnd with no utteranceStart saves nothing", () => {
    const { slot, storage } = makeSlot(turnOf(7, "user.text_submitted"));

    slot.utteranceEnd("complete");

    expect(storage.saved).toEqual([]);
  });

  it("an utteranceStart with no current turn saves nothing, and neither does its end", () => {
    const { slot, storage } = makeSlot(null);

    slot.utteranceStart();
    slot.utteranceEnd("complete");

    expect(storage.saved).toEqual([]);
    expect(slot.get()).toBeUndefined();
  });
});

describe("createPreviousTurn — the stored value at creation", () => {
  it("keeps a well-formed stored record", () => {
    const stored = { event_name: "user.text_submitted", ended: "failed", ts: NOW - 60_000 };
    const { slot } = makeSlot(null, stored);

    expect(slot.get()).toEqual(stored);
  });

  it.each([
    ["an unknown ended value", { event_name: "user.text_submitted", ended: "weird", ts: NOW }],
    ["an empty event_name", { event_name: "", ended: "failed", ts: NOW }],
    ["a non-finite ts", { event_name: "user.text_submitted", ended: "failed", ts: Number.NaN }],
    ["an array", [{ event_name: "user.text_submitted", ended: "failed", ts: NOW }]],
    ["a string", "user.text_submitted"],
    ["null", null],
  ])("ignores %s", (_label, stored) => {
    const { slot } = makeSlot(null, stored);

    expect(slot.get()).toBeUndefined();
  });
});

describe("createPreviousTurn — what the user heard of a cut-off reply", () => {
  it("keeps the last 50 characters spoken and the first 50 still owed", () => {
    const { slot, storage } = makeSlot(turnOf(11, "user.text_submitted"));

    slot.utteranceStart();
    slot.utteranceEnd("interrupted", {
      spoken: `${"x".repeat(60)}END`,
      unspoken: `START${"y".repeat(60)}`,
    });

    expect(storage.saved).toEqual([
      {
        event_name: "user.text_submitted",
        ended: "interrupted",
        ts: NOW,
        spoken: `${"x".repeat(47)}END`,
        unspoken: `START${"y".repeat(45)}`,
      },
    ]);
  });

  it("cuts on whole characters, so one outside the basic plane never lands halved", () => {
    const { slot, storage } = makeSlot(turnOf(17, "user.text_submitted"));

    slot.utteranceStart();
    slot.utteranceEnd("interrupted", {
      spoken: `\u{1F600}${"b".repeat(49)}`,
      unspoken: `${"a".repeat(49)}\u{1F600}${"c".repeat(10)}`,
    });

    expect(storage.saved.at(-1)).toMatchObject({
      spoken: `\u{1F600}${"b".repeat(49)}`,
      unspoken: `${"a".repeat(49)}\u{1F600}`,
    });
  });

  it("stores neither part for a completed utterance", () => {
    const { slot, storage } = makeSlot(turnOf(12, "user.text_submitted"));

    slot.utteranceStart();
    slot.utteranceEnd("complete", { spoken: "all of it", unspoken: "" });

    expect(storage.saved).toEqual([
      { event_name: "user.text_submitted", ended: "complete", ts: NOW },
    ]);
  });

  it("stores neither part when both halves are empty", () => {
    const { slot, storage } = makeSlot(turnOf(13, "user.text_submitted"));

    slot.utteranceStart();
    slot.utteranceEnd("interrupted", { spoken: "", unspoken: "" });

    expect(storage.saved).toEqual([
      { event_name: "user.text_submitted", ended: "interrupted", ts: NOW },
    ]);
  });

  it("records the interruption of the second utterance after the first completed", () => {
    const { slot, storage } = makeSlot(turnOf(14, "push.render"));

    slot.utteranceStart();
    slot.utteranceStart();
    slot.utteranceEnd("complete");
    slot.utteranceEnd("interrupted", { spoken: "heard this", unspoken: "owed this" });

    expect(storage.saved.at(-1)).toEqual({
      event_name: "push.render",
      ended: "interrupted",
      ts: NOW,
      spoken: "heard this",
      unspoken: "owed this",
    });
  });

  it("names the utterance opened most recently when two overlap", () => {
    const storage = memoryStorage();
    let current = turnOf(15, "user.text_submitted");
    const slot = createPreviousTurn({
      currentTurn: () => current,
      storage,
      now: () => NOW,
    });

    slot.utteranceStart();
    current = turnOf(16, "push.render");
    slot.utteranceStart();
    slot.utteranceEnd("interrupted", { spoken: "heard this", unspoken: "owed this" });

    expect(storage.saved.at(-1)).toMatchObject({ event_name: "push.render" });
  });
});

describe("createPreviousTurn — the stored split at creation", () => {
  it("keeps both parts of a stored record", () => {
    const stored = {
      event_name: "user.text_submitted",
      ended: "interrupted",
      ts: NOW,
      spoken: "heard this",
      unspoken: "owed this",
    };
    const { slot } = makeSlot(null, stored);

    expect(slot.get()).toEqual(stored);
  });

  it("drops a part that is not a string", () => {
    const { slot } = makeSlot(null, {
      event_name: "user.text_submitted",
      ended: "interrupted",
      ts: NOW,
      spoken: 7,
      unspoken: "owed this",
    });

    expect(slot.get()).toEqual({
      event_name: "user.text_submitted",
      ended: "interrupted",
      ts: NOW,
      unspoken: "owed this",
    });
  });
});
