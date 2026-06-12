/**
 * camera-settings.test.ts — TDD red for the camera zoom reactive store.
 *
 * Pins the contract for src/io/camera-settings.ts:
 *   CAMERA_ZOOM_MIN / MAX / DEFAULT constants
 *   createCameraSettings({ storage?, initial? }) store
 *   localStorageCameraStorage(key?) localStorage adapter
 *
 * Zoom multiplies the computed fit distance: zoom > 1 ⇒ bigger character.
 */

import { describe, expect, it, vi } from "vitest";
import type { CameraSettings, CameraStorage } from "./camera-settings";
import {
  CAMERA_ZOOM_DEFAULT,
  CAMERA_ZOOM_MAX,
  CAMERA_ZOOM_MIN,
  createCameraSettings,
  localStorageCameraStorage,
} from "./camera-settings";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

describe("camera-settings constants", () => {
  it("MIN is 0.5", () => {
    expect(CAMERA_ZOOM_MIN).toBe(0.5);
  });

  it("MAX is 3.0", () => {
    expect(CAMERA_ZOOM_MAX).toBe(3.0);
  });

  it("DEFAULT is 1.0", () => {
    expect(CAMERA_ZOOM_DEFAULT).toBe(1.0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createCameraSettings — defaults
// ─────────────────────────────────────────────────────────────────────────────

describe("createCameraSettings — defaults", () => {
  it("returns DEFAULT zoom when no storage or initial given", () => {
    const store = createCameraSettings();
    expect(store.get().zoom).toBe(CAMERA_ZOOM_DEFAULT);
  });

  it("get() returns a copy, not the internal reference", () => {
    const store = createCameraSettings();
    const a = store.get();
    const b = store.get();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createCameraSettings — setZoom + subscribers
// ─────────────────────────────────────────────────────────────────────────────

describe("createCameraSettings — setZoom", () => {
  it("setZoom(2) updates get().zoom to 2", () => {
    const store = createCameraSettings();
    store.setZoom(2);
    expect(store.get().zoom).toBe(2);
  });

  it("setZoom notifies subscribers with a fresh copy { zoom: 2 }", () => {
    const store = createCameraSettings();
    const cb = vi.fn();
    store.subscribe(cb);
    store.setZoom(2);
    expect(cb).toHaveBeenCalledOnce();
    expect(cb).toHaveBeenCalledWith({ zoom: 2 });
    // must be a copy, not the internal state reference
    expect(cb.mock.calls[0][0]).not.toBe(store.get());
  });

  it("clamps above MAX: setZoom(10) → 3.0", () => {
    const store = createCameraSettings();
    store.setZoom(10);
    expect(store.get().zoom).toBe(3.0);
  });

  it("clamps below MIN: setZoom(0.1) → 0.5", () => {
    const store = createCameraSettings();
    store.setZoom(0.1);
    expect(store.get().zoom).toBe(0.5);
  });

  it("clamps negative: setZoom(-5) → 0.5", () => {
    const store = createCameraSettings();
    store.setZoom(-5);
    expect(store.get().zoom).toBe(0.5);
  });

  it("NaN is ignored — zoom stays at DEFAULT and no notification", () => {
    const store = createCameraSettings();
    const cb = vi.fn();
    store.subscribe(cb);
    store.setZoom(NaN);
    expect(store.get().zoom).toBe(CAMERA_ZOOM_DEFAULT);
    expect(cb).not.toHaveBeenCalled();
  });

  it("Infinity is ignored — zoom stays at DEFAULT and no notification", () => {
    const store = createCameraSettings();
    const cb = vi.fn();
    store.subscribe(cb);
    store.setZoom(Infinity);
    expect(store.get().zoom).toBe(CAMERA_ZOOM_DEFAULT);
    expect(cb).not.toHaveBeenCalled();
  });

  it("dedup: second setZoom(2) after first does NOT notify again", () => {
    const store = createCameraSettings();
    const cb = vi.fn();
    store.subscribe(cb);
    store.setZoom(2);
    store.setZoom(2);
    expect(cb).toHaveBeenCalledOnce();
  });

  it("dedup: two clamped setZoom(10) calls both resolve to 3.0, second does NOT notify", () => {
    const store = createCameraSettings();
    const cb = vi.fn();
    store.subscribe(cb);
    store.setZoom(10);
    store.setZoom(10);
    expect(store.get().zoom).toBe(3.0);
    expect(cb).toHaveBeenCalledOnce();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createCameraSettings — subscribe / unsubscribe / dispose
// ─────────────────────────────────────────────────────────────────────────────

describe("createCameraSettings — subscribe / dispose", () => {
  it("unsubscribe fn stops notifications", () => {
    const store = createCameraSettings();
    const cb = vi.fn();
    const unsub = store.subscribe(cb);
    store.setZoom(2);
    unsub();
    store.setZoom(1.5);
    expect(cb).toHaveBeenCalledOnce();
  });

  it("dispose() clears all subscribers", () => {
    const store = createCameraSettings();
    const cb = vi.fn();
    store.subscribe(cb);
    store.dispose();
    store.setZoom(2);
    expect(cb).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createCameraSettings — storage persistence
// ─────────────────────────────────────────────────────────────────────────────

function makeMemStorage(): CameraStorage & { _data: CameraSettings | null } {
  let data: CameraSettings | null = null;
  return {
    get _data() {
      return data;
    },
    set _data(v: CameraSettings | null) {
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

describe("createCameraSettings — persistence", () => {
  it("setZoom calls storage.save with the new settings", () => {
    const storage = makeMemStorage();
    const saveSpy = vi.spyOn(storage, "save");
    const store = createCameraSettings({ storage });
    store.setZoom(1.5);
    expect(saveSpy).toHaveBeenCalledWith({ zoom: 1.5 });
  });

  it("a new store created with same storage loads the persisted zoom", () => {
    const storage = makeMemStorage();
    const store1 = createCameraSettings({ storage });
    store1.setZoom(1.5);

    const store2 = createCameraSettings({ storage });
    expect(store2.get().zoom).toBe(1.5);
  });

  it("stored value out of range is clamped on load: {zoom:99} → 3.0", () => {
    const storage: CameraStorage = {
      load: () => ({ zoom: 99 }),
      save: vi.fn(),
    };
    const store = createCameraSettings({ storage });
    expect(store.get().zoom).toBe(3.0);
  });

  it("stored invalid type {zoom:'x'} falls back to DEFAULT", () => {
    const storage: CameraStorage = {
      load: () => ({ zoom: "x" }) as unknown as CameraSettings,
      save: vi.fn(),
    };
    const store = createCameraSettings({ storage });
    expect(store.get().zoom).toBe(CAMERA_ZOOM_DEFAULT);
  });

  it("storage.load() returning null falls back to DEFAULT", () => {
    const storage: CameraStorage = {
      load: () => null,
      save: vi.fn(),
    };
    const store = createCameraSettings({ storage });
    expect(store.get().zoom).toBe(CAMERA_ZOOM_DEFAULT);
  });

  it("stored > initial: storage value takes priority over initial option", () => {
    const storage: CameraStorage = {
      load: () => ({ zoom: 1.5 }),
      save: vi.fn(),
    };
    const store = createCameraSettings({ storage, initial: { zoom: 2.5 } });
    expect(store.get().zoom).toBe(1.5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createCameraSettings — reloadFromStorage (cross-window sync)
// ─────────────────────────────────────────────────────────────────────────────

describe("createCameraSettings — reloadFromStorage", () => {
  it("applies an externally-changed stored value and notifies", () => {
    const storage = makeMemStorage();
    const store = createCameraSettings({ storage });
    const cb = vi.fn();
    store.subscribe(cb);

    // 다른 창이 storage를 직접 갱신한 상황을 모사
    storage._data = { zoom: 1.5 };
    store.reloadFromStorage();

    expect(store.get().zoom).toBe(1.5);
    expect(cb).toHaveBeenCalledOnce();
    expect(cb).toHaveBeenCalledWith({ zoom: 1.5 });
  });

  it("clamps an out-of-range stored value on reload", () => {
    const storage = makeMemStorage();
    const store = createCameraSettings({ storage });
    storage._data = { zoom: 99 };
    store.reloadFromStorage();
    expect(store.get().zoom).toBe(CAMERA_ZOOM_MAX);
  });

  it("identical value is a no-op (no notify)", () => {
    const storage = makeMemStorage();
    const store = createCameraSettings({ storage });
    store.setZoom(2);
    const cb = vi.fn();
    store.subscribe(cb);
    store.reloadFromStorage();
    expect(cb).not.toHaveBeenCalled();
  });

  it("ignores invalid stored value on reload (no notify)", () => {
    const storage = makeMemStorage();
    const store = createCameraSettings({ storage });
    const cb = vi.fn();
    store.subscribe(cb);
    storage._data = { zoom: "x" } as unknown as CameraSettings;
    store.reloadFromStorage();
    expect(store.get().zoom).toBe(CAMERA_ZOOM_DEFAULT);
    expect(cb).not.toHaveBeenCalled();
  });

  it("no-op when storage is absent", () => {
    const store = createCameraSettings();
    const cb = vi.fn();
    store.subscribe(cb);
    expect(() => store.reloadFromStorage()).not.toThrow();
    expect(cb).not.toHaveBeenCalled();
  });

  it("no-op when storage.load throws", () => {
    let throws = false;
    const storage: CameraStorage = {
      load: () => {
        if (throws) throw new Error("boom");
        return null;
      },
      save: vi.fn(),
    };
    const store = createCameraSettings({ storage });
    const cb = vi.fn();
    store.subscribe(cb);
    throws = true;
    expect(() => store.reloadFromStorage()).not.toThrow();
    expect(cb).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createCameraSettings — initial option
// ─────────────────────────────────────────────────────────────────────────────

describe("createCameraSettings — initial option", () => {
  it("uses initial.zoom when no storage is provided", () => {
    const store = createCameraSettings({ initial: { zoom: 2.5 } });
    expect(store.get().zoom).toBe(2.5);
  });

  it("uses initial.zoom when storage returns null", () => {
    const storage: CameraStorage = { load: () => null, save: vi.fn() };
    const store = createCameraSettings({ storage, initial: { zoom: 2.5 } });
    expect(store.get().zoom).toBe(2.5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// localStorageCameraStorage
// ─────────────────────────────────────────────────────────────────────────────

describe("localStorageCameraStorage", () => {
  it("round-trips through stubbed globalThis.localStorage", () => {
    const fakeStore: Record<string, string> = {};
    (globalThis as any).localStorage = {
      getItem: (k: string) => fakeStore[k] ?? null,
      setItem: (k: string, v: string) => {
        fakeStore[k] = v;
      },
    };

    const adapter = localStorageCameraStorage();
    adapter.save({ zoom: 1.5 });
    const loaded = adapter.load();
    expect(loaded).toEqual({ zoom: 1.5 });

    delete (globalThis as any).localStorage;
  });

  it("default key is 'yui.camera'", () => {
    const written: Array<[string, string]> = [];
    (globalThis as any).localStorage = {
      getItem: () => null,
      setItem: (k: string, v: string) => written.push([k, v]),
    };

    const adapter = localStorageCameraStorage();
    adapter.save({ zoom: 1.0 });
    expect(written[0][0]).toBe("yui.camera");

    delete (globalThis as any).localStorage;
  });

  it("custom key is used when provided", () => {
    const written: Array<[string, string]> = [];
    (globalThis as any).localStorage = {
      getItem: () => null,
      setItem: (k: string, v: string) => written.push([k, v]),
    };

    const adapter = localStorageCameraStorage("my.key");
    adapter.save({ zoom: 1.0 });
    expect(written[0][0]).toBe("my.key");

    delete (globalThis as any).localStorage;
  });

  it("gracefully returns null when localStorage is unavailable", () => {
    const saved = (globalThis as any).localStorage;
    delete (globalThis as any).localStorage;

    const adapter = localStorageCameraStorage();
    expect(() => adapter.load()).not.toThrow();
    expect(adapter.load()).toBeNull();
    expect(() => adapter.save({ zoom: 1.0 })).not.toThrow();

    if (saved !== undefined) (globalThis as any).localStorage = saved;
  });
});
