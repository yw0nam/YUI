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
 * Once armed, the poll re-checks ~1.4 Hz whether the perched window is still
 * under the seat and topmost. The held-perch test is point-in-rect (NOT the
 * U-band catch zone — that generosity is for the drop decision only). Loss
 * fires user.window_sit_exit through the bus and disarms. The poll never calls
 * setPerchTarget directly — it preserves the bus→dispatcher→renderer path.
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
/** Consecutive lost ticks required for an *ambiguous* loss (covered / not-containing). */
const AMBIGUOUS_LOST_TICKS = 2;

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
    lostStreak = 0;
  }

  function arm(windowNumber: number): void {
    armedWindowNumber = windowNumber;
    lostStreak = 0;
    stopPoll();
    pollGen++;
    pollTimer = setIntervalImpl(() => {
      void tick().catch((err) => log.warn("perch poll tick failed — degrade:", err));
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

    let lost: boolean;
    let ambiguous = false;
    if (!probe) {
      lost = true;
    } else {
      const seat = projectSeat(probe, pos, scale);
      const armedIdx = windows.findIndex((w) => w.windowNumber === armedWindowNumber);
      // A window earlier in the front-to-back list (above the armed one) covers the seat.
      const covered = windows.some((w, i) => i < armedIdx && containsSeat(w, seat));
      const stillUnder = armedIdx >= 0 && containsSeat(windows[armedIdx], seat);
      lost = armedIdx < 0 || !stillUnder || covered;
      // Unambiguous: the armed window is gone (moved/closed/minimized). Ambiguous
      // (covered or not-containing) rides out the debounce.
      ambiguous = armedIdx >= 0;
    }

    if (lost) {
      lostStreak++;
      const need = ambiguous ? AMBIGUOUS_LOST_TICKS : 1;
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
    arm(target.windowNumber);
  }

  return {
    async start() {
      if (unlisten) return;
      try {
        unlisten = await listen(RELEASE_EVENT, () => {
          void onRelease().catch((err) => log.warn("release handling failed — degrade:", err));
        });
      } catch (err) {
        log.warn("listen subscribe failed — degrade:", err);
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
