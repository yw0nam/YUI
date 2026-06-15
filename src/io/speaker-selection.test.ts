/**
 * speaker-selection.test.ts — irodori speaker selection store.
 *
 * Pins the contract for src/io/speaker-selection.ts:
 *   createSpeakerSelection({ available?, defaultId, storage? }) store
 *   localStorageSpeakerStorage(key?) localStorage adapter
 *
 * The store owns *which irodori speaker is active*, persisted by SpeakerOption.id.
 * Resolution is keyed by id (the configured irodori_speaker), NOT by ref_url.
 * It does not register voices — only holds + persists + resolves the active speaker.
 */

import { describe, expect, it, vi } from "vitest";
import type {
  SpeakerOption,
  SpeakerSelectionStorage,
  UserSpeakerStorage,
} from "./speaker-selection";
import {
  createSpeakerSelection,
  localStorageSpeakerStorage,
  localStorageUserSpeakerStorage,
} from "./speaker-selection";

const SAMPLE: SpeakerOption[] = [
  { id: "carlotta", label: "Carlotta", ref_url: "/references/carlotta.wav" },
  { id: "miko", label: "Miko", ref_url: "/references/miko.wav" },
  { id: "custom", label: "Custom", ref_url: "/references/custom.wav" },
];

/** In-memory storage mirroring vrm-selection's makeMemStorage helper. */
function makeMemStorage(): SpeakerSelectionStorage & { _data: string | null } {
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

describe("createSpeakerSelection — list", () => {
  it("returns the provided manifest verbatim", () => {
    const store = createSpeakerSelection({ available: SAMPLE, defaultId: "carlotta" });
    expect(store.list()).toEqual(SAMPLE);
  });

  it("synthesizes a single option from defaultId when available is undefined", () => {
    const store = createSpeakerSelection({ defaultId: "carlotta" });
    expect(store.list()).toEqual([{ id: "carlotta", label: "carlotta", ref_url: "" }]);
  });

  it("synthesizes a single option when available is an empty array", () => {
    const store = createSpeakerSelection({ available: [], defaultId: "carlotta" });
    expect(store.list()).toEqual([{ id: "carlotta", label: "carlotta", ref_url: "" }]);
  });

  it("list() returns a copy, not the internal reference", () => {
    const store = createSpeakerSelection({ available: SAMPLE, defaultId: "carlotta" });
    expect(store.list()).not.toBe(store.list());
    expect(store.list()).toEqual(store.list());
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getActive() / getActiveId() — resolution priority
// ─────────────────────────────────────────────────────────────────────────────

describe("createSpeakerSelection — getActive resolution", () => {
  it("(1) persisted override wins when present in list", () => {
    const storage = makeMemStorage();
    storage._data = "miko";
    const store = createSpeakerSelection({ available: SAMPLE, defaultId: "carlotta", storage });
    expect(store.getActive()).toEqual(SAMPLE[1]);
    expect(store.getActiveId()).toBe("miko");
  });

  it("(2) entry matching defaultId wins when no override", () => {
    const store = createSpeakerSelection({ available: SAMPLE, defaultId: "miko" });
    expect(store.getActiveId()).toBe("miko");
  });

  it("(3) first entry wins when no override and defaultId matches nothing", () => {
    const store = createSpeakerSelection({ available: SAMPLE, defaultId: "does-not-exist" });
    expect(store.getActiveId()).toBe("carlotta");
  });

  it("getActive() returns the synthesized option for a bare defaultId", () => {
    const store = createSpeakerSelection({ defaultId: "carlotta" });
    expect(store.getActiveId()).toBe("carlotta");
  });

  it("getActive() returns a copy, not a manifest reference", () => {
    const store = createSpeakerSelection({ available: SAMPLE, defaultId: "carlotta" });
    expect(store.getActive()).not.toBe(SAMPLE[0]);
    expect(store.getActive()).toEqual(SAMPLE[0]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// select()
// ─────────────────────────────────────────────────────────────────────────────

describe("createSpeakerSelection — select", () => {
  it("sets a known id as the override, persists, and notifies once", () => {
    const storage = makeMemStorage();
    const store = createSpeakerSelection({ available: SAMPLE, defaultId: "carlotta", storage });
    const cb = vi.fn();
    store.subscribe(cb);

    store.select("miko");

    expect(store.getActiveId()).toBe("miko");
    expect(storage._data).toBe("miko");
    expect(cb).toHaveBeenCalledOnce();
    expect(cb).toHaveBeenCalledWith(SAMPLE[1]);
  });

  it("notifies with a fresh copy, not the manifest reference", () => {
    const store = createSpeakerSelection({ available: SAMPLE, defaultId: "carlotta" });
    const cb = vi.fn();
    store.subscribe(cb);
    store.select("miko");
    expect(cb.mock.calls[0][0]).not.toBe(SAMPLE[1]);
    expect(cb.mock.calls[0][0]).toEqual(SAMPLE[1]);
  });

  it("selecting the already-active id is a no-op (no save, no notify)", () => {
    const storage = makeMemStorage();
    const store = createSpeakerSelection({ available: SAMPLE, defaultId: "carlotta", storage });
    const saveSpy = vi.spyOn(storage, "save");
    const cb = vi.fn();
    store.subscribe(cb);

    // carlotta is already active via defaultId; selecting it must not churn.
    store.select("carlotta");

    expect(cb).not.toHaveBeenCalled();
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it("selecting an unknown id is a no-op — does not persist garbage", () => {
    const storage = makeMemStorage();
    const store = createSpeakerSelection({ available: SAMPLE, defaultId: "carlotta", storage });
    const cb = vi.fn();
    store.subscribe(cb);

    store.select("ghost");

    expect(store.getActiveId()).toBe("carlotta");
    expect(storage._data).toBeNull();
    expect(cb).not.toHaveBeenCalled();
  });

  it("re-selecting after an override switches and notifies again", () => {
    const store = createSpeakerSelection({ available: SAMPLE, defaultId: "carlotta" });
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

describe("createSpeakerSelection — reset", () => {
  it("clears the override back to default resolution, persists cleared, notifies", () => {
    const storage = makeMemStorage();
    storage._data = "miko";
    const store = createSpeakerSelection({ available: SAMPLE, defaultId: "carlotta", storage });
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
    const store = createSpeakerSelection({ available: SAMPLE, defaultId: "carlotta", storage });
    const cb = vi.fn();
    store.subscribe(cb);
    store.reset();
    expect(cb).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// reloadFromStorage — cross-window sync
// ─────────────────────────────────────────────────────────────────────────────

describe("createSpeakerSelection — reloadFromStorage", () => {
  it("applies an externally-changed override and notifies", () => {
    const storage = makeMemStorage();
    const store = createSpeakerSelection({ available: SAMPLE, defaultId: "carlotta", storage });
    const cb = vi.fn();
    store.subscribe(cb);

    // simulate another window writing storage directly
    storage._data = "miko";
    store.reloadFromStorage();

    expect(store.getActiveId()).toBe("miko");
    expect(cb).toHaveBeenCalledOnce();
    expect(cb).toHaveBeenCalledWith(SAMPLE[1]);
  });

  it("picks up an external reset (override cleared) and notifies", () => {
    const storage = makeMemStorage();
    storage._data = "miko";
    const store = createSpeakerSelection({ available: SAMPLE, defaultId: "carlotta", storage });
    const cb = vi.fn();
    store.subscribe(cb);

    storage._data = null;
    store.reloadFromStorage();

    expect(store.getActiveId()).toBe("carlotta");
    expect(cb).toHaveBeenCalledOnce();
  });

  it("identical override on reload is a no-op (no notify)", () => {
    const storage = makeMemStorage();
    const store = createSpeakerSelection({ available: SAMPLE, defaultId: "carlotta", storage });
    store.select("miko");
    const cb = vi.fn();
    store.subscribe(cb);
    store.reloadFromStorage();
    expect(cb).not.toHaveBeenCalled();
  });

  it("no-op when storage is absent", () => {
    const store = createSpeakerSelection({ available: SAMPLE, defaultId: "carlotta" });
    const cb = vi.fn();
    store.subscribe(cb);
    expect(() => store.reloadFromStorage()).not.toThrow();
    expect(cb).not.toHaveBeenCalled();
  });

  it("no-op when storage.load throws", () => {
    let throws = false;
    const storage: SpeakerSelectionStorage = {
      load: () => {
        if (throws) throw new Error("boom");
        return null;
      },
      save: vi.fn(),
    };
    const store = createSpeakerSelection({ available: SAMPLE, defaultId: "carlotta", storage });
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

describe("createSpeakerSelection — stale override + coercion", () => {
  it("a persisted id no longer in available falls back to default resolution", () => {
    const storage = makeMemStorage();
    storage._data = "custom"; // a previously-selected entry, now removed
    const reduced: SpeakerOption[] = [SAMPLE[0], SAMPLE[1]];
    const store = createSpeakerSelection({ available: reduced, defaultId: "carlotta", storage });
    expect(store.getActiveId()).toBe("carlotta");
  });

  it("a stale override does not resurface — selecting another id then resetting yields default", () => {
    const storage = makeMemStorage();
    storage._data = "ghost";
    const store = createSpeakerSelection({ available: SAMPLE, defaultId: "carlotta", storage });
    // stale "ghost" is treated as no override → default resolution.
    expect(store.getActiveId()).toBe("carlotta");
    store.select("miko");
    store.reset();
    expect(store.getActiveId()).toBe("carlotta");
  });

  it("empty-string persisted value coerces to no override", () => {
    const storage = makeMemStorage();
    storage._data = "";
    const store = createSpeakerSelection({ available: SAMPLE, defaultId: "miko", storage });
    expect(store.getActiveId()).toBe("miko"); // resolves via defaultId, not the empty override
  });

  it("non-string persisted junk coerces to no override without throwing", () => {
    const storage: SpeakerSelectionStorage = {
      load: () => ({ nope: true }) as unknown as string | null,
      save: vi.fn(),
    };
    const store = createSpeakerSelection({ available: SAMPLE, defaultId: "miko", storage });
    expect(() => store.getActive()).not.toThrow();
    expect(store.getActiveId()).toBe("miko");
  });

  it("storage.load() throwing on construction falls back to default resolution", () => {
    const storage: SpeakerSelectionStorage = {
      load: () => {
        throw new Error("boom");
      },
      save: vi.fn(),
    };
    const store = createSpeakerSelection({ available: SAMPLE, defaultId: "carlotta", storage });
    expect(store.getActiveId()).toBe("carlotta");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// setManifest — config hot-reload
// ─────────────────────────────────────────────────────────────────────────────

describe("createSpeakerSelection — setManifest", () => {
  it("replaces the manifest so list()/getActive() reflect the new options", () => {
    const store = createSpeakerSelection({ defaultId: "carlotta" });
    expect(store.list()).toHaveLength(1);

    store.setManifest({ available: SAMPLE, defaultId: "miko" });

    expect(store.list()).toEqual(SAMPLE);
    expect(store.getActiveId()).toBe("miko"); // new defaultId resolves
  });

  it("synthesizes a single option when the new manifest omits available", () => {
    const store = createSpeakerSelection({ available: SAMPLE, defaultId: "carlotta" });

    store.setManifest({ defaultId: "miko" });

    expect(store.list()).toEqual([{ id: "miko", label: "miko", ref_url: "" }]);
    expect(store.getActiveId()).toBe("miko");
  });

  it("preserves a user override across a manifest swap (override wins over new defaultId)", () => {
    const storage = makeMemStorage();
    const store = createSpeakerSelection({ available: SAMPLE, defaultId: "carlotta", storage });
    store.select("miko");
    expect(store.getActiveId()).toBe("miko");

    // config edits irodori_speaker to "custom" — the user's pick must NOT be clobbered.
    store.setManifest({ available: SAMPLE, defaultId: "custom" });

    expect(store.getActiveId()).toBe("miko");
    expect(storage._data).toBe("miko");
  });

  it("a preserved override absent from the new manifest falls back to default resolution", () => {
    const storage = makeMemStorage();
    const store = createSpeakerSelection({ available: SAMPLE, defaultId: "carlotta", storage });
    store.select("custom");
    expect(store.getActiveId()).toBe("custom");

    // new manifest drops "custom" → fall through to the new defaultId entry.
    const reduced: SpeakerOption[] = [SAMPLE[0], SAMPLE[1]];
    store.setManifest({ available: reduced, defaultId: "miko" });

    expect(store.getActiveId()).toBe("miko");
  });

  it("notifies subscribers when the resolved active id changes", () => {
    const store = createSpeakerSelection({ available: SAMPLE, defaultId: "carlotta" });
    const cb = vi.fn();
    store.subscribe(cb);

    store.setManifest({ available: SAMPLE, defaultId: "miko" });

    expect(cb).toHaveBeenCalledOnce();
    expect(cb).toHaveBeenCalledWith(SAMPLE[1]);
  });

  it("does NOT notify when the resolved active id is unchanged", () => {
    const store = createSpeakerSelection({ available: SAMPLE, defaultId: "carlotta" });
    const cb = vi.fn();
    store.subscribe(cb);

    // carlotta stays active (override absent, defaultId still resolves to carlotta).
    store.setManifest({ available: SAMPLE, defaultId: "carlotta" });

    expect(cb).not.toHaveBeenCalled();
  });

  it("does NOT notify when a preserved override keeps the same active id", () => {
    const storage = makeMemStorage();
    const store = createSpeakerSelection({ available: SAMPLE, defaultId: "carlotta", storage });
    store.select("miko");
    const cb = vi.fn();
    store.subscribe(cb);

    // override "miko" survives; new defaultId is irrelevant → no active-id change.
    store.setManifest({ available: SAMPLE, defaultId: "custom" });

    expect(cb).not.toHaveBeenCalled();
    expect(store.getActiveId()).toBe("miko");
  });

  it("notifies when a stale override falls back to a different default after swap", () => {
    const storage = makeMemStorage();
    const store = createSpeakerSelection({ available: SAMPLE, defaultId: "carlotta", storage });
    store.select("custom");
    const cb = vi.fn();
    store.subscribe(cb);

    // "custom" removed → falls to new defaultId "miko" (was "custom") → active changes.
    const reduced: SpeakerOption[] = [SAMPLE[0], SAMPLE[1]];
    store.setManifest({ available: reduced, defaultId: "miko" });

    expect(store.getActiveId()).toBe("miko");
    expect(cb).toHaveBeenCalledOnce();
    expect(cb).toHaveBeenCalledWith(SAMPLE[1]);
  });

  it("after setManifest, select() validates against the NEW manifest", () => {
    const store = createSpeakerSelection({ defaultId: "carlotta" });
    store.setManifest({ available: SAMPLE, defaultId: "carlotta" });
    store.select("custom"); // only valid because the new manifest contains it
    expect(store.getActiveId()).toBe("custom");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// subscribe / dispose
// ─────────────────────────────────────────────────────────────────────────────

describe("createSpeakerSelection — subscribe / dispose", () => {
  it("unsubscribe fn stops notifications", () => {
    const store = createSpeakerSelection({ available: SAMPLE, defaultId: "carlotta" });
    const cb = vi.fn();
    const unsub = store.subscribe(cb);
    store.select("miko");
    unsub();
    store.select("custom");
    expect(cb).toHaveBeenCalledOnce();
  });

  it("dispose() clears all subscribers", () => {
    const store = createSpeakerSelection({ available: SAMPLE, defaultId: "carlotta" });
    const cb = vi.fn();
    store.subscribe(cb);
    store.dispose();
    store.select("miko");
    expect(cb).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// localStorageSpeakerStorage
// ─────────────────────────────────────────────────────────────────────────────

describe("localStorageSpeakerStorage", () => {
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

    const adapter = localStorageSpeakerStorage();
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

    const adapter = localStorageSpeakerStorage();
    adapter.save("miko");
    adapter.save(null);
    expect(adapter.load()).toBeNull();

    delete (globalThis as any).localStorage;
  });

  it("default key is 'yui.speaker'", () => {
    const written: Array<[string, string]> = [];
    (globalThis as any).localStorage = {
      getItem: () => null,
      setItem: (k: string, v: string) => written.push([k, v]),
      removeItem: () => {},
    };

    const adapter = localStorageSpeakerStorage();
    adapter.save("miko");
    expect(written[0][0]).toBe("yui.speaker");

    delete (globalThis as any).localStorage;
  });

  it("custom key is used when provided", () => {
    const written: Array<[string, string]> = [];
    (globalThis as any).localStorage = {
      getItem: () => null,
      setItem: (k: string, v: string) => written.push([k, v]),
      removeItem: () => {},
    };

    const adapter = localStorageSpeakerStorage("my.speaker.key");
    adapter.save("miko");
    expect(written[0][0]).toBe("my.speaker.key");

    delete (globalThis as any).localStorage;
  });

  it("gracefully returns null when localStorage is unavailable", () => {
    const saved = (globalThis as any).localStorage;
    delete (globalThis as any).localStorage;

    const adapter = localStorageSpeakerStorage();
    expect(() => adapter.load()).not.toThrow();
    expect(adapter.load()).toBeNull();
    expect(() => adapter.save("miko")).not.toThrow();
    expect(() => adapter.save(null)).not.toThrow();

    if (saved !== undefined) (globalThis as any).localStorage = saved;
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// User options — imported (source:"user") voices persist + merge with bundled
// ─────────────────────────────────────────────────────────────────────────────

const BUNDLED: SpeakerOption[] = [
  { id: "carlotta", label: "Carlotta", ref_url: "/references/carlotta.wav" },
  { id: "miko", label: "Miko", ref_url: "/references/miko.wav" },
];

const USER_CAT: SpeakerOption = {
  id: "Cat",
  label: "Cat",
  ref_url: "asset://localhost/app-data/references/Cat/clip.mp3",
  source: "user",
};

/** In-memory UserSpeakerStorage mirroring the VRM storage helper. */
function makeUserMemStorage(): UserSpeakerStorage & { _data: SpeakerOption[] } {
  let data: SpeakerOption[] = [];
  return {
    get _data() {
      return data;
    },
    set _data(v: SpeakerOption[]) {
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

describe("createSpeakerSelection — user options merge", () => {
  it("getOptions() returns bundled ∪ user", () => {
    const store = createSpeakerSelection({ available: BUNDLED, defaultId: "carlotta" });
    store.addUserVoice(USER_CAT);
    const ids = store.getOptions().map((o) => o.id);
    expect(ids).toEqual(["carlotta", "miko", "Cat"]);
  });

  it("list() also reflects user options (single source of truth)", () => {
    const store = createSpeakerSelection({ available: BUNDLED, defaultId: "carlotta" });
    store.addUserVoice(USER_CAT);
    expect(store.list().map((o) => o.id)).toContain("Cat");
  });

  it("addUserVoice persists the user list via userStorage", () => {
    const userStorage = makeUserMemStorage();
    const store = createSpeakerSelection({
      available: BUNDLED,
      defaultId: "carlotta",
      userStorage,
    });
    store.addUserVoice(USER_CAT);
    expect(userStorage._data).toEqual([USER_CAT]);
  });

  it("restores persisted user options on construction (survives reload)", () => {
    const userStorage = makeUserMemStorage();
    userStorage._data = [USER_CAT];
    const store = createSpeakerSelection({
      available: BUNDLED,
      defaultId: "carlotta",
      userStorage,
    });
    expect(store.getOptions().map((o) => o.id)).toContain("Cat");
  });

  it("a re-added user id updates in place (no duplicate)", () => {
    const store = createSpeakerSelection({ available: BUNDLED, defaultId: "carlotta" });
    store.addUserVoice(USER_CAT);
    store.addUserVoice({ ...USER_CAT, label: "Renamed", ref_url: "asset://localhost/new.mp3" });
    const cats = store.getOptions().filter((o) => o.id === "Cat");
    expect(cats).toHaveLength(1);
    expect(cats[0].ref_url).toBe("asset://localhost/new.mp3");
  });

  it("forces source:'user' on an added option regardless of input", () => {
    const store = createSpeakerSelection({ available: BUNDLED, defaultId: "carlotta" });
    store.addUserVoice({ ...USER_CAT, source: "bundled" });
    const cat = store.getOptions().find((o) => o.id === "Cat");
    expect(cat?.source).toBe("user");
  });

  it("a user option may be selected like a bundled one and persists the id", () => {
    const storage = makeMemStorage();
    const store = createSpeakerSelection({
      available: BUNDLED,
      defaultId: "carlotta",
      storage,
    });
    store.addUserVoice(USER_CAT);
    store.select("Cat");
    expect(store.getActiveId()).toBe("Cat");
    expect(storage._data).toBe("Cat");
  });

  it("a persisted user-option id resolves as the active override across reload", () => {
    const storage = makeMemStorage();
    const userStorage = makeUserMemStorage();
    userStorage._data = [USER_CAT];
    storage._data = "Cat";
    const store = createSpeakerSelection({
      available: BUNDLED,
      defaultId: "carlotta",
      storage,
      userStorage,
    });
    expect(store.getActiveId()).toBe("Cat");
  });
});

describe("createSpeakerSelection — removeUserVoice", () => {
  it("removes the option and persists the shrunken list", () => {
    const userStorage = makeUserMemStorage();
    const store = createSpeakerSelection({
      available: BUNDLED,
      defaultId: "carlotta",
      userStorage,
    });
    store.addUserVoice(USER_CAT);
    store.removeUserVoice("Cat");
    expect(store.getOptions().map((o) => o.id)).not.toContain("Cat");
    expect(userStorage._data).toEqual([]);
  });

  it("removing the currently-selected user option falls back to default + notifies", () => {
    const storage = makeMemStorage();
    const store = createSpeakerSelection({
      available: BUNDLED,
      defaultId: "carlotta",
      storage,
    });
    store.addUserVoice(USER_CAT);
    store.select("Cat");
    const cb = vi.fn();
    store.subscribe(cb);

    store.removeUserVoice("Cat");

    expect(store.getActiveId()).toBe("carlotta");
    expect(storage._data).toBeNull();
    expect(cb).toHaveBeenCalledOnce();
    expect(cb).toHaveBeenCalledWith(BUNDLED[0]);
  });

  it("removing a non-selected user option does not churn the active selection", () => {
    const store = createSpeakerSelection({ available: BUNDLED, defaultId: "carlotta" });
    store.addUserVoice(USER_CAT);
    const cb = vi.fn();
    store.subscribe(cb);
    store.removeUserVoice("Cat");
    expect(store.getActiveId()).toBe("carlotta");
    expect(cb).not.toHaveBeenCalled();
  });

  it("removing an unknown id is a no-op", () => {
    const userStorage = makeUserMemStorage();
    const store = createSpeakerSelection({
      available: BUNDLED,
      defaultId: "carlotta",
      userStorage,
    });
    store.addUserVoice(USER_CAT);
    store.removeUserVoice("ghost");
    expect(store.getOptions().map((o) => o.id)).toContain("Cat");
  });
});

describe("createSpeakerSelection — renameUserVoice", () => {
  it("renames a user voice, persists, and survives reload", () => {
    const userStorage = makeUserMemStorage();
    const store = createSpeakerSelection({
      available: BUNDLED,
      defaultId: "carlotta",
      userStorage,
    });
    store.addUserVoice(USER_CAT);
    store.renameUserVoice("Cat", "냥이");
    expect(store.getOptions().find((o) => o.id === "Cat")?.label).toBe("냥이");
    // persisted to storage
    expect(userStorage._data.find((o) => o.id === "Cat")?.label).toBe("냥이");

    // a fresh store over the same storage sees the renamed label
    const reloaded = createSpeakerSelection({
      available: BUNDLED,
      defaultId: "carlotta",
      userStorage,
    });
    expect(reloaded.getOptions().find((o) => o.id === "Cat")?.label).toBe("냥이");
  });

  it("notifies subscribers when the active user voice is renamed", () => {
    const store = createSpeakerSelection({ available: BUNDLED, defaultId: "carlotta" });
    store.addUserVoice(USER_CAT);
    store.select("Cat");
    const cb = vi.fn();
    store.subscribe(cb);
    store.renameUserVoice("Cat", "냥이");
    expect(cb).toHaveBeenCalledOnce();
    expect(cb.mock.calls[0][0].label).toBe("냥이");
  });

  it("does NOT notify when a non-active user voice is renamed", () => {
    const store = createSpeakerSelection({ available: BUNDLED, defaultId: "carlotta" });
    store.addUserVoice(USER_CAT);
    const cb = vi.fn();
    store.subscribe(cb);
    store.renameUserVoice("Cat", "냥이");
    expect(cb).not.toHaveBeenCalled();
  });

  it("renaming an unknown id is a no-op", () => {
    const userStorage = makeUserMemStorage();
    const store = createSpeakerSelection({
      available: BUNDLED,
      defaultId: "carlotta",
      userStorage,
    });
    store.addUserVoice(USER_CAT);
    store.renameUserVoice("ghost", "Nope");
    expect(store.getOptions().find((o) => o.id === "Cat")?.label).toBe("Cat");
    expect(userStorage._data).toEqual([USER_CAT]);
  });

  it("renaming a bundled id is a no-op (only user voices are renamable)", () => {
    const store = createSpeakerSelection({ available: BUNDLED, defaultId: "carlotta" });
    store.renameUserVoice("carlotta", "Hacked");
    expect(store.getOptions().find((o) => o.id === "carlotta")?.label).toBe("Carlotta");
  });

  it("rejects an empty / whitespace-only label (keeps the old one)", () => {
    const store = createSpeakerSelection({ available: BUNDLED, defaultId: "carlotta" });
    store.addUserVoice(USER_CAT);
    store.renameUserVoice("Cat", "   ");
    expect(store.getOptions().find((o) => o.id === "Cat")?.label).toBe("Cat");
    store.renameUserVoice("Cat", "");
    expect(store.getOptions().find((o) => o.id === "Cat")?.label).toBe("Cat");
  });
});

describe("createSpeakerSelection — user id never clobbers a bundled id", () => {
  it("addUserVoice with a bundled id is rejected (bundled wins)", () => {
    const store = createSpeakerSelection({ available: BUNDLED, defaultId: "carlotta" });
    store.addUserVoice({
      id: "carlotta",
      label: "Evil",
      ref_url: "asset://localhost/evil.mp3",
      source: "user",
    });
    const carlottas = store.getOptions().filter((o) => o.id === "carlotta");
    expect(carlottas).toHaveLength(1);
    expect(carlottas[0].source).toBeUndefined();
    expect(carlottas[0].ref_url).toBe("/references/carlotta.wav");
  });

  it("a persisted user option colliding with a bundled id is dropped on load", () => {
    const userStorage = makeUserMemStorage();
    userStorage._data = [
      { id: "miko", label: "Fake", ref_url: "asset://localhost/fake.mp3", source: "user" },
    ];
    const store = createSpeakerSelection({
      available: BUNDLED,
      defaultId: "carlotta",
      userStorage,
    });
    const mikos = store.getOptions().filter((o) => o.id === "miko");
    expect(mikos).toHaveLength(1);
    expect(mikos[0].ref_url).toBe("/references/miko.wav");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// localStorageUserSpeakerStorage
// ─────────────────────────────────────────────────────────────────────────────

describe("localStorageUserSpeakerStorage", () => {
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

    const adapter = localStorageUserSpeakerStorage();
    adapter.save([USER_CAT]);
    expect(adapter.load()).toEqual([USER_CAT]);

    delete (globalThis as any).localStorage;
  });

  it("default key is 'yui.speaker.user'", () => {
    const written: Array<[string, string]> = [];
    (globalThis as any).localStorage = {
      getItem: () => null,
      setItem: (k: string, v: string) => written.push([k, v]),
      removeItem: () => {},
    };

    const adapter = localStorageUserSpeakerStorage();
    adapter.save([USER_CAT]);
    expect(written[0][0]).toBe("yui.speaker.user");

    delete (globalThis as any).localStorage;
  });

  it("returns [] for malformed persisted JSON", () => {
    (globalThis as any).localStorage = {
      getItem: () => "{not json",
      setItem: () => {},
      removeItem: () => {},
    };
    const adapter = localStorageUserSpeakerStorage();
    expect(adapter.load()).toEqual([]);
    delete (globalThis as any).localStorage;
  });

  it("drops entries missing id or ref_url on load", () => {
    (globalThis as any).localStorage = {
      getItem: () => JSON.stringify([USER_CAT, { label: "no id", ref_url: "/x.mp3" }, { id: "x" }]),
      setItem: () => {},
      removeItem: () => {},
    };
    const adapter = localStorageUserSpeakerStorage();
    expect(adapter.load()).toEqual([USER_CAT]);
    delete (globalThis as any).localStorage;
  });

  it("gracefully returns [] when localStorage is unavailable", () => {
    const saved = (globalThis as any).localStorage;
    delete (globalThis as any).localStorage;
    const adapter = localStorageUserSpeakerStorage();
    expect(() => adapter.load()).not.toThrow();
    expect(adapter.load()).toEqual([]);
    expect(() => adapter.save([USER_CAT])).not.toThrow();
    if (saved !== undefined) (globalThis as any).localStorage = saved;
  });
});

describe("coerceUserSpeaker — id charset validation", () => {
  it("drops entries whose id contains a traversal or separator", () => {
    (globalThis as any).localStorage = {
      getItem: () =>
        JSON.stringify([
          USER_CAT,
          { id: "..", ref_url: "/x.mp3" },
          { id: "a/b", ref_url: "/x.mp3" },
          { id: "a\\b", ref_url: "/x.mp3" },
          { id: ".", ref_url: "/x.mp3" },
          { id: "a.b", ref_url: "/x.mp3" },
        ]),
      setItem: () => {},
      removeItem: () => {},
    };
    const adapter = localStorageUserSpeakerStorage();
    expect(adapter.load()).toEqual([USER_CAT]);
    delete (globalThis as any).localStorage;
  });

  it("drops an empty-id entry but keeps valid ids", () => {
    (globalThis as any).localStorage = {
      getItem: () => JSON.stringify([{ id: "", ref_url: "/x.mp3" }, USER_CAT]),
      setItem: () => {},
      removeItem: () => {},
    };
    const adapter = localStorageUserSpeakerStorage();
    expect(adapter.load()).toEqual([USER_CAT]);
    delete (globalThis as any).localStorage;
  });

  it("a crafted `..` id in user storage is dropped on store construction", () => {
    const userStorage = makeUserMemStorage();
    userStorage._data = [{ id: "..", label: "evil", ref_url: "/x.mp3", source: "user" }];
    const store = createSpeakerSelection({
      available: BUNDLED,
      defaultId: "carlotta",
      userStorage,
    });
    expect(store.getOptions().map((o) => o.id)).not.toContain("..");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// reloadFromStorage — cross-window user-options merge (no lost update)
// ─────────────────────────────────────────────────────────────────────────────

const USER_DOG: SpeakerOption = {
  id: "Dog",
  label: "Dog",
  ref_url: "asset://localhost/app-data/references/Dog/clip.mp3",
  source: "user",
};

describe("createSpeakerSelection — reloadFromStorage user-list merge", () => {
  it("union-merges an externally-added user voice into the in-memory list", () => {
    const storage = makeMemStorage();
    const userStorage = makeUserMemStorage();
    const a = createSpeakerSelection({
      available: BUNDLED,
      defaultId: "carlotta",
      storage,
      userStorage,
    });
    const b = createSpeakerSelection({
      available: BUNDLED,
      defaultId: "carlotta",
      storage,
      userStorage,
    });

    a.addUserVoice(USER_CAT);
    b.reloadFromStorage();
    b.addUserVoice(USER_DOG);

    expect(userStorage._data.map((o) => o.id).sort()).toEqual(["Cat", "Dog"]);
    expect(b.list().map((o) => o.id)).toContain("Cat");
    expect(b.list().map((o) => o.id)).toContain("Dog");
  });

  it("reloadFromStorage picks up a user voice added by another window", () => {
    const userStorage = makeUserMemStorage();
    const a = createSpeakerSelection({ available: BUNDLED, defaultId: "carlotta", userStorage });
    const b = createSpeakerSelection({ available: BUNDLED, defaultId: "carlotta", userStorage });

    a.addUserVoice(USER_CAT);
    expect(b.getOptions().map((o) => o.id)).not.toContain("Cat");

    b.reloadFromStorage();
    expect(b.getOptions().map((o) => o.id)).toContain("Cat");
  });

  it("merge dedupes by id and keeps the reloaded entry (no duplicates)", () => {
    const userStorage = makeUserMemStorage();
    const store = createSpeakerSelection({
      available: BUNDLED,
      defaultId: "carlotta",
      userStorage,
    });
    store.addUserVoice(USER_CAT);
    userStorage._data = [{ ...USER_CAT, label: "냥이" }];

    store.reloadFromStorage();

    const cats = store.getOptions().filter((o) => o.id === "Cat");
    expect(cats).toHaveLength(1);
  });

  it("a reloaded user entry colliding with a bundled id is dropped (bundled wins)", () => {
    const userStorage = makeUserMemStorage();
    const store = createSpeakerSelection({
      available: BUNDLED,
      defaultId: "carlotta",
      userStorage,
    });
    userStorage._data = [
      { id: "miko", label: "Fake", ref_url: "asset://localhost/fake.mp3", source: "user" },
    ];

    store.reloadFromStorage();

    const mikos = store.getOptions().filter((o) => o.id === "miko");
    expect(mikos).toHaveLength(1);
    expect(mikos[0].ref_url).toBe("/references/miko.wav");
  });

  it("notifies when an externally-added user voice becomes the resolved override", () => {
    const storage = makeMemStorage();
    const userStorage = makeUserMemStorage();
    const store = createSpeakerSelection({
      available: BUNDLED,
      defaultId: "carlotta",
      storage,
      userStorage,
    });
    const cb = vi.fn();
    store.subscribe(cb);

    userStorage._data = [USER_CAT];
    storage._data = "Cat";
    store.reloadFromStorage();

    expect(store.getActiveId()).toBe("Cat");
    expect(cb).toHaveBeenCalledOnce();
  });

  it("does NOT notify when the merged list leaves the active id unchanged", () => {
    const userStorage = makeUserMemStorage();
    const store = createSpeakerSelection({
      available: BUNDLED,
      defaultId: "carlotta",
      userStorage,
    });
    const cb = vi.fn();
    store.subscribe(cb);

    userStorage._data = [USER_CAT];
    store.reloadFromStorage();

    expect(store.getActiveId()).toBe("carlotta");
    expect(cb).not.toHaveBeenCalled();
  });

  it("is a no-op for the user list when userStorage is absent", () => {
    const storage = makeMemStorage();
    const store = createSpeakerSelection({ available: BUNDLED, defaultId: "carlotta", storage });
    expect(() => store.reloadFromStorage()).not.toThrow();
    expect(store.getOptions().map((o) => o.id)).toEqual(["carlotta", "miko"]);
  });

  it("survives a throwing userStorage.load without dropping existing user voices", () => {
    let throwOnLoad = false;
    const userStorage: UserSpeakerStorage = {
      load: () => {
        if (throwOnLoad) throw new Error("boom");
        return [];
      },
      save: vi.fn(),
    };
    const store = createSpeakerSelection({
      available: BUNDLED,
      defaultId: "carlotta",
      userStorage,
    });
    store.addUserVoice(USER_CAT);
    throwOnLoad = true;
    expect(() => store.reloadFromStorage()).not.toThrow();
    expect(store.getOptions().map((o) => o.id)).toContain("Cat");
  });
});
