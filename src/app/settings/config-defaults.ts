import type { ConfigStore } from "../../config/store";
import { agentTriggerableMotionIds } from "../../io/chat/vocabulary/express-vocabulary";
import { endpointDefaultsOf } from "../../settings/backend/endpoints-settings";
import { rateLimitDefaultsFromConfig } from "../../settings/backend/guardrails-settings";
import { screenDefaultsFromConfig } from "../../settings/capture/screen-settings";

/** The quick-controls getters over the bundled config; each falls back while the config has not loaded. */
export function quickControlsConfigDefaults(config: Pick<ConfigStore, "get">) {
  const read = <T, F>(pick: (cfg: ReturnType<ConfigStore["get"]>) => T, fallback: F): T | F => {
    try {
      return pick(config.get());
    } catch {
      return fallback;
    }
  };
  return {
    getRateLimitDefaults: () => read((c) => rateLimitDefaultsFromConfig(c.guardrails), undefined),
    getScreenDefaults: () => read((c) => screenDefaultsFromConfig(c.screen), undefined),
    getDefaultInstructions: () => read((c) => c.endpoints.chat_instructions, undefined),
    getEndpointDefaults: () => endpointDefaultsOf(config),
    getDefaultChatApi: () => read((c) => c.endpoints.chat_api, undefined),
    getIdlePool: () => read((c) => c.motions.idle, undefined),
    getExpressMotions: () => read((c) => agentTriggerableMotionIds(c.motions), [] as string[]),
  };
}
