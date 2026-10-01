/** General tab, Speech bubble section: the keep-until-dismissed switch over its store. */

import type { Logger } from "../../../../logger";
import type { FlagSettingsStore } from "../../../../settings/persisted-store";
import { t } from "../../../i18n";
import { secHeadHtml } from "../../../quick-controls/markup";
import { createBubblePersistRow } from "../../../quick-controls/switch-row";
import { bindSwitchRows, switchRowHtml } from "../../../quick-controls/switches/switch-rows";

export function createBubbleSection(deps: {
  bubblePersistSettings: FlagSettingsStore;
  log: Logger;
}): { el: HTMLElement; refresh(): void; dispose(): void } {
  const { bubblePersistSettings, log } = deps;
  const row = createBubblePersistRow(bubblePersistSettings);

  const el = document.createElement("div");
  el.className = "yui-sec";
  el.innerHTML = `${secHeadHtml(t("phone.general.bubble_section"))}<div class="yui-group">${switchRowHtml(row)}</div>`;
  const switches = bindSwitchRows(el, [row], log);
  const unsubscribe = bubblePersistSettings.subscribe(() => switches.reflect());

  return {
    el,
    refresh: switches.reflect,
    dispose(): void {
      unsubscribe();
      switches.dispose();
      el.remove();
    },
  };
}
