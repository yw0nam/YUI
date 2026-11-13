/** thread-reaction-thresholds-settings — the waiting count and wait at which a Thread reaction starts without a chip tap. Device-wide. */

import type { PersistedStorage } from "../persisted-store";

export interface ThreadReactionThresholdsSettings {
  count: number;
  wait_min: number;
}
export type ThreadReactionThresholdsStorage = PersistedStorage<ThreadReactionThresholdsSettings>;

export function createThreadReactionThresholdsSettings(_opts?: {
  storage?: ThreadReactionThresholdsStorage;
}) {
  return {
    get: (): ThreadReactionThresholdsSettings => ({ count: 3, wait_min: 10 }),
    setCount(_count: number): void {},
    setWait(_wait_min: number): void {},
    reloadFromStorage(): void {},
    subscribe: (_cb: () => void) => () => {},
    dispose(): void {},
  };
}

export type ThreadReactionThresholdsSettingsStore = ReturnType<
  typeof createThreadReactionThresholdsSettings
>;
