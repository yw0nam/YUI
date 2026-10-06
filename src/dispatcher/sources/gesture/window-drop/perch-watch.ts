/**
 * perch-watch — the armed perch/peek state and its occlusion-aware detach poll.
 *
 * Once armed on a window, the poll re-checks ~1.4 Hz whether the target detached.
 * Sit loses on gone, covered, or moved; peek loses on gone or moved because its
 * target is expected to cover YUI. Loss fires the matching exit through the bus
 * and disarms. The poll never mutates renderer state directly, except to clear the
 * perch pin of a lost or suspended sit.
 *
 * Tauri deps (invoke / getWindow) are injected so the module is unit-testable
 * without the Tauri runtime.
 */

import type { WindowRect } from "../../../../contract";
import {
  containsSeat,
  MOVE_TH,
  PERCH_AMBIGUOUS_LOST_TICKS,
  PERCH_POLL_MS,
} from "../../../../io/window/geometry/perch";
import { createLogger } from "../../../../logger";
import type { ScreenPoint } from "../../../../renderer/geometry/probe/perch-geometry";
import { petPxToGlobalPoints } from "../../../../renderer/geometry/probe/perch-geometry";
import type { EventBus } from "../../../core/event-bus";

const log = createLogger("window-drop");

/** Live perch probe surface the window-drop modules need from the renderer. */
export interface PerchProbeSource {
  getPerchProbe(): { seatPx: { x: number; y: number }; charHpx: number } | null;
  /** Whether the renderer is currently in perch-align mode. */
  isPerched(): boolean;
  setPerchTarget(target: { edgeLocalYpx: number } | null): void;
}

/** Tauri window position/scale accessors the window-drop modules read. */
export interface DropWindow {
  outerPosition(): Promise<{ x: number; y: number }>;
  scaleFactor(): Promise<number>;
  /**
   * Move the pet window (physical px). Only the programmatic placement path needs it;
   * a drag-only wiring may omit it, and `placeOn` then reports `unsupported`.
   */
  setPositionPhysical?(x: number, y: number): Promise<void>;
}

/** Tauri `invoke` (only `list_windows` is used here). */
export type DropInvoke = (cmd: "list_windows") => Promise<WindowRect[]>;

/** Shared seat math: probe + window pos/scale → seat global point. Distinct predicates layer on top. */
export function projectSeat(
  probe: { seatPx: { x: number; y: number } },
  pos: { x: number; y: number },
  scale: number,
): ScreenPoint {
  return petPxToGlobalPoints(probe.seatPx, { x: pos.x, y: pos.y }, scale);
}

export interface PerchWatchDeps {
  bus: EventBus;
  renderer: PerchProbeSource;
  invoke: DropInvoke;
  /** Resolve the pet window (lazily — `getCurrentWindow()` throws off-Tauri). */
  getWindow: () => DropWindow;
  /** Whether side-peek intent is currently active. */
  peekActive: () => boolean;
  /** An armed sit lost its host — the seat is gone and the character hangs where it was. */
  onSitLost?: () => void;
  /** Injectable timer fns (fake timers in tests). */
  setInterval: typeof setInterval;
  clearInterval: typeof clearInterval;
}

export interface PerchWatch {
  /** Arm the poll on a window; a re-arm replaces the previous one. */
  arm(
    kind: "sit" | "peek",
    windowNumber: number,
    armRect: { x: number; y: number },
    charHpx: number,
    origin: "commit" | "adopt" | null,
  ): void;
  /** Disarm and push the sit leave/interrupt envelope for a miss or missing probe. */
  pushExit(): void;
  /** Stop the poll and forget the armed window. */
  disarm(): void;
  /** Arm a sit the mover already published. */
  adoptSit(
    windowNumber: number,
    rect: { x: number; y: number },
    charHpx: number,
    origin: "commit" | "adopt",
  ): void;
  /** The window an armed sit is held on, and the standing height it was armed with. null when nothing, or a peek, is armed. */
  armedSit(): { windowNumber: number; origin: "commit" | "adopt"; charHpx: number } | null;
  /** Stop the sit poll and clear the renderer pin without publishing an exit. */
  suspendSit(): {
    windowNumber: number;
    origin: "commit" | "adopt";
    rect: { x: number; y: number };
    charHpx: number;
  } | null;
  /** Restore a quietly suspended sit pin and its poll without publishing an event. */
  resumeSit(edgeLocalYpx: number): void;
  /**
   * Drop a suspended sit for good: the armed identity goes with it and a later resumeSit
   * does nothing. Silent — the caller that suspended the sit owns whatever it publishes.
   */
  abandonSit(): void;
  /** Whether a perch/peek is armed or a sit is suspended. */
  isHeld(): boolean;
  /** Release any armed perch/peek and push the matching exit; a release with nothing held is silent. */
  release(): void;
}

