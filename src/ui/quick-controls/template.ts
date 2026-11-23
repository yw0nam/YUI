/** Quick-controls panel markup — pure string construction (no DOM, no state). */

import type { SettingsPage } from "../../settings/panels/settings-pages";
import { t } from "../i18n";
import {
  initialPageOf,
  TAB_ICON_BODY,
  TAB_ICON_CONN,
  TAB_ICON_GENERAL,
  TAB_ICON_HIST,
  TAB_ICON_LISTENING,
  TAB_ICON_MOTION,
  TAB_ICON_PERMS,
  TAB_ICON_PERSONA,
  TAB_ICON_PLUGINS,
  TAB_ICON_REACT,
  TAB_ICON_TOGETHER,
  TAB_ICON_VOICE,
} from "./constants";
import { presetStripHtml } from "./preset/preset-strip";
import { settingsSearchHtml } from "./search/settings-search";
import { tabButtonHtml, tabPanelOpenHtml } from "./tabs/tab-rail";

/** Initial flags/states the panel HTML needs — computed by the entry where the stores live. */
interface PanelHtmlOptions {
  /** Chat was unconfigured at window open: the panel opens on Connection, Quick start. */
  openOnQuickStart: boolean;
  /** Whether the History tab renders — true when a transcript store is injected. */
  showHistory: boolean;
  /** Whether the Plugins page renders — true when the MCP host is injected. */
  showPlugins?: boolean;
  /** Whether the preset strip and each page's scope line render — true when the registry is injected. */
  showPreset?: boolean;
}

export function buildPanelHtml(o: PanelHtmlOptions): string {
  const { openOnQuickStart, showHistory, showPlugins, showPreset } = o;

  // A narrow panel keeps the label; the icon-only rail drops it with the tooltip.
  const initialPage = initialPageOf(openOnQuickStart);
  const tabHtml = (id: SettingsPage, icon: string, opts?: { tipKey?: string }): string =>
    tabButtonHtml(id, icon, { selected: id === initialPage, tipKey: opts?.tipKey });
  const panelOpenHtml = (id: SettingsPage): string =>
    tabPanelOpenHtml(id, { hidden: id !== initialPage, scope: showPreset });
  // The character group's heading names the edited character once the preset strip fills it.
  const groupHtml = (group: "character" | "app"): string =>
    `<p class="yui-tabs__group" role="presentation" data-rail-group="${group}">${t(`rail.group_${group}`)}</p>`;

  return `
    ${showPreset ? presetStripHtml() : ""}
    <div class="yui-quick__cols">
      <div class="yui-rail">${settingsSearchHtml()}
      <div class="yui-tabs" role="tablist" aria-label="${t("panel.tablist_label")}" aria-orientation="vertical">${groupHtml("character")}${tabHtml("conn", TAB_ICON_CONN)}${tabHtml("voice", TAB_ICON_VOICE)}${tabHtml("persona", TAB_ICON_PERSONA)}${tabHtml("body", TAB_ICON_BODY)}${showHistory ? tabHtml("hist", TAB_ICON_HIST) : ""}${groupHtml("app")}${tabHtml("together", TAB_ICON_TOGETHER)}${tabHtml("listening", TAB_ICON_LISTENING)}${tabHtml("perms", TAB_ICON_PERMS)}${showPlugins ? tabHtml("plugins", TAB_ICON_PLUGINS) : ""}${tabHtml("react", TAB_ICON_REACT, { tipKey: "tabs.react_hint" })}${tabHtml("motion", TAB_ICON_MOTION)}${tabHtml("general", TAB_ICON_GENERAL)}
      </div>
      </div>
      <div class="yui-quick__body">
${panelOpenHtml("conn")}
      </div>
${panelOpenHtml("voice")}
      </div>
${panelOpenHtml("persona")}
      </div>
${panelOpenHtml("body")}
      </div>
${
  showHistory
    ? `${panelOpenHtml("hist")}
      </div>
`
    : ""
}${panelOpenHtml("together")}
      </div>
${panelOpenHtml("listening")}
      </div>
${panelOpenHtml("perms")}
      </div>
${
  showPlugins
    ? `${panelOpenHtml("plugins")}
      </div>
`
    : ""
}${panelOpenHtml("react")}
      </div>
${panelOpenHtml("motion")}
      </div>
${panelOpenHtml("general")}
      </div>
      </div>
    </div>
  `;
}
