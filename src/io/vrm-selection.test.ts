/**
 * vrm-selection.test.ts — VRM selection reactive store.
 *
 * Pins the contract for src/io/vrm-selection.ts:
 *   createVrmSelection({ available?, defaultUrl, storage? }) store
 *   localStorageVrmStorage(key?) localStorage adapter
 *
 * The store owns *which VRM is selected*, persisted by AvatarOption.id (stable key,
 * NOT url). It does not perform the renderer swap — only holds + persists + resolves.
 */

import { describe, expect, it, vi } from "vitest";
import type { AvatarOption } from "../config/load";
import type { UserVrmStorage, VrmSelectionStorage } from "./vrm-selection";
import {
  createVrmSelection,
  localStorageUserVrmStorage,
  localStorageVrmStorage,
} from "./vrm-selection";

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
    const store = createVrmSelection({
      available: SAMPLE,
      defaultUrl: "/vrms/carlotta.vrm",
      storage,
    });
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
    const store = createVrmSelection({
      available: SAMPLE,
      defaultUrl: "/vrms/carlotta.vrm",
      storage,
    });
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
    const store = createVrmSelection({
      available: SAMPLE,
      defaultUrl: "/vrms/carlotta.vrm",
      storage,
    });
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
    const store = createVrmSelection({
      available: SAMPLE,
      defaultUrl: "/vrms/carlotta.vrm",
      storage,
    });
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
    const store = createVrmSelection({
      available: SAMPLE,
      defaultUrl: "/vrms/carlotta.vrm",
      storage,
    });
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
    const store = createVrmSelection({
      available: SAMPLE,
      defaultUrl: "/vrms/carlotta.vrm",
      storage,
    });
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
    const store = createVrmSelection({
      available: SAMPLE,
      defaultUrl: "/vrms/carlotta.vrm",
      storage,
    });
    const cb = vi.fn();
    store.subscribe(cb);

    // Simulate other window directly updating storage
    storage._data = "miko";
    store.reloadFromStorage();

    expect(store.getActiveId()).toBe("miko");
    expect(cb).toHaveBeenCalledOnce();
    expect(cb).toHaveBeenCalledWith(SAMPLE[1]);
  });

  it("picks up an external reset (override cleared) and notifies", () => {
    const storage = makeMemStorage();
    storage._data = "miko";
    const store = createVrmSelection({
      available: SAMPLE,
      defaultUrl: "/vrms/carlotta.vrm",
      storage,
    });
    const cb = vi.fn();
    store.subscribe(cb);

    storage._data = null;
    store.reloadFromStorage();

    expect(store.getActiveId()).toBe("carlotta");
    expect(cb).toHaveBeenCalledOnce();
  });

  it("identical override on reload is a no-op (no notify)", () => {
    const storage = makeMemStorage();
    const store = createVrmSelection({
      available: SAMPLE,
      defaultUrl: "/vrms/carlotta.vrm",
      storage,
    });
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
    const store = createVrmSelection({
      available: SAMPLE,
      defaultUrl: "/vrms/carlotta.vrm",
      storage,
    });
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
    const store = createVrmSelection({
      available: reduced,
      defaultUrl: "/vrms/carlotta.vrm",
      storage,
    });
    expect(store.getActiveId()).toBe("carlotta");
  });

  it("a stale override does not resurface — selecting another id then resetting yields default", () => {
    const storage = makeMemStorage();
    storage._data = "ghost";
    const store = createVrmSelection({
      available: SAMPLE,
      defaultUrl: "/vrms/carlotta.vrm",
      storage,
    });
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
      load: () => ({ nope: true }) as unknown as string | null,
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
    const store = createVrmSelection({
      available: SAMPLE,
      defaultUrl: "/vrms/carlotta.vrm",
      storage,
    });
    expect(store.getActiveId()).toBe("carlotta");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// setManifest — config hot-reload
// ─────────────────────────────────────────────────────────────────────────────

describe("createVrmSelection — setManifest", () => {
  it("replaces the manifest so list()/getActive() reflect the new options", () => {
    const store = createVrmSelection({ defaultUrl: "/vrms/carlotta.vrm" });
    expect(store.list()).toHaveLength(1);

    store.setManifest({ available: SAMPLE, defaultValue: "/vrms/miko.vrm" });

    expect(store.list()).toEqual(SAMPLE);
    expect(store.getActiveId()).toBe("miko"); // new defaultUrl resolves
  });

  it("synthesizes a single option when the new manifest omits available", () => {
    const store = createVrmSelection({ available: SAMPLE, defaultUrl: "/vrms/carlotta.vrm" });

    store.setManifest({ defaultValue: "/vrms/miko.vrm" });

    expect(store.list()).toEqual([
      { id: "miko", label: "Miko", url: "/vrms/miko.vrm", source: "bundled" },
    ]);
    expect(store.getActiveId()).toBe("miko");
  });

  it("preserves a user override across a manifest swap (override wins over new defaultUrl)", () => {
    const storage = makeMemStorage();
    const store = createVrmSelection({
      available: SAMPLE,
      defaultUrl: "/vrms/carlotta.vrm",
      storage,
    });
    store.select("miko");
    expect(store.getActiveId()).toBe("miko");

    // config edits vrm_url to "custom" — the user's pick must NOT be clobbered.
    store.setManifest({ available: SAMPLE, defaultValue: "file:///tmp/custom.vrm" });

    expect(store.getActiveId()).toBe("miko");
    expect(storage._data).toBe("miko");
  });

  it("a preserved override absent from the new manifest falls back to default resolution", () => {
    const storage = makeMemStorage();
    const store = createVrmSelection({
      available: SAMPLE,
      defaultUrl: "/vrms/carlotta.vrm",
      storage,
    });
    store.select("custom");
    expect(store.getActiveId()).toBe("custom");

    // new manifest drops "custom" → fall through to the new defaultUrl entry.
    const reduced: AvatarOption[] = [SAMPLE[0], SAMPLE[1]];
    store.setManifest({ available: reduced, defaultValue: "/vrms/miko.vrm" });

    expect(store.getActiveId()).toBe("miko");
  });

  it("notifies subscribers when the resolved active id changes", () => {
    const store = createVrmSelection({ available: SAMPLE, defaultUrl: "/vrms/carlotta.vrm" });
    const cb = vi.fn();
    store.subscribe(cb);

    store.setManifest({ available: SAMPLE, defaultValue: "/vrms/miko.vrm" });

    expect(cb).toHaveBeenCalledOnce();
    expect(cb).toHaveBeenCalledWith(SAMPLE[1]);
  });

  it("does NOT notify when the resolved active id is unchanged", () => {
    const store = createVrmSelection({ available: SAMPLE, defaultUrl: "/vrms/carlotta.vrm" });
    const cb = vi.fn();
    store.subscribe(cb);

    // carlotta stays active (override absent, defaultUrl still resolves to carlotta).
    store.setManifest({ available: SAMPLE, defaultValue: "/vrms/carlotta.vrm" });

    expect(cb).not.toHaveBeenCalled();
  });

  it("does NOT notify when a preserved override keeps the same active id", () => {
    const storage = makeMemStorage();
    const store = createVrmSelection({
      available: SAMPLE,
      defaultUrl: "/vrms/carlotta.vrm",
      storage,
    });
    store.select("miko");
    const cb = vi.fn();
    store.subscribe(cb);

    // override "miko" survives; new defaultUrl is irrelevant → no active-id change.
    store.setManifest({ available: SAMPLE, defaultValue: "file:///tmp/custom.vrm" });

    expect(cb).not.toHaveBeenCalled();
    expect(store.getActiveId()).toBe("miko");
  });

  it("notifies when a stale override falls back to a different default after swap", () => {
    const storage = makeMemStorage();
    const store = createVrmSelection({
      available: SAMPLE,
      defaultUrl: "/vrms/carlotta.vrm",
      storage,
    });
    store.select("custom");
    const cb = vi.fn();
    store.subscribe(cb);

    // "custom" removed → falls to new defaultUrl "miko" (was "custom") → active changes.
    const reduced: AvatarOption[] = [SAMPLE[0], SAMPLE[1]];
    store.setManifest({ available: reduced, defaultValue: "/vrms/miko.vrm" });

    expect(store.getActiveId()).toBe("miko");
    expect(cb).toHaveBeenCalledOnce();
    expect(cb).toHaveBeenCalledWith(SAMPLE[1]);
  });

  it("after setManifest, select() validates against the NEW manifest", () => {
    const store = createVrmSelection({ defaultUrl: "/vrms/carlotta.vrm" });
    store.setManifest({ available: SAMPLE, defaultValue: "/vrms/carlotta.vrm" });
    store.select("custom"); // only valid because the new manifest contains it
    expect(store.getActiveId()).toBe("custom");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// boot-order regression — saved override arrives before the real manifest
// (config is injected asynchronously; storage.load() is synchronous at construction)
// ─────────────────────────────────────────────────────────────────────────────

describe("createVrmSelection — boot-order regression", () => {
  it("a saved override not yet in the creation-time manifest survives to setManifest()", () => {
    const storage = makeMemStorage();
    storage._data = "miko"; // saved id — but "miko" isn't in the manifest at construction time
    const store = createVrmSelection({
      defaultUrl: "/vrms/carlotta.vrm", // only a synthesized default exists at boot
      storage,
    });

    // The real config manifest arrives after construction (async injection).
    store.setManifest({ available: SAMPLE, defaultValue: "/vrms/carlotta.vrm" });

    expect(store.getActive().id).toBe("miko");
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

// ─────────────────────────────────────────────────────────────────────────────
// User options — imported (source:"user") VRMs persist + merge with bundled
// ─────────────────────────────────────────────────────────────────────────────

const BUNDLED: AvatarOption[] = [
  { id: "carlotta", label: "Carlotta", url: "/vrms/carlotta.vrm", source: "bundled" },
  { id: "miko", label: "Miko", url: "/vrms/miko.vrm", source: "bundled" },
];

const USER_CAT: AvatarOption = {
  id: "Cat",
  label: "Cat",
  url: "asset://localhost/app-data/vrms/Cat.vrm",
  source: "user",
};

/** In-memory user-options storage. */
function makeUserMemStorage(): UserVrmStorage & { _data: AvatarOption[] } {
  let data: AvatarOption[] = [];
  return {
    get _data() {
      return data;
    },
    set _data(v: AvatarOption[]) {
      data = v;
    },
    load() {
      return data.map((o) => ({ ...o }));
    },
    save(list) {
      data = list.map((o) => ({ ...o }));
    },
  };
}

describe("createVrmSelection — user options merge", () => {
  it("getOptions() returns bundled ∪ user", () => {
    const store = createVrmSelection({ available: BUNDLED, defaultUrl: "/vrms/carlotta.vrm" });
    store.addUserOption(USER_CAT);
    const ids = store.getOptions().map((o) => o.id);
    expect(ids).toEqual(["carlotta", "miko", "Cat"]);
  });

  it("list() also reflects user options (single source of truth)", () => {
    const store = createVrmSelection({ available: BUNDLED, defaultUrl: "/vrms/carlotta.vrm" });
    store.addUserOption(USER_CAT);
    expect(store.list().map((o) => o.id)).toContain("Cat");
  });

  it("addUserOption persists the user list via storage", () => {
    const userStorage = makeUserMemStorage();
    const store = createVrmSelection({
      available: BUNDLED,
      defaultUrl: "/vrms/carlotta.vrm",
      userStorage,
    });
    store.addUserOption(USER_CAT);
    expect(userStorage._data).toEqual([USER_CAT]);
  });

  it("restores persisted user options on construction (survives reload)", () => {
    const userStorage = makeUserMemStorage();
    userStorage._data = [USER_CAT];
    const store = createVrmSelection({
      available: BUNDLED,
      defaultUrl: "/vrms/carlotta.vrm",
      userStorage,
    });
    expect(store.getOptions().map((o) => o.id)).toContain("Cat");
  });

  it("a re-added user id updates in place (no duplicate)", () => {
    const store = createVrmSelection({ available: BUNDLED, defaultUrl: "/vrms/carlotta.vrm" });
    store.addUserOption(USER_CAT);
    store.addUserOption({ ...USER_CAT, label: "Renamed", url: "asset://localhost/new.vrm" });
    const cats = store.getOptions().filter((o) => o.id === "Cat");
    expect(cats).toHaveLength(1);
    expect(cats[0].url).toBe("asset://localhost/new.vrm");
  });

  it("forces source:'user' on an added option regardless of input", () => {
    const store = createVrmSelection({ available: BUNDLED, defaultUrl: "/vrms/carlotta.vrm" });
    store.addUserOption({ ...USER_CAT, source: "bundled" });
    const cat = store.getOptions().find((o) => o.id === "Cat");
    expect(cat?.source).toBe("user");
  });

  it("a user option may be selected like a bundled one and persists the id", () => {
    const storage = makeMemStorage();
    const store = createVrmSelection({
      available: BUNDLED,
      defaultUrl: "/vrms/carlotta.vrm",
      storage,
    });
    store.addUserOption(USER_CAT);
    store.select("Cat");
    expect(store.getActiveId()).toBe("Cat");
    expect(storage._data).toBe("Cat");
  });

  it("a persisted user-option id resolves as the active override across reload", () => {
    const storage = makeMemStorage();
    const userStorage = makeUserMemStorage();
    userStorage._data = [USER_CAT];
    storage._data = "Cat";
    const store = createVrmSelection({
      available: BUNDLED,
      defaultUrl: "/vrms/carlotta.vrm",
      storage,
      userStorage,
    });
    expect(store.getActiveId()).toBe("Cat");
  });
});

describe("createVrmSelection — removeUserOption", () => {
  it("removes the option and persists the shrunken list", () => {
    const userStorage = makeUserMemStorage();
    const store = createVrmSelection({
      available: BUNDLED,
      defaultUrl: "/vrms/carlotta.vrm",
      userStorage,
    });
    store.addUserOption(USER_CAT);
    store.removeUserOption("Cat");
    expect(store.getOptions().map((o) => o.id)).not.toContain("Cat");
    expect(userStorage._data).toEqual([]);
  });

  it("removing the currently-selected user option falls back to default + notifies", () => {
    const storage = makeMemStorage();
    const store = createVrmSelection({
      available: BUNDLED,
      defaultUrl: "/vrms/carlotta.vrm",
      storage,
    });
    store.addUserOption(USER_CAT);
    store.select("Cat");
    const cb = vi.fn();
    store.subscribe(cb);

    store.removeUserOption("Cat");

    expect(store.getActiveId()).toBe("carlotta");
    expect(storage._data).toBeNull();
    expect(cb).toHaveBeenCalledOnce();
    expect(cb).toHaveBeenCalledWith(BUNDLED[0]);
  });

  it("removing a non-selected user option does not churn the active selection", () => {
    const store = createVrmSelection({ available: BUNDLED, defaultUrl: "/vrms/carlotta.vrm" });
    store.addUserOption(USER_CAT);
    const cb = vi.fn();
    store.subscribe(cb);
    store.removeUserOption("Cat");
    expect(store.getActiveId()).toBe("carlotta");
    expect(cb).not.toHaveBeenCalled();
  });

  it("removing an unknown id is a no-op", () => {
    const userStorage = makeUserMemStorage();
    const store = createVrmSelection({
      available: BUNDLED,
      defaultUrl: "/vrms/carlotta.vrm",
      userStorage,
    });
    store.addUserOption(USER_CAT);
    store.removeUserOption("ghost");
    expect(store.getOptions().map((o) => o.id)).toContain("Cat");
  });
});

describe("createVrmSelection — renameUserOption", () => {
  it("renames a user option, persists, and survives reloadFromStorage", () => {
    const userStorage = makeUserMemStorage();
    const store = createVrmSelection({
      available: BUNDLED,
      defaultUrl: "/vrms/carlotta.vrm",
      userStorage,
    });
    store.addUserOption(USER_CAT);
    store.renameUserOption("Cat", "냥이");
    expect(store.getOptions().find((o) => o.id === "Cat")?.label).toBe("냥이");
    // persisted to storage
    expect(userStorage._data.find((o) => o.id === "Cat")?.label).toBe("냥이");

    // a fresh store over the same storage sees the renamed label
    const reloaded = createVrmSelection({
      available: BUNDLED,
      defaultUrl: "/vrms/carlotta.vrm",
      userStorage,
    });
    expect(reloaded.getOptions().find((o) => o.id === "Cat")?.label).toBe("냥이");
  });

  it("notifies subscribers when the active user option is renamed", () => {
    const store = createVrmSelection({ available: BUNDLED, defaultUrl: "/vrms/carlotta.vrm" });
    store.addUserOption(USER_CAT);
    store.select("Cat");
    const cb = vi.fn();
    store.subscribe(cb);
    store.renameUserOption("Cat", "냥이");
    expect(cb).toHaveBeenCalledOnce();
    expect(cb.mock.calls[0][0].label).toBe("냥이");
  });

  it("renaming an unknown id is a no-op", () => {
    const userStorage = makeUserMemStorage();
    const store = createVrmSelection({
      available: BUNDLED,
      defaultUrl: "/vrms/carlotta.vrm",
      userStorage,
    });
    store.addUserOption(USER_CAT);
    store.renameUserOption("ghost", "Nope");
    expect(store.getOptions().find((o) => o.id === "Cat")?.label).toBe("Cat");
    expect(userStorage._data).toEqual([USER_CAT]);
  });

  it("renaming a bundled id is a no-op (only user options are renamable)", () => {
    const store = createVrmSelection({ available: BUNDLED, defaultUrl: "/vrms/carlotta.vrm" });
    store.renameUserOption("carlotta", "Hacked");
    expect(store.getOptions().find((o) => o.id === "carlotta")?.label).toBe("Carlotta");
  });

  it("rejects an empty / whitespace-only label (keeps the old one)", () => {
    const store = createVrmSelection({ available: BUNDLED, defaultUrl: "/vrms/carlotta.vrm" });
    store.addUserOption(USER_CAT);
    store.renameUserOption("Cat", "   ");
    expect(store.getOptions().find((o) => o.id === "Cat")?.label).toBe("Cat");
    store.renameUserOption("Cat", "");
    expect(store.getOptions().find((o) => o.id === "Cat")?.label).toBe("Cat");
  });
});

describe("createVrmSelection — user id never clobbers a bundled id", () => {
  it("addUserOption with a bundled id is rejected (bundled wins)", () => {
    const store = createVrmSelection({ available: BUNDLED, defaultUrl: "/vrms/carlotta.vrm" });
    store.addUserOption({
      id: "carlotta",
      label: "Evil",
      url: "asset://localhost/evil.vrm",
      source: "user",
    });
    const carlottas = store.getOptions().filter((o) => o.id === "carlotta");
    expect(carlottas).toHaveLength(1);
    expect(carlottas[0].source).toBe("bundled");
    expect(carlottas[0].url).toBe("/vrms/carlotta.vrm");
  });

  it("a persisted user option colliding with a bundled id is dropped on load", () => {
    const userStorage = makeUserMemStorage();
    userStorage._data = [
      { id: "miko", label: "Fake", url: "asset://localhost/fake.vrm", source: "user" },
    ];
    const store = createVrmSelection({
      available: BUNDLED,
      defaultUrl: "/vrms/carlotta.vrm",
      userStorage,
    });
    const mikos = store.getOptions().filter((o) => o.id === "miko");
    expect(mikos).toHaveLength(1);
    expect(mikos[0].source).toBe("bundled");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// localStorageUserVrmStorage
// ─────────────────────────────────────────────────────────────────────────────

describe("localStorageUserVrmStorage", () => {
  it("round-trips a user-options list through stubbed localStorage", () => {
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

    const adapter = localStorageUserVrmStorage();
    adapter.save([USER_CAT]);
    expect(adapter.load()).toEqual([USER_CAT]);

    delete (globalThis as any).localStorage;
  });

  it("default key is 'yui.vrm.user'", () => {
    const written: Array<[string, string]> = [];
    (globalThis as any).localStorage = {
      getItem: () => null,
      setItem: (k: string, v: string) => written.push([k, v]),
      removeItem: () => {},
    };

    const adapter = localStorageUserVrmStorage();
    adapter.save([USER_CAT]);
    expect(written[0][0]).toBe("yui.vrm.user");

    delete (globalThis as any).localStorage;
  });

  it("returns [] for malformed persisted JSON", () => {
    (globalThis as any).localStorage = {
      getItem: () => "{not json",
      setItem: () => {},
      removeItem: () => {},
    };
    const adapter = localStorageUserVrmStorage();
    expect(adapter.load()).toEqual([]);
    delete (globalThis as any).localStorage;
  });

  it("drops malformed entries (missing id/url) on load", () => {
    (globalThis as any).localStorage = {
      getItem: () => JSON.stringify([USER_CAT, { label: "no id" }, { id: "x" }]),
      setItem: () => {},
      removeItem: () => {},
    };
    const adapter = localStorageUserVrmStorage();
    expect(adapter.load()).toEqual([USER_CAT]);
    delete (globalThis as any).localStorage;
  });

  it("gracefully returns [] when localStorage is unavailable", () => {
    const saved = (globalThis as any).localStorage;
    delete (globalThis as any).localStorage;
    const adapter = localStorageUserVrmStorage();
    expect(() => adapter.load()).not.toThrow();
    expect(adapter.load()).toEqual([]);
    expect(() => adapter.save([USER_CAT])).not.toThrow();
    if (saved !== undefined) (globalThis as any).localStorage = saved;
  });
});

describe("coerceUserOption — id charset validation", () => {
  it("drops entries whose id contains a traversal or separator", () => {
    (globalThis as any).localStorage = {
      getItem: () =>
        JSON.stringify([
          USER_CAT,
          { id: "..", url: "/x.vrm" },
          { id: "a/b", url: "/x.vrm" },
          { id: "a\\b", url: "/x.vrm" },
          { id: ".", url: "/x.vrm" },
          { id: ".hidden", url: "/x.vrm" },
        ]),
      setItem: () => {},
      removeItem: () => {},
    };
    const adapter = localStorageUserVrmStorage();
    expect(adapter.load()).toEqual([USER_CAT]);
    delete (globalThis as any).localStorage;
  });

  // The relaxed native sanitize_stem permits UTF-8 and interior dots — ids shaped like that
  // (not traversal/separator) must survive the reload, not be silently dropped.
  it("keeps entries whose id has an interior dot or is UTF-8 (relaxed sanitize_stem charset)", () => {
    (globalThis as any).localStorage = {
      getItem: () =>
        JSON.stringify([
          { id: "a.b", label: "a.b", url: "/x.vrm", source: "user" },
          { id: "ナツメ", label: "ナツメ", url: "/y.vrm", source: "user" },
        ]),
      setItem: () => {},
      removeItem: () => {},
    };
    const adapter = localStorageUserVrmStorage();
    expect(adapter.load().map((o) => o.id)).toEqual(["a.b", "ナツメ"]);
    delete (globalThis as any).localStorage;
  });

  it("drops an empty-id entry but keeps valid ids", () => {
    (globalThis as any).localStorage = {
      getItem: () => JSON.stringify([{ id: "", url: "/x.vrm" }, USER_CAT]),
      setItem: () => {},
      removeItem: () => {},
    };
    const adapter = localStorageUserVrmStorage();
    expect(adapter.load()).toEqual([USER_CAT]);
    delete (globalThis as any).localStorage;
  });

  it("a crafted `..` id in user storage is dropped on store construction", () => {
    const userStorage = makeUserMemStorage();
    userStorage._data = [{ id: "..", label: "evil", url: "/x.vrm", source: "user" }];
    const store = createVrmSelection({
      available: BUNDLED,
      defaultUrl: "/vrms/carlotta.vrm",
      userStorage,
    });
    expect(store.getOptions().map((o) => o.id)).not.toContain("..");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// reloadFromStorage — cross-window user-options merge (no lost update)
// ─────────────────────────────────────────────────────────────────────────────

const USER_DOG: AvatarOption = {
  id: "Dog",
  label: "Dog",
  url: "asset://localhost/app-data/vrms/Dog.vrm",
  source: "user",
};

describe("createVrmSelection — reloadFromStorage user-list merge", () => {
  it("union-merges an externally-added user option into the in-memory list", () => {
    const storage = makeMemStorage();
    const userStorage = makeUserMemStorage();
    // Two stores over one shared userStorage (two windows).
    const a = createVrmSelection({
      available: BUNDLED,
      defaultUrl: "/vrms/carlotta.vrm",
      storage,
      userStorage,
    });
    const b = createVrmSelection({
      available: BUNDLED,
      defaultUrl: "/vrms/carlotta.vrm",
      storage,
      userStorage,
    });

    // Window A imports Cat first → userStorage = [Cat].
    a.addUserOption(USER_CAT);
    // Window B (stale, in-memory []) reloads, then imports Dog.
    b.reloadFromStorage();
    b.addUserOption(USER_DOG);

    // No lost update: BOTH survive in persisted storage and B's list.
    expect(userStorage._data.map((o) => o.id).sort()).toEqual(["Cat", "Dog"]);
    expect(b.list().map((o) => o.id)).toContain("Cat");
    expect(b.list().map((o) => o.id)).toContain("Dog");
  });

  it("reloadFromStorage picks up a user option added by another window", () => {
    const userStorage = makeUserMemStorage();
    const a = createVrmSelection({
      available: BUNDLED,
      defaultUrl: "/vrms/carlotta.vrm",
      userStorage,
    });
    const b = createVrmSelection({
      available: BUNDLED,
      defaultUrl: "/vrms/carlotta.vrm",
      userStorage,
    });

    a.addUserOption(USER_CAT);
    expect(b.getOptions().map((o) => o.id)).not.toContain("Cat");

    b.reloadFromStorage();
    expect(b.getOptions().map((o) => o.id)).toContain("Cat");
  });

  it("merge dedupes by id and keeps the reloaded entry (no duplicates)", () => {
    const userStorage = makeUserMemStorage();
    const store = createVrmSelection({
      available: BUNDLED,
      defaultUrl: "/vrms/carlotta.vrm",
      userStorage,
    });
    store.addUserOption(USER_CAT);
    // Another window renamed Cat → reflected only in storage.
    userStorage._data = [{ ...USER_CAT, label: "냥이" }];

    store.reloadFromStorage();

    const cats = store.getOptions().filter((o) => o.id === "Cat");
    expect(cats).toHaveLength(1);
  });

  it("a reloaded user entry colliding with a bundled id is dropped (bundled wins)", () => {
    const userStorage = makeUserMemStorage();
    const store = createVrmSelection({
      available: BUNDLED,
      defaultUrl: "/vrms/carlotta.vrm",
      userStorage,
    });
    // Another window persisted a user entry shadowing a bundled id.
    userStorage._data = [
      { id: "miko", label: "Fake", url: "asset://localhost/fake.vrm", source: "user" },
    ];

    store.reloadFromStorage();

    const mikos = store.getOptions().filter((o) => o.id === "miko");
    expect(mikos).toHaveLength(1);
    expect(mikos[0].source).toBe("bundled");
  });

  it("notifies when an externally-added user option becomes the resolved override", () => {
    const storage = makeMemStorage();
    const userStorage = makeUserMemStorage();
    const store = createVrmSelection({
      available: BUNDLED,
      defaultUrl: "/vrms/carlotta.vrm",
      storage,
      userStorage,
    });
    const cb = vi.fn();
    store.subscribe(cb);

    // Another window added Cat AND selected it.
    userStorage._data = [USER_CAT];
    storage._data = "Cat";
    store.reloadFromStorage();

    expect(store.getActiveId()).toBe("Cat");
    expect(cb).toHaveBeenCalledOnce();
  });

  it("does NOT notify when the merged list leaves the active id unchanged", () => {
    const userStorage = makeUserMemStorage();
    const store = createVrmSelection({
      available: BUNDLED,
      defaultUrl: "/vrms/carlotta.vrm",
      userStorage,
    });
    const cb = vi.fn();
    store.subscribe(cb);

    // Merge a new user option but active stays carlotta (no override).
    userStorage._data = [USER_CAT];
    store.reloadFromStorage();

    expect(store.getActiveId()).toBe("carlotta");
    expect(cb).not.toHaveBeenCalled();
  });

  it("is a no-op for the user list when userStorage is absent", () => {
    const storage = makeMemStorage();
    const store = createVrmSelection({
      available: BUNDLED,
      defaultUrl: "/vrms/carlotta.vrm",
      storage,
    });
    expect(() => store.reloadFromStorage()).not.toThrow();
    expect(store.getOptions().map((o) => o.id)).toEqual(["carlotta", "miko"]);
  });

  it("survives a throwing userStorage.load without dropping existing user options", () => {
    let throwOnLoad = false;
    const userStorage: UserVrmStorage = {
      load: () => {
        if (throwOnLoad) throw new Error("boom");
        return [];
      },
      save: vi.fn(),
    };
    const store = createVrmSelection({
      available: BUNDLED,
      defaultUrl: "/vrms/carlotta.vrm",
      userStorage,
    });
    store.addUserOption(USER_CAT);
    throwOnLoad = true;
    expect(() => store.reloadFromStorage()).not.toThrow();
    expect(store.getOptions().map((o) => o.id)).toContain("Cat");
  });
});
