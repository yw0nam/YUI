import { describe, expect, it, vi } from "vitest";
import {
  type ContextSettingsStorage,
  createContextSettings,
  DEFAULT_CONTEXT_SETTINGS,
} from "./context-settings";

describe("context settings", () => {
  it("defaults every signal to enabled and persists partial changes", () => {
    const storage: ContextSettingsStorage = { load: () => null, save: vi.fn() };
    const store = createContextSettings({ storage });

    expect(store.get()).toEqual(DEFAULT_CONTEXT_SETTINGS);
    store.set({ send_window_title: false });

    expect(store.get()).toEqual({
      ...DEFAULT_CONTEXT_SETTINGS,
      send_window_title: false,
    });
    expect(storage.save).toHaveBeenCalledWith(store.get());
  });

  it("reloads valid cross-window changes", () => {
    let value = { ...DEFAULT_CONTEXT_SETTINGS };
    const storage: ContextSettingsStorage = {
      load: () => value,
      save: (next) => {
        value = next;
      },
    };
    const store = createContextSettings({ storage });
    value = { ...value, send_recent_apps: false };

    store.reloadFromStorage();

    expect(store.get().send_recent_apps).toBe(false);
  });
});
