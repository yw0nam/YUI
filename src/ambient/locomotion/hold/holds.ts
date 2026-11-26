/** Who holds her still, each with what its hold declares; she is held while any holder holds her. */

/** What a holder's hold declares when it takes her. */
export interface HoldOptions {
  /** Runs once when an agent move takes her, or a drag where `endsOnDrag`; the move waits for it. */
  onAbort?: (by: "agent" | "drag") => void | Promise<void>;
  /** A drag start ends this hold too. */
  endsOnDrag?: boolean;
  /** Her window geometry is the holder's while this hold lasts: Ctrl+wheel is ignored and no resize is saved. */
  keepsGeometry?: boolean;
  /** The keep-on-screen guard pauses while this hold lasts. */
  pausesKeepOnScreen?: boolean;
}

export function createHolds(deps: { pauseKeepOnScreen(paused: boolean): void }) {
  const holds = new Map<string, HoldOptions>();
  const releaseListeners = new Set<() => void>();
  let lettingGo: Promise<unknown> = Promise.resolve();
  const any = (key: "keepsGeometry" | "pausesKeepOnScreen"): boolean =>
    [...holds.values()].some((hold) => hold[key]);

  return {
    take(holder: string, opts: HoldOptions = {}): void {
      holds.set(holder, { ...opts });
      deps.pauseKeepOnScreen(any("pausesKeepOnScreen"));
    },
    release(holder: string): void {
      if (!holds.delete(holder)) return;
      deps.pauseKeepOnScreen(any("pausesKeepOnScreen"));
      for (const cb of releaseListeners) cb();
    },
    held: (): boolean => holds.size > 0,
    keepsGeometry: (): boolean => any("keepsGeometry"),
    /** Runs the abort of each hold an agent move, or a drag, ends, each only once; settles once all let go. */
    abort(by: "agent" | "drag"): Promise<unknown> {
      const ended = [...holds.values()].filter((hold) => by === "agent" || hold.endsOnDrag);
      const aborts = ended.map((hold) => hold.onAbort);
      for (const hold of ended) hold.onAbort = undefined;
      lettingGo = Promise.all(aborts.map((onAbort) => onAbort?.(by)));
      return lettingGo;
    },
    /** Settles once the holds the last abort ended have let go. */
    lettingGo: (): Promise<unknown> => lettingGo,
    /** Calls `cb` after each holder lets go of her; returns its disposer. */
    onReleased(cb: () => void): () => void {
      releaseListeners.add(cb);
      return () => releaseListeners.delete(cb);
    },
  };
}
