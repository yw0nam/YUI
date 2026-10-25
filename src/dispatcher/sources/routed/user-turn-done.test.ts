import { describe, expect, it, vi } from "vitest";
import type { BusEnvelope } from "../../core/event-bus";
import { createUserTurnDone } from "./user-turn-done";

const env = (payload?: Record<string, unknown>): BusEnvelope => ({
  seq_id: 1,
  source: "user_input_source",
  event_name: "user.text_submitted",
  ts: 1,
  payload,
});

function setup() {
  const emit = vi.fn();
  const restore = vi.fn();
  const onTurnClosed = vi.fn();
  const done = createUserTurnDone({
    presetId: () => "natsume",
    emit,
    onTurnClosed,
    onTurnDropped: restore,
  });
  return { done, emit, restore, onTurnClosed };
}

describe("createUserTurnDone", () => {
  it("reports done for the send id of a closed turn and still runs the wrapped close hook", () => {
    const { done, emit, onTurnClosed } = setup();
    const turn = { id: 3, outcome: "ok" as const, spokeText: true, sendId: "s1" };

    done.onTurnClosed(turn);

    expect(emit).toHaveBeenCalledExactlyOnceWith({ sendId: "s1", preset: "natsume" });
    expect(onTurnClosed).toHaveBeenCalledExactlyOnceWith(turn);
  });

  it("reports done for the send id of a dropped turn and still runs the wrapped drop hook", () => {
    const { done, emit, restore } = setup();

    done.onTurnDropped(env({ text: "hi", send_id: "s1" }), "not_configured");

    expect(emit).toHaveBeenCalledExactlyOnceWith({ sendId: "s1", preset: "natsume" });
    expect(restore).toHaveBeenCalledExactlyOnceWith(expect.any(Object), "not_configured");
  });

  it("reports nothing for a turn without a send id", () => {
    const { done, emit } = setup();

    done.onTurnClosed({ id: 3, outcome: "ok", spokeText: true });
    done.onTurnDropped(env({ text: "hi" }), "not_configured");

    expect(emit).not.toHaveBeenCalled();
  });
});
