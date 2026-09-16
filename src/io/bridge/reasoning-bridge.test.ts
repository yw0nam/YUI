// @vitest-environment jsdom
/**
 * reasoning-bridge.test.ts — the reasoning text lives in the pet window (it rides the push
 * socket there), so the message window reads a mirror of it over the cross-window bridge.
 *
 * The whole state crosses on every change, so a missed event cannot corrupt the text; the
 * next snapshot or a refresh() repairs it.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { createMirroredReasoning, publishReasoning } from "./reasoning-bridge";
import type { ReasoningState } from "./reasoning-store";
import { type BridgeTransport, createSettingsBridge } from "./settings-bridge";

/** In-memory pub/sub shared by two bridges — one per window. */
function createFakeTransport(): BridgeTransport {
  const listeners = new Map<string, Set<(p: unknown) => void>>();
  return {
    emit(name, payload) {
      for (const cb of [...(listeners.get(name) ?? [])]) cb(payload);
    },
    listen(name, cb) {
      let set = listeners.get(name);
      if (!set) {
        set = new Set();
        listeners.set(name, set);
      }
      set.add(cb);
      return () => set?.delete(cb);
    },
  };
}

function fakeStore(initial: ReasoningState = { text: "", live: false }) {
  let state = initial;
  const subs = new Set<(s: ReasoningState) => void>();
  return {
    get: () => state,
    subscribe(cb: (s: ReasoningState) => void) {
      subs.add(cb);
      return () => {
        subs.delete(cb);
      };
    },
    set(next: ReasoningState): void {
      state = next;
      for (const cb of subs) cb(next);
    },
    listenerCount: () => subs.size,
  };
}

const LIVE: ReasoningState = { text: "checking the logs", live: true };
const DONE: ReasoningState = { text: "checking the logs", live: false };

let transport: BridgeTransport;
let petBridge: ReturnType<typeof createSettingsBridge>;
let messageBridge: ReturnType<typeof createSettingsBridge>;
let store: ReturnType<typeof fakeStore>;

beforeEach(() => {
  transport = createFakeTransport();
  petBridge = createSettingsBridge(transport, { windowKind: "pet" });
  messageBridge = createSettingsBridge(transport, { windowKind: "message" });
  store = fakeStore();
});

describe("reasoning across windows", () => {
  it("carries every state change from the pet window to the mirror", () => {
    publishReasoning({ store, bridge: petBridge });
    const mirror = createMirroredReasoning({ bridge: messageBridge });

    store.set(LIVE);

    expect(mirror.get()).toEqual(LIVE);
  });

  it("carries a cycle closing from live to done", () => {
    publishReasoning({ store, bridge: petBridge });
    const mirror = createMirroredReasoning({ bridge: messageBridge });
    store.set(LIVE);

    store.set(DONE);

    expect(mirror.get()).toEqual(DONE);
  });

  it("notifies the mirror's own subscribers", () => {
    publishReasoning({ store, bridge: petBridge });
    const mirror = createMirroredReasoning({ bridge: messageBridge });
    const seen: ReasoningState[] = [];
    mirror.subscribe((s) => seen.push(s));

    store.set(LIVE);

    expect(seen).toEqual([LIVE]);
  });

  it("answers a mirror opened after the state settled", () => {
    store = fakeStore(DONE);
    publishReasoning({ store, bridge: petBridge });

    const mirror = createMirroredReasoning({ bridge: messageBridge });

    expect(mirror.get()).toEqual(DONE);
  });

  it("starts empty while no pet window answers", () => {
    const mirror = createMirroredReasoning({ bridge: messageBridge });
    expect(mirror.get()).toEqual({ text: "", live: false });
  });

  it("asks again on refresh, for a window that opened before the text arrived", () => {
    const mirror = createMirroredReasoning({ bridge: messageBridge });
    expect(mirror.get()).toEqual({ text: "", live: false });

    const stop = publishReasoning({ store, bridge: petBridge });
    mirror.refresh();
    stop();

    expect(mirror.get()).toEqual({ text: "", live: false });
  });

  it("carries the current state on refresh", () => {
    store = fakeStore(DONE);
    const mirror = createMirroredReasoning({ bridge: messageBridge });
    publishReasoning({ store, bridge: petBridge });

    mirror.refresh();

    expect(mirror.get()).toEqual(DONE);
  });

  it("stops publishing after the pet side is disposed", () => {
    publishReasoning({ store, bridge: petBridge })();
    const mirror = createMirroredReasoning({ bridge: messageBridge });

    store.set(LIVE);

    expect(mirror.get()).toEqual({ text: "", live: false });
    expect(store.listenerCount()).toBe(0);
  });

  it("stops updating after the mirror is disposed", () => {
    publishReasoning({ store, bridge: petBridge });
    const mirror = createMirroredReasoning({ bridge: messageBridge });
    mirror.dispose();

    store.set(LIVE);

    expect(mirror.get()).toEqual({ text: "", live: false });
  });

  it("ignores a payload that is not a reasoning state", () => {
    const mirror = createMirroredReasoning({ bridge: messageBridge });

    expect(() => {
      petBridge.emitReasoning(null as never);
    }).not.toThrow();

    expect(mirror.get()).toEqual({ text: "", live: false });
  });
});
