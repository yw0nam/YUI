/** Wires the bed scene: the launch entry, the bed the avatar commands use, the hold the rest of the window reads, and the posture events. */
import { type BedScene, createBedScene } from "../../ambient/bed-scene/bed-scene";
import { prefersReducedMotion, type Tier1Engine } from "../../ambient/liveliness/tier1";
import type { WakeCause } from "../../contract";
import type { EventBus } from "../../dispatcher/core/event-bus";
import type { AvatarBed } from "../../io/bridge/inbox/avatar-executor";
import type { Logger } from "../../logger";
import type { Renderer } from "../../renderer";
import type { SettingsStores } from "../../settings/settings-stores";
import { isTauri } from "../../tauri-env";
import type { BedSceneHold } from "./bed-scene-hold";
import { createAvatarBed } from "./create-avatar-bed";
import { createSceneFrame } from "./scene-frame";
import type { wireLocomotion } from "./wire-locomotion";

type Locomotion = Pick<
  ReturnType<typeof wireLocomotion>,
  "frame" | "placed" | "place" | "setKeepOnScreenPaused" | "drop"
>;

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
  /** Builds the scene, and starts it when the launch scene runs at this launch. */
  start(locomotion: Locomotion, onWake: (cause: Exclude<WakeCause, "message">) => void): void;
} {
  const { enabled, wakeTimeoutS } = deps.settings.bedSceneSettings.get();
  const { hold } = deps;
  if (enabled && !prefersReducedMotion()) {
    hold.take();
    deps.register(hold.release);
  }
  let scene: BedScene | null = null;
  let place: () => Promise<boolean> = async () => false;

  return {
    isHeld: hold.isHeld,
    wake: (cause) => scene?.wake(cause),
    takeMessageWake: () => scene?.takeMessageWake() ?? false,
    onDragEnd: () => scene?.onDragEnd(),
    bed: createAvatarBed({
      hold,
      scene: () => scene,
      canRun: () => !prefersReducedMotion(),
      place: () => place(),
      renderer: deps.renderer,
      log: deps.log,
    }),
    start(locomotion, onWake) {
      if (prefersReducedMotion()) return;
      place = locomotion.place;
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
        onWake,
        onLying: (lying) =>
          void deps.bus.push({
            source: "timer_scheduler",
            event_name: lying ? "avatar.bed_start" : "avatar.bed_end",
            ts: Date.now(),
          }),
        log: deps.log,
      });
      deps.register(scene.cancel);
      if (hold.isHeld()) scene.start();
    },
  };
}
