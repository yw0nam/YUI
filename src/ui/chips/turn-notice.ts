/**
 * The failed-turn notice the status pill carries when no input is open to show the failure: the
 * condition text and, for a keyed failure, its action. It clears itself so an unattended pill never
 * keeps taking OS clicks meant for what sits behind YUI.
 */

export interface TurnNoticeAction {
  label: string;
  onClick(): void;
}

export interface TurnNotice {
  message: string;
  action?: TurnNoticeAction;
}

export interface TurnNoticeStore {
  get(): TurnNotice | null;
  show(notice: TurnNotice): void;
  /** Drops the notice at once, as a new turn starts. */
  clear(): void;
  subscribe(listener: () => void): () => void;
  dispose(): void;
}

// An action needs time to be reached; a bare condition only to be read.
const ACTION_HOLD_MS = 60_000;
const TEXT_HOLD_MS = 3_000;

export function createTurnNotice(): TurnNoticeStore {
  let current: TurnNotice | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const listeners = new Set<() => void>();

  function stop(): void {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  function set(next: TurnNotice | null): void {
    current = next;
    for (const listener of listeners) listener();
  }

  return {
    get: () => current,
    show(notice) {
      stop();
      set(notice);
      timer = setTimeout(
        () => {
          timer = null;
          set(null);
        },
        notice.action ? ACTION_HOLD_MS : TEXT_HOLD_MS,
      );
    },
    clear() {
      stop();
      if (current !== null) set(null);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      stop();
      listeners.clear();
    },
  };
}
