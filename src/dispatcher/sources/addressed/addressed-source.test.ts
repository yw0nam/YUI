import { describe, expect, it, vi } from "vitest";
import type { CharacterAddressed } from "../../../io/bridge/settings-bridge";
import type { EventBus } from "../../core/event-bus";
import { createAddressedSource } from "./addressed-source";

const EVENT: CharacterAddressed = {
  from: "perlica",
  name: "Perlica",
  to: "natsume",
  text: "natsume, you took my chair",
  ts: 1_717_000_000_000,
};

function setup(selfPresetId = "natsume") {
  const bus = { push: vi.fn(() => true) } as Pick<EventBus, "push"> & { push: ReturnType<typeof vi.fn> };
  let deliver: ((event: CharacterAddressed) => void) | null = null;
  let unsubscribed = false;
  const source = createAddressedSource({
    bus,
    selfPresetId,
    subscribe: (cb) => {
      deliver = cb;
      return () => {
        unsubscribed = true;
      };
    },
  });
  return { bus, source, deliver: () => deliver!, isUnsubscribed: () => unsubscribed };
}

describe("createAddressedSource", () => {
  it("pushes one addressed.character envelope for an event naming this preset", () => {
    const { bus, source, deliver } = setup();
    source.start();

    deliver()(EVENT);

    expect(bus.push).toHaveBeenCalledExactlyOnceWith({
      source: "addressed_source",
      event_name: "addressed.character",
      ts: EVENT.ts,
      payload: { from: "perlica", name: "Perlica", line: "natsume, you took my chair" },
    });
    // The spoken text rides as `line`; no payload field carries it verbatim.
    expect(bus.push.mock.calls[0]![0].payload).not.toHaveProperty("text");
  });

  it("pushes nothing for an event addressed to another preset", () => {
    const { bus, source, deliver } = setup("shino");
    source.start();

    deliver()(EVENT);

    expect(bus.push).not.toHaveBeenCalled();
  });

  it("stop unsubscribes, so a later event pushes nothing", () => {
    const { bus, source, deliver, isUnsubscribed } = setup();
    source.start();
    source.stop();

    expect(isUnsubscribed()).toBe(true);
    deliver()(EVENT);
    expect(bus.push).not.toHaveBeenCalled();
  });
});
