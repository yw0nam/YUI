/** The voice step's write once Fish confirms a key: the Fish preset, the key, TTS on, and the app language's default voice active. */

import type { EndpointsConfig } from "../../../../contract";
import type { createSpeakerSelection } from "../../../../io/voice/voices/speaker-selection";
import type { ApiKeySettingsStore } from "../../../../settings/backend/api-key-settings";
import type { createEndpointsSettings } from "../../../../settings/backend/endpoints-settings";
import type { FlagSettingsStore } from "../../../../settings/persisted-store";
import { getLocale } from "../../../i18n";
import { FISH_PRESET } from "../../constants";

/** Returns the default voice's name, or null without the bundled default voices. */
export function turnOnVoice(
  deps: {
    endpointsSettings: Pick<ReturnType<typeof createEndpointsSettings>, "set">;
    ttsKeySettings: Pick<ApiKeySettingsStore, "setApiKey">;
    ttsSettings: Pick<FlagSettingsStore, "setEnabled">;
    speakerSelection: Pick<
      ReturnType<typeof createSpeakerSelection>,
      "list" | "addUserOption" | "pin"
    >;
    getDefaultVoices: () => NonNullable<EndpointsConfig["tts_default_voices"]> | undefined;
  },
  key: string,
): string | null {
  const voices = deps.getDefaultVoices();
  if (!voices) return null;
  // The owner switch to fish rides this set: the wired voice-list refresh reads it synchronously.
  deps.endpointsSettings.set({
    tts_provider: "fish",
    tts_base_url: FISH_PRESET.url,
    tts_model: FISH_PRESET.model,
  });
  deps.ttsKeySettings.setApiKey(key);
  deps.ttsSettings.setEnabled(true);
  const voice = voices[getLocale()];
  if (!deps.speakerSelection.list().some((o) => o.id === voice.id)) {
    deps.speakerSelection.addUserOption({
      id: voice.id,
      label: voice.name,
      ref_url: "",
      source: "user",
      provider: "fish",
    });
  }
  deps.speakerSelection.pin(voice.id);
  return voice.name;
}
