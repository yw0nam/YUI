import { describe, expect, it, vi } from "vitest";

// wire-ambient reaches io/chat/chat-client through dispatcher/backend/backend-caller; keep it mocked.
const { selectFetch } = vi.hoisted(() => ({ selectFetch: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../io/chat/chat-client", () => ({ selectFetch }));

import { wireStrollReflexCancel } from "./wire-ambient";

describe("wireStrollReflexCancel", () => {
  function fakeDispatcher(trigger: string) {
    let cb: ((busy: boolean) => void) | null = null;
    return {
      subscribeBusy: vi.fn((next: (busy: boolean) => void) => {
        cb = next;
        return vi.fn();
      }),
      inFlight: () => ({
        trigger: { source: "tap", event_name: trigger, ts: 0, hint_tier: 1, seq_id: 1 } as never,
        started_at: 0,
      }),
      fire: (busy: boolean) => cb?.(busy),
    };
  }

  it("cancels a running stroll when a reflex turn opens", () => {
    const dispatcher = fakeDispatcher("proactive.touch_belly");
    const walker = { cancel: vi.fn() };
    wireStrollReflexCancel({ dispatcher, walker });
    dispatcher.fire(true);
    expect(walker.cancel).toHaveBeenCalledTimes(1);
  });

  it("leaves the stroll alone when an ordinary turn opens or a turn closes", () => {
    const dispatcher = fakeDispatcher("user.text_submitted");
    const walker = { cancel: vi.fn() };
    wireStrollReflexCancel({ dispatcher, walker });
    dispatcher.fire(true);
    dispatcher.fire(false);
    expect(walker.cancel).not.toHaveBeenCalled();
  });
});
