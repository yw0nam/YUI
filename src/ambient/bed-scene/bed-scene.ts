/**
 * Bed scene — she lies asleep on a bed, wakes on a click, a message, the wake timeout or the
 * backend's own stand, plays
 * one wake clip that ends standing, and the bed fades out. The scene holds the body on its
 * clips from the moment she lies down until the frame is back to its normal size. Every path
 * out goes through one exit, so the hold, the bed and the widened frame never outlive it, and
 * the scene can run again afterwards. All timing runs on the renderer tick, which pauses with
 * a hidden document.
 */

import type { WakeCause } from "../../contract";
import type { createStationaryFrame } from "../../io/window/geometry/stationary-frame";
import type { Logger } from "../../logger";
import type { PropHandle, Renderer } from "../../renderer";
import type { Tier1Engine } from "../liveliness/tier1";

/** Registry id of the one-shot that lays her down on the bed. */
export const BED_LIE_MOTION_ID = "bed_lie";
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

const LAUNCH_MOTION_IDS: readonly string[] = [BED_SLEEP_MOTION_ID, BED_WAKE_MOTION_ID];
const COMMAND_MOTION_IDS: readonly string[] = [BED_LIE_MOTION_ID, ...LAUNCH_MOTION_IDS];

type BedSceneState = "idle" | "starting" | "asleep" | "waking" | "done";
type EndReason = "ended" | "skipped" | "lost" | "swapped" | "cancelled";
/** Who got her up: the user, the wake timeout, or the backend's own `stand`. */
export type BedWakeCause = WakeCause | "agent";
/** How a lie-down on command came out: lying, cut short by the user, or not startable. */
export type LieDownResult = "lying" | "interrupted" | "failed";
type Entry = "launch" | "command";

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
  /** How long she sleeps before the timeout wakes her, on either entry. */
  wakeTimeoutS: number;
  /** Called once, after the hold is released. */
  onDone: () => void;
  /** Called as the wake clip starts, for a click or the timeout; never for a message or the backend's stand. */
  onWake: (cause: Exclude<WakeCause, "message">) => void;
  /** Called when she starts lying on the bed and when her wake clip starts or the scene ends. */
  onLying: (lying: boolean) => void;
  log: Logger;
}

export interface BedScene {
  /** Launch entry: lie down asleep at once, waking on the timeout. Ignored while a scene runs. */
  start(): void;
  /** Command entry: show the bed at her spot and lie down. Settles once she lies down, or why she did not. */
  lieDown(): Promise<LieDownResult>;
  /** Cuts a lie-down on command that is still starting short; anything else is left alone. */
  cancelStart(): void;
  /** Wake her. Before she has lain down it skips the scene; once waking it is ignored. */
  wake(cause: BedWakeCause): void;
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
  let cause: BedWakeCause | null = null;
  /** The clips the running entry holds. */
  let ids = LAUNCH_MOTION_IDS;
  let entry: Entry = "launch";
  /** Why a lie-down that did not start was cut short, when the user did it. */
  let startCut: LieDownResult = "failed";
  /** The command entry's lying-down clip is playing; the sleep loop follows it. */
  let lyingDown = false;
  let lying = false;
  /** Answers the pending lieDown() call. */
  let settleLie: ((lay: LieDownResult) => void) | null = null;
  let messageWakeOwed = false;
  /** The model the scene started on; another one on the tick is a hot-swap. */
  let vrmSeen: unknown = null;
  let asleepS = 0;
  /** Seconds into the bed's fade; null until the wake clip has ended. */
  let fadeS: number | null = null;
  /** What the bed is shown at; its fade starts from here. */
  let opacity = 0;

  /** Clears what the previous run left, so the scene can start again. */
  function reset(): void {
    cause = null;
    startCut = "failed";
    lyingDown = false;
    messageWakeOwed = false;
    vrmSeen = null;
    asleepS = 0;
    fadeS = null;
    opacity = 0;
  }

  function setLying(next: boolean): void {
    if (lying === next) return;
    lying = next;
    deps.onLying(next);
  }

  function begin(next: Entry): void {
    reset();
    entry = next;
    ids = next === "launch" ? LAUNCH_MOTION_IDS : COMMAND_MOTION_IDS;
    state = "starting";
    unsub = renderer.onTick(onTick);
  }

