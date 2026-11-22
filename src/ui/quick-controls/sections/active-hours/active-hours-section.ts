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
import { spansInUse } from "../../../../settings/active-hours/card-active-hours";
import type { SettingsStores } from "../../../../settings/settings-stores";
import { getLocale } from "../../../i18n";
import { ActiveHours, type ActiveHoursView } from "./active-hours";
import "./active-hours-section.css";

export function activeHoursSectionHtml(): string {
  return `
        <div class="yui-sec yui-hours"></div>`;
}

interface ActiveHoursSectionDeps {
  /** Panel root holding the section's markup. */
  root: HTMLElement;
  activeHoursSettings: ActiveHoursSettingsStore;
  agentSettings: Pick<SettingsStores["agentSettings"], "get" | "subscribe">;
  /** The bundled config's default cards; undefined until the config loads. */
  getPersona?: () => PersonaConfig | undefined;
  log: Logger;
}

interface ActiveHoursSection {
  /** Permanent teardown: unsubscribe and unmount. */
  dispose(): void;
}

export function createActiveHoursSection(deps: ActiveHoursSectionDeps): ActiveHoursSection {
  const { root: panel, activeHoursSettings: store, agentSettings, getPersona, log } = deps;
  const sec = panel.querySelector<HTMLElement>(".yui-hours")!;

  // The card this section reads spans from: the user's card, else the default card of the UI language.
  const card = () => agentSettings.get().card ?? getPersona?.()?.cards[getLocale()];
  // The stores clone on every read, so the view is a fresh object per call; useSnapshot keeps one until the next change.
  const read = (): ActiveHoursView => {
    const edited = store.get().spans;
    return { edited, spans: spansInUse(edited, card()) };
  };
  const subscribe = (cb: () => void): (() => void) => {
    const offs = [store.subscribe(cb), agentSettings.subscribe(cb)];
    return () => {
      for (const off of offs) off();
    };
  };

  const root = createRoot(sec);
  flushSync(() => root.render(createElement(ActiveHours, { read, subscribe, store, log })));

  return {
    dispose(): void {
      root.unmount();
    },
  };
}
