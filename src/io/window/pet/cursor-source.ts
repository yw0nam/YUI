/**
 * One OS-cursor poll for the pet window, shared by every subscriber (gaze, the click-through
 * hit-test). It runs while at least one subscriber exists and the document is visible, and
 * delivers window-local CSS px, or null while the cursor is unavailable.
 *
 * Tauri: a self-scheduled poll reads cursorPosition() every tick; the window origin and the two
 * scale factors are cached and re-read every STATIC_REFRESH_TICKS ticks, on a window
 * move/resize/scale-change event, and every tick while the window is moving. Three consecutive
 * read failures send null and back off to BACKOFF_MS until a read succeeds. Non-Tauri:
 * mousemove/mouseleave on the window (keeps Vite browser dev testable).
 */

import { cursorPosition, getCurrentWindow, primaryMonitor } from "@tauri-apps/api/window";
import { createLogger } from "../../../logger";
import { isMacOS, isTauri } from "../../../tauri-env";

const log = createLogger("cursor-source");

export interface Vec2 {
  x: number;
  y: number;
}

type Unlisten = () => void;
type CursorListener = (pos: Vec2 | null) => void;

/** Ticks between outerPosition/scaleFactor/primaryScaleFactor re-reads. */
const STATIC_REFRESH_TICKS = 8;
/** Poll cadence after FAILURE_THRESHOLD consecutive read failures, until one succeeds (ms). */
const BACKOFF_MS = 1000;
/** Consecutive read failures before reporting the cursor unavailable and backing off. */
const FAILURE_THRESHOLD = 3;

/** The window reads and events the poll needs (Tauri @tauri-apps/api/window). */
interface CursorWindow {
  cursorPosition(): Promise<Vec2>;
  outerPosition(): Promise<Vec2>;
  scaleFactor(): Promise<number>;
  /** Scale factor the cursor reading is expressed in, where it differs from the window's. Falls back to scaleFactor(). */
  primaryScaleFactor?(): Promise<number>;
  onMoved(cb: () => void): Promise<Unlisten>;
  onResized(cb: () => void): Promise<Unlisten>;
  onScaleChanged(cb: () => void): Promise<Unlisten>;
}

export interface CursorSource {
  /** Delivers every sample to `listener` until the returned function is called. */
  subscribe(listener: CursorListener): () => void;
  /** While the window is being moved by the client, re-read its origin every tick. */
  setMoving(moving: boolean): void;
}

interface CursorSourceOptions {
  /** Healthy poll cadence (ms), read before every tick. */
  getIntervalMs: () => number;
  /** Returns the live Tauri window. Default: the current Tauri window. */
  getWindow?: () => CursorWindow;
  /** setTimeout seam (testability). Default: globalThis.setTimeout. */
  schedule?: (cb: () => void, ms: number) => number;
  /** clearTimeout seam. Default: globalThis.clearTimeout. */
  cancel?: (handle: number) => void;
  /** EventTarget for mousemove in the non-Tauri path. Default: window. */
  moveTarget?: EventTarget;
  /** Document seam for visibility (stops polling while hidden). Default: document. */
  doc?: Document;
}

/** What the subscriber fan-out drives: the Tauri poll or the browser mouse feed. */
interface CursorFeed {
  start(): void;
  stop(): void;
  /** True while a new subscriber would wait for a sample that is not coming. */
  unavailable(): boolean;
  setMoving(moving: boolean): void;
}

/**
 * Convert a screen-global PHYSICAL cursor to window-local CSS/logical px.
 *
 * On macOS both readings describe the same screen-global point space, but each arrives scaled by
 * a different monitor's factor: the cursor by the primary monitor's, the window origin by the
 * factor of the monitor the window sits on. Dividing each by its own factor recovers the shared
 * space — `localLogical = cursorPhys / cursorScaleFactor − windowOuterPhys / scaleFactor`. Where
 * the two readings are one physical px space (Windows), or on a uniform-DPI setup, the factors
 * are equal and this reduces to the single-factor form, so cursorScaleFactor defaults to
 * scaleFactor. Either factor ≤ 0 falls back to 1 (never divide by zero).
 */
