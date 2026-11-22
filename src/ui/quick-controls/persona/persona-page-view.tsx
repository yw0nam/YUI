/** The Persona page: the Active hours editor above the card. */

import type { PersonaConfig } from "../../../config/validators/persona/types";
import type { Logger } from "../../../logger";
import type { ActiveHoursSettingsStore } from "../../../settings/active-hours/active-hours-settings";
import type { createAgentSettings } from "../../../settings/backend/agent-settings";
import { ActiveHoursSection } from "./active-hours/active-hours-section";

export function PersonaPageView({
  activeHoursSettings,
  agentSettings,
  getPersona,
  log,
}: {
  activeHoursSettings: ActiveHoursSettingsStore;
  agentSettings: ReturnType<typeof createAgentSettings>;
  getPersona?: () => PersonaConfig | undefined;
  log: Logger;
}) {
  return (
    <ActiveHoursSection
      store={activeHoursSettings}
      agentSettings={agentSettings}
      getPersona={getPersona}
      log={log}
    />
  );
}
