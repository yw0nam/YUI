/**
 * Quick start's key state once connected: whether the paste row is open, the stored key's last
 * check verdict, and whether a key was replaced. Pure: the page renders what `keyView` returns.
 */

export interface KeyState {
  /** The paste row is open in the connected state. */
  replacing: boolean;
  /** The stored key's last check; null before one answers. */
  verdict: "passed" | "refused" | null;
  /** A new key replaced the stored one. */
  replaced: boolean;
}

export const INITIAL_KEY_STATE: KeyState = { replacing: false, verdict: null, replaced: false };

/** Replace key or a focus request opens the paste row. */
export function openKey(state: KeyState): KeyState {
  return { ...state, replacing: true };
}

/** The stored key's check answered. An open paste row stays open: the user may be typing in it. */
export function keyChecked(state: KeyState, ok: boolean): KeyState {
  return {
    replacing: state.replacing || state.verdict === "refused",
    verdict: ok ? "passed" : "refused",
    replaced: state.replaced,
  };
}

/** A confirmed key was written: a replacement when already connected, else the first connect. */
export function keyWritten(wasConnected: boolean): KeyState {
  return { ...INITIAL_KEY_STATE, replaced: wasConnected };
}

/** What shows, given the state and whether Quick start is connected. */
export function keyView(state: KeyState, connected: boolean) {
  const refused = connected && state.verdict === "refused";
  return {
    keyRow: connected && !refused,
    replaceButton: !state.replacing,
    makeRow: !connected || refused,
    paste: !connected || state.replacing || refused,
    done: !refused,
    rejected: refused,
    keyOk: connected && state.replacing && state.verdict === "passed",
    doneText: state.replaced ? "start.key_replaced" : "start.done",
  };
}
