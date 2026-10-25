import { createFlagSettings, localStorageStore, type PersistedStorage } from "../persisted-store";

/** Whether relations run at all: the Relations section, the strip's relation line, the relation: line and rate_relation. Default ON. */
export const createRelationsSwitch = (
  storage: PersistedStorage<{ enabled: boolean }> = localStorageStore("yui.relations-enabled"),
) => createFlagSettings(true, { storage });
