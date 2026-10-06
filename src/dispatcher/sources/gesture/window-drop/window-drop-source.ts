/**
 * window-drop-source — Rust `window_drop_release` → bus envelope producer.
 *
 * Client-firing, backend-bypassed (firing ≠ judgment): on a drag-release the
 * client decides whether the character's *seat* landed over a foreign window's
 * top- or side-edge catch zone, and emits a tier1 bus event the dispatcher renders
 * locally. No brain, no agent call.
 *
 * Flow on each release:
 *   1. probe = renderer.getPerchProbe(). null (no VRM / projection failed) →
 *      push user.window_sit_exit when something was held at pickup, and stop.
 *   2. seatGlobal = petPxToGlobalPoints(seatPx, outerPosition, scaleFactor).
 *   3. windows = invoke("list_windows")  (front-to-back, topmost first).
 *   4. target = first window whose catch zone contains the seat (topmost wins).
 *   5. hit → proactive.window_sit at once, the sit-down plays in place, then
 *      user.window_sit_drop { edge_local_ypx } + arm the poll on target.windowNumber,
 *      both read off the host as it is when the sit lands; miss → user.window_sit_exit
 *      when the character was sitting or peeking at pickup.
 *
 * A mover that seated the character itself adopts the same poll through `adoptSit`,
 * which arms on a window without pushing anything. The armed state and its detach
 * poll live in perch-watch; programmatic placement lives in placement.
 *
 * Tauri deps (invoke / getWindow / listen) are injected so the module is unit-
 * testable without the Tauri runtime. Never throws to the caller — failures
 * degrade to a warn log.
 */

import type {
  GestureCueConfig,
  GestureCuesConfig,
  PeekConfig,
} from "../../../../config/validators/avatar/types";
import type { WindowRect } from "../../../../contract";
import type {
  PerchTargets,
  PlacementOptions,
  PlacementRequest,
  PlacementResult,
} from "../../../../io/window/geometry/perch";
import { containsSeat } from "../../../../io/window/geometry/perch";
import { createLogger } from "../../../../logger";
import type { ScreenPoint } from "../../../../renderer/geometry/probe/perch-geometry";
import {
  inCatchZone,
  inSideCatchZone,
  peekTargetPx,
} from "../../../../renderer/geometry/probe/perch-geometry";
import type { EventBus } from "../../../core/event-bus";
import {
  createPerchWatch,
  type DropInvoke,
  type DropWindow,
  type PerchProbeSource,
  type PerchWatch,
  projectSeat,
} from "./perch-watch";
import { createPlacement } from "./placement";

const log = createLogger("window-drop");

/** Tauri event channel carrying the drag-release point (payload unused by the seat hit-test). */
const RELEASE_EVENT = "window_drop_release";

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
  /** Play the sit-down where she is. "lost" means a pickup took her before it landed. */
  sitDown: () => Promise<"done" | "lost">;
  /** Injectable timer fns (fake timers in tests). */
  setInterval?: typeof setInterval;
  clearInterval?: typeof clearInterval;
}

/** What a settle pass landed on. `interrupted` is a sit whose sit-down a pickup cut short. */
type SettleOutcome =
  | { kind: "sit"; app: string | null; window_title: string | null }
  | { kind: "peek"; side: "left" | "right"; app: string | null; window_title: string | null }
  | { kind: "none" }
  | { kind: "interrupted" };

export interface WindowDropSource {
  /** Register the release listener. Idempotent. */
  start(): Promise<void>;
  /** Unregister the release listener + stop the poll. */
  stop(): void;
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
  /** Release any armed perch/peek and push the matching exit; a release with nothing held is silent. */
  release(): void;
  /** Record at drag start whether a perch/peek is held, for the release that follows. */
  notePickup(): void;
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
  const getPeekConfig = deps.getPeekConfig;
  const getGestureCues = deps.getGestureCues;

  let unlisten: (() => void) | undefined;
  let heldAtPickup = false;

  const perch: PerchWatch = createPerchWatch({
    bus,
    renderer,
    invoke,
    getWindow,
    peekActive: deps.peekActive ?? (() => false),
    onSitLost: () => deps.onSitLost?.(),
    setInterval: deps.setInterval ?? setInterval,
    clearInterval: deps.clearInterval ?? clearInterval,
  });

