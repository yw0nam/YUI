import { describe, expect, it } from "vitest";
import type { BusEnvelope } from "../core/event-bus";
import { sourceLinesOf } from "./signal-lines";

function signalsEnv(groups: unknown[]): BusEnvelope {
  return {
    source: "urgent_signal_source",
    event_name: "signals.batch",
    ts: 0,
    payload: { signals: groups },
  };
}

function group(source: string, over: Record<string, unknown> = {}) {
  return {
    envelope: {
      source,
      event_type: `${source}.event`,
      delivery: "batched",
      event_id: `${source}-1`,
      occurred_at: 1,
      ...over,
    },
    items: [],
  };
}

describe("sourceLinesOf", () => {
  it("puts urgent groups first, arrival order otherwise", () => {
    expect(
      sourceLinesOf(signalsEnv([group("a"), group("b", { delivery: "urgent" }), group("c")])),
    ).toEqual([
      { delivery: "urgent", source: "b", text: "b.event" },
      { delivery: "batched", source: "a", text: "a.event" },
      { delivery: "batched", source: "c", text: "c.event" },
    ]);
  });

  it("text is the label when the producer gave one, the event type otherwise", () => {
    expect(sourceLinesOf(signalsEnv([group("a", { label: "PR merged" }), group("b")]))).toEqual([
      { delivery: "batched", source: "a", text: "PR merged" },
      { delivery: "batched", source: "b", text: "b.event" },
    ]);
  });

  it("a user turn trigger carries no source lines", () => {
    expect(
      sourceLinesOf({
        source: "user_input_source",
        event_name: "user.text_submitted",
        ts: 0,
        payload: { text: "hi" },
      }),
    ).toEqual([]);
  });
});
