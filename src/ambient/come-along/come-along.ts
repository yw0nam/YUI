/**
 * come-along — one settings window's session on its pet window. On the window's first stage slot
 * she leaves her spot, travels onto the slot and docks: as a native child where the shell links one,
 * else by following each later slot herself. A null slot or the close sends her home. She walks on
 * her own monitor, vanishes and lands across monitors or over a long way, and fades under reduced
 * motion.
 *
 * Whoever moves her owns her: a drag or an agent move ends the session where she is dropped, and
 * the window's later slots are ignored until it minimises or closes; a drag or agent command
 * running at the open keeps her where she is the same way. Her home and that opt-out sit in
 * session storage, so a reload of her window finds the open session again.
 *
 * While the last backend emotion is angry she sulks: she stays on the desktop with `stay_chance`
 * probability, the same opt-out as a drag at the open, else she comes along and sulks on the stage.
 */

import type { StageConfig } from "../../config/validators/avatar/types";
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

const SULK_MOTION_ID = "sulk";

/** Slow at the start, faster through the middle, slow again on arrival. */
const easeInOutCubic = (t: number): number => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);

type Point = { x: number; y: number };

/** What a reload of her window keeps: where she goes home to, or that she stays this session. */
type SessionRecord = { home: Home } | { stays: true };

/** Her window's frame where she left her spot, in logical points. */
type Home = Point & { width: number; height: number };

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
    | "onTick"
    | "playMotion"
    | "getCurrentMotion"
    | "setBodyYaw"
    | "getCharacterAnchor"
    | "vanish"
    | "appear"
    | "land"
  >;
  hitTest: { setMoving(moving: boolean): void };
  /** Links her window into the settings window; resolves whether a native link is in effect. */
  dock: { attach(): Promise<boolean>; detach(): Promise<void> };
  setPositionPhysical(x: number, y: number): Promise<void>;
  /** Follows a settings window she is not linked to in its physical px (Windows), else in logical points. */
  followsInPhysicalPx: boolean;
  reducedMotion(): boolean;
  /** The travel and staying tuning, read at use. */
  stage(): StageConfig;
  /** The last backend emotion, neutral once older than `decayMs`. */
  lastEmotion(decayMs: number): string;
  /** A draw in [0, 1) for the stay roll. */
  random(): number;
}

