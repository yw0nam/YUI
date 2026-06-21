/**
 * tts-settings.test.ts — createTtsSettings reactive store.
 *
 * 검증:
 *  - 기본값(defaults): enabled=true
 *  - setEnabled: 실제 변경 시 persist + notify, 동일값이면 skip
 *  - reloadFromStorage: 크로스윈도우 재로드, 동일값/malformed/부재 시 no-op
 *  - subscribe/unsubscribe
 *  - get()이 shallow copy를 반환(내부 상태 변경 불가)
 *  - dispose: 구독자 정리
 */

import { describe, expect, it, vi } from "vitest";
import { createTtsSettings, type TtsSettings, type TtsStorage } from "./tts-settings";

function fakeStorage(
  initial?: TtsSettings | null,
  opts?: { throwOnLoad?: boolean },
): TtsStorage & { saved: TtsSettings[] } {
  const saved: TtsSettings[] = [];
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

function memStorage(): TtsStorage & { _data: TtsSettings | null } {
  let data: TtsSettings | null = null;
  return {
    get _data() {
      return data;
    },
    set _data(v: TtsSettings | null) {
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

describe("createTtsSettings — defaults", () => {
  it("defaults to enabled=true when no storage and no initial", () => {
    const store = createTtsSettings();
    expect(store.get().enabled).toBe(true);
  });

  it("does not throw when no options given", () => {
    expect(() => createTtsSettings()).not.toThrow();
  });
});

describe("createTtsSettings — hydration precedence", () => {
  it("valid stored value wins over initial", () => {
    const stored: TtsSettings = { enabled: false };
    const initial: TtsSettings = { enabled: true };
    const store = createTtsSettings({
      storage: fakeStorage(stored),
      initial,
    });
    expect(store.get().enabled).toBe(false);
  });

  it("initial wins over hard defaults when no stored value", () => {
    const initial: TtsSettings = { enabled: false };
    const store = createTtsSettings({
      storage: fakeStorage(null),
      initial,
    });
    expect(store.get().enabled).toBe(false);
  });
});

describe("createTtsSettings — malformed/throwing storage", () => {
  it("storage.load() throws → falls back to defaults, factory does not throw", () => {
    const store = createTtsSettings({
      storage: fakeStorage(null, { throwOnLoad: true }),
    });
    expect(store.get().enabled).toBe(true);
  });

  it("storage returns malformed data (missing enabled) → falls back to defaults", () => {
    const malformed = {} as unknown as TtsSettings;
    const store = createTtsSettings({ storage: fakeStorage(malformed) });
    expect(store.get().enabled).toBe(true);
  });

  it("storage returns non-boolean enabled → falls back to defaults", () => {
    const malformed = { enabled: "nope" } as unknown as TtsSettings;
    const store = createTtsSettings({ storage: fakeStorage(malformed) });
    expect(store.get().enabled).toBe(true);
  });
});

describe("createTtsSettings — setEnabled", () => {
  it("setEnabled(false) persists and notifies subscribers", () => {
    const storage = fakeStorage(null);
    const store = createTtsSettings({ storage });
    const cb = vi.fn();
    store.subscribe(cb);

    store.setEnabled(false);

    expect(store.get().enabled).toBe(false);
    expect(storage.saved).toHaveLength(1);
    expect(storage.saved[0].enabled).toBe(false);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0][0].enabled).toBe(false);
  });

  it("setEnabled with same value does NOT persist or notify", () => {
    const storage = fakeStorage(null);
    const store = createTtsSettings({ storage });
    const cb = vi.fn();
    store.subscribe(cb);

    store.setEnabled(true); // same as default

    expect(storage.saved).toHaveLength(0);
    expect(cb).not.toHaveBeenCalled();
  });
});

describe("createTtsSettings — reloadFromStorage (cross-window sync)", () => {
  it("applies an externally-changed stored value and notifies", () => {
    const storage = memStorage();
    const store = createTtsSettings({ storage });
    const cb = vi.fn();
    store.subscribe(cb);

    const next: TtsSettings = { enabled: false };
    storage._data = next;
    store.reloadFromStorage();

    expect(store.get()).toEqual(next);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0][0]).toEqual(next);
  });

  it("identical value is a no-op (no notify)", () => {
    const storage = memStorage();
    const store = createTtsSettings({ storage });
    store.setEnabled(false);
    const cb = vi.fn();
    store.subscribe(cb);
    store.reloadFromStorage();
    expect(cb).not.toHaveBeenCalled();
  });

  it("ignores malformed stored value on reload (no notify)", () => {
    const storage = memStorage();
    const store = createTtsSettings({ storage });
    const cb = vi.fn();
    store.subscribe(cb);
    storage._data = { enabled: "nope" } as unknown as TtsSettings;
    store.reloadFromStorage();
    expect(store.get().enabled).toBe(true);
    expect(cb).not.toHaveBeenCalled();
  });

  it("no-op when storage is absent", () => {
    const store = createTtsSettings();
    const cb = vi.fn();
    store.subscribe(cb);
    expect(() => store.reloadFromStorage()).not.toThrow();
    expect(cb).not.toHaveBeenCalled();
  });

  it("no-op when storage.load throws", () => {
    let throws = false;
    const storage: TtsStorage = {
      load: () => {
        if (throws) throw new Error("boom");
        return null;
      },
      save: vi.fn(),
    };
    const store = createTtsSettings({ storage });
    const cb = vi.fn();
    store.subscribe(cb);
    throws = true;
    expect(() => store.reloadFromStorage()).not.toThrow();
    expect(cb).not.toHaveBeenCalled();
  });
});

describe("createTtsSettings — subscribe/unsubscribe", () => {
  it("subscribe returns unsubscribe function that stops notifications", () => {
    const store = createTtsSettings();
    const cb = vi.fn();
    const unsub = store.subscribe(cb);

    store.setEnabled(false);
    expect(cb).toHaveBeenCalledTimes(1);

    unsub();
    store.setEnabled(true);
    expect(cb).toHaveBeenCalledTimes(1); // no more
  });

  it("multiple subscribers are each notified independently", () => {
    const store = createTtsSettings();
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    store.subscribe(cb1);
    store.subscribe(cb2);

    store.setEnabled(false);
    expect(cb1).toHaveBeenCalledTimes(1);
    expect(cb2).toHaveBeenCalledTimes(1);
  });
});

describe("createTtsSettings — get() returns a copy", () => {
  it("mutating the returned object does not affect store state", () => {
    const store = createTtsSettings();
    const s = store.get();
    (s as any).enabled = false;

    expect(store.get().enabled).toBe(true);
  });
});

describe("createTtsSettings — dispose", () => {
  it("dispose clears all subscribers; subsequent mutations do not call them", () => {
    const store = createTtsSettings();
    const cb = vi.fn();
    store.subscribe(cb);

    store.dispose();
    store.setEnabled(false);

    expect(cb).not.toHaveBeenCalled();
  });
});
