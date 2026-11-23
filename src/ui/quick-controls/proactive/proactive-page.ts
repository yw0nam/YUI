import type { PersonaConfig } from "../../../config/validators/persona/types";
import type { Logger } from "../../../logger";
import type { ActiveHoursSettingsStore } from "../../../settings/active-hours/active-hours-settings";
import type { BasePaceSettingsStore } from "../../../settings/active-hours/base-pace-settings";
import type { createAgentSettings } from "../../../settings/backend/agent-settings";
import type {
  GuardrailsSettingsStore,
  RateLimitDefaults,
} from "../../../settings/backend/guardrails-settings";
import type { createProactiveSettings } from "../../../settings/cues/proactive-settings";
import type { createScheduleSettings } from "../../../settings/cues/schedule-settings";
import type { ClampedIntSettingsStore } from "../../../settings/persisted-store";

export interface ProactivePage {
  el: HTMLElement;
  refresh(): void;
  dispose(): void;
}

export function createProactivePage(_deps: {
  basePaceSettings?: BasePaceSettingsStore;
  activeHoursSettings?: ActiveHoursSettingsStore;
  agentSettings: Pick<ReturnType<typeof createAgentSettings>, "current" | "subscribe">;
  getPersona?: () => PersonaConfig | undefined;
  scheduleSettings: ReturnType<typeof createScheduleSettings>;
  proactiveSettings: ReturnType<typeof createProactiveSettings>;
  openPersona(): void;
  pacerGapSettings?: ClampedIntSettingsStore;
  presenceSettings?: ClampedIntSettingsStore;
  rateLimitSettings?: GuardrailsSettingsStore;
  getRateLimitDefaults?: () => RateLimitDefaults | undefined;
  log: Logger;
}): ProactivePage {
  return { el: document.createElement("div"), refresh() {}, dispose() {} };
}
