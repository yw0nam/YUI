/**
 * user-input-source.test.ts — user.text_submitted + user.voice_segment_ready producers.
 *
 * Locks:
 *  - submit(text) pushes a well-formed user.text_submitted envelope.
 *  - submitVoice(text) pushes a user.voice_segment_ready envelope with text payload.
 *  - voice envelope: source=user_input_source, dnd_override=true, hint_tier=2.
 *  - payload shape: { text }.
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

describe("user_input_source — submit with images", () => {
  const URL = "data:image/png;base64,AAA";

  it("carries images on the payload alongside text", () => {
    const { bus, pushed } = fakeBus();
    const src = createUserInputSource(bus);
    src.submit("hi", [URL]);
    expect(pushed).toHaveLength(1);
    expect(pushed[0].payload?.text).toBe("hi");
    expect(pushed[0].payload?.images).toEqual([URL]);
  });

  it("pushes images-only submit with empty text", () => {
    const { bus, pushed } = fakeBus();
    const src = createUserInputSource(bus);
    src.submit("", [URL]);
    expect(pushed).toHaveLength(1);
    expect(pushed[0].payload?.text).toBe("");
    expect(pushed[0].payload?.images).toEqual([URL]);
  });

  it("does not set images key when no images attached", () => {
    const { bus, pushed } = fakeBus();
    const src = createUserInputSource(bus);
    src.submit("hi");
    expect(pushed[0].payload).not.toHaveProperty("images");
  });

  it("ignores empty text with empty image list", () => {
    const { bus, pushed } = fakeBus();
    const src = createUserInputSource(bus);
    src.submit("", []);
    src.submit("   ");
    expect(pushed).toHaveLength(0);
  });
});

describe("user_input_source — submitVoice", () => {
  it("pushes a user.voice_segment_ready envelope with text payload", () => {
    const { bus, pushed } = fakeBus();
    const src = createUserInputSource(bus);
    src.submitVoice("こんにちは");

    expect(pushed).toHaveLength(1);
    const e = pushed[0];
    expect(e.source).toBe("user_input_source");
    expect(e.event_name).toBe("user.voice_segment_ready");
    expect(e.dnd_override).toBe(true);
    expect(e.hint_tier).toBe(2);
    expect(typeof e.ts).toBe("number");
    expect(e.payload?.text).toBe("こんにちは");
  });

  it("does not push when text is empty", () => {
    const { bus, pushed } = fakeBus();
    const src = createUserInputSource(bus);
    src.submitVoice("");
    src.submitVoice("   ");
    expect(pushed).toHaveLength(0);
  });

  it("trims surrounding whitespace from text", () => {
    const { bus, pushed } = fakeBus();
    const src = createUserInputSource(bus);
    src.submitVoice("  hello  ");
    expect(pushed[0].payload?.text).toBe("hello");
  });
});
