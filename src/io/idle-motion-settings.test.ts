import { describe, expect, it, vi } from "vitest";
import {
  createIdleMotionSettings,
  enabledIdleVariants,
  type IdleMotionSettings,
  type IdleMotionStorage,
} from "./idle-motion-settings";

const POOL = {
  vrma_path: "/motions/calm.vrma",
  variants: [
    "/motions/calm.vrma",
    "/motions/idle_01.vrma",
    "/motions/idle_04.vrma",
    "/motions/idle_12.vrma",
  ],
};

function memoryStorage(initial?: IdleMotionSettings): IdleMotionStorage {
  let value: IdleMotionSettings | null = initial ? { ...initial } : null;
  return {
    load: () => (value ? { ...value } : null),
    save: (s) => {
      value = { ...s };
    },
  };
}

describe("enabledIdleVariants — read-side pool derivation", () => {
  it("returns the whole catalog pool when nothing is disabled", () => {
    expect(enabledIdleVariants(POOL, { disabled: [] })).toEqual(POOL.variants);
  });

  it("drops disabled variants and keeps catalog order", () => {
    expect(enabledIdleVariants(POOL, { disabled: ["/motions/idle_04.vrma"] })).toEqual([
      "/motions/calm.vrma",
      "/motions/idle_01.vrma",
      "/motions/idle_12.vrma",
    ]);
  });

  it("clamps the baseline back on when storage claims it is disabled", () => {
    const enabled = enabledIdleVariants(POOL, { disabled: ["/motions/calm.vrma"] });
    expect(enabled).toContain("/motions/calm.vrma");
  });

  it("never returns an empty pool — the baseline survives disabling everything", () => {
    expect(enabledIdleVariants(POOL, { disabled: [...POOL.variants] })).toEqual([
      "/motions/calm.vrma",
    ]);
  });

  it("ignores disabled paths that are not in the catalog", () => {
    expect(enabledIdleVariants(POOL, { disabled: ["/motions/gone.vrma"] })).toEqual(POOL.variants);
  });

  it("falls back to the single baseline path for a pool with no variants", () => {
    expect(enabledIdleVariants({ vrma_path: "/motions/calm.vrma" }, { disabled: [] })).toEqual([
      "/motions/calm.vrma",
    ]);
  });
});

describe("createIdleMotionSettings", () => {
  it("defaults to nothing disabled", () => {
    expect(createIdleMotionSettings().get()).toEqual({ disabled: [] });
  });

  it("setEnabled(path, false) persists the path as disabled", () => {
    const storage = memoryStorage();
    const store = createIdleMotionSettings({ storage });
    store.setEnabled("/motions/idle_12.vrma", false);
    expect(store.get().disabled).toEqual(["/motions/idle_12.vrma"]);
    expect(storage.load()).toEqual({ disabled: ["/motions/idle_12.vrma"] });
  });

  it("setEnabled(path, true) removes the path from disabled", () => {
    const store = createIdleMotionSettings({
      storage: memoryStorage({ disabled: ["/motions/idle_12.vrma"] }),
    });
    store.setEnabled("/motions/idle_12.vrma", true);
    expect(store.get().disabled).toEqual([]);
  });

  it("does not duplicate an already-disabled path", () => {
    const store = createIdleMotionSettings();
    store.setEnabled("/motions/idle_01.vrma", false);
    store.setEnabled("/motions/idle_01.vrma", false);
    expect(store.get().disabled).toEqual(["/motions/idle_01.vrma"]);
  });

  it("notifies subscribers on change", () => {
    const store = createIdleMotionSettings();
    const seen = vi.fn();
    store.subscribe(seen);
    store.setEnabled("/motions/idle_01.vrma", false);
    expect(seen).toHaveBeenCalledWith({ disabled: ["/motions/idle_01.vrma"] });
  });

  it("rejects a malformed stored value and falls back to the default", () => {
    const store = createIdleMotionSettings({
      storage: { load: () => ({ disabled: "nope" }) as never, save: () => {} },
    });
    expect(store.get()).toEqual({ disabled: [] });
  });

  it("reloadFromStorage adopts a value another window wrote", () => {
    const storage = memoryStorage();
    const store = createIdleMotionSettings({ storage });
    storage.save({ disabled: ["/motions/idle_04.vrma"] });
    store.reloadFromStorage();
    expect(store.get().disabled).toEqual(["/motions/idle_04.vrma"]);
  });
});
