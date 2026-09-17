/**
 * proactive_pacer — the one quiet gap every proactive source shares.
 *
 * Any backend turn start (user or proactive, spoken or silent) anchors a window; while it is
 * open, proactive fires are held back. The sources that skip rather than queue — screen, loop
 * cues, schedule — consult `isHolding()` at their own gate; the two buffered-inbox sources
 * (signals, agent) take the window as busy and flush one catchup at the open edge. The
 * dispatcher enforces the same window at its routing gate as a backstop.
 *
 * An interval of 0 disables the pacer: nothing is ever held.
 */

export interface ProactivePacer {
  /** Anchor the window at the current time and (re)schedule its open edge. */
  noteTurnStart(): void;
  /**
   * Re-aim an open window at the edited interval: a longer gap moves the open edge out, and a
   * gap already shorter than the elapsed hold opens the window now.
   */
  noteIntervalChanged(): void;
  isHolding(): boolean;
  /** Called with true at each anchor and false when the window opens; returns an unsubscribe fn. */
  subscribe(cb: (holding: boolean) => void): () => void;
  stop(): void;
}

export function createProactivePacer(deps: {
  /** Read at each anchor and on every isHolding() call — a knob edit applies without a restart. */
  getIntervalMs: () => number;
  /** Injectable clock; defaults to Date.now. */
  now?: () => number;
}): ProactivePacer {
  const now = deps.now ?? Date.now;
  const subscribers = new Set<(holding: boolean) => void>();
  let anchor: number | undefined;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function clearOpenTimer(): void {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
  }

  function isHolding(): boolean {
    const interval = deps.getIntervalMs();
    if (interval <= 0 || anchor === undefined) return false;
    return now() - anchor < interval;
  }

  function notify(holding: boolean): void {
    for (const cb of subscribers) cb(holding);
  }

  /** Open the window now: drop any pending edge and tell subscribers, if one was held. */
  function openWindow(): void {
    clearOpenTimer();
    if (anchor === undefined) return;
    anchor = undefined;
    notify(false);
  }

  /** Arm the open edge at the current anchor + interval, replacing any pending one. */
  function scheduleOpen(): void {
    clearOpenTimer();
    if (anchor === undefined) return;
    const remaining = anchor + deps.getIntervalMs() - now();
    if (remaining <= 0) return;
    timer = setTimeout(() => {
      timer = null;
      // The interval may have grown since this timer was armed — the edge belongs to whatever
      // the window says now, not to the timer that happened to fire.
      if (isHolding()) {
        scheduleOpen();
        return;
      }
      openWindow();
    }, remaining);
  }

  return {
    noteTurnStart() {
      if (deps.getIntervalMs() <= 0) {
        openWindow();
        return;
      }
      anchor = now();
      scheduleOpen();
      notify(true);
    },
    noteIntervalChanged() {
      if (anchor === undefined) return;
      if (isHolding()) {
        scheduleOpen();
        return;
      }
      openWindow();
    },
    isHolding,
    subscribe(cb) {
      subscribers.add(cb);
      return () => {
        subscribers.delete(cb);
      };
    },
    stop() {
      clearOpenTimer();
      anchor = undefined;
      subscribers.clear();
    },
  };
}
