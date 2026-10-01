import { createTier1Engine, type Tier1Engine } from "../../ambient/liveliness/tier1";
import { createRenderer, type Renderer } from "../../renderer";
import type { SettingsStores } from "../../settings/settings-stores";
import { registerRendererAndAmbientDisposal } from "../bootstrap-disposal";
import { wireCamera } from "./wire-pet-stage";

/** The renderer on the stage, its persisted camera and idle throttle, and the Tier 1 liveliness. */
export function createStageRenderer(deps: {
  stage: HTMLElement;
  settings: Pick<SettingsStores, "cameraSettings" | "idleThrottleSettings">;
  register: (dispose: () => void) => void;
}): { renderer: Renderer; ambient: Tier1Engine } {
  const renderer = createRenderer({ mount: deps.stage });
  deps.register(
    wireCamera({
      stage: deps.stage,
      renderer,
      cameraSettings: deps.settings.cameraSettings,
      idleThrottleSettings: deps.settings.idleThrottleSettings,
    }),
  );
  // Tier 1 ambient: backend-independent, always on. tick fires after VRM loads, so
  // starting before loadVRM is safe (frames without VRM are no-op).
  const ambient = createTier1Engine(renderer);
  ambient.start();
  registerRendererAndAmbientDisposal(deps.register, renderer, ambient);
  return { renderer, ambient };
}
