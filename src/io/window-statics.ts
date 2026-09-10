/**
 * Cached window geometry for the two global-cursor poll loops (cursor-tracker, hit-test).
 *
 * Every tick needs the OS cursor, but converting it to window-local CSS px also needs the
 * window origin and two scale factors — reads slow enough to skip on most ticks. They are
 * cached here and dropped on a window move/resize/DPI change, which a drag fires
 * continuously; the caller decides the refresh cadence and what to do with a stale cache.
 */

export interface Vec2 {
  x: number;
  y: number;
}

/** Unsubscribe handle returned by a Tauri event listener. */
export type Unlisten = () => void;

/** Ticks between outerPosition/scaleFactor/primaryScaleFactor re-reads. */
export const STATIC_REFRESH_TICKS = 8;

/** The window reads and events the cache needs (Tauri @tauri-apps/api/window). */
export interface WindowStaticsSource {
  cursorPosition(): Promise<Vec2>;
  outerPosition(): Promise<Vec2>;
  scaleFactor(): Promise<number>;
  /** Scale factor the cursor reading is expressed in — the primary monitor's. Falls back to scaleFactor(). */
  primaryScaleFactor?(): Promise<number>;
  /** Fires on window move/resize/DPI change — invalidates the cached statics. Non-Tauri: absent. */
  onMoved?(cb: () => void): Promise<Unlisten>;
  onResized?(cb: () => void): Promise<Unlisten>;
  onScaleChanged?(cb: () => void): Promise<Unlisten>;
}

export interface WindowStatics {
  /** Cached window origin in physical px. null while stale — a sample taken now is untrustworthy. */
  readonly origin: Vec2 | null;
  /** Cached scale factor of the monitor the window sits on. */
  readonly scale: number;
  /** Cached scale factor the cursor reading is expressed in. */
  readonly cursorScale: number;
  /** Read the cursor, re-reading and caching the statics in the same round-trip when `refresh`. */
  readCursor(w: WindowStaticsSource, refresh: boolean): Promise<Vec2>;
  /** Drop the cached statics — the next refreshing read re-reads them. */
  invalidate(): void;
  /** Invalidate on every window move/resize/scale-change the source reports. */
  subscribe(w: WindowStaticsSource): void;
  /** Release the window-event listeners. */
  unsubscribe(): void;
}

export function createWindowStatics(): WindowStatics {
  let origin: Vec2 | null = null;
  let scale = 1;
  let cursorScale = 1;
  // Window move/resize/scale-change unlisten handles — awaited (not blocking subscribe) so an
  // unsubscribe that lands before they resolve still releases them once they do.
  let unlistenMoved: Promise<Unlisten> | null = null;
  let unlistenResized: Promise<Unlisten> | null = null;
  let unlistenScaleChanged: Promise<Unlisten> | null = null;

  function invalidate(): void {
    origin = null;
  }

  return {
    get origin() {
      return origin;
    },
    get scale() {
      return scale;
    },
    get cursorScale() {
      return cursorScale;
    },
    readCursor(w, refresh) {
      if (!refresh) return w.cursorPosition();
      return Promise.all([
        w.cursorPosition(),
        w.outerPosition(),
        w.scaleFactor(),
        w.primaryScaleFactor?.(),
      ]).then(([cursor, nextOrigin, sf, cursorSf]) => {
        origin = nextOrigin;
        scale = sf;
        cursorScale = cursorSf ?? sf;
        return cursor;
      });
    },
    invalidate,
    subscribe(w) {
      unlistenMoved = w.onMoved?.(invalidate) ?? null;
      unlistenResized = w.onResized?.(invalidate) ?? null;
      unlistenScaleChanged = w.onScaleChanged?.(invalidate) ?? null;
    },
    unsubscribe() {
      unlistenMoved?.then((fn) => fn()).catch(() => {});
      unlistenResized?.then((fn) => fn()).catch(() => {});
      unlistenScaleChanged?.then((fn) => fn()).catch(() => {});
      unlistenMoved = null;
      unlistenResized = null;
      unlistenScaleChanged = null;
    },
  };
}
