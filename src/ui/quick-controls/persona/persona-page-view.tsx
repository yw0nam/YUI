/** The Persona page: the Active hours editor above the card. */

import type { PersonaConfig } from "../../../config/validators/persona/types";
import type { Logger } from "../../../logger";
import type { ActiveHoursSettingsStore } from "../../../settings/active-hours/active-hours-settings";
import type { createAgentSettings } from "../../../settings/backend/agent-settings";
import type { PresetRegistry } from "../../../settings/preset/preset-registry";
import { ActiveHoursSection } from "./active-hours/active-hours-section";
import type { CardIo } from "./card/card-io";
import { CardSection } from "./card/card-section";

export function PersonaPageView({
  activeHoursSettings,
  agentSettings,
  registry,
  getPersona,
  isPushMode,
  io,
  log,
  refresh,
}: {
  activeHoursSettings?: ActiveHoursSettingsStore;
  agentSettings: ReturnType<typeof createAgentSettings>;
  registry?: Pick<PresetRegistry, "rename">;
  getPersona?: () => PersonaConfig | undefined;
  isPushMode: () => boolean;
  io?: CardIo;
  log: Logger;
  refresh(): void;
}) {
  return (
    <>
      {activeHoursSettings && (
        <ActiveHoursSection
          store={activeHoursSettings}
          agentSettings={agentSettings}
          getPersona={getPersona}
          log={log}
        />
      )}
      <CardSection
        agentSettings={agentSettings}
        registry={registry}
        getPersona={getPersona}
        isPushMode={isPushMode}
        io={io}
        log={log}
        refresh={refresh}
      />
    </>
  );
}
