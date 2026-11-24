/**
 * come-along — one settings window's session on its pet window. On the window's first stage slot
 * she leaves her spot, walks onto the slot and docks: as a native child where the shell links one,
 * else by following each later slot herself. A null slot or the close sends her home.
 *
 * Whoever moves her owns her: a drag or an agent move ends the session where she is dropped, and
 * the window's later slots are ignored until it minimises or closes; a drag or agent command
 * running at the open keeps her where she is the same way. Her home and that opt-out sit in
 * session storage, so a reload of her window finds the open session again.
 */

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
import { WALK_MOTION_ID, WALK_YAW_EASE_MS, WALK_YAW_RAD } from "../locomotion/walk/walker";

const log = createLogger("come-along");

/** A walk takes 600 ms, and up to 300 ms more by distance, all of it at 1200 pt. */
const WALK_MS = 600;
const WALK_EXTRA_MS = 300;
const WALK_FULL_PT = 1200;

/** Slow at the start, faster through the middle, slow again on arrival. */
const easeInOutCubic = (t: number): number => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);

type Point = { x: number; y: number };

/** What a reload of her window keeps: where she goes home to, or that she stays this session. */
type SessionRecord = { home: Point } | { stays: true };

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
    widen(via: Point[]): Promise<Travel>;
    release(): void;
    drop(opts: { landOnSeam: true }): Promise<void>;
    /** Whether a travel parks her real window, as the open Character menu does. */
    isTravelling(): boolean;
    frame: { frameWindow(): FrameWindow; listMonitors(): Promise<ScreenMonitor[]> };
  };
  renderer: Pick<
    Renderer,
    "onTick" | "playMotion" | "getCurrentMotion" | "setBodyYaw" | "getCharacterAnchor"
  >;
  hitTest: { setMoving(moving: boolean): void };
  /** Links her window into the settings window; resolves whether a native link is in effect. */
  dock: { attach(): Promise<boolean>; detach(): Promise<void> };
  setPositionPhysical(x: number, y: number): Promise<void>;
  /** Follows a settings window she is not linked to in its physical px (Windows), else in logical points. */
  followsInPhysicalPx: boolean;
  reducedMotion(): boolean;
}

