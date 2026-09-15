// @vitest-environment jsdom
/**
 * delegations-bridge.test.ts — the delegations list lives in the pet window (it rides the push
 * socket there), so the settings window reads a mirror of it over the cross-window bridge.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMirroredDelegations, publishDelegations } from "./delegations-bridge";
import type { DelegationItem } from "./push-socket";
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

function fakeStore(initial: DelegationItem[] = []) {
  let items = initial;
  const subs = new Set<(items: DelegationItem[]) => void>();
  return {
    get: () => items,
    subscribe(cb: (items: DelegationItem[]) => void) {
      subs.add(cb);
      return () => {
        subs.delete(cb);
      };
    },
    set(next: DelegationItem[]): void {
      items = next;
      for (const cb of subs) cb(next);
    },
    listenerCount: () => subs.size,
  };
}

function running(id: string): DelegationItem {
  return { id, title: `work ${id}`, started_at: 1_789_365_900_000, state: "running" };
}

function done(id: string): DelegationItem {
  return {
    id,
    title: `work ${id}`,
    started_at: 1_789_365_900_000,
    state: "done",
    ended_at: 1_789_365_960_000,
  };
}

let transport: BridgeTransport;
let petBridge: ReturnType<typeof createSettingsBridge>;
let settingsBridge: ReturnType<typeof createSettingsBridge>;
let store: ReturnType<typeof fakeStore>;

beforeEach(() => {
  transport = createFakeTransport();
  petBridge = createSettingsBridge(transport, { windowKind: "pet" });
  settingsBridge = createSettingsBridge(transport, { windowKind: "settings" });
  store = fakeStore();
});

describe("delegations across windows", () => {
  it("carries every list change from the pet window to the mirror", () => {
    publishDelegations({ store, bridge: petBridge });
    const mirror = createMirroredDelegations({ bridge: settingsBridge });

    store.set([running("d-1"), running("d-2")]);

    expect(mirror.get().map((d) => d.id)).toEqual(["d-1", "d-2"]);
  });

  it("carries a list that shrank back to empty", () => {
    publishDelegations({ store, bridge: petBridge });
    const mirror = createMirroredDelegations({ bridge: settingsBridge });
    store.set([running("d-1")]);

    store.set([]);

    expect(mirror.get()).toEqual([]);
  });

  it("notifies the mirror's own subscribers", () => {
    publishDelegations({ store, bridge: petBridge });
    const mirror = createMirroredDelegations({ bridge: settingsBridge });
    const seen: DelegationItem[][] = [];
    mirror.subscribe((items) => seen.push(items));

    store.set([running("d-1")]);

    expect(seen).toEqual([[running("d-1")]]);
  });

  it("answers a mirror opened after the list settled", () => {
    store = fakeStore([running("d-1")]);
    publishDelegations({ store, bridge: petBridge });

    const mirror = createMirroredDelegations({ bridge: settingsBridge });

    expect(mirror.get().map((d) => d.id)).toEqual(["d-1"]);
  });

  it("counts the running items, the way the chip reads the list", () => {
    publishDelegations({ store, bridge: petBridge });
    const mirror = createMirroredDelegations({ bridge: settingsBridge });

    store.set([running("d-1"), done("d-2"), running("d-3")]);

    expect(mirror.runningCount()).toBe(2);
  });

  it("counts nothing running on an empty list", () => {
    publishDelegations({ store, bridge: petBridge });
    const mirror = createMirroredDelegations({ bridge: settingsBridge });

    expect(mirror.runningCount()).toBe(0);
  });

  it("starts empty while no pet window answers", () => {
    const mirror = createMirroredDelegations({ bridge: settingsBridge });
    expect(mirror.get()).toEqual([]);
  });

  it("asks again on refresh, for a window that opened before the store filled", () => {
    const mirror = createMirroredDelegations({ bridge: settingsBridge });
    expect(mirror.get()).toEqual([]);

    store = fakeStore([running("d-1")]);
    const stop = publishDelegations({ store, bridge: petBridge });
    mirror.refresh();
    stop();

    expect(mirror.get().map((d) => d.id)).toEqual(["d-1"]);
  });

  it("stops publishing after the pet side is disposed", () => {
    publishDelegations({ store, bridge: petBridge })();
    const mirror = createMirroredDelegations({ bridge: settingsBridge });

    store.set([running("d-1")]);

    expect(mirror.get()).toEqual([]);
    expect(store.listenerCount()).toBe(0);
  });

  it("stops updating after the mirror is disposed", () => {
    publishDelegations({ store, bridge: petBridge });
    const mirror = createMirroredDelegations({ bridge: settingsBridge });
    mirror.dispose();

    store.set([running("d-1")]);

    expect(mirror.get()).toEqual([]);
  });

  it("treats a non-array delegations payload as an empty list instead of throwing", () => {
    const mirror = createMirroredDelegations({ bridge: settingsBridge });

    expect(() => {
      petBridge.emitDelegations(null as unknown as DelegationItem[]);
    }).not.toThrow();

    expect(mirror.get()).toEqual([]);
  });

  it("ignores its own window's publishes", () => {
    const seen: DelegationItem[][] = [];
    const stopAsk = petBridge.onDelegationsAsk(vi.fn());
    const stop = petBridge.onDelegations((items) => seen.push(items));
    publishDelegations({ store, bridge: petBridge });

    store.set([running("d-1")]);

    expect(seen).toEqual([]);
    stop();
    stopAsk();
  });
});
