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

  return {
    noteTurnStart() {
      clearOpenTimer();
      const interval = deps.getIntervalMs();
      if (interval <= 0) {
        anchor = undefined;
        return;
      }
      anchor = now();
      // The open edge is fixed to the interval read here: a knob change mid-hold reaches
      // isHolding() immediately, but this notification still lands at the old expiry.
      timer = setTimeout(() => {
        timer = null;
        anchor = undefined;
        notify(false);
      }, interval);
      notify(true);
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
