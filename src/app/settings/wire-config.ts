/** The pet window's config store — bundled configs, runtime key overrides, and the live merges. */

import {
  CHAT_API_KEY_SECRET,
  type GuardrailsConfig,
  STT_API_KEY_SECRET,
  TTS_API_KEY_SECRET,
} from "../../config/load";
import type { ConfigStore } from "../../config/store";
import { createConfigStore } from "../../config/store";
import type { EndpointsConfig } from "../../contract";
import { createSettingsSecretProvider } from "../../io/chat/secret-provider";
import type { Logger } from "../../logger";
import type { Renderer } from "../../renderer";
import { enabledIdleVariants } from "../../settings/avatar/idle-motion-settings";
import { mergeEndpoints } from "../../settings/backend/endpoints-settings";
import { mergeGuardrails } from "../../settings/backend/guardrails-settings";
import type { SettingsStores } from "../../settings/settings-stores";
import type { Surfaces } from "../../ui/surfaces/surfaces";
import type { ConfiguredBootstrapHandles } from "../bootstrap-configured";
import type { wireVrmSelection } from "./wire-avatar";

export function createPetConfig(deps: {
  endpointsSettings: Pick<SettingsStores["endpointsSettings"], "get">;
  guardrailsSettings: Pick<SettingsStores["guardrailsSettings"], "get">;
  chatKeySettings: Pick<SettingsStores["chatKeySettings"], "get">;
  sttKeySettings: Pick<SettingsStores["sttKeySettings"], "get">;
  ttsKeySettings: Pick<SettingsStores["ttsKeySettings"], "get">;
  log: Pick<Logger, "warn">;
}): {
  config: ReturnType<typeof createConfigStore>;
  getEndpoints(): EndpointsConfig;
  getGuardrails(): GuardrailsConfig;
} {
  const config = createConfigStore({
    secrets: createSettingsSecretProvider({
      stores: {
        [CHAT_API_KEY_SECRET]: deps.chatKeySettings,
        [STT_API_KEY_SECRET]: deps.sttKeySettings,
        [TTS_API_KEY_SECRET]: deps.ttsKeySettings,
      },
      fallback: {
        [CHAT_API_KEY_SECRET]: import.meta.env.VITE_YUI_CHAT_KEY,
        [STT_API_KEY_SECRET]: import.meta.env.VITE_YUI_STT_KEY,
        [TTS_API_KEY_SECRET]: import.meta.env.VITE_YUI_TTS_KEY,
      },
    }),
  });
  // No runtime override + no build-time key → the call looks like a silent 401 → warn early. Never log the key itself.
  if (
    import.meta.env.DEV &&
    !deps.chatKeySettings.get().apiKey &&
    !import.meta.env.VITE_YUI_CHAT_KEY
  ) {
    deps.log.warn("chat_key_missing", { env: "VITE_YUI_CHAT_KEY" });
  }
  if (
    import.meta.env.DEV &&
    !deps.sttKeySettings.get().apiKey &&
    !import.meta.env.VITE_YUI_STT_KEY
  ) {
    deps.log.warn("stt_key_missing", { env: "VITE_YUI_STT_KEY" });
  }
  if (
    import.meta.env.DEV &&
    !deps.ttsKeySettings.get().apiKey &&
    !import.meta.env.VITE_YUI_TTS_KEY
  ) {
    deps.log.warn("tts_key_missing", { env: "VITE_YUI_TTS_KEY" });
  }
  return {
    config,
    // Effective endpoints with overrides layered on config.endpoints. Evaluated at call time (hot-reload friendly).
    getEndpoints: () => mergeEndpoints(config.get().endpoints, deps.endpointsSettings.get()),
    // Effective guardrails with the edited caps layered on config.guardrails. Evaluated at call time.
    getGuardrails: () => mergeGuardrails(config.get().guardrails, deps.guardrailsSettings.get()),
  };
}

