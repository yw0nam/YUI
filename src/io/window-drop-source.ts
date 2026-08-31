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
 * A mover that seated the character itself adopts the same poll through `adoptSit`,
 * which arms on a window without pushing anything.
 *
 * Once armed, the poll re-checks ~1.4 Hz whether the target window detached.
 * Sit loses on gone, covered, or moved; peek loses on gone or moved because its
 * target is expected to cover YUI. Loss fires the matching exit through the bus
 * and disarms. The poll never mutates renderer state directly.
 *
 * Tauri deps (invoke / getWindow / listen) are injected so the module is unit-
 * testable without the Tauri runtime. Never throws to the caller — failures
 * degrade to a warn log.
 */

import type { GestureCueConfig, GestureCuesConfig, PeekConfig } from "../config/load";
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

/** Registry id of the clip that holds the character in place for as long as she is perched. */
export const PERCH_MOTION_ID = "window_sit";
/** Poll cadence — ~1.4 Hz keeps detach latency under ~2 ticks (≈1.4 s). */
export const PERCH_POLL_MS = 700;
/** Consecutive lost ticks required for an *ambiguous* loss (covered / moved). */
export const PERCH_AMBIGUOUS_LOST_TICKS = 2;
/** Px threshold below which armed-window movement is treated as jitter, not a move. */
export const MOVE_TH = 12;

/** Live perch probe surface the producer needs from the renderer. */
interface PerchProbeSource {
  getPerchProbe(): { seatPx: { x: number; y: number }; charHpx: number } | null;
  /** Whether the renderer is currently in perch-align mode. */
  isPerched(): boolean;
  setPerchTarget(target: { edgeLocalYpx: number } | null): void;
}

