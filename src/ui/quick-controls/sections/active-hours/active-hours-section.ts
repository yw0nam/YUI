/**
 * Active hours section of the Persona page: mounts the span editor on the panel's host
 * element and binds it to the per-character store and the agent card.
 */

import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { PersonaConfig } from "../../../../config/validators/persona/types";
import type { Logger } from "../../../../logger";
import type { ActiveHoursSettingsStore } from "../../../../settings/active-hours/active-hours-settings";
import type { SettingsStores } from "../../../../settings/settings-stores";
import { ActiveHours } from "./active-hours";
import "./active-hours-section.css";

export function activeHoursSectionHtml(): string {
  return `
        <div class="yui-sec yui-hours"></div>`;
}

interface ActiveHoursSectionDeps {
  /** Panel root holding the section's markup. */
  root: HTMLElement;
  activeHoursSettings: ActiveHoursSettingsStore;
  agentSettings: Pick<SettingsStores["agentSettings"], "current" | "subscribe">;
  /** The bundled config's default cards; undefined until the config loads. */
  getPersona?: () => PersonaConfig | undefined;
  log: Logger;
}

interface ActiveHoursSection {
  /** Permanent teardown: unsubscribe and unmount. */
  dispose(): void;
}

export function createActiveHoursSection(deps: ActiveHoursSectionDeps): ActiveHoursSection {
  const { root: panel, activeHoursSettings, agentSettings, getPersona, log } = deps;
  const sec = panel.querySelector<HTMLElement>(".yui-hours")!;

  const root = createRoot(sec);
  flushSync(() =>
    root.render(
      createElement(ActiveHours, {
        store: activeHoursSettings,
        agentSettings,
        getPersona,
        log,
      }),
    ),
  );

  return {
    dispose(): void {
      root.unmount();
    },
  };
}
