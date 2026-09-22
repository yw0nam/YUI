/** The pet window's config store — bundled configs, runtime key overrides, and the live merges. */

import {
  CHAT_API_KEY_SECRET,
  type GuardrailsConfig,
  STT_API_KEY_SECRET,
  TTS_API_KEY_SECRET,
} from "../../config/load";
import { createConfigStore } from "../../config/store";
import type { EndpointsConfig } from "../../contract";
import { createSettingsSecretProvider } from "../../io/chat/secret-provider";
import type { Logger } from "../../logger";
import { mergeEndpoints } from "../../settings/backend/endpoints-settings";
import { mergeGuardrails } from "../../settings/backend/guardrails-settings";
import type { SettingsStores } from "../../settings/settings-stores";

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
