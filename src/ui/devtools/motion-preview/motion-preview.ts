/**
 * The motion preview's core, lazy-loaded by the Developer Tools window: loads the registries and the
 * selected VRM (stored selection, else the configured default), creates the renderer in the panel's
 * host, and runs the live status. The panel's controls drive the renderer it hands over.
 */

import { resolveAssetUrl } from "../../../config/asset-url";
import { createConfigStore } from "../../../config/store";
import type { AvatarConfig } from "../../../config/validators/avatar/types";
import type { EmotionId, EmotionRegistry, MotionRegistry } from "../../../contract";
import {
  createVrmSelection,
  localStorageUserVrmStorage,
  localStorageVrmStorage,
} from "../../../io/assets/vrm-selection";
import { createLogger } from "../../../logger";
import { createRenderer, type Renderer } from "../../../renderer";
import { type Clip, createLiveStatus, type StatusRefs } from "./live-status";
import { installPerchHook } from "./perch-hook";
import { expandVariantEntries } from "./variants";

const log = createLogger("motion-preview");

export interface MotionPreview {
  renderer: Renderer;
  /** The motion registry with each pooled variant as its own entry. */
  registry: MotionRegistry;
  variantIds: Set<string>;
  emotions: EmotionRegistry;
}

/** What the panel gives the core: the renderer's host, the status elements, and where to report. */
export interface MotionView {
  host: HTMLElement;
  status: StatusRefs;
  /** The emotion last applied, for the viewport status. */
  emotion(): EmotionId | null;
  /** The registries and the renderer, before the VRM loads. */
  ready(preview: MotionPreview): void;
  /** The committed clip changed. */
  clip(clip: Clip | null): void;
}

/** Resolves once the VRM load settles; rejects when the registry or config load fails, before any renderer exists. */
export async function mountMotionPreview(view: MotionView): Promise<{ dispose(): void }> {
  const live = createLiveStatus(view.status, view.emotion, view.clip);

  let motionsRegistry: MotionRegistry;
  let emotionsRegistry: EmotionRegistry;
  let avatar: AvatarConfig;
  let vrmUrl: string;
  try {
    const config = await createConfigStore().load();
    motionsRegistry = config.motions;
    emotionsRegistry = config.emotionRegistry;
    avatar = config.avatar;
    const selection = createVrmSelection({
      available: config.avatar.available,
      defaultValue: config.avatar.vrm_url,
      storage: localStorageVrmStorage(),
      userStorage: localStorageUserVrmStorage(),
    });
    vrmUrl = await resolveAssetUrl(selection.getActive().url);
  } catch (err) {
    log.error("registry_load_failed", { error: String(err) });
    throw err;
  }

  const { registry, variantIds } = expandVariantEntries(motionsRegistry);
  const renderer = createRenderer({
    mount: view.host,
    motionRegistry: registry,
    emotionRegistry: emotionsRegistry,
    framing: avatar.framing,
    gaze: avatar.gaze,
    hitTestThreshold: avatar.hit_test.alpha_threshold,
  });
  view.ready({ renderer, registry, variantIds, emotions: emotionsRegistry });
  live.start(() => renderer.getCurrentMotion(), registry);
  installPerchHook(renderer);

  // The renderer plays the idle baseline once the VRM loads.
  try {
    await renderer.loadVRM(vrmUrl);
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