export function createPerchWatch(deps: PerchWatchDeps): PerchWatch {
  const { bus, renderer, invoke, getWindow, peekActive } = deps;
  const setIntervalImpl = deps.setInterval;
  const clearIntervalImpl = deps.clearInterval;

  let armedWindowNumber: number | null = null;
  let armedRect: { x: number; y: number } | null = null;
  let armedKind: "sit" | "peek" | null = null;
  let armedOrigin: "commit" | "adopt" | null = null;
  let armedCharHpx = 0;
  let sitSuspended = false;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let lostStreak = 0;
  // Bumped on every (re)arm; a tick captures it before awaiting and discards a
  // stale result if a fresh drop re-armed mid-await.
  let pollGen = 0;

  /** Push the sit leave/interrupt envelope for a miss or missing probe. */
  function pushExit(): void {
    disarm();
    bus.push({
      source: "os_event_watcher",
      event_name: "user.window_sit_exit",
      ts: Date.now(),
    });
  }

  function pushArmedExit(kind: "sit" | "peek"): void {
    disarm();
    bus.push({
      source: "os_event_watcher",
      event_name: kind === "sit" ? "user.window_sit_exit" : "user.peek_exit",
      ts: Date.now(),
    });
  }

  function isHeld(): boolean {
    return armedKind !== null || sitSuspended;
  }

  function stopPoll(): void {
    if (pollTimer !== null) {
      clearIntervalImpl(pollTimer);
      pollTimer = null;
    }
  }

  function disarm(): void {
    pollGen++;
    stopPoll();
    armedWindowNumber = null;
    armedRect = null;
    armedKind = null;
    armedOrigin = null;
    armedCharHpx = 0;
    sitSuspended = false;
    lostStreak = 0;
  }

  function arm(
    kind: "sit" | "peek",
    windowNumber: number,
    armRect: { x: number; y: number },
    charHpx: number,
    origin: "commit" | "adopt" | null,
  ): void {
    armedWindowNumber = windowNumber;
    armedRect = { x: armRect.x, y: armRect.y };
    armedKind = kind;
    armedOrigin = origin;
    armedCharHpx = charHpx;
    sitSuspended = false;
    lostStreak = 0;
    stopPoll();
    pollGen++;
    log.debug("perch.arm", {
      armedWindowNumber,
      armX: Math.round(armRect.x),
      armY: Math.round(armRect.y),
      charHpx: Math.round(charHpx),
    });
    pollTimer = setIntervalImpl(() => {
      void tick().catch((err) =>
        log.warn("perch_poll_tick_failed", { degrade: true, error: String(err) }),
      );
    }, PERCH_POLL_MS);
  }

  async function tick(): Promise<void> {
    const kind = armedKind;
    if (kind === null) return;
    // Held state ended elsewhere (manual re-grab / summon / dev exit) → silent disarm.
    if ((kind === "sit" && !renderer.isPerched()) || (kind === "peek" && !peekActive())) {
      disarm();
      return;
    }
    const gen = pollGen;
    const probe = renderer.getPerchProbe();
    const win = getWindow();
    const [pos, scale, windows] = await Promise.all([
      win.outerPosition(),
      win.scaleFactor(),
      invoke("list_windows"),
    ]);
    // A fresh drop re-armed mid-await → this result is stale; discard.
    if (gen !== pollGen) return;
    if ((kind === "sit" && !renderer.isPerched()) || (kind === "peek" && !peekActive())) {
      disarm();
      return;
    }

    let reason: "gone" | "covered" | "moved" | null = null;
    let dx = 0;
    let dy = 0;
    let covering = false;
    const seat = probe ? projectSeat(probe, pos, scale) : null;
    const armedIdx = windows.findIndex((w) => w.windowNumber === armedWindowNumber);
    if (!probe && kind === "sit") {
      // No live probe → treat as gone (unambiguous): the seat is unknowable.
      reason = "gone";
    } else if (armedIdx < 0) {
      reason = "gone";
    } else {
      const w = windows[armedIdx];
      dx = armedRect ? w.x - armedRect.x : 0;
      dy = armedRect ? w.y - armedRect.y : 0;
      const moved = armedRect != null && (Math.abs(dx) > MOVE_TH || Math.abs(dy) > MOVE_TH);
      if (kind === "sit" && seat) {
        // A window earlier in the front-to-back list (above the armed one) covers the seat.
        covering = windows.some((candidate, i) => i < armedIdx && containsSeat(candidate, seat));
      }
      if (covering) reason = "covered";
      else if (moved) reason = "moved";
    }

    if (reason) {
      log.debug("perch.lost", {
        armedWindowNumber,
        armedIdx,
        reason,
        covering,
        seatY: seat ? Math.round(seat.y) : null,
        winY: armedIdx >= 0 ? Math.round(windows[armedIdx].y) : null,
        armY: armedRect ? Math.round(armedRect.y) : null,
        dx: Math.round(dx),
        dy: Math.round(dy),
      });
      lostStreak++;
      // gone is unambiguous (1 tick); covered/moved ride out the debounce.
      const need = reason === "gone" ? 1 : PERCH_AMBIGUOUS_LOST_TICKS;
      if (lostStreak >= need) {
        pushArmedExit(kind);
        if (kind === "sit") {
          // The exit leaves the character standing where the seat was; a sit owes a fall.
          // The dispatcher clears the pin on that exit a pump later, too late for a fall
          // starting here — the perch hold would swallow the falling clip until then.
          renderer.setPerchTarget(null);
          deps.onSitLost?.();
        }
      }
    } else {
      lostStreak = 0;
    }
  }

  return {
    arm,
    pushExit,
    disarm,
    adoptSit(windowNumber, rect, charHpx, origin) {
      arm("sit", windowNumber, rect, charHpx, origin);
    },
    armedSit() {
      if (armedKind !== "sit" || armedWindowNumber === null || armedOrigin === null) return null;
      return { windowNumber: armedWindowNumber, origin: armedOrigin, charHpx: armedCharHpx };
    },
    suspendSit() {
      if (
        armedKind !== "sit" ||
        armedWindowNumber === null ||
        armedRect === null ||
        armedOrigin === null
      ) {
        return null;
      }
      stopPoll();
      pollGen++;
      sitSuspended = true;
      renderer.setPerchTarget(null);
      return {
        windowNumber: armedWindowNumber,
        origin: armedOrigin,
        rect: { ...armedRect },
        charHpx: armedCharHpx,
      };
    },
    resumeSit(edgeLocalYpx) {
      if (
        !sitSuspended ||
        armedKind !== "sit" ||
        armedWindowNumber === null ||
        armedRect === null ||
        armedOrigin === null
      ) {
        return;
      }
      const windowNumber = armedWindowNumber;
      const rect = { ...armedRect };
      const charHpx = armedCharHpx;
      const origin = armedOrigin;
      renderer.setPerchTarget({ edgeLocalYpx });
      arm("sit", windowNumber, rect, charHpx, origin);
    },
    abandonSit() {
      if (!sitSuspended) return;
      disarm();
    },
    isHeld,
    release() {
      if (!isHeld()) return;
      if (armedKind !== null) {
        pushArmedExit(armedKind);
        return;
      }
      pushExit();
    },
  };
}
