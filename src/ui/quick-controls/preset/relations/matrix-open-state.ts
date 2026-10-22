/** The matrix disclosure's open state, per window. */

import { presetIdForWindow } from "../../../../settings/preset/active-preset";
import { resolveStorageKey } from "../../../../settings/preset/preset-keys";

const OPEN_KEY = "yui.relations-matrix-open";

function key(): string {
  return resolveStorageKey(OPEN_KEY, presetIdForWindow());
}

export function readOpen(): boolean {
  try {
    return globalThis.localStorage?.getItem(key()) === "true";
  } catch {
    return false;
  }
}

export function writeOpen(open: boolean): void {
  try {
    globalThis.localStorage?.setItem(key(), String(open));
  } catch {
    // The state lives for this panel only.
  }
}