export function physicalCursorToLocalCss(
  cursorPhys: Vec2,
  windowOuterPhys: Vec2,
  scaleFactor: number,
  cursorScaleFactor: number = scaleFactor,
): Vec2 {
  const sf = scaleFactor > 0 ? scaleFactor : 1;
  const cf = cursorScaleFactor > 0 ? cursorScaleFactor : 1;
  // Equal factors subtract first — dividing each term separately loses precision on 1.5.
  if (cf === sf) {
    return {
      x: (cursorPhys.x - windowOuterPhys.x) / sf,
      y: (cursorPhys.y - windowOuterPhys.y) / sf,
    };
  }
  return {
    x: cursorPhys.x / cf - windowOuterPhys.x / sf,
    y: cursorPhys.y / cf - windowOuterPhys.y / sf,
  };
}

/**
 * The real Tauri window. macOS reports the cursor in points scaled by the primary monitor's
 * factor; elsewhere the cursor and the window origin are one physical px space, so the window's
 * own factor converts both.
 */
function createTauriCursorWindow(): CursorWindow {
  const w = getCurrentWindow();
  return {
    cursorPosition: () => cursorPosition(),
    outerPosition: () => w.outerPosition(),
    scaleFactor: () => w.scaleFactor(),
    ...(isMacOS() && {
      primaryScaleFactor: async () =>
        (await primaryMonitor())?.scaleFactor ?? (await w.scaleFactor()),
    }),
    onMoved: (cb) => w.onMoved(() => cb()),
    onResized: (cb) => w.onResized(() => cb()),
    onScaleChanged: (cb) => w.onScaleChanged(() => cb()),
  };
}

function createMouseFeed(moveTarget: EventTarget, emit: CursorListener): CursorFeed {
  const onMove = (e: Event): void => {
    const me = e as MouseEvent;
    emit({ x: me.clientX, y: me.clientY });
  };
  const onLeave = (): void => emit(null);
  return {
    start() {
      moveTarget.addEventListener("mousemove", onMove);
      moveTarget.addEventListener("mouseleave", onLeave);
    },
    stop() {
      moveTarget.removeEventListener("mousemove", onMove);
      moveTarget.removeEventListener("mouseleave", onLeave);
    },
    unavailable: () => false,
    setMoving() {},
  };
}