/**
 * Config hot-reload → live surfaces: per-section re-apply of emotions, motions, guardrails,
 * hotkeys, endpoints, and the avatar. Returns the subscription's own disposer for the composer
 * to register.
 */
export function wireConfigReload(deps: {
  config: Pick<ConfigStore, "subscribe">;
  renderer: Pick<
    Renderer,
    | "setEmotionRegistry"
    | "setIdleVariants"
    | "setMotionRegistry"
    | "setFraming"
    | "setGaze"
    | "setHitTestThreshold"
  >;
  surfaces: Pick<Surfaces, "setAttachmentLimits">;
  idleMotionSettings: Pick<SettingsStores["idleMotionSettings"], "get">;
  getGuardrails: () => GuardrailsConfig;
  configured: {
    guardrails: Pick<ConfiguredBootstrapHandles["guardrails"], "setConfig">;
    summonHotkey: Pick<ConfiguredBootstrapHandles["summonHotkey"], "apply">;
    broker: Pick<ConfiguredBootstrapHandles["broker"], "onConfigChange">;
  };
  vrm: Pick<ReturnType<typeof wireVrmSelection>, "vrmSelection" | "loadVrmSerialized">;
  refreshVoiceList: () => Promise<void>;
  log: Pick<Logger, "error">;
}): () => void {
  return deps.config.subscribe((cfg, changed) => {
    if (changed.has("emotionRegistry")) deps.renderer.setEmotionRegistry(cfg.emotionRegistry);
    if (changed.has("motions")) {
      // The enabled pool is catalog ∩ overlay, so a new catalog needs the intersection redone.
      // Applied before the registry — as at boot — so the baseline it replays already honors it.
      const idlePool = cfg.motions.idle;
      if (idlePool) {
        deps.renderer.setIdleVariants(enabledIdleVariants(idlePool, deps.idleMotionSettings.get()));
      }
      deps.renderer.setMotionRegistry(cfg.motions);
    }
    if (changed.has("guardrails")) {
      deps.configured.guardrails.setConfig(deps.getGuardrails());
      deps.surfaces.setAttachmentLimits(cfg.guardrails.attachments);
    }
    if (changed.has("hotkeys")) void deps.configured.summonHotkey.apply(cfg.hotkeys.summon_global);
    if (changed.has("endpoints")) void deps.refreshVoiceList();
    deps.configured.broker.onConfigChange(cfg, changed);
    if (!changed.has("avatar")) return;
    deps.renderer.setFraming(cfg.avatar.framing);
    deps.renderer.setGaze(cfg.avatar.gaze);
    deps.renderer.setHitTestThreshold(cfg.avatar.hit_test.alpha_threshold);
    deps.vrm.vrmSelection.setManifest({
      available: cfg.avatar.available,
      defaultValue: cfg.avatar.vrm_url,
    });
    void deps.vrm
      .loadVrmSerialized(deps.vrm.vrmSelection.getActive().url)
      .catch((err) => deps.log.error("vrm_hot_swap_failed", { error: String(err) }));
  });
}

/**
 * The config store's reload-error logger plus the DEV-only polling watcher as one handle: the
 * error logger installs in every build, startDev() runs only under `import.meta.env.DEV`.
 */
export function wireConfigWatch(deps: {
  config: Pick<ConfigStore, "onError" | "start" | "stop">;
  log: Pick<Logger, "error">;
  register: (teardown: () => void) => void;
}): { startDev(): void } {
  // The onError unsubscriber is dropped: this logger lives as long as the window.
  deps.config.onError((err) =>
    deps.log.error("config_reload_failed", {
      kept_previous: true,
      error: String(err),
    }),
  );
  return {
    startDev: () => {
      // Prod never calls this; the guard lets the minifier drop the DEV handle from the bundle.
      if (!import.meta.env.DEV) return;
      deps.config.start();
      Object.assign(globalThis as Record<string, unknown>, {
        __yuiConfig: deps.config,
      });
      // HMR module re-run stacks previous store's setInterval → stop in dispose.
      deps.register(() => deps.config.stop());
    },
  };
}
