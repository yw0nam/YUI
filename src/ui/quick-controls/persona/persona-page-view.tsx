/** The Persona page: the Active hours editor above the card. */

import { useEffect } from "react";
import type { PersonaConfig } from "../../../config/validators/persona/types";
import type { Logger } from "../../../logger";
import type { ActiveHoursSettingsStore } from "../../../settings/active-hours/active-hours-settings";
import type { createAgentSettings } from "../../../settings/backend/agent-settings";
import type { PresetRegistry } from "../../../settings/preset/preset-registry";
import { ActiveHoursSection } from "./active-hours/active-hours-section";
import type { CardIo, CardIoPorts } from "./card/card-io";
import { CardSection } from "./card/card-section";

export function PersonaPageView({
  activeHoursSettings,
  agentSettings,
  registry,
  getPersona,
  isPushMode,
  io,
  importBusy,
  vrmSelection,
  speakerSelection,
  inspectPresetVrm,
  log,
  refresh,
  sources,
  openDrop,
}: {
  activeHoursSettings?: ActiveHoursSettingsStore;
  agentSettings: ReturnType<typeof createAgentSettings>;
  registry?: Pick<PresetRegistry, "rename">;
  getPersona?: () => PersonaConfig | undefined;
  isPushMode: () => boolean;
  io: CardIo;
  importBusy: CardIoPorts["importBusy"];
  vrmSelection: Parameters<typeof CardSection>[0]["vrmSelection"];
  speakerSelection: Parameters<typeof CardSection>[0]["speakerSelection"];
  inspectPresetVrm: CardIoPorts["inspectPresetVrm"];
  log: Logger;
  refresh(): void;
  /** Subscriptions held while the page is mounted; each returns its release. */
  sources: readonly ((() => () => void) | undefined)[];
  /** Opens the card's drop cover while the page is mounted. */
  openDrop?: () => { dispose(): void } | undefined;
}) {
  useEffect(() => {
    const offs = sources.map((subscribe) => subscribe?.());
    return () => {
      for (const off of offs) off?.();
    };
  }, [sources]);
  useEffect(() => {
    const cover = openDrop?.();
    return () => cover?.dispose();
  }, [openDrop]);
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
        importBusy={importBusy}
        vrmSelection={vrmSelection}
        speakerSelection={speakerSelection}
        inspectPresetVrm={inspectPresetVrm}
        log={log}
        refresh={refresh}
      />
    </>
  );
}
