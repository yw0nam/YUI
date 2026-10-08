/** The bed scene's window frame over a real window that is wired later than the scene starts. */
import type { BedSceneDeps } from "../../ambient/bed-scene/bed-scene";
import { createStationaryFrame } from "../../io/window/geometry/stationary-frame";
import type { Renderer } from "../../renderer";
import type { wireLocomotion } from "./wire-locomotion";

type Locomotion = Pick<ReturnType<typeof wireLocomotion>, "frame" | "setKeepOnScreenPaused">;

export function createSceneFrame(
  renderer: Pick<Renderer, "setViewWindow">,
  locomotion: Locomotion,
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
