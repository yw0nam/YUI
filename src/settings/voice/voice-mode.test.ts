import { describe, expect, it, vi } from "vitest";
import type { PersistedStorage } from "../persisted-store";
import { createVoiceMode, type VoiceMode } from "./voice-mode";

function memoryStorage(initial: unknown): PersistedStorage<{ mode: VoiceMode }> & {
  saved: unknown;
} {
  return {
    saved: undefined,
    load: () => initial as { mode: VoiceMode } | null,
    save(s) {
      this.saved = s;
    },
  };
}

describe("createVoiceMode", () => {
  it("defaults to tap", () => {
    expect(createVoiceMode({ storage: memoryStorage(null) }).get()).toEqual({ mode: "tap" });
  });

  it("restores a stored always mode", () => {
    expect(createVoiceMode({ storage: memoryStorage({ mode: "always" }) }).get().mode).toBe(
      "always",
    );
  });

  it.each([{ mode: "loud" }, { mode: 3 }, "always", []])("falls back to tap for %j", (stored) => {
    expect(createVoiceMode({ storage: memoryStorage(stored) }).get().mode).toBe("tap");
  });

  it("persists a change and notifies subscribers once", () => {
    const storage = memoryStorage(null);
    const store = createVoiceMode({ storage });
    const listener = vi.fn();
    store.subscribe(listener);

    store.set("always");
    store.set("always");

    expect(storage.saved).toEqual({ mode: "always" });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
