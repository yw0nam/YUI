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
  register: (teardown: () => void) => void;
  log: Logger;
}): {
  /** True from construction until the scene has ended and the window is back to its size. */
  isHeld(): boolean;
  /** The user woke her. */
  wake(): void;
  onDragEnd(): void;
  /** Starts the scene, when it runs at this launch. */
  start(locomotion: Locomotion): void;
} {
  const { enabled, wakeTimeoutS } = deps.settings.bedSceneSettings.get();
  let held = enabled && !prefersReducedMotion();
  let scene: BedScene | null = null;
  return {
    isHeld: () => held,
    wake: () => scene?.wake("user"),
    onDragEnd: () => scene?.onDragEnd(),
    start(locomotion) {
      if (!held) return;
      scene = createBedScene({
        renderer: deps.renderer,
        liveliness: deps.ambient,
        gazeEnabled: () => deps.settings.gazeSettings.get().enabled,
        camera: deps.settings.cameraSettings,
        frame: isTauri() ? createSceneFrame(deps.renderer, locomotion) : null,
        placed: locomotion.placed,
        wakeTimeoutS,
        onDone: () => {
          held = false;
          deps.applyCamera();
          // A window dragged into mid-air while she slept falls now.
          locomotion.drop();
        },
        log: deps.log,
      });
      deps.register(scene.cancel);
      scene.start();
    },
  };
}
