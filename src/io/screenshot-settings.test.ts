/**
 * screenshot-settings.test.ts — createScreenshotSettings reactive store.
 *
 * 검증:
 *  - 기본값(defaults): enabled=false, source={kind:"monitor",index:0}
 *  - 저장된 유효값이 initial보다 우선
 *  - initial이 기본값보다 우선
 *  - 잘못된/throw하는 storage → 기본값, factory는 throw 안 함
 *  - setEnabled/setSource: 실제 변경 시 persist + notify, 동일값이면 skip
 *  - subscribe/unsubscribe
 *  - get()이 shallow copy를 반환(내부 상태 변경 불가)
 */

import { describe, expect, it, vi } from "vitest";
import {
  createScreenshotSettings,
  type ScreenshotSettings,
  type ScreenshotStorage,
} from "./screenshot-settings";

function fakeStorage(
  initial?: ScreenshotSettings | null,
  opts?: { throwOnLoad?: boolean },
): ScreenshotStorage & { saved: ScreenshotSettings[] } {
  const saved: ScreenshotSettings[] = [];
  return {
    saved,
    load() {
      if (opts?.throwOnLoad) throw new Error("storage exploded");
      return initial ?? null;
    },
    save(s) {
      saved.push(s);
    },
  };
}

function memStorage(): ScreenshotStorage & { _data: ScreenshotSettings | null } {
  let data: ScreenshotSettings | null = null;
  return {
    get _data() {
      return data;
    },
    set _data(v: ScreenshotSettings | null) {
      data = v;
    },
    load() {
      return data;
    },
    save(s) {
      data = { ...s };
    },
  };
}

const DEFAULT_SOURCE = { kind: "monitor" as const, index: 0 };

describe("createScreenshotSettings — defaults", () => {
  it("defaults to enabled=false, monitor index 0 when no storage and no initial", () => {
    const store = createScreenshotSettings();
    const s = store.get();
    expect(s.enabled).toBe(false);
    expect(s.source).toEqual(DEFAULT_SOURCE);
  });

  it("does not throw when no options given", () => {
    expect(() => createScreenshotSettings()).not.toThrow();
  });
});

describe("createScreenshotSettings — hydration precedence", () => {
  it("valid stored value wins over initial", () => {
    const stored: ScreenshotSettings = {
      enabled: true,
      source: { kind: "monitor", index: 2, label: "stored" },
    };
    const initial: ScreenshotSettings = {
      enabled: false,
      source: { kind: "monitor", index: 1 },
    };
    const store = createScreenshotSettings({
      storage: fakeStorage(stored),
      initial,
    });
    expect(store.get().enabled).toBe(true);
    expect(store.get().source).toEqual(stored.source);
  });

  it("initial wins over hard defaults when no stored value", () => {
    const initial: ScreenshotSettings = {
      enabled: true,
      source: { kind: "monitor", index: 3 },
    };
    const store = createScreenshotSettings({
      storage: fakeStorage(null),
      initial,
    });
    expect(store.get().enabled).toBe(true);
    expect((store.get().source as { index: number }).index).toBe(3);
  });
});

describe("createScreenshotSettings — malformed/throwing storage", () => {
  it("storage.load() throws → falls back to defaults, factory does not throw", () => {
    const store = createScreenshotSettings({
      storage: fakeStorage(null, { throwOnLoad: true }),
    });
    expect(store.get().enabled).toBe(false);
    expect(store.get().source).toEqual(DEFAULT_SOURCE);
  });

  it("storage returns malformed data (missing enabled) → falls back to defaults", () => {
    const malformed = { source: { kind: "monitor", index: 0 } } as unknown as ScreenshotSettings;
    const store = createScreenshotSettings({ storage: fakeStorage(malformed) });
    expect(store.get().enabled).toBe(false);
    expect(store.get().source).toEqual(DEFAULT_SOURCE);
  });

  it("storage returns malformed data (missing source) → falls back to defaults", () => {
    const malformed = { enabled: false } as unknown as ScreenshotSettings;
    const store = createScreenshotSettings({ storage: fakeStorage(malformed) });
    expect(store.get().enabled).toBe(false);
    expect(store.get().source).toEqual(DEFAULT_SOURCE);
  });

  it("storage returns null source → falls back to defaults", () => {
    const malformed = { enabled: false, source: null } as unknown as ScreenshotSettings;
    const store = createScreenshotSettings({ storage: fakeStorage(malformed) });
    expect(store.get().enabled).toBe(false);
    expect(store.get().source).toEqual(DEFAULT_SOURCE);
  });
});

