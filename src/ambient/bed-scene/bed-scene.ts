/**
 * Launch bed scene — she starts asleep on a bed, wakes on a click, a message or the wake timeout,
 * plays one wake clip that ends standing, and the bed fades out. The scene holds the body
 * on its two clips from the moment she lies down until the frame is back to its normal
 * size. Every path out goes through one exit, so the hold, the bed and the widened frame
 * never outlive it. All timing runs on the renderer tick, which pauses with a hidden document.
 */

import type { WakeCause } from "../../contract";
import type { createStationaryFrame } from "../../io/window/geometry/stationary-frame";
import type { Logger } from "../../logger";
import type { PropHandle, Renderer } from "../../renderer";
import type { Tier1Engine } from "../liveliness/tier1";

/** Registry id of the looping sleep on the bed. */
export const BED_SLEEP_MOTION_ID = "bed_sleep";
/** Registry id of the one-shot wake that ends standing. */
export const BED_WAKE_MOTION_ID = "bed_wake";
/** The bed, authored with its origin where she stands after the wake clip. */
export const BED_PROP_URL = "/props/bed.glb";
/** Rest hips height (metres) both clips and the bed are authored for. */
export const CLIP_REST_HIPS_M = 0.9;
/** The bed fades out over this long after the wake clip ends. */
export const PROP_FADE_S = 0.6;
/** Within this of the wake clip's end counts as ended; one frame at 30 fps is 0.033 s. */
const WAKE_END_S = 0.05;
/** Frame margin around the bed, in metres so it scales with the model. */
export const FRAME_MARGIN_M = 0.1;

const BED_MOTION_IDS: readonly string[] = [BED_SLEEP_MOTION_ID, BED_WAKE_MOTION_ID];

type BedSceneState = "idle" | "starting" | "asleep" | "waking" | "done";
type EndReason = "ended" | "skipped" | "lost" | "swapped" | "cancelled";

export interface BedSceneDeps {
  renderer: Pick<
    Renderer,
    | "onTick"
    | "playMotion"
    | "getCurrentMotion"
    | "getCurrentMotionTime"
    | "getMotionDuration"
    | "preloadMotion"
    | "setMotionHold"
    | "setSpringBonesHeld"
    | "loadProp"
    | "getModelRestHipsHeight"
    | "getPxPerMetre"
    | "getCharacterAnchor"
    | "setGazeEnabled"
    | "setOrbit"
  >;
  liveliness: Pick<Tier1Engine, "setAsleep">;
  /** The user's gaze setting, restored when she wakes. */
  gazeEnabled: () => boolean;
  /** The stored orbit: the scene views her head-on and puts this back at its end. */
  camera: { get(): { azimuth: number; polar: number } };
  /** null runs the scene in the window as it is. */
  frame: Pick<ReturnType<typeof createStationaryFrame>, "park" | "refit" | "release"> | null;
  /** Settles once the boot placement has put the window where it stays. */
  placed: Promise<void>;
  wakeTimeoutS: number;
  /** Called once, after the hold is released. */
  onDone: () => void;
  /** Called as the wake clip starts, for a wake no message brought. */
  onWake: (cause: Exclude<WakeCause, "message">) => void;
  log: Logger;
}

export interface BedScene {
  /** Lie down asleep. Only the first call starts the scene. */
  start(): void;
  /** Wake her. Before she has lain down it skips the scene; once waking it is ignored. */
  wake(cause: WakeCause): void;
  /** True once, after a message woke her. */
  takeMessageWake(): boolean;
  /** End the scene now. */
  cancel(): void;
  /** After a native drag of the widened window. */
  onDragEnd(): void;
  state(): BedSceneState;
}

