/** What the relations section reads, each told to redraw only while the panel is open. */

import type { Logger } from "../../../../logger";
import type { FlagSettingsStore } from "../../../../settings/persisted-store";
import type { PresetEntry } from "../../../../settings/preset/active-preset";
import type { Relations, RelationsStore } from "../../../../settings/relations/relations-store";

type Subscribe = (cb: () => void) => () => void;

export interface RelationsPort {
  store: {
    current(): Readonly<Relations>;
    set: RelationsStore["set"];
    subscribe: Subscribe;
  };
  enabled: { current(): boolean; subscribe: Subscribe };
  /** This window's preset id. */
  self: string;
  presets: () => readonly PresetEntry[];
  log: Logger;
}

/** The stores and names the relations rows are built from. */
export interface RelationsDeps {
  store: RelationsStore;
  relationsSwitch: FlagSettingsStore;
  /** This window's preset id. */
  self: string;
  presets: () => readonly PresetEntry[];
}

export function createRelationsPort(
  deps: RelationsDeps & { isOpen: () => boolean; log: Logger },
): RelationsPort {
  const { store, relationsSwitch, isOpen } = deps;
  const whileOpen =
    (subscribe: Subscribe): Subscribe =>
    (cb) =>
      subscribe(() => {
        if (isOpen()) cb();
      });
  return {
    store: { current: store.current, set: store.set, subscribe: whileOpen(store.subscribe) },
    enabled: {
      current: () => relationsSwitch.current().enabled,
      subscribe: whileOpen(relationsSwitch.subscribe),
    },
    self: deps.self,
    presets: deps.presets,
    log: deps.log,
  };
}
