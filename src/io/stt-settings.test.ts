/**
 * stt-settings.test.ts — createSttSettings reactive store.
 *
 * 검증:
 *  - 기본값(defaults): enabled=false (부트 시 음성입력 off 유지)
 *  - setEnabled: 실제 변경 시 persist + notify, 동일값이면 skip
 *  - reloadFromStorage: 크로스윈도우 재로드, 동일값/malformed/부재 시 no-op
 *  - subscribe/unsubscribe
 *  - get()이 shallow copy를 반환(내부 상태 변경 불가)
 *  - dispose: 구독자 정리
 */

import { describe, expect, it, vi } from "vitest";
import { createSttSettings, type SttSettings, type SttStorage } from "./stt-settings";

function fakeStorage(
  initial?: SttSettings | null,
  opts?: { throwOnLoad?: boolean },
): SttStorage & { saved: SttSettings[] } {
  const saved: SttSettings[] = [];
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

function memStorage(): SttStorage & { _data: SttSettings | null } {
  let data: SttSettings | null = null;
  return {
    get _data() {
      return data;
    },
    set _data(v: SttSettings | null) {
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

describe("createSttSettings — defaults", () => {
  it("defaults to enabled=false when no storage and no initial", () => {
    const store = createSttSettings();
    expect(store.get().enabled).toBe(false);
  });

  it("does not throw when no options given", () => {
    expect(() => createSttSettings()).not.toThrow();
  });
});

describe("createSttSettings — hydration precedence", () => {
  it("valid stored value wins over initial", () => {
    const stored: SttSettings = { enabled: true };
    const initial: SttSettings = { enabled: false };
    const store = createSttSettings({
      storage: fakeStorage(stored),
      initial,
    });
    expect(store.get().enabled).toBe(true);
  });

  it("initial wins over hard defaults when no stored value", () => {
    const initial: SttSettings = { enabled: true };
    const store = createSttSettings({
      storage: fakeStorage(null),
      initial,
    });
    expect(store.get().enabled).toBe(true);
  });
});

describe("createSttSettings — malformed/throwing storage", () => {
  it("storage.load() throws → falls back to defaults, factory does not throw", () => {
    const store = createSttSettings({
      storage: fakeStorage(null, { throwOnLoad: true }),
    });
    expect(store.get().enabled).toBe(false);
  });

  it("storage returns malformed data (missing enabled) → falls back to defaults", () => {
    const malformed = {} as unknown as SttSettings;
    const store = createSttSettings({ storage: fakeStorage(malformed) });
    expect(store.get().enabled).toBe(false);
  });

  it("storage returns non-boolean enabled → falls back to defaults", () => {
    const malformed = { enabled: "nope" } as unknown as SttSettings;
    const store = createSttSettings({ storage: fakeStorage(malformed) });
    expect(store.get().enabled).toBe(false);
  });
});

describe("createSttSettings — setEnabled", () => {
  it("setEnabled(true) persists and notifies subscribers", () => {
    const storage = fakeStorage(null);
    const store = createSttSettings({ storage });
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
    const store = createSttSettings({ storage });
    const cb = vi.fn();
    store.subscribe(cb);

    store.setEnabled(false); // same as default

    expect(storage.saved).toHaveLength(0);
    expect(cb).not.toHaveBeenCalled();
  });
});

describe("createSttSettings — reloadFromStorage (cross-window sync)", () => {
  it("applies an externally-changed stored value and notifies", () => {
    const storage = memStorage();
    const store = createSttSettings({ storage });
    const cb = vi.fn();
    store.subscribe(cb);

    const next: SttSettings = { enabled: true };
    storage._data = next;
    store.reloadFromStorage();

    expect(store.get()).toEqual(next);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0][0]).toEqual(next);
  });

  it("identical value is a no-op (no notify)", () => {
    const storage = memStorage();
    const store = createSttSettings({ storage });
    store.setEnabled(true);
    const cb = vi.fn();
    store.subscribe(cb);
    storage._data = { enabled: true };
    store.reloadFromStorage();
    expect(cb).not.toHaveBeenCalled();
  });

  it("ignores malformed stored value on reload (no notify)", () => {
    const storage = memStorage();
    const store = createSttSettings({ storage });
    const cb = vi.fn();
    store.subscribe(cb);
    storage._data = { enabled: "nope" } as unknown as SttSettings;
    store.reloadFromStorage();
    expect(store.get().enabled).toBe(false);
    expect(cb).not.toHaveBeenCalled();
  });

  it("no-op when storage is absent", () => {
    const store = createSttSettings();
    const cb = vi.fn();
    store.subscribe(cb);
    expect(() => store.reloadFromStorage()).not.toThrow();
    expect(cb).not.toHaveBeenCalled();
  });

  it("no-op when storage.load throws", () => {
    let throws = false;
    const storage: SttStorage = {
      load: () => {
        if (throws) throw new Error("boom");
        return null;
      },
      save: vi.fn(),
    };
    const store = createSttSettings({ storage });
    const cb = vi.fn();
    store.subscribe(cb);
    throws = true;
    expect(() => store.reloadFromStorage()).not.toThrow();
    expect(cb).not.toHaveBeenCalled();
  });
});

describe("createSttSettings — subscribe/unsubscribe", () => {
  it("subscribe returns unsubscribe function that stops notifications", () => {
    const store = createSttSettings();
    const cb = vi.fn();
    const unsub = store.subscribe(cb);

    store.setEnabled(true);
    expect(cb).toHaveBeenCalledTimes(1);

    unsub();
    store.setEnabled(false);
    expect(cb).toHaveBeenCalledTimes(1); // no more
  });

  it("multiple subscribers are each notified independently", () => {
    const store = createSttSettings();
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    store.subscribe(cb1);
    store.subscribe(cb2);

    store.setEnabled(true);
    expect(cb1).toHaveBeenCalledTimes(1);
    expect(cb2).toHaveBeenCalledTimes(1);
  });
});

describe("createSttSettings — get() returns a copy", () => {
  it("mutating the returned object does not affect store state", () => {
    const store = createSttSettings();
    const s = store.get();
    (s as any).enabled = true;

    expect(store.get().enabled).toBe(false);
  });
});

describe("createSttSettings — dispose", () => {
  it("dispose clears all subscribers; subsequent mutations do not call them", () => {
    const store = createSttSettings();
    const cb = vi.fn();
    store.subscribe(cb);

    store.dispose();
    store.setEnabled(true);

    expect(cb).not.toHaveBeenCalled();
  });
});