  async function finish(reason: EndReason): Promise<void> {
    if (state === "done") return;
    state = "done";
    generation += 1;
    messageWakeOwed = false;
    setLying(false);
    settleLie?.(startCut);
    settleLie = null;
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
      if (!current || ids.includes(current.id)) renderer.playMotion(null);
      log.info("bed_scene_end", { entry, reason, cause });
      deps.onDone();
    }
  }

  /** Loads the clips; the rest hips height when the scene can run, else null after skipping. */
  async function prepare(startedAt: number): Promise<number | null> {
    await Promise.all(ids.map((id) => renderer.preloadMotion(id)));
    if (generation !== startedAt) return null;
    const restHips = renderer.getModelRestHipsHeight();
    // A preload resolves either way; a cached duration is what says the clip loaded.
    if (restHips === null || ids.some((id) => renderer.getMotionDuration(id) === null)) {
      void finish("skipped");
      return null;
    }
    return restHips;
  }

  /** Loads the bed, parks the frame and shows the bed, unless the run is over by then. */
  async function raiseBed(startedAt: number, restHips: number): Promise<void> {
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

  /** Asleep on the sleep loop: the eyes close, the hair and the gaze rest. */
  function fallAsleep(): void {
    liveliness.setAsleep(true);
    // Lying on her side, the spring simulation pushes the long hair off the body colliders.
    renderer.setSpringBonesHeld(true);
    renderer.setGazeEnabled(false);
    state = "asleep";
    setLying(true);
  }

  /** The frame extents are measured head-on. */
  function faceHeadOn(): void {
    renderer.setOrbit({ azimuth: 0, polar: deps.camera.get().polar });
  }

  async function run(): Promise<void> {
    const startedAt = generation;
    const restHips = await prepare(startedAt);
    if (restHips === null) return;
    renderer.setMotionHold(ids);
    renderer.playMotion({ id: BED_SLEEP_MOTION_ID });
    fallAsleep();
    faceHeadOn();
    await raiseBed(startedAt, restHips);
  }

  /** Where she stands: the bed appears, then she lies down on it. */
  async function runLieDown(): Promise<void> {
    const startedAt = generation;
    const restHips = await prepare(startedAt);
    if (restHips === null) return;
    renderer.setMotionHold(ids);
    faceHeadOn();
    await raiseBed(startedAt, restHips);
    if (generation !== startedAt) return;
    renderer.playMotion({ id: BED_LIE_MOTION_ID });
    // A request the renderer dropped, such as a perch pin still held, leaves nothing to lie in.
    if (renderer.getCurrentMotion()?.id !== BED_LIE_MOTION_ID) {
      void finish("skipped");
      return;
    }
    lyingDown = true;
    fallAsleep();
    settleLie?.("lying");
    settleLie = null;
  }

  function wake(by: BedWakeCause): void {
    if (state === "starting") {
      // A user's click or message during the set-up is the user taking over.
      if (by !== "agent") startCut = "interrupted";
      void finish("skipped");
      return;
    }
    if (state !== "asleep") return;
    cause = by;
    state = "waking";
    lyingDown = false;
    setLying(false);
    liveliness.setAsleep(false);
    renderer.setSpringBonesHeld(false);
    // The gaze nudge rides on the clip's head and neck, which are lying or seated until the scene ends.
    renderer.playMotion({ id: BED_WAKE_MOTION_ID });
    if (by === "message") messageWakeOwed = true;
    else if (by !== "agent") deps.onWake(by);
  }

  /** The hold keeps an ended clip on its last frame, so its playhead stays at the end. */
  function clipEnded(id: string): boolean {
    const t = renderer.getCurrentMotionTime();
    const duration = renderer.getMotionDuration(id);
    return t !== null && duration !== null && t >= duration - WAKE_END_S;
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
      state === "waking" ? id !== BED_WAKE_MOTION_ID : id === undefined || !ids.includes(id);
    if (lost) {
      void finish("lost");
      return;
    }
    if (state === "asleep") {
      if (lyingDown) {
        if (clipEnded(BED_LIE_MOTION_ID)) {
          lyingDown = false;
          renderer.playMotion({ id: BED_SLEEP_MOTION_ID });
        }
        return;
      }
      asleepS += ctx.dt;
      if (asleepS > deps.wakeTimeoutS) wake("timeout");
      return;
    }
    if (fadeS === null) {
      if (clipEnded(BED_WAKE_MOTION_ID)) fadeS = 0;
      return;
    }
    fadeS += ctx.dt;
    prop?.setOpacity(opacity * Math.max(0, 1 - fadeS / PROP_FADE_S));
    if (fadeS >= PROP_FADE_S) void finish("ended");
  }

  return {
    start() {
      if (state !== "idle" && state !== "done") return;
      begin("launch");
      void run().catch(() => finish("skipped"));
    },
    lieDown() {
      if (state !== "idle" && state !== "done") return Promise.resolve("failed");
      begin("command");
      return new Promise<LieDownResult>((resolve) => {
        settleLie = resolve;
        void runLieDown().catch(() => finish("skipped"));
      });
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
    cancelStart() {
      if (state !== "starting" || entry !== "command") return;
      startCut = "interrupted";
      void finish("cancelled");
    },
    onDragEnd() {
      // A refit that lands during the exit's release would widen the window again.
      if (state !== "done") void frame?.refit();
    },
    state: () => state,
  };
}
