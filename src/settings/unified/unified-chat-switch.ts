import { createFlagSettings, localStorageStore, type PersistedStorage } from "../persisted-store";

/** Whether main opens the unified chat window while two or more presets are open. Default OFF. Device-wide. */
export const createUnifiedChatSwitch = (
  storage: PersistedStorage<{ enabled: boolean }> = localStorageStore("yui.unified-chat"),
) => createFlagSettings(false, { storage });
