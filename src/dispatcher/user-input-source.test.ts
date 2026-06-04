/**
 * user-input-source.test.ts — user.text_submitted producer (event-dispatcher.md §3.4).
 *
 * Locks: submit(text) pushes a well-formed envelope onto the bus
 * (source=user_input_source, event_name=user.text_submitted, dnd_override=true,
 * payload.text, ts≈now). Empty/whitespace text is ignored.
 */

import { describe, it, expect, vi } from "vitest";
import { createUserInputSource } from "./user-input-source";
import type { BusEnvelope, EventBus } from "./event-bus";

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
