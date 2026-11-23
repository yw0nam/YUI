/** Quick start's write once Gemini confirms a pasted key: the key alone when already connected, else the whole connection. */

import type { ChatKeySettingsStore } from "../../../../settings/backend/api-key-settings";
import type { createEndpointsSettings } from "../../../../settings/backend/endpoints-settings";
import type { createProactiveSettings } from "../../../../settings/cues/proactive-settings";
import type { createScheduleSettings } from "../../../../settings/cues/schedule-settings";
import { GEMINI_PRESET } from "../../constants";

export function writeGeminiKey(
  deps: {
    endpointsSettings: Pick<ReturnType<typeof createEndpointsSettings>, "set">;
    chatKeySettings: Pick<ChatKeySettingsStore, "setApiKey">;
    proactiveSettings: Pick<ReturnType<typeof createProactiveSettings>, "setEnabled">;
    scheduleSettings: Pick<ReturnType<typeof createScheduleSettings>, "setEnabled">;
    onConnected: () => void;
  },
  key: string,
  wasConnected: boolean,
): void {
  if (wasConnected) {
    deps.chatKeySettings.setApiKey(key);
    return;
  }
  deps.endpointsSettings.set({
    chat_base_url: GEMINI_PRESET.url,
    chat_model: GEMINI_PRESET.model,
    chat_api: "chat_completions",
  });
  deps.chatKeySettings.setApiKey(key);
  deps.proactiveSettings.setEnabled(false);
  deps.scheduleSettings.setEnabled(false);
  deps.onConnected();
}
