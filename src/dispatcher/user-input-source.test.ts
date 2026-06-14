/**
 * user-input-source.test.ts — user.text_submitted + user.voice_segment_ready producers.
 *
 * Locks:
 *  - submit(text) pushes a well-formed user.text_submitted envelope.
 *  - submitVoice(transcript) pushes a user.voice_segment_ready envelope with transcript payload.
 *  - voice envelope: source=user_input_source, dnd_override=true, hint_tier=2.
 *  - payload shape: { transcript: { text, confidence?, lang? } }.
 */

import { describe, expect, it, vi } from "vitest";
import type { BusEnvelope, EventBus } from "./event-bus";
import { createUserInputSource } from "./user-input-source";

function fakeBus(): { bus: EventBus; pushed: BusEnvelope[] } {
  const pushed: BusEnvelope[] = [];
  const bus: EventBus = {
    push: vi.fn((e: BusEnvelope) => {
      pushed.push(e);
      return true;
    }),
    pop: () => null,
    snapshot: () => [],
  };
  return { bus, pushed };
}

describe("user_input_source — submit", () => {
  it("pushes a user.text_submitted envelope with dnd_override and payload.text", () => {
    const { bus, pushed } = fakeBus();
    const src = createUserInputSource(bus);
    src.submit("안녕");
    expect(pushed).toHaveLength(1);
    const e = pushed[0];
    expect(e.source).toBe("user_input_source");
    expect(e.event_name).toBe("user.text_submitted");
    expect(e.dnd_override).toBe(true);
    expect(e.hint_tier).toBe(2);
    expect(e.payload?.text).toBe("안녕");
    expect(typeof e.ts).toBe("number");
  });

  it("ignores empty / whitespace-only text", () => {
    const { bus, pushed } = fakeBus();
    const src = createUserInputSource(bus);
    src.submit("");
    src.submit("   ");
    expect(pushed).toHaveLength(0);
  });

  it("trims surrounding whitespace from text", () => {
    const { bus, pushed } = fakeBus();
    const src = createUserInputSource(bus);
    src.submit("  hi  ");
    expect(pushed[0].payload?.text).toBe("hi");
  });
});

describe("user_input_source — submitVoice", () => {
  it("pushes a user.voice_segment_ready envelope with transcript payload", () => {
    const { bus, pushed } = fakeBus();
    const src = createUserInputSource(bus);
    src.submitVoice({ text: "こんにちは" });

    expect(pushed).toHaveLength(1);
    const e = pushed[0];
    expect(e.source).toBe("user_input_source");
    expect(e.event_name).toBe("user.voice_segment_ready");
    expect(e.dnd_override).toBe(true);
    expect(e.hint_tier).toBe(2);
    expect(typeof e.ts).toBe("number");
    expect(e.payload?.transcript).toEqual({ text: "こんにちは" });
  });

  it("forwards confidence and lang when present", () => {
    const { bus, pushed } = fakeBus();
    const src = createUserInputSource(bus);
    src.submitVoice({ text: "hello", confidence: 0.95, lang: "en" });

    const e = pushed[0];
    expect(e.payload?.transcript).toEqual({ text: "hello", confidence: 0.95, lang: "en" });
  });

  it("does not push when transcript text is empty", () => {
    const { bus, pushed } = fakeBus();
    const src = createUserInputSource(bus);
    src.submitVoice({ text: "" });
    src.submitVoice({ text: "   " });
    expect(pushed).toHaveLength(0);
  });
});