export function createComeAlong(deps: ComeAlongDeps): {
  /** A settings window's stage slot: starts her session or moves her with it; null ends it. */
  onStage(slot: StageSlot | null): Promise<void>;
  /** The settings window closes or minimises: she goes home. */
  goHome(): Promise<void>;
  /** Places her on the latest slot again, after her own window was resized or a travel ended. */
  place(): Promise<void>;
} {
  const { locomotion, renderer } = deps;
  const key = `yui.come-along.${deps.settingsLabel}`;
  let session: "none" | "staying" | "on-stage" = "none";
  let slot: StageSlot | null = null;
  let home: Home | null = null;
  let docked: { native: boolean } | null = null;
  // Each move gets a new id; a move owns her while `move` is still its id.
  let move = 0;
  let stopTick: (() => void) | null = null;
  // A vanish left her canvas invisible, and no land or appear has shown her since.
  let hidden = false;

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

  /** Shows her canvas again when a vanish left it invisible. */
  function show(): void {
    if (!hidden) return;
    hidden = false;
    void renderer.appear();
  }

  /** Moves her window to `to`: a walk, else a vanish across monitors or a long way, else a fade. */
  async function travel(id: number, to: Point): Promise<void> {
    try {
      const [{ at: from, size }, monitors] = await Promise.all([
        read(),
        locomotion.frame.listMonitors(),
      ]);
      if (id !== move) return;
      const distance = Math.hypot(to.x - from.x, to.y - from.y);
      const win = locomotion.frame.frameWindow();
      if (distance < 1) return win.setPositionLogical(to.x, to.y);
      const stage = deps.stage();
      const on = monitorAtLogical(monitors, from.x + size.width / 2, from.y + size.height / 2);
      const crosses =
        !on || monitorAtLogical(monitors, to.x + size.width / 2, to.y + size.height / 2) !== on;
      const reduced = deps.reducedMotion();
      if (!reduced && !crosses && distance <= stage.walk_full_pt) {
        // A walk that took over mid-vanish shows her before she sets off.
        show();
        return walkOver(
          id,
          from,
          to,
          stage.walk_ms + stage.walk_extra_ms * (distance / stage.walk_full_pt),
        );
      }
      const mode = reduced ? "fade" : "vanish";
      const startedMs = performance.now();
      deps.hitTest.setMoving(true);
      hidden = true;
      await renderer.vanish();
      if (id !== move) return;
      await win.setPositionLogical(to.x, to.y);
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

  /** Walks her window to `to` over the parked travel frame; resolves on arrival or once stopped. */
  async function walkOver(id: number, from: Point, to: Point, durationMs: number): Promise<void> {
    const parked = await locomotion.widen([to]);
    if (id !== move) {
      await parked.end();
      return;
    }
    renderer.playMotion({ id: WALK_MOTION_ID });
    renderer.setBodyYaw(Math.sign(to.x - from.x) * WALK_YAW_RAD, WALK_YAW_EASE_MS);
    deps.hitTest.setMoving(true);
    const startedMs = performance.now();
    let frames = 0;
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
        frames += 1;
        const p = easeInOutCubic(Math.min(1, elapsedMs / durationMs));
        void parked.win
          .setPositionLogical(
            Math.round(from.x + (to.x - from.x) * p),
            Math.round(from.y + (to.y - from.y) * p),
          )
          .catch((err) => log.warn("come_along_move_failed", { error: String(err) }));
        if (elapsedMs >= durationMs) stopTick?.();
      });
    });
    // Wall time against the curve's time shows a walk the renderer paused (a hidden document).
    log.info("come_along_move", {
      mode: "walk",
      from,
      to,
      ms: Math.round(durationMs),
      wallMs: Math.round(performance.now() - startedMs),
      frames,
    });
    if (renderer.getCurrentMotion()?.id === WALK_MOTION_ID) renderer.playMotion(null);
    renderer.setBodyYaw(0, WALK_YAW_EASE_MS);
    await parked.end();
  }

  /** Stops her move and lets her go: no dock, no home, no hold. */
  function letGo(): void {
    takeOver();
    docked = null;
    home = null;
    locomotion.hold("come-along", false);
    deps.hitTest.setMoving(false);
    show();
  }

  /** A drag or an agent move took her: she stays, and this window's session lets her go. */
  function yieldToMover(): Promise<void> {
    const wasDocked = docked;
    if (session === "on-stage") {
      session = "staying";
      store({ stays: true });
    }
    letGo();
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
    const angry = deps.lastEmotion(deps.stage().emotion_decay_min * 60_000) === "angry";
    if (angry && deps.random() < deps.stage().stay_chance) {
      session = "staying";
      store({ stays: true });
      renderer.playMotion({ id: SULK_MOTION_ID });
      log.info("come_along_sulked");
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
      // A trip home that this window interrupted keeps the spot she left from.
      home ??= { ...at, ...size };
      store({ home });
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
      origin: target,
      size,
    });
    if (angry) renderer.playMotion({ id: SULK_MOTION_ID });
    await place();
  }

  async function placeOnce(): Promise<void> {
    const rect = slot;
    // A parked frame is not her window's own rect; the newest slot waits for the next place.
    if (!rect || !docked || locomotion.isTravelling()) return;
    const win = locomotion.frame.frameWindow();
    // Windows: the whole target in the settings window's scale, her size included.
    const px = !docked.native && deps.followsInPhysicalPx;
    const { at, size } = await read();
    const now = px ? await win.outerPosition() : at;
    const target = dockOrigin(rect, size);
    const k = px ? rect.scale : 1;
    const to = { x: Math.round(target.x * k), y: Math.round(target.y * k) };
    if (!docked || Math.max(Math.abs(to.x - now.x), Math.abs(to.y - now.y)) < 1) return;
    log.info("come_along_placed", { slot: rect, origin: to, size, ...(px && { px: true }) });
    await (px ? deps.setPositionPhysical(to.x, to.y) : win.setPositionLogical(to.x, to.y));
  }

  const placeLatest = latestOnly(placeOnce);
  const place = (): Promise<void> =>
    placeLatest().catch((err) => log.warn("come_along_place_failed", { error: String(err) }));

  /** Her spot, or the nearest monitor's floor when no monitor holds its centre any more. */
  async function homeOrFloor(spot: Home): Promise<Point> {
    const [monitors, { size }] = await Promise.all([locomotion.frame.listMonitors(), read()]);
    // Judged by the frame she left, so a size she took on the stage cannot move her spot off-screen.
    const centre = { x: spot.x + spot.width / 2, y: spot.y + spot.height / 2 };
    if (monitors.length === 0 || monitorAtLogical(monitors, centre.x, centre.y))
      return { x: spot.x, y: spot.y };
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
    await locomotion.drop({ landOnSeam: true });
  }

  /** A failed start or trip home lets her go where she is, and the next slot starts afresh. */
  async function releaseOnFailure(step: Promise<void>): Promise<void> {
    try {
      await step;
    } catch (err) {
      session = "none";
      store(null);
      letGo();
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
