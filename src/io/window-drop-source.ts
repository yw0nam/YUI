/**
 * window-drop-source — Rust `window_drop_release` → bus envelope producer
 * plus the occlusion-aware perch detach poll.
 *
 * Client-firing, backend-bypassed (firing ≠ judgment): on a drag-release the
 * client decides whether the character's *seat* landed over a foreign window's
 * top-edge catch zone, and emits a tier1 bus event the dispatcher renders
 * locally. No brain, no agent call.
 *
 * Flow on each release:
 *   1. probe = renderer.getPerchProbe(). null (no VRM / projection failed) →
 *      push user.window_sit_exit and stop.
 *   2. seatGlobal = petPxToGlobalPoints(seatPx, outerPosition, scaleFactor).
 *   3. windows = invoke("list_windows")  (front-to-back, topmost first).
 *   4. target = first window whose catch zone contains the seat (topmost wins).
 *   5. hit → user.window_sit_drop { target_window_rect, edge_local_ypx } + arm
 *      the poll on target.windowNumber; miss → user.window_sit_exit.
 *
 * Once armed, the poll re-checks ~1.4 Hz whether the perched window detached.
 * The held-perch test is arm-baseline delta: a perch is lost when the armed
 * window is gone from the list, is covered by an earlier z-order window, or has
 * moved more than MOVE_TH from its arm-time top-left. A seat parked above the
 * window's top edge (animation bob) yields zero displacement → no false detach.
 * Loss fires user.window_sit_exit through the bus and disarms. The poll never
 * calls setPerchTarget directly — it preserves the bus→dispatcher→renderer path.
 *
 * Tauri deps (invoke / getWindow / listen) are injected so the module is unit-
 * testable without the Tauri runtime. Never throws to the caller — failures
 * degrade to a warn log (mirrors os-context.ts).
 */

import type { ScreenRect, WindowRect } from "../contract";
import type { EventBus } from "../dispatcher/event-bus";
import { createLogger } from "../logger";
import type { ScreenPoint } from "../renderer/perch-geometry";
import { inCatchZone, petPxToGlobalPoints } from "../renderer/perch-geometry";

const log = createLogger("window-drop");

/** Tauri event channel carrying the drag-release point (payload unused by the seat hit-test). */
const RELEASE_EVENT = "window_drop_release";

/** Poll cadence — ~1.4 Hz keeps detach latency under ~2 ticks (≈1.4 s). */
const DEFAULT_POLL_MS = 700;
/** Consecutive lost ticks required for an *ambiguous* loss (covered / moved). */
const AMBIGUOUS_LOST_TICKS = 2;
/** Px threshold below which armed-window movement is treated as jitter, not a move. */
const MOVE_TH = 12;

/** Live perch probe surface the producer needs from the renderer. */
export interface PerchProbeSource {
  getPerchProbe(): { seatPx: { x: number; y: number }; charHpx: number } | null;
  /** Whether the renderer is currently in perch-align mode. */
  isPerched(): boolean;
}

/** Tauri window position/scale accessors the producer reads at drop time. */
export interface DropWindow {
  outerPosition(): Promise<{ x: number; y: number }>;
  scaleFactor(): Promise<number>;
}

/** Tauri `invoke` (only `list_windows` is used here). */
export type DropInvoke = (cmd: "list_windows") => Promise<WindowRect[]>;

/** Tauri `listen` (injectable for tests). */
export type DropListen = (
  event: string,
  handler: (e: { payload: unknown }) => void,
) => Promise<() => void>;

export interface WindowDropSourceDeps {
  bus: EventBus;
  renderer: PerchProbeSource;
  invoke: DropInvoke;
  /** Resolve the pet window (lazily — `getCurrentWindow()` throws off-Tauri). */
  getWindow: () => DropWindow;
  listen: DropListen;
  /** Poll cadence in ms (default {@link DEFAULT_POLL_MS}). */
  pollIntervalMs?: number;
  /** Injectable timer fns (fake timers in tests). */
  setInterval?: typeof setInterval;
  clearInterval?: typeof clearInterval;
}

export interface WindowDropSource {
  /** Register the release listener. Idempotent. */
  start(): Promise<void>;
  /** Unregister the release listener + stop the poll. */
  stop(): void;
  /** Alias of stop() for HMR-dispose call sites. */
  dispose(): void;
}

/** Point-in-rect: is the seat actually over this window's surface (points). */
function containsSeat(win: ScreenRect, seat: ScreenPoint): boolean {
  return (
    seat.x >= win.x &&
    seat.x <= win.x + win.width &&
    seat.y >= win.y &&
    seat.y <= win.y + win.height
  );
}

