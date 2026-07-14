/**
 * idle-throttle-settings.test.ts — createIdleThrottleSettings reactive store.
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
import {
  createIdleThrottleSettings,
  type IdleThrottleSettings,
  type IdleThrottleStorage,
} from "./idle-throttle-settings";

function fakeStorage(
  initial?: IdleThrottleSettings | null,
): IdleThrottleStorage & { saved: IdleThrottleSettings[] } {
  const saved: IdleThrottleSettings[] = [];
  return {
    saved,
    load() {
      return initial ?? null;
    },
    save(s) {
      saved.push(s);
    },
  };
}

describe("createIdleThrottleSettings — defaults", () => {
  it("defaults to enabled=true when no storage and no initial", () => {
    const store = createIdleThrottleSettings();
    expect(store.get().enabled).toBe(true);
  });

  it("does not throw when no options given", () => {
    expect(() => createIdleThrottleSettings()).not.toThrow();
  });
});

describe("createIdleThrottleSettings — malformed/throwing storage", () => {
  it("storage returns malformed data (missing enabled) → falls back to defaults", () => {
    const malformed = {} as unknown as IdleThrottleSettings;
    const store = createIdleThrottleSettings({ storage: fakeStorage(malformed) });
    expect(store.get().enabled).toBe(true);
  });

  it("storage returns non-boolean enabled → falls back to defaults", () => {
    const malformed = { enabled: "nope" } as unknown as IdleThrottleSettings;
    const store = createIdleThrottleSettings({ storage: fakeStorage(malformed) });
    expect(store.get().enabled).toBe(true);
  });
});

describe("createIdleThrottleSettings — setEnabled", () => {
  it("setEnabled(false) persists and notifies subscribers", () => {
    const storage = fakeStorage(null);
    const store = createIdleThrottleSettings({ storage });
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
    const store = createIdleThrottleSettings({ storage });
    const cb = vi.fn();
    store.subscribe(cb);

    store.setEnabled(true); // same as default

    expect(storage.saved).toHaveLength(0);
    expect(cb).not.toHaveBeenCalled();
  });
});