/** Tauri window position/scale accessors the producer reads at drop time. */
interface DropWindow {
  outerPosition(): Promise<{ x: number; y: number }>;
  scaleFactor(): Promise<number>;
  /**
   * Move the pet window (physical px). Only the programmatic placement path needs it;
   * a drag-only wiring may omit it, and `placeOn` then reports `unsupported`.
   */
  setPositionPhysical?(x: number, y: number): Promise<void>;
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
  /** Poll cadence in ms (default {@link PERCH_POLL_MS}). */
  pollIntervalMs?: number;
  /** Whether side-peek intent is currently active. */
  peekActive?: () => boolean;
  /** Returns the current side-peek configuration. */
  getPeekConfig: () => PeekConfig;
  /** Returns the current reflex-gesture speech cues (window_sit / peek used here). */
  getGestureCues: () => GestureCuesConfig;
  /** A drag release that neither sat nor peeked — the character is left mid-air. */
  onDragMiss?: () => void;
  /** An armed sit lost its host — the seat is gone and the character hangs where it was. */
  onSitLost?: () => void;
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
type SettleOutcome =
  | { kind: "sit"; app: string | null; window_title: string | null }
  | { kind: "peek"; side: "left" | "right"; app: string | null; window_title: string | null }
  | { kind: "none" };

/** A gesture asked for by name rather than inferred from where a drag landed. */
export type PlacementRequest =
  | { kind: "sit"; app: string }
  | { kind: "peek"; side: "left" | "right" };

export type PlacementResult =
  | { ok: true; kind: "sit" | "peek" }
  | { ok: false; reason: "not_found" | "blocked" | "interrupted" | "unsupported" };

export interface PlacementOptions {
  /** Polled just before the envelope push — true abandons the placement uncommitted. */
  shouldAbort?: () => boolean;
}

export interface WindowDropSource {
  /** Register the release listener. Idempotent. */
  start(): Promise<void>;
  /** Unregister the release listener + stop the poll. */
  stop(): void;
  /** Alias of stop() for HMR-dispose call sites. */
  dispose(): void;
  /**
   * Put the character on a named target, the inverse of the drag flow: the target is
   * given instead of inferred, so this moves the pet window until the seat lands on it,
   * then pushes and arms exactly what a real drop would. No drag happened, so the
   * drag-release cue does not fire. A seat point covered by a window in front of the
   * target is `blocked`, and nothing moves.
   */
  placeOn(request: PlacementRequest, opts?: PlacementOptions): Promise<PlacementResult>;
  /** The current perch candidates. */
  perchTargets(): Promise<PerchTargets>;
  /**
   * Track a sit the character reached on her own: arms the occlusion poll on the given
   * window without pushing anything, because the mover already published the sit. The
   * origin names who owns the seat afterwards — a climb keeps it, a jump hands it to the
   * perch loop the same way a drag release would.
   */
  adoptSit(
    windowNumber: number,
    rect: { x: number; y: number },
    charHpx: number,
    origin: "commit" | "adopt",
  ): void;
  /** The window an armed sit is held on. null when nothing, or a peek, is armed. */
  armedSit(): { windowNumber: number; origin: "commit" | "adopt" } | null;
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
  /** Release any armed perch/peek and push the matching exit. */
  release(): void;
}

/**
 * Cue payload fields for a perch gesture. context is only composed when the config
 * authored one — built-in cues ship a label alone.
 */
function cueFields(
  cue: GestureCueConfig,
  name: string | null,
): { label: string; context?: string } {
  if (cue.context === undefined) return { label: cue.label };
  return {
    label: cue.label,
    context: name ? `${cue.context} (currently perched on: ${name})` : cue.context,
  };
}

/** Point-in-rect: is the seat actually over this window's surface (points). */
export function containsSeat(win: ScreenRect, seat: ScreenPoint): boolean {
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
  const pollMs = deps.pollIntervalMs ?? PERCH_POLL_MS;
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

  /**
   * Commit a sit on `target`: local edge → cue (unless suppressed) → tier1 drop → arm.
   * `pos` is the pet window's physical origin the character is at when it commits.
   */
  function commitSit(
    target: WindowRect,
    pos: { x: number; y: number },
    scale: number,
    charHpx: number,
    suppressCue: boolean,
  ): SettleOutcome {
    // Global top edge → pet-window-local px (winOriginPts = pos / scale).
    const sf = scale > 0 ? scale : 1;
    const edgeLocalYpx = target.y - pos.y / sf;
    if (!suppressCue) {
      const windowSitCue = getGestureCues().window_sit;
      bus.push({
        source: "os_event_watcher",
        event_name: "proactive.window_sit",
        ts: Date.now(),
        hint_tier: 2,
        payload: {
          cue_id: "window_sit",
          ...cueFields(windowSitCue, target.name),
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
    arm("sit", target.windowNumber, { x: target.x, y: target.y }, charHpx, "commit");
    return { kind: "sit", app: target.ownerName, window_title: target.name };
  }

  /** Commit a peek on `target`'s `side` edge — same shape as {@link commitSit}. */
  function commitPeek(
    target: WindowRect,
    side: "left" | "right",
    pos: { x: number; y: number },
    scale: number,
    charHpx: number,
    peekConfig: PeekConfig,
    suppressCue: boolean,
  ): SettleOutcome {
    const sf = scale > 0 ? scale : 1;
    const edgeXpx = side === "left" ? target.x : target.x + target.width;
    const edgeLocalXpx = edgeXpx - pos.x / sf;
    const targetLocalXpx = peekTargetPx(edgeLocalXpx, side, charHpx, peekConfig.inset_frac);
    if (!suppressCue) {
      const peekCue = getGestureCues().peek;
      bus.push({
        source: "os_event_watcher",
        event_name: "proactive.peek",
        ts: Date.now(),
        hint_tier: 2,
        payload: {
          cue_id: "peek",
          ...cueFields(peekCue, target.name),
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
        app: target.ownerName,
        window_title: target.name,
      },
    });
    arm("peek", target.windowNumber, { x: target.x, y: target.y }, charHpx, null);
    return { kind: "peek", side, app: target.ownerName, window_title: target.name };
  }

  /** The drag-release pass: infer the target from where the seat landed, then commit. */
  async function settle(): Promise<SettleOutcome> {
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
      return commitPeek(sideTarget, side, pos, scale, probe.charHpx, peekConfig, false);
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

    return commitSit(target, pos, scale, probe.charHpx, false);
  }

  /**
   * Every window the app owns, front-to-back: exact owner-name matches first, then
   * partial ones. Plural because the frontmost match is not always sittable — Stage
   * Manager keeps thumbnails of the same app in front of the real window.
   */
  function matchesByApp(windows: WindowRect[], app: string): number[] {
    const needle = app.toLowerCase();
    const indices = windows.map((_, i) => i);
    const exact = indices.filter((i) => windows[i].ownerName?.toLowerCase() === needle);
    const partial = indices.filter(
      (i) => !exact.includes(i) && windows[i].ownerName?.toLowerCase().includes(needle),
    );
    return [...exact, ...partial];
  }

  /** Where the seat must land (global points) for the requested gesture. */
  function seatPointFor(request: PlacementRequest, target: WindowRect): ScreenPoint {
    if (request.kind === "sit") {
      return { x: target.x + target.width / 2, y: target.y };
    }
    return {
      x: request.side === "left" ? target.x : target.x + target.width,
      y: target.y + target.height / 2,
    };
  }

  async function placeOn(
    request: PlacementRequest,
    opts?: PlacementOptions,
  ): Promise<PlacementResult> {
    const probe = renderer.getPerchProbe();
    if (!probe) return { ok: false, reason: "unsupported" };
    const win = getWindow();
    const move = win.setPositionPhysical?.bind(win);
    if (!move) return { ok: false, reason: "unsupported" };

    const [pos, scale, windows] = await Promise.all([
      win.outerPosition(),
      win.scaleFactor(),
      invoke("list_windows"),
    ]);
    // Front-to-back: sit considers every window the app owns, peek the frontmost
    // window outright.
    const candidates = request.kind === "sit" ? matchesByApp(windows, request.app) : [0];
    if (candidates.length === 0 || windows.length === 0) {
      return { ok: false, reason: "not_found" };
    }
    // Take the frontmost candidate whose own seat point is reachable. The covered
    // predicate is the drop path's: a window in front of that candidate holding its
    // seat point means the character would land on that window's surface instead.
    // Only when no candidate is reachable is the request genuinely blocked.
    let chosen: { index: number; target: WindowRect; seat: ScreenPoint } | undefined;
    for (const index of candidates) {
      const target = windows[index];
      const seat = seatPointFor(request, target);
      if (!windows.some((w, i) => i < index && containsSeat(w, seat))) {
        chosen = { index, target, seat };
        break;
      }
      log.debug("placement.candidate_covered", {
        kind: request.kind,
        targetWindowNumber: target.windowNumber,
        seatX: Math.round(seat.x),
        seatY: Math.round(seat.y),
      });
    }
    if (!chosen) {
      log.debug("placement.blocked", { kind: request.kind, candidates: candidates.length });
      return { ok: false, reason: "blocked" };
    }
    const { target, seat } = chosen;

    // Invert projectSeat: shift the window by the seat's global shortfall (points → physical).
    const sf = scale > 0 ? scale : 1;
    const current = projectSeat(probe, pos, scale);
    const next = {
      x: Math.round(pos.x + (seat.x - current.x) * sf),
      y: Math.round(pos.y + (seat.y - current.y) * sf),
    };
    await move(next.x, next.y);
    // The window manager may clamp the move (menu bar, screen bounds), so the local
    // coords have to be computed against where the window actually landed.
    const applied = await win.outerPosition();
    log.debug("placement.moved", {
      kind: request.kind,
      x: applied.x,
      y: applied.y,
      requestedX: next.x,
      requestedY: next.y,
    });
    // Last gate before any side effect: a drag that started during the move wins, and
    // abandoning here keeps the reported outcome honest — nothing was pushed or armed.
    if (opts?.shouldAbort?.()) {
      log.debug("placement.aborted", { kind: request.kind });
      return { ok: false, reason: "interrupted" };
    }
    if (request.kind === "sit") {
      commitSit(target, applied, scale, probe.charHpx, true);
    } else {
      commitPeek(target, request.side, applied, scale, probe.charHpx, getPeekConfig(), true);
    }
    return { ok: true, kind: request.kind };
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
    placeOn,
    perchTargets,
    adoptSit(windowNumber, rect, charHpx, origin) {
      arm("sit", windowNumber, rect, charHpx, origin);
    },
    armedSit() {
      if (armedKind !== "sit" || armedWindowNumber === null || armedOrigin === null) return null;
      return { windowNumber: armedWindowNumber, origin: armedOrigin };
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
          void settle()
            .then((outcome) => {
              if (outcome.kind === "none") deps.onDragMiss?.();
            })
            .catch((err) =>
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
