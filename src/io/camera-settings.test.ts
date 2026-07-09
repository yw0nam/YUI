/**
 * camera-settings.test.ts — camera zoom reactive store.
 *
 * Pins the contract for src/io/camera-settings.ts:
 *   CAMERA_ZOOM_MIN / MAX / DEFAULT constants
 *   createCameraSettings({ storage?, initial? }) store
 *   localStorageCameraStorage(key?) localStorage adapter
 *
 * Zoom multiplies the computed fit distance: zoom > 1 ⇒ bigger character.
 */

import { describe, expect, it, vi } from "vitest";
import {
  CAMERA_AZIMUTH_DEFAULT,
  CAMERA_POLAR_DEFAULT,
  CAMERA_POLAR_FREE_MAX,
  CAMERA_POLAR_FREE_MIN,
} from "../renderer/camera-fit";
import type { CameraSettings, CameraStorage } from "./camera-settings";
import {
  CAMERA_ZOOM_DEFAULT,
  CAMERA_ZOOM_MAX,
  CAMERA_ZOOM_MIN,
  createCameraSettings,
  localStorageCameraStorage,
} from "./camera-settings";

const DEG = Math.PI / 180;
/** Full default settings object — zoom + head-on orbit angles. */
const DEFAULTS: CameraSettings = {
  zoom: CAMERA_ZOOM_DEFAULT,
  azimuth: CAMERA_AZIMUTH_DEFAULT,
  polar: CAMERA_POLAR_DEFAULT,
};

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
    expect(cb).toHaveBeenCalledWith({ ...DEFAULTS, zoom: 2 });
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
    expect(saveSpy).toHaveBeenCalledWith({ ...DEFAULTS, zoom: 1.5 });
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
      load: () => ({ ...DEFAULTS, zoom: 99 }),
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
      load: () => ({ ...DEFAULTS, zoom: 1.5 }),
      save: vi.fn(),
    };
    const store = createCameraSettings({ storage, initial: { ...DEFAULTS, zoom: 2.5 } });
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
    storage._data = { ...DEFAULTS, zoom: 1.5 };
    store.reloadFromStorage();

    expect(store.get().zoom).toBe(1.5);
    expect(cb).toHaveBeenCalledOnce();
    expect(cb).toHaveBeenCalledWith({ ...DEFAULTS, zoom: 1.5 });
  });

  it("clamps an out-of-range stored value on reload", () => {
    const storage = makeMemStorage();
    const store = createCameraSettings({ storage });
    storage._data = { ...DEFAULTS, zoom: 99 };
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
    const store = createCameraSettings({ initial: { ...DEFAULTS, zoom: 2.5 } });
    expect(store.get().zoom).toBe(2.5);
  });

  it("uses initial.zoom when storage returns null", () => {
    const storage: CameraStorage = { load: () => null, save: vi.fn() };
    const store = createCameraSettings({ storage, initial: { ...DEFAULTS, zoom: 2.5 } });
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
    adapter.save({ ...DEFAULTS, zoom: 1.5 });
    const loaded = adapter.load();
    expect(loaded).toEqual({ ...DEFAULTS, zoom: 1.5 });

    delete (globalThis as any).localStorage;
  });

  it("default key is 'yui.camera'", () => {
    const written: Array<[string, string]> = [];
    (globalThis as any).localStorage = {
      getItem: () => null,
      setItem: (k: string, v: string) => written.push([k, v]),
    };

    const adapter = localStorageCameraStorage();
    adapter.save({ ...DEFAULTS, zoom: 1.0 });
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
    adapter.save({ ...DEFAULTS, zoom: 1.0 });
    expect(written[0][0]).toBe("my.key");

    delete (globalThis as any).localStorage;
  });

  it("gracefully returns null when localStorage is unavailable", () => {
    const saved = (globalThis as any).localStorage;
    delete (globalThis as any).localStorage;

    const adapter = localStorageCameraStorage();
    expect(() => adapter.load()).not.toThrow();
    expect(adapter.load()).toBeNull();
    expect(() => adapter.save({ ...DEFAULTS, zoom: 1.0 })).not.toThrow();

    if (saved !== undefined) (globalThis as any).localStorage = saved;
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createCameraSettings — orbit angles (azimuth + polar)
// azimuth is free (wrapped to (-π, π]); polar clamps to the free range [2°, 178°].
// ─────────────────────────────────────────────────────────────────────────────

describe("createCameraSettings — orbit defaults", () => {
  it("defaults to head-on angles (azimuth 0, polar 90°)", () => {
    const store = createCameraSettings();
    expect(store.get().azimuth).toBe(CAMERA_AZIMUTH_DEFAULT);
    expect(store.get().polar).toBeCloseTo(CAMERA_POLAR_DEFAULT, 12);
  });
});

describe("createCameraSettings — setAzimuth", () => {
  it("setAzimuth updates get().azimuth", () => {
    const store = createCameraSettings();
    store.setAzimuth(0.5);
    expect(store.get().azimuth).toBeCloseTo(0.5, 12);
  });

  it("azimuth is free — values inside (-π, π] pass unchanged", () => {
    const store = createCameraSettings();
    store.setAzimuth(2.5);
    expect(store.get().azimuth).toBeCloseTo(2.5, 12);
  });

  it("wraps azimuth beyond π into (-π, π] (same orientation)", () => {
    const store = createCameraSettings();
    // 3π/2 wraps to -π/2.
    store.setAzimuth((3 * Math.PI) / 2);
    expect(store.get().azimuth).toBeCloseTo(-Math.PI / 2, 12);
  });

  it("notifies and persists; keeps zoom + polar", () => {
    const storage = makeMemStorage();
    const saveSpy = vi.spyOn(storage, "save");
    const store = createCameraSettings({ storage });
    const cb = vi.fn();
    store.subscribe(cb);
    store.setAzimuth(0.5);
    expect(cb).toHaveBeenCalledOnce();
    expect(saveSpy).toHaveBeenCalledWith({ ...DEFAULTS, azimuth: 0.5 });
  });

  it("NaN azimuth is ignored — no change, no notify", () => {
    const store = createCameraSettings();
    const cb = vi.fn();
    store.subscribe(cb);
    store.setAzimuth(NaN);
    expect(store.get().azimuth).toBe(CAMERA_AZIMUTH_DEFAULT);
    expect(cb).not.toHaveBeenCalled();
  });

  it("dedup: identical azimuth does not notify twice", () => {
    const store = createCameraSettings();
    const cb = vi.fn();
    store.subscribe(cb);
    store.setAzimuth(0.5);
    store.setAzimuth(0.5);
    expect(cb).toHaveBeenCalledOnce();
  });
});

describe("createCameraSettings — setPolar", () => {
  it("setPolar updates get().polar inside the free range", () => {
    const store = createCameraSettings();
    store.setPolar(60 * DEG);
    expect(store.get().polar).toBeCloseTo(60 * DEG, 12);
  });

  it("clamps polar below the free floor up to the 2° pole-epsilon", () => {
    const store = createCameraSettings();
    store.setPolar(0.5 * DEG);
    expect(store.get().polar).toBeCloseTo(CAMERA_POLAR_FREE_MIN, 12);
  });

  it("clamps polar above the free ceiling down to the 178° pole-epsilon", () => {
    const store = createCameraSettings();
    store.setPolar(200 * DEG);
    expect(store.get().polar).toBeCloseTo(CAMERA_POLAR_FREE_MAX, 12);
  });

  it("near-overhead 5° passes unclamped (near-full free range)", () => {
    const store = createCameraSettings();
    store.setPolar(5 * DEG);
    expect(store.get().polar).toBeCloseTo(5 * DEG, 12);
  });

  it("NaN polar is ignored — no change, no notify", () => {
    const store = createCameraSettings();
    const cb = vi.fn();
    store.subscribe(cb);
    store.setPolar(NaN);
    expect(store.get().polar).toBeCloseTo(CAMERA_POLAR_DEFAULT, 12);
    expect(cb).not.toHaveBeenCalled();
  });
});

describe("createCameraSettings — resetOrbit", () => {
  it("restores head-on angles and keeps zoom", () => {
    const store = createCameraSettings();
    store.setZoom(2);
    store.setAzimuth(1.2);
    store.setPolar(40 * DEG);
    store.resetOrbit();
    expect(store.get().azimuth).toBe(CAMERA_AZIMUTH_DEFAULT);
    expect(store.get().polar).toBeCloseTo(CAMERA_POLAR_DEFAULT, 12);
    expect(store.get().zoom).toBe(2);
  });

  it("is a no-op (no notify) when already at default angles", () => {
    const store = createCameraSettings();
    const cb = vi.fn();
    store.subscribe(cb);
    store.resetOrbit();
    expect(cb).not.toHaveBeenCalled();
  });
});

describe("createCameraSettings — orbit persistence + round-trip", () => {
  it("a new store with the same storage loads persisted azimuth + polar", () => {
    const storage = makeMemStorage();
    const store1 = createCameraSettings({ storage });
    store1.setAzimuth(0.8);
    store1.setPolar(70 * DEG);

    const store2 = createCameraSettings({ storage });
    expect(store2.get().azimuth).toBeCloseTo(0.8, 12);
    expect(store2.get().polar).toBeCloseTo(70 * DEG, 12);
  });

  it("backward-compat: legacy stored {zoom} fills default orbit angles", () => {
    const storage: CameraStorage = {
      load: () => ({ zoom: 1.5 }) as unknown as CameraSettings,
      save: vi.fn(),
    };
    const store = createCameraSettings({ storage });
    expect(store.get().zoom).toBe(1.5);
    expect(store.get().azimuth).toBe(CAMERA_AZIMUTH_DEFAULT);
    expect(store.get().polar).toBeCloseTo(CAMERA_POLAR_DEFAULT, 12);
  });

  it("out-of-range stored polar is clamped on load", () => {
    const storage: CameraStorage = {
      load: () => ({ zoom: 1, azimuth: 0, polar: 300 * DEG }),
      save: vi.fn(),
    };
    const store = createCameraSettings({ storage });
    expect(store.get().polar).toBeCloseTo(CAMERA_POLAR_FREE_MAX, 12);
  });
});