describe("createScreenshotSettings — setEnabled", () => {
  it("setEnabled(true) persists and notifies subscribers", () => {
    const storage = fakeStorage(null);
    const store = createScreenshotSettings({ storage });
    const cb = vi.fn();
    store.subscribe(cb);

    store.setEnabled(true);

    expect(store.get().enabled).toBe(true);
    expect(storage.saved).toHaveLength(1);
    expect(storage.saved[0].enabled).toBe(true);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0][0].enabled).toBe(true);
  });

  it("setEnabled with same value does NOT persist or notify", () => {
    const storage = fakeStorage(null);
    const store = createScreenshotSettings({ storage });
    const cb = vi.fn();
    store.subscribe(cb);

    store.setEnabled(false); // same as default

    expect(storage.saved).toHaveLength(0);
    expect(cb).not.toHaveBeenCalled();
  });
});

describe("createScreenshotSettings — setSource", () => {
  it("setSource persists and notifies on actual change", () => {
    const storage = fakeStorage(null);
    const store = createScreenshotSettings({ storage });
    const cb = vi.fn();
    store.subscribe(cb);

    const newSource = { kind: "monitor" as const, index: 1, label: "外部" };
    store.setSource(newSource);

    expect(store.get().source).toEqual(newSource);
    expect(storage.saved).toHaveLength(1);
    expect(storage.saved[0].source).toEqual(newSource);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("setSource with structurally equal value does NOT persist or notify", () => {
    const storage = fakeStorage(null);
    const store = createScreenshotSettings({ storage });
    const cb = vi.fn();
    store.subscribe(cb);

    store.setSource({ kind: "monitor", index: 0 }); // same as default

    expect(storage.saved).toHaveLength(0);
    expect(cb).not.toHaveBeenCalled();
  });
});

describe("createScreenshotSettings — reloadFromStorage (cross-window sync)", () => {
  it("applies an externally-changed stored value and notifies", () => {
    const storage = memStorage();
    const store = createScreenshotSettings({ storage });
    const cb = vi.fn();
    store.subscribe(cb);

    // 다른 창이 storage를 직접 갱신한 상황을 모사
    const next: ScreenshotSettings = {
      enabled: true,
      source: { kind: "monitor", index: 2, label: "other" },
    };
    storage._data = next;
    store.reloadFromStorage();

    expect(store.get()).toEqual(next);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0][0]).toEqual(next);
  });

  it("identical value is a no-op (no notify)", () => {
    const storage = memStorage();
    const store = createScreenshotSettings({ storage });
    store.setEnabled(true);
    const cb = vi.fn();
    store.subscribe(cb);
    store.reloadFromStorage();
    expect(cb).not.toHaveBeenCalled();
  });

  it("ignores malformed stored value on reload (no notify)", () => {
    const storage = memStorage();
    const store = createScreenshotSettings({ storage });
    const cb = vi.fn();
    store.subscribe(cb);
    storage._data = { enabled: "nope" } as unknown as ScreenshotSettings;
    store.reloadFromStorage();
    expect(store.get().enabled).toBe(false);
    expect(cb).not.toHaveBeenCalled();
  });

  it("no-op when storage is absent", () => {
    const store = createScreenshotSettings();
    const cb = vi.fn();
    store.subscribe(cb);
    expect(() => store.reloadFromStorage()).not.toThrow();
    expect(cb).not.toHaveBeenCalled();
  });

  it("no-op when storage.load throws", () => {
    let throws = false;
    const storage: ScreenshotStorage = {
      load: () => {
        if (throws) throw new Error("boom");
        return null;
      },
      save: vi.fn(),
    };
    const store = createScreenshotSettings({ storage });
    const cb = vi.fn();
    store.subscribe(cb);
    throws = true;
    expect(() => store.reloadFromStorage()).not.toThrow();
    expect(cb).not.toHaveBeenCalled();
  });
});

describe("createScreenshotSettings — subscribe/unsubscribe", () => {
  it("subscribe returns unsubscribe function that stops notifications", () => {
    const store = createScreenshotSettings();
    const cb = vi.fn();
    const unsub = store.subscribe(cb);

    store.setEnabled(true);
    expect(cb).toHaveBeenCalledTimes(1);

    unsub();
    store.setEnabled(false);
    expect(cb).toHaveBeenCalledTimes(1); // no more
  });

  it("multiple subscribers are each notified independently", () => {
    const store = createScreenshotSettings();
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    store.subscribe(cb1);
    store.subscribe(cb2);

    store.setEnabled(true);
    expect(cb1).toHaveBeenCalledTimes(1);
    expect(cb2).toHaveBeenCalledTimes(1);
  });
});

describe("createScreenshotSettings — get() returns a copy", () => {
  it("mutating the returned object does not affect store state", () => {
    const store = createScreenshotSettings();
    const s = store.get();
    (s as any).enabled = true;
    (s as any).source = { kind: "monitor", index: 99 };

    expect(store.get().enabled).toBe(false);
    expect((store.get().source as { index: number }).index).toBe(0);
  });
});

describe("createScreenshotSettings — dispose", () => {
  it("dispose clears all subscribers; subsequent mutations do not call them", () => {
    const store = createScreenshotSettings();
    const cb = vi.fn();
    store.subscribe(cb);

    store.dispose();
    store.setEnabled(true);

    expect(cb).not.toHaveBeenCalled();
  });
});
