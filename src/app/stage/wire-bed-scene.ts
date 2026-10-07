/** Wires the launch bed scene: whether it runs, the hold the rest of the window reads, and its frame. */
import {
  type BedScene,
  type BedSceneDeps,
  createBedScene,
} from "../../ambient/bed-scene/bed-scene";
import { prefersReducedMotion, type Tier1Engine } from "../../ambient/liveliness/tier1";
import { createStationaryFrame } from "../../io/window/geometry/stationary-frame";
import type { Logger } from "../../logger";
import type { Renderer } from "../../renderer";
import type { SettingsStores } from "../../settings/settings-stores";
import { isTauri } from "../../tauri-env";
import type { BedSceneHold } from "./bed-scene-hold";
import type { wireLocomotion } from "./wire-locomotion";

type Locomotion = Pick<
  ReturnType<typeof wireLocomotion>,
  "frame" | "placed" | "setKeepOnScreenPaused" | "drop"
>;

/** The scene's frame over a real window that is wired later than the scene starts. */
function createSceneFrame(
  renderer: Pick<Renderer, "setViewWindow">,
  locomotion: Pick<Locomotion, "frame" | "setKeepOnScreenPaused">,
): NonNullable<BedSceneDeps["frame"]> {
  let frame: ReturnType<typeof createStationaryFrame> | null = null;
  let parking: Promise<void> | null = null;
  return {
    park(e) {
      parking = locomotion.frame.ready.then(() => {
        frame = createStationaryFrame({
          frame: locomotion.frame.frameWindow(),
          renderer,
          setKeepOnScreenPaused: locomotion.setKeepOnScreenPaused,
        });
        return frame.park(e);
      });
      return parking;
    },
    refit: async () => frame?.refit(),
    async release() {
      // A park still waiting for the real window lands first, so it is unparked too.
      await parking?.catch(() => {});
      await frame?.release();
    },
  };
}

export function wireBedScene(deps: {
  renderer: Renderer;
  ambient: Tier1Engine;
  settings: Pick<SettingsStores, "bedSceneSettings" | "gazeSettings" | "cameraSettings">;
  /** Applies the stored zoom and orbit, which the hold kept out. */
  applyCamera: () => void;
  /** Taken here when the scene will run, and released by its end or by the teardown. */
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
  /** Starts the scene, when it runs at this launch. */
  start(locomotion: Locomotion, onWake: BedSceneDeps["onWake"]): void;
} {
  const { enabled, wakeTimeoutS } = deps.settings.bedSceneSettings.get();
  const { hold } = deps;
  if (enabled && !prefersReducedMotion()) {
    hold.take();
    deps.register(hold.release);
  }
  let scene: BedScene | null = null;
  return {
    isHeld: hold.isHeld,
    wake: (cause) => scene?.wake(cause),
    takeMessageWake: () => scene?.takeMessageWake() ?? false,
    onDragEnd: () => scene?.onDragEnd(),
    start(locomotion, onWake) {
      if (!hold.isHeld()) return;
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
        log: deps.log,
      });
      deps.register(scene.cancel);
      scene.start();
    },
  };
}
