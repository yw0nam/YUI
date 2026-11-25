/**
 * come-along — one settings window's session on its pet window. On the window's first stage slot
 * she leaves her spot, travels onto the slot and docks: as a native child where the shell links one,
 * else by following each later slot herself, then plays one entry clip of her last backend emotion's
 * Entry family. On the stage her window is the slot, her feet on its bottom edge, and follows every
 * slot the settings window sends. A null slot or the close sends her home at her desktop size. She
 * is picked up and carried on her own monitor, her size easing with her, vanishes and lands across
 * monitors or over a long way, and fades under reduced motion; hidden, her size changes at once.
 * An edge entry plays with her hips pinned beyond her window's right edge (the stage peek pin).
 *
 * Whoever moves her owns her: a drag or an agent move ends the session where she is dropped, and
 * the window's later slots are ignored until it minimises or closes; a drag or agent command
 * running at the open keeps her where she is the same way. Taken off the stage, she gets her
 * desktop size back, bottom-centre, before the mover goes on: at a drag's drop, before an agent's
 * move. Her home and that opt-out sit in session storage, so a reload of her window finds the open
 * session again.
 *
 * While the last backend emotion is angry she sulks: she stays on the desktop with `stay_chance`
 * probability, the same opt-out as a drag at the open, else she comes along and sulks on the stage.
 */

import type { StageConfig } from "../../config/validators/avatar/types";
import type { MotionKind } from "../../contract";
import type { StageSlot } from "../../io/bridge/settings-bridge";
import {
  clampToWorkArea,
  floorPx,
  logicalWorkArea,
  monitorAtLogical,
  type ScreenMonitor,
} from "../../io/window/geometry/screen-geometry";
import type { FrameWindow, Travel } from "../../io/window/geometry/travel-frame";
import { latestOnly } from "../../io/window/latest-only";
import { createLogger } from "../../logger";
import type { Renderer } from "../../renderer";
import type { HoldOptions } from "../locomotion/hold/holds";
import { pickEntry } from "./entry-pick";
import {
  bottomCentred,
  differs,
  dockFrame,
  easedFrame,
  type Frame,
  type Size,
} from "./stage-frame";
import { createStagePin } from "./stage-pin";

const log = createLogger("come-along");

const SULK_MOTION_ID = "sulk";
const DRAG_MOTION_ID = "drag";

/** Slow at the start, faster through the middle, slow again on arrival. */
const easeInOutCubic = (t: number): number => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);

type Point = { x: number; y: number };

/** What a reload of her window keeps: where she goes home to, or that she stays this session. */
type SessionRecord = { home: Frame } | { stays: true };

export interface ComeAlongDeps {
  /** The settings window's label, which keys what `storage` keeps. */
  settingsLabel: string;
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  /** A user drag or an agent command holds her. */
  isBusy(): boolean;
  peek: { active(): boolean; exit(): Promise<void> };
  locomotion: {
    hold(holder: "come-along", on: boolean, opts?: HoldOptions): void;
    abortTravel(): Promise<void>;
    widen(via: Point[], end?: Frame): Promise<Travel>;
    release(): void;
    drop(opts: { landOnSeam: true }): Promise<void>;
    /** Whether a travel parks her real window, as the open Character menu does. */
    isTravelling(): boolean;
    frame: { frameWindow(): FrameWindow; listMonitors(): Promise<ScreenMonitor[]> };
  };
  renderer: Pick<
    Renderer,
    | "onTick"
    | "playMotion"
    | "getCurrentMotion"
    | "getCurrentMotionTime"
    | "setPeekTarget"
    | "setMotionMirror"
    | "getPerchProbe"
    | "getCharacterAnchor"
    | "vanish"
    | "appear"
    | "land"
  >;
  hitTest: { setMoving(moving: boolean): void };
  /** Links her window into the settings window; resolves whether a native link is in effect. */
  dock: { attach(): Promise<boolean>; detach(): Promise<void> };
  /** Sets her window's frame in physical px, the settings window's own when it follows another scale. */
  setFramePhysical(x: number, y: number, width: number, height: number): Promise<void>;
  /** Follows a settings window she is not linked to in its physical px (Windows), else in logical points. */
  followsInPhysicalPx: boolean;
  /** Her page's height now, which the renderer's feet anchor and probe are measured in. */
  pageHeight(): number;
  /** Settles once her page is `width` × `height` and the renderer has refit to it. */
  refitTo(width: number, height: number): Promise<void>;
  reducedMotion(): boolean;
  /** The travel and staying tuning, read at use. */
  stage(): StageConfig;
  /** The last backend emotion, neutral once older than `decayMs`. */
  lastEmotion(decayMs: number): string;
  /** A draw in [0, 1) for the stay roll and the entry pick. */
  random(): number;
  /** A registered motion's kind. */
  getMotionKind(id: string): MotionKind | undefined;
}

