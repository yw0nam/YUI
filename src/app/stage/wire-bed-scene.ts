/** Wires the bed scene: the launch entry, the lie-down on command, the hold the rest of the window reads, and the wake signal. */
import {
  type BedScene,
  type BedWakeCause,
  createBedScene,
} from "../../ambient/bed-scene/bed-scene";
import { prefersReducedMotion, type Tier1Engine } from "../../ambient/liveliness/tier1";
import type { EventBus } from "../../dispatcher/core/event-bus";
import type { AvatarBed } from "../../io/bridge/inbox/avatar-executor";
import type { Logger } from "../../logger";
import type { Renderer } from "../../renderer";
import type { SettingsStores } from "../../settings/settings-stores";
import { isTauri } from "../../tauri-env";
import type { BedSceneHold } from "./bed-scene-hold";
import { createSceneFrame } from "./scene-frame";
import type { wireLocomotion } from "./wire-locomotion";

type Locomotion = Pick<
  ReturnType<typeof wireLocomotion>,
  "frame" | "placed" | "place" | "setKeepOnScreenPaused" | "drop"
>;

type SignalledWake = Exclude<BedWakeCause, "message" | "agent">;

export function wireBedScene(deps: {
  renderer: Renderer;
  ambient: Tier1Engine;
  bus: Pick<EventBus, "push">;
  settings: Pick<SettingsStores, "bedSceneSettings" | "gazeSettings" | "cameraSettings">;
  /** Applies the stored zoom and orbit, which the hold kept out. */
  applyCamera: () => void;
  /** Taken here when the launch scene will run, and released by its end or by the teardown. */
  hold: BedSceneHold;
  register: (teardown: () => void) => void;
  log: Logger;
}): {
  /** True from construction until the scene has ended and the window is back to its size. */
  isHeld(): boolean;
  /** The user woke her. */
  wake(cause: "click" | "message"): void;
  takeMessageWake(): boolean;
  onDragEnd(): void;
  /** What the avatar commands see of the scene. */
  bed: AvatarBed;
  /** Starts the launch scene, when it runs at this launch, and readies the bed for commands. */
  start(locomotion: Locomotion, onWake: (cause: SignalledWake) => void): void;
} {
  const { enabled, wakeTimeoutS } = deps.settings.bedSceneSettings.get();
  const { hold } = deps;
  if (enabled && !prefersReducedMotion()) {
    hold.take();
    deps.register(hold.release);
  }
  let scene: BedScene | null = null;
  let stage: { locomotion: Locomotion; onWake: (cause: SignalledWake) => void } | null = null;

  /** One scene serves both entries and every run. */
  function sceneOf({ locomotion, onWake }: NonNullable<typeof stage>): BedScene {
    if (scene) return scene;
    scene = createBedScene({
      renderer: deps.renderer,
      liveliness: deps.ambient,
      gazeEnabled: () => deps.settings.gazeSettings.get().enabled,
      camera: deps.settings.cameraSettings,
      frame: isTauri() ? createSceneFrame(deps.renderer, locomotion) : null,
      placed: locomotion.placed,
      wakeTimeoutS,
      onDone: () => {
        hold.release();
        deps.applyCamera();
        // A window dragged into mid-air while she slept falls now.
        locomotion.drop();
      },
      // The backend sent its own stand_down and knows she is up; only the user's wake is a candidate.
      onWake: (cause) => {
        if (cause !== "agent") onWake(cause);
      },
      onLying: (lying) =>
        void deps.bus.push({
          source: "timer_scheduler",
          event_name: lying ? "avatar.bed_start" : "avatar.bed_end",
          ts: Date.now(),
        }),
      log: deps.log,
    });
    deps.register(scene.cancel);
    return scene;
  }

  const bed: AvatarBed = {
    phase() {
      if (!stage || prefersReducedMotion()) return hold.isHeld() ? "starting" : "unsupported";
      switch (scene?.state()) {
        case "starting":
          return "starting";
        case "asleep":
          return "lying";
        case "waking":
          return "waking";
        default:
          // A finished scene still holds the body until its exit has released the window.
          return hold.isHeld() ? "starting" : "off";
      }
    },
    async lieDown() {
      if (!stage || prefersReducedMotion()) return false;
      hold.take();
      await stage.locomotion.place();
      return sceneOf(stage).lieDown();
    },
    getUp: () => scene?.wake("agent"),
  };

  return {
    isHeld: hold.isHeld,
    wake: (cause) => scene?.wake(cause),
    takeMessageWake: () => scene?.takeMessageWake() ?? false,
    onDragEnd: () => scene?.onDragEnd(),
    bed,
    start(locomotion, onWake) {
      stage = { locomotion, onWake };
      if (hold.isHeld()) sceneOf(stage).start();
    },
  };
}
