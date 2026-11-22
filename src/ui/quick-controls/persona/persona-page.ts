/** The Persona page: its React root. */

import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { PersonaConfig } from "../../../config/validators/persona/types";
import type { Logger } from "../../../logger";
import type { ActiveHoursSettingsStore } from "../../../settings/active-hours/active-hours-settings";
import type { createAgentSettings } from "../../../settings/backend/agent-settings";
import { PersonaPageView } from "./persona-page-view";

export interface PersonaPage {
  el: HTMLElement;
  dispose(): void;
}

export function createPersonaPage(deps: {
  activeHoursSettings: ActiveHoursSettingsStore;
  agentSettings: ReturnType<typeof createAgentSettings>;
  /** The bundled config's default cards; undefined until the config loads. */
  getPersona?: () => PersonaConfig | undefined;
  log: Logger;
}): PersonaPage {
  const el = document.createElement("div");
  el.className = "yui-tab-stack";
  const root = createRoot(el);
  flushSync(() => root.render(createElement(PersonaPageView, deps)));

  return {
    el,
    dispose(): void {
      root.unmount();
    },
  };
}
