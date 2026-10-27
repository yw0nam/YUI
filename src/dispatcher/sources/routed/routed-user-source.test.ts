import { describe, expect, it, vi } from "vitest";
import type { UserTurnRouted } from "../../../io/bridge/settings-bridge";
import { createRoutedUserSource } from "./routed-user-source";

function setup(selfPresetId = "natsume") {
  const submit = vi.fn();
  const listeners = new Set<(event: UserTurnRouted) => void>();
  const source = createRoutedUserSource({
    selfPresetId,
    submit,
    subscribe: (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
  });
  return {
    submit,
    source,
    emit: (event: UserTurnRouted) => {
      for (const cb of [...listeners]) cb(event);
    },
    isUnsubscribed: () => listeners.size === 0,
  };
}

describe("createRoutedUserSource", () => {
  it("submits the text with its mention, send id and via for a message routed to this preset", () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const { source, submit, emit } = setup();
    source.start();

    emit({ sendId: "s1", to: "natsume", text: "@Natsume hi", mention: "character" });
    emit({ sendId: "s2", to: "natsume", text: "hello" });
    emit({ sendId: "s3", to: "natsume", text: "hey", via: "voice" });

    expect(submit.mock.calls).toEqual([
      ["@Natsume hi", [], { mention: "character", sendId: "s1" }],
      ["hello", [], { mention: undefined, sendId: "s2" }],
      ["hey", [], { mention: undefined, sendId: "s3", via: "voice" }],
    ]);
  });

  it("ignores a message routed to another preset", () => {
    const { source, submit, emit } = setup();
    source.start();

    emit({ sendId: "s1", to: "perlica", text: "hi" });

    expect(submit).not.toHaveBeenCalled();
  });

  it("stops listening on stop", () => {
    const { source, isUnsubscribed } = setup();
    source.start();
    source.stop();

    expect(isUnsubscribed()).toBe(true);
  });
});
