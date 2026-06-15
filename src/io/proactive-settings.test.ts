/**
 * proactive-settings.test.ts — createProactiveSettings reactive store.
 *
 * 검증:
 *  - 기본값(defaults): enabled=true
 *  - 저장된 유효값이 initial보다 우선
 *  - initial이 기본값보다 우선
 *  - 잘못된/throw하는 storage → 기본값, factory는 throw 안 함
 *  - setEnabled: 실제 변경 시 persist + notify, 동일값이면 skip
 *  - reloadFromStorage: 크로스윈도우 재로드, 동일값/malformed/부재 시 no-op
 *  - subscribe/unsubscribe
 *  - get()이 shallow copy를 반환(내부 상태 변경 불가)
 */

import { describe, expect, it, vi } from "vitest";
import {
  createProactiveSettings,
  type ProactiveSettings,
  type ProactiveStorage,
} from "./proactive-settings";

function fakeStorage(
  initial?: ProactiveSettings | null,
  opts?: { throwOnLoad?: boolean },
): ProactiveStorage & { saved: ProactiveSettings[] } {
  const saved: ProactiveSettings[] = [];
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

function memStorage(): ProactiveStorage & { _data: ProactiveSettings | null } {
  let data: ProactiveSettings | null = null;
  return {
    get _data() {
      return data;
    },
    set _data(v: ProactiveSettings | null) {
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

describe("createProactiveSettings — defaults", () => {
  it("defaults to enabled=true when no storage and no initial", () => {
    const store = createProactiveSettings();
    expect(store.get().enabled).toBe(true);
  });

  it("does not throw when no options given", () => {
    expect(() => createProactiveSettings()).not.toThrow();
  });
});

describe("createProactiveSettings — hydration precedence", () => {
  it("valid stored value wins over initial", () => {
    const stored: ProactiveSettings = { enabled: false };
    const initial: ProactiveSettings = { enabled: true };
    const store = createProactiveSettings({
      storage: fakeStorage(stored),
      initial,
    });
    expect(store.get().enabled).toBe(false);
  });

  it("initial wins over hard defaults when no stored value", () => {
    const initial: ProactiveSettings = { enabled: false };
    const store = createProactiveSettings({
      storage: fakeStorage(null),
      initial,
    });
    expect(store.get().enabled).toBe(false);
  });
});

describe("createProactiveSettings — malformed/throwing storage", () => {
  it("storage.load() throws → falls back to defaults, factory does not throw", () => {
    const store = createProactiveSettings({
      storage: fakeStorage(null, { throwOnLoad: true }),
    });
    expect(store.get().enabled).toBe(true);
  });

  it("storage returns malformed data (missing enabled) → falls back to defaults", () => {
    const malformed = {} as unknown as ProactiveSettings;
    const store = createProactiveSettings({ storage: fakeStorage(malformed) });
    expect(store.get().enabled).toBe(true);
  });

  it("storage returns non-boolean enabled → falls back to defaults", () => {
    const malformed = { enabled: "nope" } as unknown as ProactiveSettings;
    const store = createProactiveSettings({ storage: fakeStorage(malformed) });
    expect(store.get().enabled).toBe(true);
  });
});

describe("createProactiveSettings — setEnabled", () => {
  it("setEnabled(false) persists and notifies subscribers", () => {
    const storage = fakeStorage(null);
    const store = createProactiveSettings({ storage });
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
    const store = createProactiveSettings({ storage });
    const cb = vi.fn();
    store.subscribe(cb);

    store.setEnabled(true); // same as default

    expect(storage.saved).toHaveLength(0);
    expect(cb).not.toHaveBeenCalled();
  });
});

describe("createProactiveSettings — reloadFromStorage (cross-window sync)", () => {
  it("applies an externally-changed stored value and notifies", () => {
    const storage = memStorage();
    const store = createProactiveSettings({ storage });
    const cb = vi.fn();
    store.subscribe(cb);

    // 다른 창이 storage를 직접 갱신한 상황을 모사
    const next: ProactiveSettings = { enabled: false };
    storage._data = next;
    store.reloadFromStorage();

    expect(store.get()).toEqual(next);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0][0]).toEqual(next);
  });

  it("identical value is a no-op (no notify)", () => {
    const storage = memStorage();
    const store = createProactiveSettings({ storage });
    store.setEnabled(false);
    const cb = vi.fn();
    store.subscribe(cb);
    store.reloadFromStorage();
    expect(cb).not.toHaveBeenCalled();
  });

  it("ignores malformed stored value on reload (no notify)", () => {
    const storage = memStorage();
    const store = createProactiveSettings({ storage });
    const cb = vi.fn();
    store.subscribe(cb);
    storage._data = { enabled: "nope" } as unknown as ProactiveSettings;
    store.reloadFromStorage();
    expect(store.get().enabled).toBe(true);
    expect(cb).not.toHaveBeenCalled();
  });

  it("no-op when storage is absent", () => {
    const store = createProactiveSettings();
    const cb = vi.fn();
    store.subscribe(cb);
    expect(() => store.reloadFromStorage()).not.toThrow();
    expect(cb).not.toHaveBeenCalled();
  });

  it("no-op when storage.load throws", () => {
    let throws = false;
    const storage: ProactiveStorage = {
      load: () => {
        if (throws) throw new Error("boom");
        return null;
      },
      save: vi.fn(),
    };
    const store = createProactiveSettings({ storage });
    const cb = vi.fn();
    store.subscribe(cb);
    throws = true;
    expect(() => store.reloadFromStorage()).not.toThrow();
    expect(cb).not.toHaveBeenCalled();
  });
});

describe("createProactiveSettings — subscribe/unsubscribe", () => {
  it("subscribe returns unsubscribe function that stops notifications", () => {
    const store = createProactiveSettings();
    const cb = vi.fn();
    const unsub = store.subscribe(cb);

    store.setEnabled(false);
    expect(cb).toHaveBeenCalledTimes(1);

    unsub();
    store.setEnabled(true);
    expect(cb).toHaveBeenCalledTimes(1); // no more
  });

  it("multiple subscribers are each notified independently", () => {
    const store = createProactiveSettings();
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    store.subscribe(cb1);
    store.subscribe(cb2);

    store.setEnabled(false);
    expect(cb1).toHaveBeenCalledTimes(1);
    expect(cb2).toHaveBeenCalledTimes(1);
  });
});

describe("createProactiveSettings — get() returns a copy", () => {
  it("mutating the returned object does not affect store state", () => {
    const store = createProactiveSettings();
    const s = store.get();
    (s as any).enabled = false;

    expect(store.get().enabled).toBe(true);
  });
});

describe("createProactiveSettings — dispose", () => {
  it("dispose clears all subscribers; subsequent mutations do not call them", () => {
    const store = createProactiveSettings();
    const cb = vi.fn();
    store.subscribe(cb);

    store.dispose();
    store.setEnabled(false);

    expect(cb).not.toHaveBeenCalled();
  });
});
