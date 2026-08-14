import { describe, expect, it, vi } from "vitest";
import {
  createExpressMotionSettings,
  type ExpressMotionSettings,
  type ExpressMotionStorage,
  enabledExpressMotions,
} from "./express-motion-settings";

const VOCAB = ["happy", "laugh", "calm", "dance"];

function memoryStorage(initial?: ExpressMotionSettings): ExpressMotionStorage {
  let value: ExpressMotionSettings | null = initial ? { ...initial } : null;
  return {
    load: () => (value ? { ...value } : null),
    save: (s) => {
      value = { ...s };
    },
  };
}

describe("enabledExpressMotions — read-side vocabulary derivation", () => {
  it("returns the whole vocabulary when nothing is disabled", () => {
    expect(enabledExpressMotions(VOCAB, { disabled: [] })).toEqual(VOCAB);
  });

  it("drops disabled ids and keeps vocabulary order", () => {
    expect(enabledExpressMotions(VOCAB, { disabled: ["laugh"] })).toEqual([
      "happy",
      "calm",
      "dance",
    ]);
  });

  it("allows an empty result — every motion may be turned off", () => {
    expect(enabledExpressMotions(VOCAB, { disabled: [...VOCAB] })).toEqual([]);
  });

  it("ignores disabled ids that are not in the vocabulary", () => {
    expect(enabledExpressMotions(VOCAB, { disabled: ["gone"] })).toEqual(VOCAB);
  });
});

describe("createExpressMotionSettings", () => {
  it("defaults to nothing disabled", () => {
    expect(createExpressMotionSettings().get()).toEqual({ disabled: [] });
  });

  it("setEnabled(id, false) persists the id as disabled", () => {
    const storage = memoryStorage();
    const store = createExpressMotionSettings({ storage });
    store.setEnabled("dance", false);
    expect(store.get().disabled).toEqual(["dance"]);
    expect(storage.load()).toEqual({ disabled: ["dance"] });
  });

  it("setEnabled(id, true) removes the id from disabled", () => {
    const store = createExpressMotionSettings({ storage: memoryStorage({ disabled: ["dance"] }) });
    store.setEnabled("dance", true);
    expect(store.get().disabled).toEqual([]);
  });

  it("does not duplicate an already-disabled id", () => {
    const store = createExpressMotionSettings();
    store.setEnabled("happy", false);
    store.setEnabled("happy", false);
    expect(store.get().disabled).toEqual(["happy"]);
  });

  it("setAllEnabled(ids, false) disables a whole group in one notification", () => {
    const store = createExpressMotionSettings();
    const seen = vi.fn();
    store.subscribe(seen);
    store.setAllEnabled(["happy", "laugh"], false);
    expect(store.get().disabled).toEqual(["happy", "laugh"]);
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it("setAllEnabled(ids, true) clears the group, leaving other ids disabled", () => {
    const store = createExpressMotionSettings({
      storage: memoryStorage({ disabled: ["happy", "laugh", "dance"] }),
    });
    store.setAllEnabled(["happy", "laugh"], true);
    expect(store.get().disabled).toEqual(["dance"]);
  });

  it("notifies subscribers on change", () => {
    const store = createExpressMotionSettings();
    const seen = vi.fn();
    store.subscribe(seen);
    store.setEnabled("happy", false);
    expect(seen).toHaveBeenCalledWith({ disabled: ["happy"] });
  });

  it("rejects a malformed stored value and falls back to the default", () => {
    const store = createExpressMotionSettings({
      storage: { load: () => ({ disabled: "nope" }) as never, save: () => {} },
    });
    expect(store.get()).toEqual({ disabled: [] });
  });

  it("dedupes a stored value that repeats an id", () => {
    const store = createExpressMotionSettings({
      storage: memoryStorage({ disabled: ["happy", "happy"] }),
    });
    expect(store.get().disabled).toEqual(["happy"]);
  });

  it("reloadFromStorage adopts a value another window wrote", () => {
    const storage = memoryStorage();
    const store = createExpressMotionSettings({ storage });
    storage.save({ disabled: ["calm"] });
    store.reloadFromStorage();
    expect(store.get().disabled).toEqual(["calm"]);
  });
});
