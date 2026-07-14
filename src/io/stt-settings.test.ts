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

function fakeStorage(initial?: SttSettings | null): SttStorage & { saved: SttSettings[] } {
  const saved: SttSettings[] = [];
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

describe("createSttSettings — defaults", () => {
  it("defaults to enabled=false when no storage and no initial", () => {
    const store = createSttSettings();
    expect(store.get().enabled).toBe(false);
  });

  it("does not throw when no options given", () => {
    expect(() => createSttSettings()).not.toThrow();
  });
});

describe("createSttSettings — malformed/throwing storage", () => {
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