export function createComeAlong(deps: ComeAlongDeps): {
  /** A settings window's stage slot: starts her session or moves her with it; null ends it. */
  onStage(slot: StageSlot | null): Promise<void>;
  /** The settings window closes or minimises: she goes home. */
  goHome(): Promise<void>;
  /** Places her on the latest slot again, after another holder let go of her. */
  place(): Promise<void>;
  /** A mover took her window: a desktop size she is owed comes back, bottom-centre where she is. */
  restoreSize(): Promise<void>;
} {
  const { locomotion, renderer } = deps;
  const key = `yui.come-along.${deps.settingsLabel}`;
  let session: "none" | "staying" | "on-stage" = "none";
  let slot: StageSlot | null = null;
  // Her frame where she left her spot, her desktop size.
  let home: Frame | null = null;
  let docked: { native: boolean } | null = null;
  // Each move gets a new id; a move owns her while `move` is still its id.
  let move = 0;
  let stopTick: (() => void) | null = null;
  // A vanish left her canvas invisible, and no land or appear has shown her since.
  let hidden = false;
  // Her `drag` is the come-along's own pickup until a set-down motion replaces it.
  let carried = false;
  // Her last submitted place write; whoever takes her next waits for it to land.
  let placed: Promise<unknown> = Promise.resolve();
  // The desktop size a mover that took her off the stage gives back, once her last write landed.
  let owed: Promise<Size | null> = Promise.resolve(null);
  // Each Entry family's last played clip, for this window's memory only.
  const lastClips = new Map<string, string>();
  const pin = createStagePin({
    renderer,
    reducedMotion: deps.reducedMotion,
    releaseMs: () => deps.stage().edge_release_ms,
    getMotionKind: deps.getMotionKind,
  });

  /** Stops whatever move runs and returns the id of the one that takes over. */
  const takeOver = (): number => {
    stopTick?.();
    move += 1;
    return move;
  };

  function load(): SessionRecord | null {
    try {
      return JSON.parse(deps.storage.getItem(key) ?? "null") as SessionRecord | null;
    } catch {
      return null;
    }
  }
  function store(value: SessionRecord | null): void {
    try {
      if (value) deps.storage.setItem(key, JSON.stringify(value));
      else deps.storage.removeItem(key);
    } catch (err) {
      log.warn("come_along_store_failed", { error: String(err) });
    }
  }

  async function read(): Promise<{ at: Point; size: { width: number; height: number } }> {
    const win = locomotion.frame.frameWindow();
    const [pos, size, sf] = await Promise.all([
      win.outerPosition(),
      win.outerSize(),
      win.scaleFactor(),
    ]);
    const scale = sf > 0 ? sf : 1;
    return {
      at: { x: pos.x / scale, y: pos.y / scale },
      size: { width: size.width / scale, height: size.height / scale },
    };
  }

  /** How far down her height her feet stand, else 1; she is drawn to her window's height. */
  function feetShare(): number {
    const page = deps.pageHeight();
    const feet = renderer.getCharacterAnchor()?.y;
    return feet === undefined || page <= 0 ? 1 : feet / page;
  }

  /** Sets her window's frame `f` in one call. */
  const writeFrame = (win: FrameWindow, f: Frame): Promise<void> =>
    win.setFrameLogical(f.x, f.y, f.width, f.height);

  /** How much taller her window `to` draws her than her page does now. */
  const heightScale = (to: Frame): number => to.height / deps.pageHeight();

  /** Shows her canvas again when a vanish left it invisible. */
  function show(): void {
    if (!hidden) return;
    hidden = false;
    void renderer.appear();
  }

  /** Runs `frame` with the elapsed ms on each tick until it returns true or a takeover stops it. */
  function tickUntil(frame: (elapsedMs: number) => boolean): Promise<void> {
    return new Promise<void>((resolve) => {
      let elapsedMs = 0;
      let off = (): void => {};
      stopTick = () => {
        off();
        stopTick = null;
        resolve();
      };
      off = renderer.onTick(({ dt }) => {
        elapsedMs += dt * 1000;
        if (frame(elapsedMs)) stopTick?.();
      });
    });
  }

  /** She is picked up and held still; no VRM ticks the clock, so none holds her. */
  async function pickUp(): Promise<void> {
    carried = true;
    renderer.playMotion({ id: DRAG_MOTION_ID });
    const holdMs = renderer.getCharacterAnchor() ? deps.stage().pickup_hold_ms : 0;
    if (holdMs > 0) await tickUntil((elapsedMs) => elapsedMs >= holdMs);
  }

  /** Moves her window to `to`: a carry, else a vanish across monitors or a long way, else a fade. */
  async function travel(id: number, to: Frame): Promise<void> {
    try {
      const [{ at: from, size }, monitors] = await Promise.all([
        read(),
        locomotion.frame.listMonitors(),
      ]);
      if (id !== move) return;
      const distance = Math.hypot(to.x - from.x, to.y - from.y);
      const win = locomotion.frame.frameWindow();
      if (distance < 1) {
        pin.arm(to.width, heightScale(to));
        return writeFrame(win, to);
      }
      const stage = deps.stage();
      const on = monitorAtLogical(monitors, from.x + size.width / 2, from.y + size.height / 2);
      const crosses =
        !on || monitorAtLogical(monitors, to.x + to.width / 2, to.y + to.height / 2) !== on;
      const reduced = deps.reducedMotion();
      if (!reduced && !crosses && distance <= stage.carry_full_pt) {
        // A carry that took over mid-vanish shows her before she sets off.
        show();
        return carryOver(
          id,
          { ...from, ...size },
          to,
          stage.carry_ms + stage.carry_extra_ms * (distance / stage.carry_full_pt),
        );
      }
      const mode = reduced ? "fade" : "vanish";
      const startedMs = performance.now();
      deps.hitTest.setMoving(true);
      if (mode === "vanish") await pickUp();
      if (id !== move) return;
      hidden = true;
      await renderer.vanish();
      if (id !== move) return;
      // Measured at her height before the frame changes.
      pin.arm(to.width, heightScale(to));
      await writeFrame(win, to);
      if (id !== move) return;
      hidden = false;
      const feet = renderer.getCharacterAnchor();
      await (mode === "vanish" && feet ? renderer.land(feet) : renderer.appear());
      log.info("come_along_move", {
        mode,
        from,
        to,
        ms: Math.round(performance.now() - startedMs),
      });
    } finally {
      // Only the move that still owns her shows her canvas and ends her hit-test move.
      if (id === move) {
        show();
        deps.hitTest.setMoving(false);
      }
    }
  }

  /** Carries her window to `to` over the parked travel frame, her size eased with her; she arrives still in `drag`. */
  async function carryOver(id: number, from: Frame, to: Frame, durationMs: number): Promise<void> {
    const parked = await locomotion.widen([], to);
    if (id !== move) {
      await parked.end();
      return;
    }
    deps.hitTest.setMoving(true);
    await pickUp();
    if (id !== move) {
      await parked.end();
      return;
    }
    pin.arm(from.width, 1, durationMs);
    const startedMs = performance.now();
    let frames = 0;
    await tickUntil((elapsedMs) => {
      frames += 1;
      const at = easedFrame(from, to, easeInOutCubic(Math.min(1, elapsedMs / durationMs)));
      void writeFrame(parked.win, at).catch((err) =>
        log.warn("come_along_move_failed", { error: String(err) }),
      );
      // The view takes the frame at once, so the pin aims in it.
      pin.reaim(at.width, 1);
      return elapsedMs >= durationMs;
    });
    // Wall time against the curve's time shows a carry the renderer paused (a hidden document).
    log.info("come_along_move", {
      mode: "carry",
      from,
      to,
      ms: Math.round(durationMs),
      wallMs: Math.round(performance.now() - startedMs),
      frames,
    });
    await parked.end();
  }

  /** Sets her down into `motion`, ending the come-along's pickup. */
  function setDown(motion: { id: string } | null): void {
    carried = false;
    renderer.playMotion(motion);
  }

  /** Stops her move and lets her go: no dock, no home, no hold, no pin; `idle` sets down her pickup. */
  function letGo(idle: boolean): void {
    takeOver();
    pin.snap();
    if (carried && idle && renderer.getCurrentMotion()?.id === DRAG_MOTION_ID) setDown(null);
    carried = false;
    docked = null;
    home = null;
    locomotion.hold("come-along", false);
    deps.hitTest.setMoving(false);
    show();
  }

  /** A drag or an agent move took her: she stays, this window's session lets her go, and owes her size back. */
  function yieldToMover(by: "agent" | "drag"): Promise<void> {
    const wasDocked = docked;
    const spot = home;
    if (session === "on-stage") {
      session = "staying";
      store({ stays: true });
    }
    // A user drag plays its own drag motion.
    letGo(by !== "drag");
    log.info("come_along_taken");
    const detached = wasDocked?.native
      ? deps.dock.detach().catch((err) => log.warn("dock_detach_failed", { error: String(err) }))
      : null;
    const landed = Promise.all([placed, detached]).then(() => {});
    if (spot) owed = landed.then(() => ({ width: spot.width, height: spot.height }));
    return landed;
  }

  async function restoreSize(): Promise<void> {
    const pending = owed;
    owed = Promise.resolve(null);
    const to = await pending;
    if (!to) return;
    try {
      const { at, size } = await read();
      if (!differs({ ...at, ...size }, { ...at, ...to })) return;
      const frame = bottomCentred({ ...at, ...size }, to);
      await writeFrame(locomotion.frame.frameWindow(), frame);
      await deps.refitTo(to.width, to.height);
      log.info("come_along_size_restored", { frame });
    } catch (err) {
      log.warn("come_along_restore_failed", { error: String(err) });
    }
  }

  async function start(rect: StageSlot): Promise<void> {
    const stored = load();
    if (stored && "stays" in stored) {
      session = "staying";
      return;
    }
    /** She stays on the desktop for this window's session. */
    const stay = (event: "come_along_stayed" | "come_along_sulked"): void => {
      session = "staying";
      store({ stays: true });
      log.info(event);
    };
    if (deps.isBusy()) return stay("come_along_stayed");
    const stage = deps.stage();
    const emotion = deps.lastEmotion(stage.emotion_decay_min * 60_000);
    const angry = emotion === "angry";
    if (angry && deps.random() < stage.stay_chance) {
      renderer.playMotion({ id: SULK_MOTION_ID });
      return stay("come_along_sulked");
    }
    session = "on-stage";
    const id = takeOver();
    // Whoever moves her owns her; on the stage her bounds are the slot's, not her own spot's.
    locomotion.hold("come-along", true, {
      onAbort: yieldToMover,
      endsOnDrag: true,
      keepsGeometry: true,
      pausesKeepOnScreen: true,
    });
    if (deps.peek.active()) await deps.peek.exit();
    await locomotion.abortTravel();
    locomotion.release();
    if (id !== move) return;
    const { at, size } = await read();
    if (id !== move) return;
    const target = dockFrame(rect, feetShare());
    let entry: { family: string; clip: string } | null = null;
    if (stored && "home" in stored) {
      home = stored.home;
      await writeFrame(locomotion.frame.frameWindow(), target);
    } else {
      // A trip home that this window interrupted keeps the spot and size she left from.
      home ??= { ...at, ...size };
      store({ home });
      if (!angry) entry = pickEntry(stage.entry_families, emotion, lastClips, deps.random);
      pin.plan((entry && stage.edge_entries[entry.clip]) ?? null);
      await travel(id, target);
    }
    if (id !== move) return;
    let native = false;
    try {
      native = await deps.dock.attach();
    } catch (err) {
      log.warn("dock_attach_failed", { error: String(err) });
    }
    if (id !== move) {
      if (native) await deps.dock.detach();
      return;
    }
    docked = { native };
    log.info("come_along_docked", {
      native,
      slot: rect,
      feet: renderer.getCharacterAnchor()?.y ?? null,
      frame: target,
    });
    if (angry) setDown({ id: SULK_MOTION_ID });
    if (entry) {
      setDown({ id: entry.clip });
      lastClips.set(entry.family, entry.clip);
      pin.watch(entry.clip);
    }
    await place();
  }

  async function placeOnce(): Promise<void> {
    const rect = slot;
    // A parked frame is not her window's own rect; the newest slot waits for the next place.
    if (!rect || !docked || locomotion.isTravelling()) return;
    const win = locomotion.frame.frameWindow();
    // Windows: the whole frame in the settings window's scale.
    const px = !docked.native && deps.followsInPhysicalPx;
    const { at, size } = await read();
    const [now, outer] = px
      ? await Promise.all([win.outerPosition(), win.outerSize()])
      : [at, size];
    if (!docked) return;
    const target = dockFrame(rect, feetShare());
    pin.reaim(target.width, heightScale(target));
    const k = px ? rect.scale : 1;
    const to = {
      x: Math.round(target.x * k),
      y: Math.round(target.y * k),
      width: Math.round(target.width * k),
      height: Math.round(target.height * k),
    };
    if (!differs(to, { ...now, ...outer })) return;
    log.info("come_along_placed", { slot: rect, frame: to, ...(px && { px: true }) });
    const write = px ? deps.setFramePhysical(to.x, to.y, to.width, to.height) : writeFrame(win, to);
    placed = write.catch(() => {});
    await write;
  }

  const placeLatest = latestOnly(placeOnce);
  const place = (): Promise<void> =>
    placeLatest().catch((err) => log.warn("come_along_place_failed", { error: String(err) }));

  /** Her spot at her desktop size, or the nearest monitor's floor when no monitor holds its centre any more. */
  async function homeOrFloor(spot: Frame): Promise<Frame> {
    const monitors = await locomotion.frame.listMonitors();
    // Judged by the frame she left, so a size she took on the stage cannot move her spot off-screen.
    const centre = { x: spot.x + spot.width / 2, y: spot.y + spot.height / 2 };
    if (monitors.length === 0 || monitorAtLogical(monitors, centre.x, centre.y)) return spot;
    const gap = (m: ScreenMonitor): number => {
      const work = logicalWorkArea(m);
      const dx = Math.max(work.x - centre.x, 0, centre.x - (work.x + work.width));
      const dy = Math.max(work.y - centre.y, 0, centre.y - (work.y + work.height));
      return dx * dx + dy * dy;
    };
    const nearest = monitors.reduce((a, b) => (gap(b) < gap(a) ? b : a));
    const work = logicalWorkArea(nearest);
    log.info("come_along_home_gone", { spot });
    return {
      x: Math.round(clampToWorkArea(spot.x, 0, spot.width, 0, work.x, 0, work.width, 0).x),
      y: Math.round(floorPx(nearest) - feetShare() * spot.height),
      width: spot.width,
      height: spot.height,
    };
  }

  async function goHome(): Promise<void> {
    const was = session;
    session = "none";
    store(null);
    if (was !== "on-stage") return;
    const id = takeOver();
    pin.snap();
    const wasDocked = docked;
    docked = null;
    let arrived = false;
    try {
      try {
        if (wasDocked?.native) await deps.dock.detach();
      } catch (err) {
        log.warn("dock_detach_failed", { error: String(err) });
      }
      await locomotion.abortTravel();
      await placed;
      // A start still leaving her spot has no home yet: she lets go where she is.
      const spot = home;
      if (id === move && spot) {
        await travel(id, await homeOrFloor(spot));
        arrived = id === move;
      }
    } finally {
      // Whatever ended the trip home lets her go, unless a new move took her over.
      if (id === move) {
        home = null;
        locomotion.hold("come-along", false);
      }
    }
    if (!arrived) return;
    log.info("come_along_home");
    setDown(null);
    await locomotion.drop({ landOnSeam: true });
  }

  /** A failed start or trip home lets her go where she is, and the next slot starts afresh. */
  async function releaseOnFailure(step: Promise<void>): Promise<void> {
    try {
      await step;
    } catch (err) {
      session = "none";
      store(null);
      letGo(true);
      throw err;
    }
  }

  return {
    async onStage(next) {
      if (next === null) return releaseOnFailure(goHome());
      slot = next;
      if (session === "none") return releaseOnFailure(start(next));
      if (session === "on-stage") return place();
    },
    goHome: () => releaseOnFailure(goHome()),
    place,
    restoreSize,
  };
}