export function createWindowDropSource(deps: WindowDropSourceDeps): WindowDropSource {
  const { bus, renderer, invoke, getWindow, listen } = deps;
  const pollMs = deps.pollIntervalMs ?? DEFAULT_POLL_MS;
  const setIntervalImpl = deps.setInterval ?? setInterval;
  const clearIntervalImpl = deps.clearInterval ?? clearInterval;

  let unlisten: (() => void) | undefined;

  // ── Occlusion poll state ──
  let armedWindowNumber: number | null = null;
  let armedRect: { x: number; y: number } | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let lostStreak = 0;
  // Bumped on every (re)arm; a tick captures it before awaiting and discards a
  // stale result if a fresh drop re-armed mid-await.
  let pollGen = 0;

  /** Push the leave/interrupt envelope (no payload) — reused for miss + no-probe + occlusion. Disarms. */
  function pushExit(): void {
    disarm();
    bus.push({
      source: "os_event_watcher",
      event_name: "user.window_sit_exit",
      ts: Date.now(),
      hint_tier: 1,
      dnd_override: true,
    });
  }

  function stopPoll(): void {
    if (pollTimer !== null) {
      clearIntervalImpl(pollTimer);
      pollTimer = null;
    }
  }

  function disarm(): void {
    stopPoll();
    armedWindowNumber = null;
    armedRect = null;
    lostStreak = 0;
  }

  function arm(windowNumber: number, armRect: { x: number; y: number }, charHpx: number): void {
    armedWindowNumber = windowNumber;
    armedRect = { x: armRect.x, y: armRect.y };
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
    }, pollMs);
  }

  /** Shared seat math: probe + window pos/scale → seat global point. Distinct predicates layer on top. */
  function projectSeat(
    probe: { seatPx: { x: number; y: number } },
    pos: { x: number; y: number },
    scale: number,
  ): ScreenPoint {
    return petPxToGlobalPoints(probe.seatPx, { x: pos.x, y: pos.y }, scale);
  }

  async function tick(): Promise<void> {
    // Perch ended elsewhere (manual re-grab / dev exit) → silent disarm, no exit.
    if (!renderer.isPerched()) {
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
    if (!renderer.isPerched()) {
      disarm();
      return;
    }

    let reason: "gone" | "covered" | "moved" | null = null;
    let dx = 0;
    let dy = 0;
    let covering = false;
    const seat = probe ? projectSeat(probe, pos, scale) : null;
    const armedIdx = windows.findIndex((w) => w.windowNumber === armedWindowNumber);
    if (!probe) {
      // No live probe → treat as gone (unambiguous): the seat is unknowable.
      reason = "gone";
    } else if (armedIdx < 0) {
      reason = "gone";
    } else if (seat) {
      // A window earlier in the front-to-back list (above the armed one) covers the seat.
      covering = windows.some((w, i) => i < armedIdx && containsSeat(w, seat));
      const w = windows[armedIdx];
      dx = armedRect ? w.x - armedRect.x : 0;
      dy = armedRect ? w.y - armedRect.y : 0;
      const moved = armedRect != null && (Math.abs(dx) > MOVE_TH || Math.abs(dy) > MOVE_TH);
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
      const need = reason === "gone" ? 1 : AMBIGUOUS_LOST_TICKS;
      if (lostStreak >= need) pushExit();
    } else {
      lostStreak = 0;
    }
  }

  async function onRelease(): Promise<void> {
    const probe = renderer.getPerchProbe();
    // No VRM / projection unavailable → nothing to perch; leave to idle.
    if (!probe) {
      pushExit();
      return;
    }

    const win = getWindow();
    const [pos, scale, windows] = await Promise.all([
      win.outerPosition(),
      win.scaleFactor(),
      invoke("list_windows"),
    ]);

    const seatGlobal = projectSeat(probe, pos, scale);
    // Front-to-back ⇒ first match is the topmost window. U-band catch zone here only.
    const target = windows.find((w) => inCatchZone(seatGlobal, w, probe.charHpx));
    if (!target) {
      pushExit();
      return;
    }

    // Global top edge → pet-window-local px (winOriginPts = pos / scale).
    const sf = scale > 0 ? scale : 1;
    const edgeLocalYpx = target.y - pos.y / sf;
    bus.push({
      source: "os_event_watcher",
      event_name: "user.window_sit_drop",
      ts: Date.now(),
      hint_tier: 1,
      dnd_override: true,
      payload: { target_window_rect: target, edge_local_ypx: edgeLocalYpx },
    });
    arm(target.windowNumber, { x: target.x, y: target.y }, probe.charHpx);
  }

  return {
    async start() {
      if (unlisten) return;
      try {
        unlisten = await listen(RELEASE_EVENT, () => {
          void onRelease().catch((err) =>
            log.warn("release_handling_failed", { degrade: true, error: String(err) }),
          );
        });
      } catch (err) {
        log.warn("listen_subscribe_failed", { degrade: true, error: String(err) });
      }
    },
    stop() {
      disarm();
      unlisten?.();
      unlisten = undefined;
    },
    dispose() {
      this.stop();
    },
  };
}
