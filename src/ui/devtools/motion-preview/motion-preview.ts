/**
 * Motion and emotion preview, lazy-loaded by the Developer Tools window.
 *
 * Architecture:
 *   - Loads validated runtime config through createConfigStore.
 *   - Resolves the configured VRM through resolveAssetUrl.
 *   - Registry list is grouped by MotionKind.
 *   - Playback controls compose RenderMotionSignal overrides passed to renderer.playMotion().
 *
 * Status bar polls renderer.getCurrentMotion() per frame, so it reflects the committed
 * motion including variant resolution and oneshot auto-return-to-idle.
 */

import "./motion-preview.css";
import { resolveAssetUrl } from "../../../config/asset-url";
import type { AvatarConfig } from "../../../config/load";
import { createConfigStore } from "../../../config/store";
import type { EmotionRegistry, MotionRegistry } from "../../../contract";
import { createLogger } from "../../../logger";
import { createRenderer } from "../../../renderer";
import { type ActiveEmotion, mountEmotionPanel } from "./emotion-panel";
import { createLiveStatus } from "./live-status";
import { wireMotionControls } from "./motion-controls";
import { installPerchHook } from "./perch-hook";
import { buildCrossfadeOptions, buildRegistryList } from "./registry-list";
import { expandVariantEntries } from "./variants";
import { createMotionPreviewView } from "./view";

const log = createLogger("motion-preview");

/**
 * Mounts the motion/emotion preview into `mount`, replacing its contents.
 * Loads the motion + emotion registries and the configured VRM, then wires
 * playback controls to a fresh renderer instance.
 *
 * Throws if the registry/config load fails — the caller (devtools shell)
 * renders an error state and lets the user retry by re-activating the tab.
 */
export async function mountMotionPreview(mount: HTMLElement): Promise<{ dispose(): void }> {
  const view = createMotionPreviewView(mount);
  const activeEmotion: ActiveEmotion = { id: null };
  const live = createLiveStatus(view, activeEmotion);

  let motionsRegistry: MotionRegistry;
  let emotionsRegistry: EmotionRegistry;
  let avatar: AvatarConfig;
  let vrmUrl: string;
  try {
    const config = await createConfigStore().load();
    motionsRegistry = config.motions;
    emotionsRegistry = config.emotionRegistry;
    avatar = config.avatar;
    vrmUrl = await resolveAssetUrl(config.avatar.vrm_url);
  } catch (err) {
    log.error("registry_load_failed", { error: String(err) });
    throw err;
  }

  // Expand pooled variants into directly selectable entries (preview-only).
  const { registry: expandedRegistry, variantIds } = expandVariantEntries(motionsRegistry);

  // Create renderer with both registries injected.
  const renderer = createRenderer({
    mount: view.vrmMount,
    motionRegistry: expandedRegistry,
    emotionRegistry: emotionsRegistry,
    framing: avatar.framing,
    gaze: avatar.gaze,
    hitTestThreshold: avatar.hit_test.alpha_threshold,
  });

  const playById = wireMotionControls(view, renderer);
  buildRegistryList(view.registryList, expandedRegistry, playById, variantIds);
  buildCrossfadeOptions(view.selCrossfade, expandedRegistry);
  mountEmotionPanel(view, renderer, emotionsRegistry, activeEmotion);
  live.start(() => renderer.getCurrentMotion(), expandedRegistry);
  installPerchHook(renderer);

  // Load VRM — renderer auto-plays idle baseline on load.
  try {
    await renderer.loadVRM(vrmUrl);
    // Idle baseline auto-plays on load; syncLiveMotion picks it up next frame.
  } catch (err) {
    log.error("vrm_load_failed", { error: String(err) });
  }

  return {
    dispose() {
      live.stop();
      renderer.dispose();
    },
  };
}
