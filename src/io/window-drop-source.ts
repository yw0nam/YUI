/**
 * window-drop-source — Rust `window_drop_release` → bus envelope producer
 * plus the occlusion-aware perch detach poll.
 *
 * Client-firing, backend-bypassed (firing ≠ judgment): on a drag-release the
 * client decides whether the character's *seat* landed over a foreign window's
 * top- or side-edge catch zone, and emits a tier1 bus event the dispatcher renders
 * locally. No brain, no agent call.
 *
 * Flow on each release:
 *   1. probe = renderer.getPerchProbe(). null (no VRM / projection failed) →
 *      push user.window_sit_exit and stop.
 *   2. seatGlobal = petPxToGlobalPoints(seatPx, outerPosition, scaleFactor).
 *   3. windows = invoke("list_windows")  (front-to-back, topmost first).
 *   4. target = first window whose catch zone contains the seat (topmost wins).
 *   5. hit → user.window_sit_drop { edge_local_ypx } + arm
 *      the poll on target.windowNumber; miss → user.window_sit_exit.
 *
 * Once armed, the poll re-checks ~1.4 Hz whether the target window detached.
 * Sit loses on gone, covered, or moved; peek loses on gone or moved because its
 * target is expected to cover YUI. Loss fires the matching exit through the bus
 * and disarms. The poll never mutates renderer state directly.
 *
 * Tauri deps (invoke / getWindow / listen) are injected so the module is unit-
 * testable without the Tauri runtime. Never throws to the caller — failures
 * degrade to a warn log (mirrors os-context.ts).
 */

import type { GestureCuesConfig, PeekConfig } from "../config/load";
import type { ScreenRect, WindowRect } from "../contract";
import type { EventBus } from "../dispatcher/event-bus";
import { createLogger } from "../logger";
import type { ScreenPoint } from "../renderer/perch-geometry";
import {
  inCatchZone,
  inSideCatchZone,
  peekTargetPx,
  petPxToGlobalPoints,
} from "../renderer/perch-geometry";

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
interface PerchProbeSource {
  getPerchProbe(): { seatPx: { x: number; y: number }; charHpx: number } | null;
  /** Whether the renderer is currently in perch-align mode. */
  isPerched(): boolean;
}

/** Tauri window position/scale accessors the producer reads at drop time. */
interface DropWindow {
  outerPosition(): Promise<{ x: number; y: number }>;
  scaleFactor(): Promise<number>;
}

/** Tauri `invoke` (only `list_windows` is used here). */
type DropInvoke = (cmd: "list_windows") => Promise<WindowRect[]>;

/** Tauri `listen` (injectable for tests). */
type DropListen = (
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
  /** Whether side-peek intent is currently active. */
  peekActive?: () => boolean;
  /** Returns the current side-peek configuration. */
  getPeekConfig: () => PeekConfig;
  /** Returns the current reflex-gesture speech cues (window_sit / peek used here). */
  getGestureCues: () => GestureCuesConfig;
  /** Injectable timer fns (fake timers in tests). */
  setInterval?: typeof setInterval;
  clearInterval?: typeof clearInterval;
}

/** One perch candidate: a foreign window the character can sit on or peek around. */
export interface PerchTargetWindow {
  app: string | null;
  title: string | null;
  rect: ScreenRect;
}

/** The perch candidate model: the tracked foreign windows plus the peek edges. */
export interface PerchTargets {
  windows: PerchTargetWindow[];
  edges: Array<"left" | "right">;
}

/** What a settle pass landed on. */
export type SettleOutcome =
  | { kind: "sit"; app: string | null; window_title: string | null }
  | { kind: "peek"; side: "left" | "right"; app: string | null; window_title: string | null }
  | { kind: "none" };

export interface WindowDropSource {
  /** Register the release listener. Idempotent. */
  start(): Promise<void>;
  /** Unregister the release listener + stop the poll. */
  stop(): void;
  /** Alias of stop() for HMR-dispose call sites. */
  dispose(): void;
  /**
   * Run the drop hit-test at the character's current position — the same pass a
   * drag release triggers. `suppressCue` skips the proactive cue for a gesture the
   * backend already knows it asked for; the tier1 perch event fires either way.
   */
  settle(opts?: { suppressCue?: boolean }): Promise<SettleOutcome>;
  /** The current perch candidates. */
  perchTargets(): Promise<PerchTargets>;
  /** Release any armed perch/peek and push the matching exit. */
  release(): void;
}

