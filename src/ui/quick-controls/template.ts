/** Quick-controls panel markup — pure string construction (no DOM, no state). */

import type { SettingsPage } from "../../settings/panels/settings-pages";
import { t } from "../i18n";
import {
  DISCLOSURE_CHEV_SVG,
  initialPageOf,
  PLUS_SVG,
  PROACTIVE_CAP_FIELDS,
  SCREEN_KNOB_FIELDS,
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
import { foldHtml } from "./fold";
import { capRowHtml, numRowHtml, secHeadHtml } from "./markup";
import { presetStripHtml } from "./preset/preset-strip";
import { settingsSearchHtml } from "./search/settings-search";
import { basePaceSectionHtml } from "./sections/base-pace/base-pace-section";
import { threadReactionThresholdsRowHtml } from "./sections/reactions/thread-reaction-thresholds-row";
import { threadTurnsRowHtml } from "./sections/reactions/thread-turns-row";
import { speakerPickerHtml } from "./sections/speaker/speaker-list";
import type { SwitchRow } from "./switch-row";
import { switchButtonHtml, switchRowHtml } from "./switches/switch-rows";
import { tabButtonHtml, tabPanelOpenHtml } from "./tabs/tab-rail";

/** Initial flags/states the panel HTML needs — computed by the entry where the stores live. */
interface PanelHtmlOptions {
  /** Chat was unconfigured at window open: the panel opens on Connection, Quick start. */
  openOnQuickStart: boolean;
  switchRows: readonly SwitchRow[];
  /** Whether How often she speaks up renders — true when the base pace store is injected. */
  showBasePace?: boolean;
  /** Whether the Screen changes group renders — true when the screen flag store is injected. */
  showScreen: boolean;
  /** Whether the Thread turns row renders under Threads — true with its store and External signals' store. */
  showThreadTurns: boolean;
  /** Whether the Reaction thresholds rows render under Threads — true with their store and the Thread reactions switch's store. */
  showReactionThresholds?: boolean;
  showPresence: boolean;
  showPacerGap: boolean;
  /** Whether the rate-limit cap rows render — true when the guardrails-override store is injected. */
  showRateLimits: boolean;
  /** Whether the History tab renders — true when a transcript store is injected. */
  showHistory: boolean;
  /** Whether the Plugins page renders — true when the MCP host is injected. */
  showPlugins?: boolean;
  /** Whether the preset strip and each page's scope line render — true when the registry is injected. */
  showPreset?: boolean;
}

export function buildPanelHtml(o: PanelHtmlOptions): string {
  const {
    openOnQuickStart,
    switchRows,
    showBasePace,
    showScreen,
    showThreadTurns,
    showReactionThresholds = false,
    showPresence,
    showPacerGap,
    showRateLimits,
    showHistory,
    showPlugins,
    showPreset,
  } = o;
  const visibleSwitchRows = switchRows.filter((row) => row.isVisible);

  function switchRowsHtml(tab: SwitchRow["tab"], position?: SwitchRow["position"]): string {
    return visibleSwitchRows
      .filter((row) => row.tab === tab && row.position === position)
      .map(switchRowHtml)
      .join("");
  }
  // Proactive page: one group per source, its switch row over a fold of its details.
  const sourceGroupHtml = (switchHtml: string, fold: string): string =>
    switchHtml || fold
      ? `
          <div class="yui-group">${switchHtml}${fold}</div>`
      : "";
  const screenGroupHtml = showScreen
    ? sourceGroupHtml(
        switchRowsHtml("react", "screen"),
        foldHtml(
          t("screen.timing"),
          t("screen.timing_summary", { n: SCREEN_KNOB_FIELDS.length }),
          `${SCREEN_KNOB_FIELDS.map((f) => numRowHtml(f)).join("")}<p class="yui-field-hint">${t("screen.foot")}</p>`,
        ),
      )
    : "";
  const threadRowsHtml = `${showReactionThresholds ? threadReactionThresholdsRowHtml() : ""}${showThreadTurns ? threadTurnsRowHtml() : ""}`;
  const threadsGroupHtml = sourceGroupHtml(
    switchRowsHtml("react", "threads"),
    threadRowsHtml ? foldHtml(t("threadReactions.fold"), "", threadRowsHtml) : "",
  );
  const signalsSwitchHtml = switchRowsHtml("react", "signals");
  const signalsGroupHtml = signalsSwitchHtml
    ? sourceGroupHtml(
        signalsSwitchHtml,
        foldHtml(
          t("agentNotify.fold"),
          "",
          `${numRowHtml({ id: "yui-agent-port", labelKey: "reactions.port_label", subKey: "reactions.port_sub", min: 1024, max: 65535, hintKey: "reactions.restart_hint" })}<div class="yui-stack yui-input-row"><span class="yui-input-row__label">${t("reactions.url_label")}</span><span class="yui-row__sub">${t("reactions.url_sub")}</span><code id="yui-ingress-url" class="yui-quick__ingress-url"></code><span class="yui-row__sub">${t("reactions.restart_hint")}</span></div>`,
        ),
      )
    : "";

  // Advanced (Proactive page, folded): the wait and presence, then the hourly caps and their note.
  const advancedGroupsHtml = `${
    showPacerGap || showPresence
      ? `
          <div class="yui-group">${showPacerGap ? numRowHtml({ id: "yui-pacer-gap", labelKey: "reactions.pacer_gap_label", subKey: "reactions.pacer_gap_sub", min: 0, max: 180, suffixKey: "reactions.minutes_suffix", hintKey: "reactions.pacer_gap_hint" }) : ""}${showPresence ? numRowHtml({ id: "yui-presence", labelKey: "reactions.presence_label", subKey: "reactions.presence_sub", min: 10, max: 3600, suffixKey: "reactions.seconds_suffix", hintKey: "reactions.restart_hint" }) : ""}</div>`
      : ""
  }${
    showRateLimits
      ? `
          <div class="yui-group">${PROACTIVE_CAP_FIELDS.map(capRowHtml).join("")}</div>
          <p class="yui-sec__foot">${t("reactions.rate_hint")}</p>`
      : ""
  }`;
  const advancedHtml = advancedGroupsHtml
    ? `
      <div class="yui-sec">
        <details class="yui-more">
          <summary>${DISCLOSURE_CHEV_SVG}${t("reactions.advanced")}</summary>${advancedGroupsHtml}
        </details>
      </div>`
    : "";

  // Thinking filler section — its enable switch rides the title row.
  const fillerRow = visibleSwitchRows.find(
    (row) => row.tab === "voice" && row.position === "filler",
  );
  function fillerStackHtml(labelKey: string, subKey: string, cls: string, ariaKey: string): string {
    return `
            <div class="yui-stack">
              <span class="yui-row__label">${t(labelKey)}</span>
              <span class="yui-row__sub">${t(subKey)}</span>
              <textarea class="yui-textarea yui-textarea--short ${cls}" spellcheck="false" rows="3" aria-label="${t(ariaKey)}"></textarea>
            </div>`;
  }
  const fillerHtml = fillerRow
    ? `
      <div class="yui-sec yui-filler">
        ${secHeadHtml(t("filler.section"), switchButtonHtml(fillerRow))}
        ${fillerRow.subKey ? `<p class="yui-sec__note">${t(fillerRow.subKey)}</p>` : ""}
        <div class="yui-group">
          <div class="yui-row">
            <div class="yui-row__main">
              <span class="yui-row__label">${t("filler.lang_label")}</span>
              <span class="yui-row__sub">${t("filler.lang_sub")}</span>
            </div>
            <div class="yui-seg yui-filler-lang-seg" role="radiogroup" aria-label="${t("filler.lang_aria")}">
              <button class="yui-seg__btn" type="button" role="radio" data-lang="ja" aria-checked="false" tabindex="-1">日本語</button>
              <button class="yui-seg__btn" type="button" role="radio" data-lang="en" aria-checked="false" tabindex="-1">English</button>
              <button class="yui-seg__btn" type="button" role="radio" data-lang="ko" aria-checked="false" tabindex="-1">한국어</button>
            </div>
          </div>${fillerStackHtml("filler.first_label", "filler.first_sub", "yui-filler-first-textarea", "filler.first_aria")}${fillerStackHtml("filler.repeat_label", "filler.repeat_sub", "yui-filler-repeat-textarea", "filler.repeat_aria")}
        </div>
        <p class="yui-sec__foot">${t("filler.hint")}</p>
        <details class="yui-more">
          <summary>${DISCLOSURE_CHEV_SVG}${t("filler.more")}</summary>
          <div class="yui-group">${fillerStackHtml("filler.long_wait_label", "filler.long_wait_sub", "yui-filler-long-wait-textarea", "filler.long_wait_aria")}${fillerStackHtml("filler.timeout_label", "filler.timeout_sub", "yui-filler-timeout-textarea", "filler.timeout_aria")}${fillerStackHtml("filler.unreachable_label", "filler.unreachable_sub", "yui-filler-unreachable-textarea", "filler.unreachable_aria")}${fillerStackHtml("filler.threads_open_label", "filler.threads_open_sub", "yui-filler-threads-open-textarea", "filler.threads_open_aria")}${fillerStackHtml("filler.threads_raise_label", "filler.threads_raise_sub", "yui-filler-threads-raise-textarea", "filler.threads_raise_aria")}${fillerStackHtml("filler.tool_label", "filler.tool_sub", "yui-filler-tool-textarea", "filler.tool_aria")}
          </div>
        </details>
      </div>`
    : "";

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
        <div class="yui-sec">
          <div class="yui-group">${switchRowsHtml("voice")}
          </div>${speakerPickerHtml()}
        </div>${fillerHtml}
        <div class="yui-sec">
          <div class="yui-group">${switchRowsHtml("voice", "after-filler")}
          </div>
        </div>
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
}${panelOpenHtml("react")}${showBasePace ? basePaceSectionHtml() : ""}
        <div class="yui-sec">
          ${secHeadHtml(t("reactions.reacts_title"))}
          <div class="yui-group yui-loop-cue-section"></div>
          <div class="yui-group yui-cue-sections"></div>${screenGroupHtml}${threadsGroupHtml}${signalsGroupHtml}
        </div>
        <div class="yui-sec">
          ${secHeadHtml(t("workflows.title"))}
          <p class="yui-sec__note">${t("workflows.sub")}</p>
          <div class="yui-group yui-wf-list"></div>
          <div class="yui-group yui-wf-add">
            <div class="yui-row yui-input-row" data-wf-field="label">
              <div class="yui-row__main"><label class="yui-input-row__label" for="yui-wf-label">${t("workflows.label_label")}</label></div>
              <div class="yui-input-wrap">
                <input class="yui-ep-input yui-wf-label-input" id="yui-wf-label" type="text" placeholder="${t("workflows.label_ph")}" />
              </div>
            </div>
            <div class="yui-row yui-input-row" data-wf-field="url">
              <div class="yui-row__main"><label class="yui-input-row__label" for="yui-wf-url">${t("workflows.url_label")}</label></div>
              <div class="yui-input-wrap">
                <input class="yui-ep-input yui-wf-url-input" id="yui-wf-url" type="text" inputmode="url" placeholder="${t("workflows.url_ph")}" />
              </div>
              <p class="yui-input-row__error">${t("workflows.url_error")}</p>
            </div>
            <div class="yui-row yui-row--action">
              <button class="yui-add-btn yui-wf-add-btn" type="button" disabled>${PLUS_SVG}${t("workflows.add")}</button>
            </div>
          </div>
        </div>${advancedHtml}
      </div>
${panelOpenHtml("motion")}
        <div class="yui-sec yui-motion-switches">
          <div class="yui-group">${switchRowsHtml("motion")}
          </div>
        </div>
      </div>
${panelOpenHtml("general")}
      </div>
      </div>
    </div>
  `;
}
