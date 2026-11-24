/**
 * The registry as the settings window sees the preset it edits: the state of the last notify that
 * still lists that preset. Once the preset leaves, `onLeave` hands the window on, and the state stays
 * as it was until the window reloads.
 */

import type { PresetState } from "../../../settings/preset/active-preset";
import type { PresetRegistry } from "../../../settings/preset/preset-registry";

export interface EditedPreset {
  /** The preset the window edits. */
  shownId: string;
  get(): PresetState;
  subscribe(cb: () => void): () => void;
}

export function createEditedPreset(
  registry: Pick<PresetRegistry, "get" | "subscribe">,
  shownId: string,
  onLeave: (state: PresetState) => void,
): EditedPreset {
  let left = false;
  let state = registry.get();
  // Reads the registry; false once the preset has left.
  const read = (): boolean => {
    if (left) return false;
    const next = registry.get();
    if (!next.list.some((e) => e.id === shownId)) {
      left = true;
      onLeave(next);
      return false;
    }
    state = next;
    return true;
  };
  read();
  return {
    shownId,
    get: () => state,
    subscribe: (cb) =>
      registry.subscribe(() => {
        if (read()) cb();
      }),
  };
}