export function createComeAlong(deps: ComeAlongDeps): {
  /** A settings window's stage slot: starts her session or moves her with it; null ends it. */
  onStage(slot: StageSlot | null): Promise<void>;
  /** The settings window closes or minimises: she walks home. */
  goHome(): Promise<void>;
  /** Places her on the latest slot again, after her own window was resized or a travel ended. */
  place(): Promise<void>;
} {
  const { locomotion, renderer } = deps;
  const key = `yui.come-along.${deps.settingsLabel}`;
  let session: "none" | "staying" | "on-stage" = "none";
  let slot: StageSlot | null = null;
  let home: Point | null = null;
  let docked: { native: boolean } | null = null;
  // Each move gets a new id; a move owns her while `move` is still its id.
  let move = 0;
  let stopTick: (() => void) | null = null;

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

  /** Her window's origin that stands her feet, else its bottom, centred on the slot's bottom edge. */
  const dockOrigin = (rect: StageSlot, size: { width: number; height: number }): Point => ({
    x: Math.round(rect.x + (rect.width - size.width) / 2),
    y: Math.round(rect.y + rect.height - (renderer.getCharacterAnchor()?.y ?? size.height)),
  });

  /** Walks her window to `to` over the parked travel frame; resolves on arrival or once stopped. */
  async function walk(id: number, to: Point): Promise<void> {
    const { at: from } = await read();
    if (id !== move) return;
    const distance = Math.hypot(to.x - from.x, to.y - from.y);
    if (deps.reducedMotion() || distance < 1) {
      await locomotion.frame.frameWindow().setPositionLogical(to.x, to.y);
      return;
    }
    const travel = await locomotion.widen([to]);
    if (id !== move) {
      await travel.end();
      return;
    }
    const durationMs = WALK_MS + WALK_EXTRA_MS * Math.min(1, distance / WALK_FULL_PT);
    renderer.playMotion({ id: WALK_MOTION_ID });
    renderer.setBodyYaw(Math.sign(to.x - from.x) * WALK_YAW_RAD, WALK_YAW_EASE_MS);
    deps.hitTest.setMoving(true);
    await new Promise<void>((resolve) => {
      let elapsedMs = 0;
      let off = (): void => {};
      stopTick = () => {
        off();
        stopTick = null;
        resolve();
      };
      off = renderer.onTick(({ dt }) => {
        elapsedMs += dt * 1000;
        const p = easeInOutCubic(Math.min(1, elapsedMs / durationMs));
        void travel.win
          .setPositionLogical(
            Math.round(from.x + (to.x - from.x) * p),
            Math.round(from.y + (to.y - from.y) * p),
          )
          .catch((err) => log.warn("come_along_move_failed", { error: String(err) }));
        if (elapsedMs >= durationMs) stopTick?.();
      });
    });
    if (renderer.getCurrentMotion()?.id === WALK_MOTION_ID) renderer.playMotion(null);
    renderer.setBodyYaw(0, WALK_YAW_EASE_MS);
    deps.hitTest.setMoving(false);
    await travel.end();
  }

  /** A drag or an agent move took her: she stays, and this window's session lets her go. */
  function yieldToMover(): Promise<void> {
    takeOver();
    const wasDocked = docked;
    docked = null;
    home = null;
    if (session === "on-stage") {
      session = "staying";
      store({ stays: true });
    }
    locomotion.hold("come-along", false);
    deps.hitTest.setMoving(false);
    log.info("come_along_taken");
    return wasDocked?.native
      ? deps.dock.detach().catch((err) => log.warn("dock_detach_failed", { error: String(err) }))
      : Promise.resolve();
  }

  async function start(rect: StageSlot): Promise<void> {
    const stored = load();
    if (stored && "stays" in stored) {
      session = "staying";
      return;
    }
    if (deps.isBusy()) {
      session = "staying";
      store({ stays: true });
      log.info("come_along_stayed");
      return;
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
    const target = dockOrigin(rect, size);
    if (stored && "home" in stored) {
      home = stored.home;
      await locomotion.frame.frameWindow().setPositionLogical(target.x, target.y);
    } else {
      // A walk home that this window interrupted keeps the spot she left from.
      home ??= at;
      store({ home });
      await walk(id, target);
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
    log.info("come_along_docked", { native });
    await place();
  }

  async function placeOnce(): Promise<void> {
    const rect = slot;
    // A parked frame is not her window's own rect; the newest slot waits for the next place.
    if (!rect || !docked || locomotion.isTravelling()) return;
    const win = locomotion.frame.frameWindow();
    if (docked.native || !deps.followsInPhysicalPx) {
      const { at, size } = await read();
      const target = dockOrigin(rect, size);
      if (docked && Math.max(Math.abs(target.x - at.x), Math.abs(target.y - at.y)) >= 1)
        await win.setPositionLogical(target.x, target.y);
      return;
    }
    // Windows: the whole target in the settings window's scale, her size included.
    const [pos, { size }] = await Promise.all([win.outerPosition(), read()]);
    const target = dockOrigin(rect, size);
    const x = Math.round(target.x * rect.scale);
    const y = Math.round(target.y * rect.scale);
    if (docked && Math.max(Math.abs(x - pos.x), Math.abs(y - pos.y)) >= 1)
      await deps.setPositionPhysical(x, y);
  }

  const placeLatest = latestOnly(placeOnce);
  const place = (): Promise<void> =>
    placeLatest().catch((err) => log.warn("come_along_place_failed", { error: String(err) }));

  /** Her spot, or the nearest monitor's floor when no monitor holds its centre any more. */
  async function homeOrFloor(spot: Point): Promise<Point> {
    const [monitors, { size }] = await Promise.all([locomotion.frame.listMonitors(), read()]);
    const centre = { x: spot.x + size.width / 2, y: spot.y + size.height / 2 };
    if (monitors.length === 0 || monitorAtLogical(monitors, centre.x, centre.y)) return spot;
    const gap = (m: ScreenMonitor): number => {
      const work = logicalWorkArea(m);
      const dx = Math.max(work.x - centre.x, 0, centre.x - (work.x + work.width));
      const dy = Math.max(work.y - centre.y, 0, centre.y - (work.y + work.height));
      return dx * dx + dy * dy;
    };
    const nearest = monitors.reduce((a, b) => (gap(b) < gap(a) ? b : a));
    const work = logicalWorkArea(nearest);
    const feet = renderer.getCharacterAnchor()?.y ?? size.height;
    log.info("come_along_home_gone", { spot });
    return {
      x: Math.round(clampToWorkArea(spot.x, 0, size.width, 0, work.x, 0, work.width, 0).x),
      y: Math.round(floorPx(nearest) - feet),
    };
  }

  async function goHome(): Promise<void> {
    const was = session;
    session = "none";
    store(null);
    if (was !== "on-stage") return;
    const id = takeOver();
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
      // A start still leaving her spot has no home yet: she lets go where she is.
      const spot = home;
      if (id === move && spot) {
        await walk(id, await homeOrFloor(spot));
        arrived = id === move;
      }
    } finally {
      // Whatever ended the walk home lets her go, unless a new move took her over.
      if (id === move) {
        home = null;
        locomotion.hold("come-along", false);
      }
    }
    if (!arrived) return;
    log.info("come_along_home");
    await locomotion.drop({ landOnSeam: true });
  }

  /** A failed start or walk home lets her go where she is, and the next slot starts afresh. */
  async function releaseOnFailure(step: Promise<void>): Promise<void> {
    try {
      await step;
    } catch (err) {
      takeOver();
      session = "none";
      docked = null;
      home = null;
      store(null);
      locomotion.hold("come-along", false);
      deps.hitTest.setMoving(false);
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
  };
}
