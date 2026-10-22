/** The matrix disclosure's open state, per window. */

const OPEN_KEY = "yui.relations-matrix-open";

export function readOpen(): boolean {
  try {
    return globalThis.localStorage?.getItem(OPEN_KEY) === "true";
  } catch {
    return false;
  }
}

export function writeOpen(open: boolean): void {
  try {
    globalThis.localStorage?.setItem(OPEN_KEY, String(open));
  } catch {
    // The state lives for this panel only.
  }
}
