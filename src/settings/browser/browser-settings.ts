import { createFlagSettings, localStorageStore, type PersistedStorage } from "../persisted-store";

/** Whether the browser tool may drive the app's own Chrome. Default OFF. */
export const createBrowserSettings = (
  storage: PersistedStorage<{ enabled: boolean }> = localStorageStore("yui.browser"),
) => createFlagSettings(false, { storage });
