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
  const bus = { push: vi.fn(() => true) } as Pick<EventBus, "push"> & {
    push: ReturnType<typeof vi.fn>;
  };
  const listeners = new Set<(event: CharacterAddressed) => void>();
  const source = createAddressedSource({
    bus,
    selfPresetId,
    subscribe: (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
  });
  return {
    bus,
    source,
    emit: (event: CharacterAddressed) => {
      for (const cb of [...listeners]) cb(event);
    },
    isUnsubscribed: () => listeners.size === 0,
  };
}

describe("createAddressedSource", () => {
  it.each([
    {},
    { user_message: "  User\nquestion  " },
  ])("pushes the addressed payload with %j", (extra) => {
    const { bus, source, emit } = setup();
    source.start();

    emit({ ...EVENT, ...extra });

    expect(bus.push).toHaveBeenCalledExactlyOnceWith({
      source: "addressed_source",
      event_name: "addressed.character",
      ts: EVENT.ts,
      payload: { from: "perlica", name: "Perlica", line: "natsume, you took my chair", ...extra },
    });
    // The spoken text rides as `line`; no payload field carries it verbatim.
    expect(bus.push.mock.calls[0]![0].payload).not.toHaveProperty("text");
  });

  it("pushes nothing for an event addressed to another preset", () => {
    const { bus, source, emit } = setup("shino");
    source.start();

    emit(EVENT);

    expect(bus.push).not.toHaveBeenCalled();
  });

  it("stop unsubscribes, so a later event pushes nothing", () => {
    const { bus, source, emit, isUnsubscribed } = setup();
    source.start();
    source.stop();

    expect(isUnsubscribed()).toBe(true);
    emit(EVENT);
    expect(bus.push).not.toHaveBeenCalled();
  });
});
