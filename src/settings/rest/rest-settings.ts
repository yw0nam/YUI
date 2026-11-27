import type { PersistedStorage } from "../persisted-store";
import type { RestChoice } from "./rest-choices";

export interface RestRecord {
  choice?: RestChoice;
  startedAt?: number;
  endsAt?: number;
}

export function createRestSettings(_opts?: { storage?: PersistedStorage<RestRecord> }) {
  return {
    get: (_now?: number): (RestRecord & { choice: RestChoice }) | null => null,
    start: (_choice: RestChoice, _now?: number): void => {},
    end: (): void => {},
    reloadFromStorage: (): void => {},
    subscribe: (_cb: () => void) => () => {},
    dispose: (): void => {},
  };
}

export type RestSettingsStore = ReturnType<typeof createRestSettings>;