  /**
   * Commit a sit on `target`: cue (unless suppressed) → sit-down → local edge → tier1 drop
   * → arm. `pos` is the pet window's physical origin the character is at when it commits;
   * the window stays there, so the sit-down plays in place. The host can move or close
   * while the clip plays, so the edge and the arm read the stack again once it lands, and
   * a host that has gone is a miss.
   */
  async function commitSit(
    dropped: WindowRect,
    pos: { x: number; y: number },
    scale: number,
    charHpx: number,
    suppressCue: boolean,
  ): Promise<SettleOutcome> {
    if (!suppressCue) {
      const windowSitCue = getGestureCues().window_sit;
      bus.push({
        source: "os_event_watcher",
        event_name: "proactive.window_sit",
        ts: Date.now(),
        payload: {
          cue_id: "window_sit",
          ...cueFields(windowSitCue, dropped.name),
        },
      });
    }
    if ((await deps.sitDown()) !== "done") {
      log.debug("perch.sit_interrupted", { targetWindowNumber: dropped.windowNumber });
      return { kind: "interrupted" };
    }
    const target = (await invoke("list_windows")).find(
      (w) => w.windowNumber === dropped.windowNumber,
    );
    if (!target) {
      log.debug("perch.host_gone_before_seat", { targetWindowNumber: dropped.windowNumber });
      perch.pushExit();
      return { kind: "none" };
    }
    // Global top edge → pet-window-local px (winOriginPts = pos / scale).
    const sf = scale > 0 ? scale : 1;
    const edgeLocalYpx = target.y - pos.y / sf;
    bus.push({
      source: "os_event_watcher",
      event_name: "user.window_sit_drop",
      ts: Date.now(),
      payload: {
        edge_local_ypx: edgeLocalYpx,
        app: target.ownerName,
        window_title: target.name,
      },
    });
    perch.arm("sit", target.windowNumber, { x: target.x, y: target.y }, charHpx, "commit");
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
      payload: {
        side,
        target_local_xpx: targetLocalXpx,
        app: target.ownerName,
        window_title: target.name,
      },
    });
    perch.arm("peek", target.windowNumber, { x: target.x, y: target.y }, charHpx, null);
    return { kind: "peek", side, app: target.ownerName, window_title: target.name };
  }

  /** The drag-release pass: infer the target from where the seat landed, then commit. */
  async function settle(): Promise<SettleOutcome> {
    const held = heldAtPickup;
    heldAtPickup = false;
    function miss(): SettleOutcome {
      if (held) perch.pushExit();
      return { kind: "none" };
    }
    const probe = renderer.getPerchProbe();
    // No VRM / projection unavailable → nothing to perch; leave to idle.
    if (!probe) return miss();

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
      if (sideTargetIdx < 0) return miss();
      const sideTarget = windows[sideTargetIdx];
      if (windows.some((w, i) => i < sideTargetIdx && containsSeat(w, seatGlobal))) {
        log.debug("peek.drop_covered", { targetWindowNumber: sideTarget.windowNumber });
        return miss();
      }
      const side = inSideCatchZone(seatGlobal, sideTarget, probe.charHpx, sideOpts);
      if (side === null) return miss();
      return commitPeek(sideTarget, side, pos, scale, probe.charHpx, peekConfig, false);
    }
    const target = windows[targetIdx];
    // Same covered predicate as the occlusion poll, applied at drop time: a window
    // in front of the match containing the seat means the seat visually lands on
    // that window's surface, not on the matched top edge — miss, no perch.
    if (windows.some((w, i) => i < targetIdx && containsSeat(w, seatGlobal))) {
      log.debug("perch.drop_covered", { targetWindowNumber: target.windowNumber });
      return miss();
    }

    return commitSit(target, pos, scale, probe.charHpx, false);
  }

  const placeOn = createPlacement({
    renderer,
    invoke,
    getWindow,
    getPeekConfig,
    commitSit,
    commitPeek,
  });

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
    adoptSit: perch.adoptSit,
    armedSit: perch.armedSit,
    suspendSit: perch.suspendSit,
    resumeSit: perch.resumeSit,
    abandonSit: perch.abandonSit,
    release: perch.release,
    notePickup() {
      heldAtPickup = perch.isHeld();
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
      perch.disarm();
      unlisten?.();
      unlisten = undefined;
    },
  };
}