/** Compose the sat-on/peeked-at window name into a cue's base context (no name → base unchanged). */
function withPerchedOn(baseContext: string, name: string | null): string {
  return name ? `${baseContext} (currently perched on: ${name})` : baseContext;
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

/**
 * Drop-time geometry dump — seat point, character height, and per-window catch-zone
 * verdicts for the frontmost windows. Diagnostic only; the decision path never reads it.
 */
function logDropGeometry(
  seat: ScreenPoint,
  windows: WindowRect[],
  charHpx: number,
  pos: { x: number; y: number },
  scale: number,
  peekConfig: PeekConfig,
): void {
  const r = Math.round;
  log.debug("drop.geometry", {
    seatX: r(seat.x),
    seatY: r(seat.y),
    charHpx: r(charHpx),
    winOriginX: r(pos.x / (scale > 0 ? scale : 1)),
    winOriginY: r(pos.y / (scale > 0 ? scale : 1)),
    scale,
    windowCount: windows.length,
  });
  for (const [i, w] of windows.slice(0, 6).entries()) {
    const out = peekConfig.side_out_frac * charHpx;
    const inside = peekConfig.side_in_frac * charHpx;
    const sideOpts = { out: peekConfig.side_out_frac, in: peekConfig.side_in_frac };
    log.debug("drop.window", {
      z: i,
      windowNumber: w.windowNumber,
      x: r(w.x),
      y: r(w.y),
      w: r(w.width),
      h: r(w.height),
      // Seat offset from each vertical edge: negative = outside the window.
      dxLeft: r(seat.x - w.x),
      dxRight: r(seat.x - (w.x + w.width)),
      dyTop: r(seat.y - w.y),
      leftBand: `${r(w.x - out)}..${r(w.x + inside)}`,
      rightBand: `${r(w.x + w.width - inside)}..${r(w.x + w.width + out)}`,
      vBand: `${r(w.y)}..${r(w.y + w.height)}`,
      top: inCatchZone(seat, w, charHpx),
      side: inSideCatchZone(seat, w, charHpx, sideOpts),
    });
  }
}

export function createWindowDropSource(deps: WindowDropSourceDeps): WindowDropSource {
  const { bus, renderer, invoke, getWindow, listen } = deps;
  const pollMs = deps.pollIntervalMs ?? DEFAULT_POLL_MS;
  const setIntervalImpl = deps.setInterval ?? setInterval;
  const clearIntervalImpl = deps.clearInterval ?? clearInterval;
  const peekActive = deps.peekActive ?? (() => false);
  const getPeekConfig = deps.getPeekConfig;
  const getGestureCues = deps.getGestureCues;

  let unlisten: (() => void) | undefined;

  // ── Occlusion poll state ──
  let armedWindowNumber: number | null = null;
  let armedRect: { x: number; y: number } | null = null;
  let armedKind: "sit" | "peek" | null = null;
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
      hint_tier: 1,
      dnd_override: true,
    });
  }

  function pushArmedExit(kind: "sit" | "peek"): void {
    disarm();
    bus.push({
      source: "os_event_watcher",
      event_name: kind === "sit" ? "user.window_sit_exit" : "user.peek_exit",
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
    pollGen++;
    stopPoll();
    armedWindowNumber = null;
    armedRect = null;
    armedKind = null;
    lostStreak = 0;
  }

  function arm(
    kind: "sit" | "peek",
    windowNumber: number,
    armRect: { x: number; y: number },
    charHpx: number,
  ): void {
    armedWindowNumber = windowNumber;
    armedRect = { x: armRect.x, y: armRect.y };
    armedKind = kind;
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
      const need = reason === "gone" ? 1 : AMBIGUOUS_LOST_TICKS;
      if (lostStreak >= need) pushArmedExit(kind);
    } else {
      lostStreak = 0;
    }
  }

  async function settle(opts?: { suppressCue?: boolean }): Promise<SettleOutcome> {
    const suppressCue = opts?.suppressCue === true;
    const probe = renderer.getPerchProbe();
    // No VRM / projection unavailable → nothing to perch; leave to idle.
    if (!probe) {
      pushExit();
      return { kind: "none" };
    }

    const win = getWindow();
    const [pos, scale, windows] = await Promise.all([
      win.outerPosition(),
      win.scaleFactor(),
      invoke("list_windows"),
    ]);

    const seatGlobal = projectSeat(probe, pos, scale);
    const peekConfig = getPeekConfig();
    const sideOpts = { out: peekConfig.side_out_frac, in: peekConfig.side_in_frac };
    logDropGeometry(seatGlobal, windows, probe.charHpx, pos, scale, peekConfig);
    // Front-to-back ⇒ first match is the topmost window. U-band catch zone here only.
    const targetIdx = windows.findIndex((w) => inCatchZone(seatGlobal, w, probe.charHpx));
    if (targetIdx < 0) {
      const sideTargetIdx = windows.findIndex(
        (w) => inSideCatchZone(seatGlobal, w, probe.charHpx, sideOpts) !== null,
      );
      if (sideTargetIdx < 0) {
        pushExit();
        return { kind: "none" };
      }
      const sideTarget = windows[sideTargetIdx];
      if (windows.some((w, i) => i < sideTargetIdx && containsSeat(w, seatGlobal))) {
        log.debug("peek.drop_covered", { targetWindowNumber: sideTarget.windowNumber });
        pushExit();
        return { kind: "none" };
      }
      const side = inSideCatchZone(seatGlobal, sideTarget, probe.charHpx, sideOpts);
      if (side === null) {
        pushExit();
        return { kind: "none" };
      }
      const sf = scale > 0 ? scale : 1;
      const edgeXpx = side === "left" ? sideTarget.x : sideTarget.x + sideTarget.width;
      const edgeLocalXpx = edgeXpx - pos.x / sf;
      const targetLocalXpx = peekTargetPx(edgeLocalXpx, side, probe.charHpx, peekConfig.inset_frac);
      const peekCue = getGestureCues().peek;
      if (!suppressCue) {
        bus.push({
          source: "os_event_watcher",
          event_name: "proactive.peek",
          ts: Date.now(),
          hint_tier: 2,
          payload: {
            cue_id: "peek",
            label: peekCue.label,
            context: withPerchedOn(peekCue.context, sideTarget.name),
          },
        });
      }
      bus.push({
        source: "os_event_watcher",
        event_name: "user.peek_drop",
        ts: Date.now(),
        hint_tier: 1,
        dnd_override: true,
        payload: {
          side,
          target_local_xpx: targetLocalXpx,
          app: sideTarget.ownerName,
          window_title: sideTarget.name,
        },
      });
      arm("peek", sideTarget.windowNumber, { x: sideTarget.x, y: sideTarget.y }, probe.charHpx);
      return {
        kind: "peek",
        side,
        app: sideTarget.ownerName,
        window_title: sideTarget.name,
      };
    }
    const target = windows[targetIdx];
    // Same covered predicate as the occlusion poll, applied at drop time: a window
    // in front of the match containing the seat means the seat visually lands on
    // that window's surface, not on the matched top edge — miss, no perch.
    if (windows.some((w, i) => i < targetIdx && containsSeat(w, seatGlobal))) {
      log.debug("perch.drop_covered", { targetWindowNumber: target.windowNumber });
      pushExit();
      return { kind: "none" };
    }

    // Global top edge → pet-window-local px (winOriginPts = pos / scale).
    const sf = scale > 0 ? scale : 1;
    const edgeLocalYpx = target.y - pos.y / sf;
    const windowSitCue = getGestureCues().window_sit;
    if (!suppressCue) {
      bus.push({
        source: "os_event_watcher",
        event_name: "proactive.window_sit",
        ts: Date.now(),
        hint_tier: 2,
        payload: {
          cue_id: "window_sit",
          label: windowSitCue.label,
          context: withPerchedOn(windowSitCue.context, target.name),
        },
      });
    }
    bus.push({
      source: "os_event_watcher",
      event_name: "user.window_sit_drop",
      ts: Date.now(),
      hint_tier: 1,
      dnd_override: true,
      payload: {
        edge_local_ypx: edgeLocalYpx,
        app: target.ownerName,
        window_title: target.name,
      },
    });
    arm("sit", target.windowNumber, { x: target.x, y: target.y }, probe.charHpx);
    return { kind: "sit", app: target.ownerName, window_title: target.name };
  }

  async function perchTargets(): Promise<PerchTargets> {
    const windows = await invoke("list_windows");
    return {
      windows: windows.map((w) => ({
        app: w.ownerName,
        title: w.name,
        rect: { x: w.x, y: w.y, width: w.width, height: w.height },
      })),
      edges: ["left", "right"],
    };
  }

  return {
    settle,
    perchTargets,
    release() {
      if (armedKind !== null) {
        pushArmedExit(armedKind);
        return;
      }
      pushExit();
    },
    async start() {
      if (unlisten) return;
      try {
        unlisten = await listen(RELEASE_EVENT, () => {
          void settle().catch((err) =>
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