export function createBedScene(deps: BedSceneDeps): BedScene {
  const { renderer, liveliness, frame, log } = deps;
  let state: BedSceneState = "idle";
  /** Bumped by the exit, so a start step that resolves after it drops its result. */
  let generation = 0;
  let unsub: (() => void) | null = null;
  let prop: PropHandle | null = null;
  let cause: WakeCause | null = null;
  let messageWakeOwed = false;
  /** The model the scene started on; another one on the tick is a hot-swap. */
  let vrmSeen: unknown = null;
  let asleepS = 0;
  /** Seconds into the bed's fade; null until the wake clip has ended. */
  let fadeS: number | null = null;
  /** What the bed is shown at; its fade starts from here. */
  let opacity = 0;

  async function finish(reason: EndReason): Promise<void> {
    if (state === "done") return;
    state = "done";
    generation += 1;
    messageWakeOwed = false;
    unsub?.();
    unsub = null;
    try {
      liveliness.setAsleep(false);
      renderer.setSpringBonesHeld(false);
      renderer.setGazeEnabled(deps.gazeEnabled());
      renderer.setOrbit(deps.camera.get());
      prop?.dispose();
      prop = null;
    } catch (err) {
      log.warn("bed_scene_restore_failed", { degrade: true, error: String(err) });
    }
    try {
      await frame?.release();
    } catch (err) {
      log.warn("frame_release_failed", { degrade: true, error: String(err) });
    } finally {
      // The hold outlasts the frame release, so no mover takes the body in the wide window.
      renderer.setMotionHold(null);
      // No current motion is a registry reload whose replayed idle the hold dropped.
      const current = renderer.getCurrentMotion();
      if (!current || BED_MOTION_IDS.includes(current.id)) renderer.playMotion(null);
      log.info("bed_scene_end", { reason, cause });
      deps.onDone();
    }
  }

  async function run(): Promise<void> {
    const startedAt = generation;
    await Promise.all(BED_MOTION_IDS.map((id) => renderer.preloadMotion(id)));
    if (generation !== startedAt) return;
    const restHips = renderer.getModelRestHipsHeight();
    // A preload resolves either way; a cached duration is what says the clip loaded.
    if (restHips === null || BED_MOTION_IDS.some((id) => renderer.getMotionDuration(id) === null)) {
      void finish("skipped");
      return;
    }
    renderer.setMotionHold(BED_MOTION_IDS);
    renderer.playMotion({ id: BED_SLEEP_MOTION_ID });
    liveliness.setAsleep(true);
    // Lying on her side, the spring simulation pushes the long hair off the body colliders.
    renderer.setSpringBonesHeld(true);
    renderer.setGazeEnabled(false);
    // The frame extents are measured head-on.
    renderer.setOrbit({ azimuth: 0, polar: deps.camera.get().polar });
    state = "asleep";

    let loaded: PropHandle;
    try {
      loaded = await renderer.loadProp(BED_PROP_URL);
    } catch {
      void finish("skipped");
      return;
    }
    if (generation !== startedAt) {
      loaded.dispose();
      return;
    }
    prop = loaded;
    loaded.setScale(restHips / CLIP_REST_HIPS_M);
    loaded.setOpacity(0);

    await deps.placed;
    if (generation !== startedAt) return;
    const pxPerMetre = renderer.getPxPerMetre();
    const anchor = renderer.getCharacterAnchor();
    if (frame && pxPerMetre !== null && anchor) {
      const { min, max } = loaded.bounds();
      try {
        await frame.park({
          leftPx: (-min.x + FRAME_MARGIN_M) * pxPerMetre,
          rightPx: (max.x + FRAME_MARGIN_M) * pxPerMetre,
          anchorX: anchor.x,
        });
      } catch (err) {
        log.warn("frame_park_failed", { degrade: true, error: String(err) });
      }
      if (generation !== startedAt) return;
    }
    if (fadeS !== null) return;
    opacity = 1;
    loaded.setOpacity(1);
  }

  function wake(by: WakeCause): void {
    if (state === "starting") {
      void finish("skipped");
      return;
    }
    if (state !== "asleep") return;
    cause = by;
    state = "waking";
    liveliness.setAsleep(false);
    renderer.setSpringBonesHeld(false);
    renderer.setGazeEnabled(deps.gazeEnabled());
    renderer.playMotion({ id: BED_WAKE_MOTION_ID });
    if (by === "message") messageWakeOwed = true;
    else deps.onWake(by);
  }

  function onTick(ctx: { vrm: unknown; dt: number }): void {
    vrmSeen ??= ctx.vrm;
    if (state !== "asleep" && state !== "waking") return;
    if (ctx.vrm !== vrmSeen) {
      void finish("swapped");
      return;
    }
    // Anything but a bed clip, or no motion at all, is one the hold did not keep out.
    const id = renderer.getCurrentMotion()?.id;
    const lost =
      state === "waking"
        ? id !== BED_WAKE_MOTION_ID
        : id === undefined || !BED_MOTION_IDS.includes(id);
    if (lost) {
      void finish("lost");
      return;
    }
    if (state === "asleep") {
      asleepS += ctx.dt;
      if (asleepS > deps.wakeTimeoutS) wake("timeout");
      return;
    }
    if (fadeS === null) {
      // The hold keeps the ended clip on its last frame, so its playhead stays at the end.
      const t = renderer.getCurrentMotionTime();
      const duration = renderer.getMotionDuration(BED_WAKE_MOTION_ID);
      if (t !== null && duration !== null && t >= duration - WAKE_END_S) fadeS = 0;
      return;
    }
    fadeS += ctx.dt;
    prop?.setOpacity(opacity * Math.max(0, 1 - fadeS / PROP_FADE_S));
    if (fadeS >= PROP_FADE_S) void finish("ended");
  }

  return {
    start() {
      if (state !== "idle") return;
      state = "starting";
      unsub = renderer.onTick(onTick);
      void run().catch(() => finish("skipped"));
    },
    wake,
    takeMessageWake() {
      const owed = messageWakeOwed;
      messageWakeOwed = false;
      return owed;
    },
    cancel() {
      void finish("cancelled");
    },
    onDragEnd() {
      // A refit that lands during the exit's release would widen the window again.
      if (state !== "done") void frame?.refit();
    },
    state: () => state,
  };
}
