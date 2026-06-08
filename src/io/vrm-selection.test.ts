/**
 * vrm-selection.test.ts — TDD red for the VRM selection reactive store (#94 P2).
 *
 * Pins the contract for src/io/vrm-selection.ts:
 *   createVrmSelection({ available?, defaultUrl, storage? }) store
 *   localStorageVrmStorage(key?) localStorage adapter
 *
 * The store owns *which VRM is selected*, persisted by AvatarOption.id (stable key,
 * NOT url). It does not perform the renderer swap — only holds + persists + resolves.
 */

import { describe, it, expect, vi } from "vitest";
import { createVrmSelection, localStorageVrmStorage } from "./vrm-selection";
import type { VrmSelectionStorage } from "./vrm-selection";
import type { AvatarOption } from "../config/load";

const SAMPLE: AvatarOption[] = [
  { id: "carlotta", label: "Carlotta", url: "/vrms/carlotta.vrm", source: "bundled" },
  { id: "miko", label: "Miko", url: "/vrms/miko.vrm", source: "bundled" },
  { id: "custom", label: "Custom", url: "file:///tmp/custom.vrm", source: "file" },
];

/** In-memory storage mirroring agent-settings' makeMemStorage helper. */
function makeMemStorage(): VrmSelectionStorage & { _data: string | null } {
  let data: string | null = null;
  return {
    get _data() {
      return data;
    },
    set _data(v: string | null) {
      data = v;
    },
    load() {
      return data;
    },
    save(id) {
      data = id;
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// list() — never empty
// ─────────────────────────────────────────────────────────────────────────────

describe("createVrmSelection — list", () => {
  it("returns the provided manifest verbatim", () => {
    const store = createVrmSelection({ available: SAMPLE, defaultUrl: "/vrms/carlotta.vrm" });
    expect(store.list()).toEqual(SAMPLE);
  });

  it("synthesizes a single option from defaultUrl when available is undefined", () => {
    const store = createVrmSelection({ defaultUrl: "/vrms/carlotta.vrm" });
    expect(store.list()).toEqual([
      { id: "carlotta", label: "Carlotta", url: "/vrms/carlotta.vrm", source: "bundled" },
    ]);
  });

  it("synthesizes a single option when available is an empty array", () => {
    const store = createVrmSelection({ available: [], defaultUrl: "/vrms/carlotta.vrm" });
    expect(store.list()).toEqual([
      { id: "carlotta", label: "Carlotta", url: "/vrms/carlotta.vrm", source: "bundled" },
    ]);
  });

  it("derives id/label from the url filename stem", () => {
    const store = createVrmSelection({ defaultUrl: "/models/AvatarSample_B.vrm" });
    const [opt] = store.list();
    expect(opt.id).toBe("AvatarSample_B");
    expect(opt.label).toBe("AvatarSample_B");
    expect(opt.url).toBe("/models/AvatarSample_B.vrm");
    expect(opt.source).toBe("bundled");
  });

  it("capitalizes a lowercase stem for the label", () => {
    const store = createVrmSelection({ defaultUrl: "https://cdn.example.com/path/miko.vrm" });
    const [opt] = store.list();
    expect(opt.id).toBe("miko");
    expect(opt.label).toBe("Miko");
  });

  it("list() returns a copy, not the internal reference", () => {
    const store = createVrmSelection({ available: SAMPLE, defaultUrl: "/vrms/carlotta.vrm" });
    expect(store.list()).not.toBe(store.list());
    expect(store.list()).toEqual(store.list());
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getActive() / getActiveId() — resolution priority
// ─────────────────────────────────────────────────────────────────────────────

describe("createVrmSelection — getActive resolution", () => {
  it("(1) persisted override wins when present in list", () => {
    const storage = makeMemStorage();
    storage._data = "miko";
    const store = createVrmSelection({ available: SAMPLE, defaultUrl: "/vrms/carlotta.vrm", storage });
    expect(store.getActive()).toEqual(SAMPLE[1]);
    expect(store.getActiveId()).toBe("miko");
  });

  it("(2) entry matching defaultUrl wins when no override", () => {
    const store = createVrmSelection({ available: SAMPLE, defaultUrl: "/vrms/miko.vrm" });
    expect(store.getActiveId()).toBe("miko");
  });

  it("(3) first entry wins when no override and defaultUrl matches nothing", () => {
    const store = createVrmSelection({ available: SAMPLE, defaultUrl: "/vrms/does-not-exist.vrm" });
    expect(store.getActiveId()).toBe("carlotta");
  });

  it("getActive() returns the synthesized option for a bare defaultUrl", () => {
    const store = createVrmSelection({ defaultUrl: "/vrms/carlotta.vrm" });
    expect(store.getActiveId()).toBe("carlotta");
  });

  it("getActive() returns a copy, not a manifest reference", () => {
    const store = createVrmSelection({ available: SAMPLE, defaultUrl: "/vrms/carlotta.vrm" });
    expect(store.getActive()).not.toBe(SAMPLE[0]);
    expect(store.getActive()).toEqual(SAMPLE[0]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// select()
// ─────────────────────────────────────────────────────────────────────────────

describe("createVrmSelection — select", () => {
  it("sets a known id as the override, persists, and notifies once", () => {
    const storage = makeMemStorage();
    const store = createVrmSelection({ available: SAMPLE, defaultUrl: "/vrms/carlotta.vrm", storage });
    const cb = vi.fn();
    store.subscribe(cb);

    store.select("miko");

    expect(store.getActiveId()).toBe("miko");
    expect(storage._data).toBe("miko");
    expect(cb).toHaveBeenCalledOnce();
    expect(cb).toHaveBeenCalledWith(SAMPLE[1]);
  });

  it("notifies with a fresh copy, not the manifest reference", () => {
    const store = createVrmSelection({ available: SAMPLE, defaultUrl: "/vrms/carlotta.vrm" });
    const cb = vi.fn();
    store.subscribe(cb);
    store.select("miko");
    expect(cb.mock.calls[0][0]).not.toBe(SAMPLE[1]);
    expect(cb.mock.calls[0][0]).toEqual(SAMPLE[1]);
  });

  it("selecting the already-active id is a no-op (no save, no notify)", () => {
    const storage = makeMemStorage();
    const store = createVrmSelection({ available: SAMPLE, defaultUrl: "/vrms/carlotta.vrm", storage });
    const saveSpy = vi.spyOn(storage, "save");
    const cb = vi.fn();
    store.subscribe(cb);

    // carlotta is already active via defaultUrl; selecting it must not churn.
    store.select("carlotta");

    expect(cb).not.toHaveBeenCalled();
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it("selecting an unknown id is a no-op — does not persist garbage", () => {
    const storage = makeMemStorage();
    const store = createVrmSelection({ available: SAMPLE, defaultUrl: "/vrms/carlotta.vrm", storage });
    const cb = vi.fn();
    store.subscribe(cb);

    store.select("ghost");

    expect(store.getActiveId()).toBe("carlotta");
    expect(storage._data).toBeNull();
    expect(cb).not.toHaveBeenCalled();
  });

  it("re-selecting after an override switches and notifies again", () => {
    const store = createVrmSelection({ available: SAMPLE, defaultUrl: "/vrms/carlotta.vrm" });
    const cb = vi.fn();
    store.subscribe(cb);
    store.select("miko");
    store.select("custom");
    expect(store.getActiveId()).toBe("custom");
    expect(cb).toHaveBeenCalledTimes(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// reset()
// ─────────────────────────────────────────────────────────────────────────────

describe("createVrmSelection — reset", () => {
  it("clears the override back to default resolution, persists cleared, notifies", () => {
    const storage = makeMemStorage();
    storage._data = "miko";
    const store = createVrmSelection({ available: SAMPLE, defaultUrl: "/vrms/carlotta.vrm", storage });
    const cb = vi.fn();
    store.subscribe(cb);

    store.reset();

    expect(store.getActiveId()).toBe("carlotta");
    expect(storage._data).toBeNull();
    expect(cb).toHaveBeenCalledOnce();
    expect(cb).toHaveBeenCalledWith(SAMPLE[0]);
  });

  it("reset with no override active is a no-op (no notify)", () => {
    const storage = makeMemStorage();
    const store = createVrmSelection({ available: SAMPLE, defaultUrl: "/vrms/carlotta.vrm", storage });
    const cb = vi.fn();
    store.subscribe(cb);
    store.reset();
    expect(cb).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// reloadFromStorage — cross-window sync
// ─────────────────────────────────────────────────────────────────────────────

describe("createVrmSelection — reloadFromStorage", () => {
  it("applies an externally-changed override and notifies", () => {
    const storage = makeMemStorage();
    const store = createVrmSelection({ available: SAMPLE, defaultUrl: "/vrms/carlotta.vrm", storage });
    const cb = vi.fn();
    store.subscribe(cb);

    // 다른 창이 storage를 직접 갱신한 상황을 모사
    storage._data = "miko";
    store.reloadFromStorage();

    expect(store.getActiveId()).toBe("miko");
    expect(cb).toHaveBeenCalledOnce();
    expect(cb).toHaveBeenCalledWith(SAMPLE[1]);
  });

  it("picks up an external reset (override cleared) and notifies", () => {
    const storage = makeMemStorage();
    storage._data = "miko";
    const store = createVrmSelection({ available: SAMPLE, defaultUrl: "/vrms/carlotta.vrm", storage });
    const cb = vi.fn();
    store.subscribe(cb);

    storage._data = null;
    store.reloadFromStorage();

    expect(store.getActiveId()).toBe("carlotta");
    expect(cb).toHaveBeenCalledOnce();
  });

  it("identical override on reload is a no-op (no notify)", () => {
    const storage = makeMemStorage();
    const store = createVrmSelection({ available: SAMPLE, defaultUrl: "/vrms/carlotta.vrm", storage });
    store.select("miko");
    const cb = vi.fn();
    store.subscribe(cb);
    store.reloadFromStorage();
    expect(cb).not.toHaveBeenCalled();
  });

  it("no-op when storage is absent", () => {
    const store = createVrmSelection({ available: SAMPLE, defaultUrl: "/vrms/carlotta.vrm" });
    const cb = vi.fn();
    store.subscribe(cb);
    expect(() => store.reloadFromStorage()).not.toThrow();
    expect(cb).not.toHaveBeenCalled();
  });

  it("no-op when storage.load throws", () => {
    let throws = false;
    const storage: VrmSelectionStorage = {
      load: () => {
        if (throws) throw new Error("boom");
        return null;
      },
      save: vi.fn(),
    };
    const store = createVrmSelection({ available: SAMPLE, defaultUrl: "/vrms/carlotta.vrm", storage });
    const cb = vi.fn();
    store.subscribe(cb);
    throws = true;
    expect(() => store.reloadFromStorage()).not.toThrow();
    expect(cb).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// stale / removed override + malformed storage
// ─────────────────────────────────────────────────────────────────────────────

describe("createVrmSelection — stale override + coercion", () => {
  it("a persisted id no longer in available falls back to default resolution", () => {
    const storage = makeMemStorage();
    storage._data = "custom"; // a previously-added source:"file" entry, now removed
    const reduced: AvatarOption[] = [SAMPLE[0], SAMPLE[1]];
    const store = createVrmSelection({ available: reduced, defaultUrl: "/vrms/carlotta.vrm", storage });
    expect(store.getActiveId()).toBe("carlotta");
  });

  it("a stale override does not resurface — selecting another id then resetting yields default", () => {
    const storage = makeMemStorage();
    storage._data = "ghost";
    const store = createVrmSelection({ available: SAMPLE, defaultUrl: "/vrms/carlotta.vrm", storage });
    // stale "ghost" is treated as no override → default resolution.
    expect(store.getActiveId()).toBe("carlotta");
    store.select("miko");
    store.reset();
    expect(store.getActiveId()).toBe("carlotta");
  });

  it("empty-string persisted value coerces to no override", () => {
    const storage = makeMemStorage();
    storage._data = "";
    const store = createVrmSelection({ available: SAMPLE, defaultUrl: "/vrms/miko.vrm", storage });
    expect(store.getActiveId()).toBe("miko"); // resolves via defaultUrl, not the empty override
  });

  it("non-string persisted junk coerces to no override without throwing", () => {
    const storage: VrmSelectionStorage = {
      load: () => ({ nope: true } as unknown as string | null),
      save: vi.fn(),
    };
    const store = createVrmSelection({ available: SAMPLE, defaultUrl: "/vrms/miko.vrm", storage });
    expect(() => store.getActive()).not.toThrow();
    expect(store.getActiveId()).toBe("miko");
  });

  it("storage.load() throwing on construction falls back to default resolution", () => {
    const storage: VrmSelectionStorage = {
      load: () => {
        throw new Error("boom");
      },
      save: vi.fn(),
    };
    const store = createVrmSelection({ available: SAMPLE, defaultUrl: "/vrms/carlotta.vrm", storage });
    expect(store.getActiveId()).toBe("carlotta");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// setManifest — config hot-reload (#94 P4)
// ─────────────────────────────────────────────────────────────────────────────

describe("createVrmSelection — setManifest", () => {
  it("replaces the manifest so list()/getActive() reflect the new options", () => {
    const store = createVrmSelection({ defaultUrl: "/vrms/carlotta.vrm" });
    expect(store.list()).toHaveLength(1);

    store.setManifest({ available: SAMPLE, defaultUrl: "/vrms/miko.vrm" });

    expect(store.list()).toEqual(SAMPLE);
    expect(store.getActiveId()).toBe("miko"); // new defaultUrl resolves
  });

  it("synthesizes a single option when the new manifest omits available", () => {
    const store = createVrmSelection({ available: SAMPLE, defaultUrl: "/vrms/carlotta.vrm" });

    store.setManifest({ defaultUrl: "/vrms/miko.vrm" });

    expect(store.list()).toEqual([
      { id: "miko", label: "Miko", url: "/vrms/miko.vrm", source: "bundled" },
    ]);
    expect(store.getActiveId()).toBe("miko");
  });

  it("preserves a user override across a manifest swap (override wins over new defaultUrl)", () => {
    const storage = makeMemStorage();
    const store = createVrmSelection({ available: SAMPLE, defaultUrl: "/vrms/carlotta.vrm", storage });
    store.select("miko");
    expect(store.getActiveId()).toBe("miko");

    // config edits vrm_url to "custom" — the user's pick must NOT be clobbered.
    store.setManifest({ available: SAMPLE, defaultUrl: "file:///tmp/custom.vrm" });

    expect(store.getActiveId()).toBe("miko");
    expect(storage._data).toBe("miko");
  });

  it("a preserved override absent from the new manifest falls back to default resolution", () => {
    const storage = makeMemStorage();
    const store = createVrmSelection({ available: SAMPLE, defaultUrl: "/vrms/carlotta.vrm", storage });
    store.select("custom");
    expect(store.getActiveId()).toBe("custom");

    // new manifest drops "custom" → fall through to the new defaultUrl entry.
    const reduced: AvatarOption[] = [SAMPLE[0], SAMPLE[1]];
    store.setManifest({ available: reduced, defaultUrl: "/vrms/miko.vrm" });

    expect(store.getActiveId()).toBe("miko");
  });

  it("notifies subscribers when the resolved active id changes", () => {
    const store = createVrmSelection({ available: SAMPLE, defaultUrl: "/vrms/carlotta.vrm" });
    const cb = vi.fn();
    store.subscribe(cb);

    store.setManifest({ available: SAMPLE, defaultUrl: "/vrms/miko.vrm" });

    expect(cb).toHaveBeenCalledOnce();
    expect(cb).toHaveBeenCalledWith(SAMPLE[1]);
  });

  it("does NOT notify when the resolved active id is unchanged", () => {
    const store = createVrmSelection({ available: SAMPLE, defaultUrl: "/vrms/carlotta.vrm" });
    const cb = vi.fn();
    store.subscribe(cb);

    // carlotta stays active (override absent, defaultUrl still resolves to carlotta).
    store.setManifest({ available: SAMPLE, defaultUrl: "/vrms/carlotta.vrm" });

    expect(cb).not.toHaveBeenCalled();
  });

  it("does NOT notify when a preserved override keeps the same active id", () => {
    const storage = makeMemStorage();
    const store = createVrmSelection({ available: SAMPLE, defaultUrl: "/vrms/carlotta.vrm", storage });
    store.select("miko");
    const cb = vi.fn();
    store.subscribe(cb);

    // override "miko" survives; new defaultUrl is irrelevant → no active-id change.
    store.setManifest({ available: SAMPLE, defaultUrl: "file:///tmp/custom.vrm" });

    expect(cb).not.toHaveBeenCalled();
    expect(store.getActiveId()).toBe("miko");
  });

  it("notifies when a stale override falls back to a different default after swap", () => {
    const storage = makeMemStorage();
    const store = createVrmSelection({ available: SAMPLE, defaultUrl: "/vrms/carlotta.vrm", storage });
    store.select("custom");
    const cb = vi.fn();
    store.subscribe(cb);

    // "custom" removed → falls to new defaultUrl "miko" (was "custom") → active changes.
    const reduced: AvatarOption[] = [SAMPLE[0], SAMPLE[1]];
    store.setManifest({ available: reduced, defaultUrl: "/vrms/miko.vrm" });

    expect(store.getActiveId()).toBe("miko");
    expect(cb).toHaveBeenCalledOnce();
    expect(cb).toHaveBeenCalledWith(SAMPLE[1]);
  });

  it("after setManifest, select() validates against the NEW manifest", () => {
    const store = createVrmSelection({ defaultUrl: "/vrms/carlotta.vrm" });
    store.setManifest({ available: SAMPLE, defaultUrl: "/vrms/carlotta.vrm" });
    store.select("custom"); // only valid because the new manifest contains it
    expect(store.getActiveId()).toBe("custom");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// subscribe / dispose
// ─────────────────────────────────────────────────────────────────────────────

describe("createVrmSelection — subscribe / dispose", () => {
  it("unsubscribe fn stops notifications", () => {
    const store = createVrmSelection({ available: SAMPLE, defaultUrl: "/vrms/carlotta.vrm" });
    const cb = vi.fn();
    const unsub = store.subscribe(cb);
    store.select("miko");
    unsub();
    store.select("custom");
    expect(cb).toHaveBeenCalledOnce();
  });

  it("dispose() clears all subscribers", () => {
    const store = createVrmSelection({ available: SAMPLE, defaultUrl: "/vrms/carlotta.vrm" });
    const cb = vi.fn();
    store.subscribe(cb);
    store.dispose();
    store.select("miko");
    expect(cb).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// localStorageVrmStorage
// ─────────────────────────────────────────────────────────────────────────────

describe("localStorageVrmStorage", () => {
  it("round-trips an id through stubbed globalThis.localStorage", () => {
    const fakeStore: Record<string, string> = {};
    (globalThis as any).localStorage = {
      getItem: (k: string) => fakeStore[k] ?? null,
      setItem: (k: string, v: string) => {
        fakeStore[k] = v;
      },
      removeItem: (k: string) => {
        delete fakeStore[k];
      },
    };

    const adapter = localStorageVrmStorage();
    adapter.save("miko");
    expect(adapter.load()).toBe("miko");

    delete (globalThis as any).localStorage;
  });

  it("save(null) clears the persisted override", () => {
    const fakeStore: Record<string, string> = {};
    (globalThis as any).localStorage = {
      getItem: (k: string) => fakeStore[k] ?? null,
      setItem: (k: string, v: string) => {
        fakeStore[k] = v;
      },
      removeItem: (k: string) => {
        delete fakeStore[k];
      },
    };

    const adapter = localStorageVrmStorage();
    adapter.save("miko");
    adapter.save(null);
    expect(adapter.load()).toBeNull();

    delete (globalThis as any).localStorage;
  });

  it("default key is 'yui.vrm'", () => {
    const written: Array<[string, string]> = [];
    (globalThis as any).localStorage = {
      getItem: () => null,
      setItem: (k: string, v: string) => written.push([k, v]),
      removeItem: () => {},
    };

    const adapter = localStorageVrmStorage();
    adapter.save("miko");
    expect(written[0][0]).toBe("yui.vrm");

    delete (globalThis as any).localStorage;
  });

  it("custom key is used when provided", () => {
    const written: Array<[string, string]> = [];
    (globalThis as any).localStorage = {
      getItem: () => null,
      setItem: (k: string, v: string) => written.push([k, v]),
      removeItem: () => {},
    };

    const adapter = localStorageVrmStorage("my.vrm.key");
    adapter.save("miko");
    expect(written[0][0]).toBe("my.vrm.key");

    delete (globalThis as any).localStorage;
  });

  it("gracefully returns null when localStorage is unavailable", () => {
    const saved = (globalThis as any).localStorage;
    delete (globalThis as any).localStorage;

    const adapter = localStorageVrmStorage();
    expect(() => adapter.load()).not.toThrow();
    expect(adapter.load()).toBeNull();
    expect(() => adapter.save("miko")).not.toThrow();
    expect(() => adapter.save(null)).not.toThrow();

    if (saved !== undefined) (globalThis as any).localStorage = saved;
  });
});
