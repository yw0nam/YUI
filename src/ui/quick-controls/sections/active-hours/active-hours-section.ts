/** Stub for the red run: the section renders its shell and no rows yet. */

import type { PersonaConfig } from "../../../../config/validators/persona/types";
import type { ActiveHoursSettingsStore } from "../../../../settings/active-hours/active-hours-settings";
import type { SettingsStores } from "../../../../settings/settings-stores";
import type { Logger } from "../../../../logger";
import { t } from "../../../i18n";
import { PLUS_SVG } from "../../constants";
import { secHeadHtml } from "../../markup";

export function activeHoursSectionHtml(): string {
  return `
        <div class="yui-sec yui-hours">
          ${secHeadHtml(
            t("active_hours.label"),
            `<button class="yui-reset" type="button" hidden>${t("card.reset")}</button>`,
          )}
          <p class="yui-sec__note">${t("active_hours.note")}</p>
          <div class="yui-group">
            <div class="yui-cue-list"></div>
            <div class="yui-row yui-row--action">
              <button class="yui-add-btn" type="button">${PLUS_SVG}${t("active_hours.add")}</button>
            </div>
          </div>
          <p class="yui-sec__foot">${t("active_hours.foot")}</p>
        </div>`;
}

export function createActiveHoursSection(_deps: {
  /** Panel root holding the section's markup. */
  root: HTMLElement;
  activeHoursSettings: ActiveHoursSettingsStore;
  agentSettings: Pick<SettingsStores["agentSettings"], "get" | "subscribe">;
  /** The bundled config's default cards; undefined until the config loads. */
  getPersona?: () => PersonaConfig | undefined;
  log: Logger;
}): { dispose(): void } {
  return { dispose: () => {} };
}
