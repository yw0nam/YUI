import { createFlagSettings, localStorageStore, type PersistedStorage } from "../persisted-store";

/** Whether main opens the unified chat window while two or more presets are open. Default OFF. Device-wide. */
export const createUnifiedChatSwitch = (
  storage: PersistedStorage<{ enabled: boolean }> = localStorageStore("yui.unified-chat"),
) => createFlagSettings(false, { storage });

/** Whether the unified chat window is shown: the switch on, two or more presets open, and a window can exist. */
export interface UnifiedShown {
  get(): boolean;
  /** Fires only when the value changes. */
  subscribe(cb: (shown: boolean) => void): () => void;
}