function createPollFeed(opts: CursorSourceOptions, emit: CursorListener): CursorFeed {
  const getWindow = opts.getWindow ?? createTauriCursorWindow;
  const schedule =
    opts.schedule ?? ((cb, ms) => globalThis.setTimeout(cb, ms) as unknown as number);
  const cancel = opts.cancel ?? ((h) => globalThis.clearTimeout(h));
  const doc = opts.doc ?? document;
  const isHidden = (): boolean => doc.visibilityState === "hidden";

  let win: CursorWindow | null = null;
  // Bumped on stop: a read that resolves into a later generation is dropped.
  let generation = 0;
  let pollHandle: number | null = null;
  let failureCount = 0;
  let backoff = false;
  let tick = 0;
  let moving = false;
  let origin: Vec2 | null = null;
  let scale = 1;
  let cursorScale = 1;
  // Bumped on every invalidation: a read that saw it change mid-flight is stale.
  let staticsEpoch = 0;
  let unlistens: Promise<Unlisten>[] = [];

  function invalidate(): void {
    origin = null;
    staticsEpoch++;
  }

  function stopPoll(): void {
    if (pollHandle !== null) {
      cancel(pollHandle);
      pollHandle = null;
    }
  }

  function scheduleNextPoll(): void {
    stopPoll();
    pollHandle = schedule(
      () => {
        pollHandle = null;
        void poll();
      },
      backoff ? BACKOFF_MS : opts.getIntervalMs(),
    );
  }

  async function poll(): Promise<void> {
    const w = win;
    if (!w || isHidden()) return;
    const gen = generation;
    const epoch = staticsEpoch;
    const refresh = origin === null || moving || tick % STATIC_REFRESH_TICKS === 0;
    tick++;
    try {
      let cursor: Vec2;
      if (refresh) {
        const [c, nextOrigin, sf, cursorSf] = await Promise.all([
          w.cursorPosition(),
          w.outerPosition(),
          w.scaleFactor(),
          w.primaryScaleFactor?.(),
        ]);
        cursor = c;
        if (gen === generation && epoch === staticsEpoch) {
          origin = nextOrigin;
          scale = sf;
          cursorScale = cursorSf ?? sf;
        }
      } else {
        cursor = await w.cursorPosition();
      }
      if (gen !== generation || isHidden()) return;
      if (backoff) log.warn("poll_recovered", {});
      failureCount = 0;
      backoff = false;
      // An invalidation during the read leaves this sample unconvertible; the next tick refreshes.
      if (epoch === staticsEpoch && origin !== null) {
        emit(physicalCursorToLocalCss(cursor, origin, scale, cursorScale));
      }
    } catch (err) {
      if (gen !== generation) return;
      failureCount++;
      if (backoff) log.debug("poll_failed", { error: String(err) });
      else log.warn("poll_failed", { error: String(err) });
      if (failureCount === FAILURE_THRESHOLD) {
        backoff = true;
        log.warn("poll_failure_threshold_reached", { backoff_ms: BACKOFF_MS });
        emit(null);
      }
    }
    if (gen === generation && !isHidden()) scheduleNextPoll();
  }

  function onVisibilityChange(): void {
    if (isHidden()) {
      stopPoll();
      emit(null);
    } else if (pollHandle === null) {
      scheduleNextPoll();
    }
  }

  return {
    start() {
      win = getWindow();
      failureCount = 0;
      backoff = false;
      tick = 0;
      invalidate();
      unlistens = [
        win.onMoved(invalidate),
        win.onResized(invalidate),
        win.onScaleChanged(invalidate),
      ];
      doc.addEventListener("visibilitychange", onVisibilityChange);
      if (!isHidden()) scheduleNextPoll();
    },
    stop() {
      generation++;
      stopPoll();
      // Awaited so a stop that lands before a listen resolves still releases it once it does.
      for (const unlisten of unlistens) unlisten.then((fn) => fn()).catch(() => {});
      unlistens = [];
      doc.removeEventListener("visibilitychange", onVisibilityChange);
      win = null;
    },
    unavailable: () => isHidden() || backoff,
    setMoving(next) {
      moving = next;
    },
  };
}

export function createCursorSource(opts: CursorSourceOptions): CursorSource {
  const listeners = new Set<CursorListener>();
  const deliver = (listener: CursorListener, pos: Vec2 | null): void => {
    try {
      listener(pos);
    } catch (err) {
      log.warn("listener_failed", { error: String(err) });
    }
  };
  const emit = (pos: Vec2 | null): void => {
    for (const listener of listeners) deliver(listener, pos);
  };
  const feed = isTauri()
    ? createPollFeed(opts, emit)
    : createMouseFeed(opts.moveTarget ?? (globalThis as unknown as EventTarget), emit);

  return {
    subscribe(listener) {
      // Its own entry, so subscribing one function twice gives two independent subscriptions.
      const entry: CursorListener = (pos) => listener(pos);
      listeners.add(entry);
      if (listeners.size === 1) feed.start();
      // A microtask, so the caller holds its unsubscribe handle before the null arrives.
      if (feed.unavailable()) {
        queueMicrotask(() => {
          if (listeners.has(entry) && feed.unavailable()) deliver(entry, null);
        });
      }
      return () => {
        if (listeners.delete(entry) && listeners.size === 0) feed.stop();
      };
    },
    setMoving: (moving) => feed.setMoving(moving),
  };
}
