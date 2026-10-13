// Playback reports identity directly; storage and clock are injected.

import { describe, expect, it } from "vitest";
import type { PreviousTurn } from "../../contract";
import type { PersistedStorage } from "../../settings/persisted-store";
import type { BusEnvelope } from "../core/event-bus";
import type { Turn } from "../turn/turn";
import { createPreviousTurn } from "./previous-turn";

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
  };
  return { id, trigger };
}

function identityOf(turn: Turn) {
  return { turn_id: String(turn.id), event_name: turn.trigger.event_name };
}

function makeSlot(initial: unknown = null) {
  const storage = memoryStorage(initial);
  const slot = createPreviousTurn({
    storage,
    now: () => NOW,
  });
  return { slot, storage };
}

describe("createPreviousTurn — an utterance that opened and closed", () => {
  it("saves complete for the turn that was speaking", () => {
    const turn = turnOf(1, "user.text_submitted");
    const identity = identityOf(turn);
    const { slot, storage } = makeSlot();

    slot.utteranceStart(identity);
    slot.utteranceEnd("complete", undefined, identity);

    expect(storage.saved).toEqual([
      { turn_id: identity.turn_id, event_name: "user.text_submitted", ended: "complete", ts: NOW },
    ]);
    expect(slot.get()).toEqual({
      turn_id: identity.turn_id,
      event_name: "user.text_submitted",
      ended: "complete",
      ts: NOW,
    });
  });

  it("saves interrupted when the utterance was cut", () => {
    const identity = identityOf(turnOf(2, "time_milestone.first_activity"));
    const { slot, storage } = makeSlot();

    slot.utteranceStart(identity);
    slot.utteranceEnd("interrupted", undefined, identity);

    expect(storage.saved).toEqual([
      {
        turn_id: identity.turn_id,
        event_name: "time_milestone.first_activity",
        ended: "interrupted",
        ts: NOW,
      },
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
    const { slot, storage } = makeSlot();

    slot.callFailed(turn, reason);

    expect(storage.saved).toEqual([
      { turn_id: "3", event_name: "agent.done", ended: "failed", ts: NOW },
    ]);
  });

  it.each(["not_configured", "superseded_by_user"] as const)("saves nothing for %s", (reason) => {
    const turn = turnOf(4, "user.text_submitted");
    const { slot, storage } = makeSlot();

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
    const identity = identityOf(spoken);
    const slot = createPreviousTurn({
      storage,
      now: () => NOW,
    });

    slot.utteranceStart(identity);
    slot.utteranceEnd("interrupted", undefined, identity);
    slot.utteranceStart({ turn_id: "hermes-1", event_name: "backend" });
    slot.callFailed(spoken, "network_stall");

    expect(slot.get()).toEqual({
      turn_id: identity.turn_id,
      event_name: "user.text_submitted",
      ended: "interrupted",
      ts: NOW,
    });

    slot.callFailed(later, "network_drop");

    expect(slot.get()).toEqual({
      turn_id: "6",
      event_name: "proactive.tap_bored",
      ended: "failed",
      ts: NOW,
    });
  });
});

describe("createPreviousTurn — the speaking turn is fixed at the start", () => {
  it("saves the turn that was current at utteranceStart, not the one current at the end", () => {
    const storage = memoryStorage();
    const identity = identityOf(turnOf(9, "time_milestone.first_activity"));
    const slot = createPreviousTurn({
      storage,
      now: () => NOW,
    });

    slot.utteranceStart(identity);
    slot.utteranceStart(identityOf(turnOf(10, "user.text_submitted")));
    slot.utteranceEnd("interrupted", undefined, identity);

    expect(storage.saved).toEqual([
      {
        turn_id: identity.turn_id,
        event_name: "time_milestone.first_activity",
        ended: "interrupted",
        ts: NOW,
      },
    ]);
  });
});

describe("createPreviousTurn — the stored value at creation", () => {
  it("keeps a well-formed stored record", () => {
    const stored = { event_name: "user.text_submitted", ended: "failed", ts: NOW - 60_000 };
    const { slot } = makeSlot(stored);

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
    const { slot } = makeSlot(stored);

    expect(slot.get()).toBeUndefined();
  });
});

describe("createPreviousTurn — what the user heard of a cut-off reply", () => {
  it("keeps the last 50 characters spoken and the first 50 still owed", () => {
    const identity = identityOf(turnOf(11, "user.text_submitted"));
    const { slot, storage } = makeSlot();

    slot.utteranceStart(identity);
    slot.utteranceEnd(
      "interrupted",
      {
        spoken: `${"x".repeat(60)}END`,
        unspoken: `START${"y".repeat(60)}`,
      },
      identity,
    );

    expect(storage.saved).toEqual([
      {
        turn_id: identity.turn_id,
        event_name: "user.text_submitted",
        ended: "interrupted",
        ts: NOW,
        spoken: `${"x".repeat(47)}END`,
        unspoken: `START${"y".repeat(45)}`,
      },
    ]);
  });

  it("cuts on whole characters, so one outside the basic plane never lands halved", () => {
    const identity = identityOf(turnOf(17, "user.text_submitted"));
    const { slot, storage } = makeSlot();

    slot.utteranceStart(identity);
    slot.utteranceEnd(
      "interrupted",
      {
        spoken: `\u{1F600}${"b".repeat(49)}`,
        unspoken: `${"a".repeat(49)}\u{1F600}${"c".repeat(10)}`,
      },
      identity,
    );

    expect(storage.saved.at(-1)).toMatchObject({
      spoken: `\u{1F600}${"b".repeat(49)}`,
      unspoken: `${"a".repeat(49)}\u{1F600}`,
    });
  });

  it("stores neither part for a completed utterance", () => {
    const identity = identityOf(turnOf(12, "user.text_submitted"));
    const { slot, storage } = makeSlot();

    slot.utteranceStart(identity);
    slot.utteranceEnd("complete", { spoken: "all of it", unspoken: "" }, identity);

    expect(storage.saved).toEqual([
      { turn_id: identity.turn_id, event_name: "user.text_submitted", ended: "complete", ts: NOW },
    ]);
  });

  it("stores neither part when both halves are empty", () => {
    const identity = identityOf(turnOf(13, "user.text_submitted"));
    const { slot, storage } = makeSlot();

    slot.utteranceStart(identity);
    slot.utteranceEnd("interrupted", { spoken: "", unspoken: "" }, identity);

    expect(storage.saved).toEqual([
      {
        turn_id: identity.turn_id,
        event_name: "user.text_submitted",
        ended: "interrupted",
        ts: NOW,
      },
    ]);
  });

  it("records the interruption of the second utterance after the first completed", () => {
    const identity = identityOf(turnOf(14, "push.render"));
    const { slot, storage } = makeSlot();

    slot.utteranceStart(identity);
    slot.utteranceStart(identity);
    slot.utteranceEnd("complete", undefined, identity);
    slot.utteranceEnd("interrupted", { spoken: "heard this", unspoken: "owed this" }, identity);

    expect(storage.saved.at(-1)).toEqual({
      turn_id: identity.turn_id,
      event_name: "push.render",
      ended: "interrupted",
      ts: NOW,
      spoken: "heard this",
      unspoken: "owed this",
    });
  });

  it("names the explicitly reported utterance when two overlap", () => {
    const storage = memoryStorage();
    const identity = identityOf(turnOf(15, "user.text_submitted"));
    const slot = createPreviousTurn({
      storage,
      now: () => NOW,
    });

    slot.utteranceStart(identity);
    const next = identityOf(turnOf(16, "backend"));
    slot.utteranceStart(next);
    slot.utteranceEnd("interrupted", { spoken: "heard this", unspoken: "owed this" }, next);

    expect(storage.saved.at(-1)).toMatchObject({ event_name: "backend", turn_id: "16" });
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
    const { slot } = makeSlot(stored);

    expect(slot.get()).toEqual(stored);
  });

  it("drops a part that is not a string", () => {
    const { slot } = makeSlot({
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

describe("playback records — utterance identity", () => {
  it("retains A identity when B opens before A completes", () => {
    const { slot, storage } = makeSlot();
    const a = { turn_id: "7", event_name: "agent.done" };
    const b = { turn_id: "8", event_name: "user.text_submitted" };
    slot.utteranceStart(a);
    slot.utteranceStart(b);
    slot.utteranceEnd("complete", undefined, a);
    expect(storage.saved).toEqual([{ ...a, ended: "complete", ts: NOW }]);
  });

  it("records explicit backend utterance identity", () => {
    const { slot } = makeSlot();
    const identity = { turn_id: "hermes-1", event_name: "backend" };
    slot.utteranceStart(identity);
    slot.utteranceEnd("interrupted", { spoken: "heard", unspoken: "owed" }, identity);
    expect(slot.get()).toEqual({
      ...identity,
      ended: "interrupted",
      ts: NOW,
      spoken: "heard",
      unspoken: "owed",
    });
  });

  it("records the exact failing client turn id", () => {
    const { slot } = makeSlot();
    slot.callFailed(turnOf(7, "agent.done"), "network_drop");
    expect(slot.get()).toEqual({
      turn_id: "7",
      event_name: "agent.done",
      ended: "failed",
      ts: NOW,
    });
  });

  it("round trips persisted identity and Unicode slices", () => {
    const record = {
      turn_id: "hermes-1",
      event_name: "backend",
      ended: "interrupted",
      ts: NOW,
      spoken: "😀".repeat(50),
      unspoken: "🌙".repeat(50),
    };
    expect(makeSlot(record).slot.get()).toEqual(record);
  });

  it("loads a legacy record without turn_id", () => {
    const record = { event_name: "agent.done", ended: "failed", ts: NOW };
    expect(makeSlot(record).slot.get()).toEqual(record);
  });

  it("notifies complete, interrupted and failed saves and stops after unsubscribe", () => {
    const { slot } = makeSlot();
    const records: PreviousTurn[] = [];
    const off = slot.subscribe((record) => records.push(record));
    const identity = { turn_id: "7", event_name: "agent.done" };
    slot.utteranceStart(identity);
    slot.utteranceEnd("complete", undefined, identity);
    slot.utteranceStart(identity);
    slot.utteranceEnd(
      "interrupted",
      { spoken: "😀".repeat(51), unspoken: "🌙".repeat(51) },
      identity,
    );
    slot.callFailed(turnOf(8, "user.text_submitted"), "network_drop");
    expect(records).toEqual([
      { ...identity, ended: "complete", ts: NOW },
      {
        ...identity,
        ended: "interrupted",
        ts: NOW,
        spoken: "😀".repeat(50),
        unspoken: "🌙".repeat(50),
      },
      { turn_id: "8", event_name: "user.text_submitted", ended: "failed", ts: NOW },
    ]);
    off();
    slot.callFailed(turnOf(9, "agent.done"), "network_drop");
    expect(records).toHaveLength(3);
  });
});
