/** Quick-controls panel markup — pure string construction (no DOM, no state). */
import "./sections/session-section.css";
import { INSTRUCTIONS_MAX_LEN, REASONING_EFFORTS } from "../../settings/backend/agent-settings";
import { RATE_LIMIT_MAX } from "../../settings/backend/guardrails-settings";
import { LOCALE_DISPLAY_NAMES, t } from "../i18n";
import {
  LANG_PICKER_ORDER,
  RATE_LIMIT_FIELDS,
  SCREEN_KNOB_FIELDS,
  SCREEN_MIN_GAP_MAX,
  SCREEN_MIN_GAP_MIN,
  SEG_LABEL_KEYS,
  TAB_ICON_CHAR,
  TAB_ICON_CONN,
  TAB_ICON_GENERAL,
  TAB_ICON_HIST,
  TAB_ICON_INPUT,
  TAB_ICON_REACT,
  TAB_ICON_TALK,
} from "./constants";
import { escapeAttr, secHeadHtml } from "./markup";
import type { SwitchRow } from "./switch-row";
import { switchButtonHtml, switchRowHtml } from "./switches/switch-rows";
import { tabButtonHtml, tabPanelOpenHtml } from "./tabs/tab-rail";

/**
 * Small round `?` that follows a section label whose name alone is not self-explanatory.
 * Markup only — hint-tooltip.ts wires the hover/focus/click tooltip onto `.yui-hint-dot`.
 */
function hintDotHtml(textKey: string): string {
  const text = escapeAttr(t(textKey));
  return `<button type="button" class="yui-hint-dot" aria-label="${text}" data-tip="${text}" data-tip-pin>?</button>`;
}

const PLUS_SVG = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;

/** Initial flags/states the panel HTML needs — computed by the entry where the stores live. */
interface PanelHtmlOptions {
  isWindow: boolean;
  /** Whether the window-only context-occupancy readout renders. */
  hasSession: boolean;
  switchRows: readonly SwitchRow[];
  /** Whether the screen-watch section renders — true when the screen flag store is injected. */
  showScreen: boolean;
  showPresence: boolean;
  showPacerGap: boolean;
  /** Whether the rate-limit cap rows render — true when the guardrails-override store is injected. */
  showRateLimits: boolean;
  showDevtools: boolean;
  /** Whether the header carries the button that opens the text input. */
  showMessage: boolean;
  /** Whether the History tab renders — true when a transcript store is injected. */
  showHistory: boolean;
}

export function buildPanelHtml(o: PanelHtmlOptions): string {
  const {
    isWindow,
    hasSession,
    switchRows,
    showScreen,
    showPresence,
    showPacerGap,
    showRateLimits,
    showDevtools,
    showMessage,
    showHistory,
  } = o;
  const visibleSwitchRows = switchRows.filter((row) => row.isVisible);

  function switchRowsHtml(tab: SwitchRow["tab"], position?: SwitchRow["position"]): string {
    return visibleSwitchRows
      .filter((row) => row.tab === tab && row.position === position)
      .map(
        (row) =>
          `${switchRowHtml(row)}${
            row.accessory === "agent-port"
              ? numRowHtml({
                  id: "yui-agent-port",
                  labelKey: "reactions.port_label",
                  subKey: "reactions.port_sub",
                  min: 1024,
                  max: 65535,
                  hintKey: "reactions.restart_hint",
                })
              : ""
          }`,
      )
      .join("");
  }
  const segButtonsHtml = REASONING_EFFORTS.map(
    (e) =>
      `<button class="yui-seg__btn" type="button" role="radio" data-effort="${e}" aria-checked="false" tabindex="-1">${t(SEG_LABEL_KEYS[e])}</button>`,
  ).join("");

  // Language picker seg (3 positions) — display language switch. Host re-mounts via i18n.subscribe.
  const langButtonsHtml = LANG_PICKER_ORDER.map(
    (l) =>
      `<button class="yui-seg__btn" type="button" role="radio" data-locale="${l}" aria-checked="false" tabindex="-1">${LOCALE_DISPLAY_NAMES[l]}</button>`,
  ).join("");

  // Numeric input row: label+sub(+hint) on the left, number input with its unit on the right.
  function numRowHtml(opts: {
    id: string;
    labelKey: string;
    subKey: string;
    min: number;
    max: number;
    suffixKey?: string;
    hintKey?: string;
  }): string {
    const { id, labelKey, subKey, min, max, suffixKey, hintKey } = opts;
    const suffixHtml = suffixKey ? `<span class="yui-cue__suffix">${t(suffixKey)}</span>` : "";
    const hintHtml = hintKey ? `<span class="yui-row__sub">${t(hintKey)}</span>` : "";
    return `
          <div class="yui-row">
            <div class="yui-row__main">
              <label class="yui-input-row__label" for="${id}">${t(labelKey)}</label>
              <span class="yui-input-row__sub">${t(subKey)}</span>${hintHtml}
            </div>
            <div class="yui-num">
              <input class="yui-num-input" id="${id}" type="number" min="${min}" max="${max}" inputmode="numeric" />
              ${suffixHtml}
            </div>
          </div>`;
  }

  // Screen-watch section (Proactive tab) — master toggle plus the knob group it reveals.
  // The min-gap slider carries the .yui-gain markup; the four thresholds are numeric rows.
  const screenHtml = showScreen
    ? `
      <div class="yui-sec">
        ${secHeadHtml(`${t("screen.section")}${hintDotHtml("screen.hint")}`)}
        <div class="yui-group">
${switchRowsHtml("react", "screen")}
          <div class="yui-screen-knobs" hidden>
            <div class="yui-gain">
              <div class="yui-gain__head">
                <span class="yui-gain__label">${t("screen.min_gap_label")}</span>
                <span class="yui-gain__value yui-screen-gap__value"></span>
              </div>
              <input class="yui-gain__slider yui-screen-gap__slider" type="range"
                min="${SCREEN_MIN_GAP_MIN}" max="${SCREEN_MIN_GAP_MAX}" step="1" aria-label="${t("screen.min_gap_aria")}" />
            </div>
${SCREEN_KNOB_FIELDS.map((f) =>
  numRowHtml({
    id: f.id,
    labelKey: f.labelKey,
    subKey: f.subKey,
    min: f.min,
    max: f.max,
    suffixKey: f.suffixKey,
  }),
).join("")}
            <p class="yui-field-hint">${t("screen.foot")}</p>
          </div>
        </div>
      </div>`
    : "";

  const watcherRowsHtml = switchRowsHtml("react");
  const watchersHtml = watcherRowsHtml
    ? `
      <div class="yui-sec">
        ${secHeadHtml(t("reactions.watchers_title"))}
        <div class="yui-group">${watcherRowsHtml}
        </div>
      </div>`
    : "";

  const sharedHtml =
    showPresence || showPacerGap
      ? `
      <div class="yui-sec">
        ${secHeadHtml(t("reactions.shared_title"))}
        <div class="yui-group">
        ${showPresence ? numRowHtml({ id: "yui-presence", labelKey: "reactions.presence_label", subKey: "reactions.presence_sub", min: 10, max: 3600, suffixKey: "reactions.seconds_suffix", hintKey: "reactions.restart_hint" }) : ""}
        ${showPacerGap ? numRowHtml({ id: "yui-pacer-gap", labelKey: "reactions.pacer_gap_label", subKey: "reactions.pacer_gap_sub", min: 0, max: 180, suffixKey: "reactions.minutes_suffix", hintKey: "reactions.pacer_gap_hint" }) : ""}
        </div>
      </div>`
      : "";

  // Rate-limit section (Proactive tab) — the rolling-window caps, one numeric row each.
  const rateLimitHtml = showRateLimits
    ? `
      <div class="yui-sec">
        ${secHeadHtml(`${t("reactions.rate_title")}${hintDotHtml("reactions.rate_hint_text")}`)}
        <p class="yui-sec__note">${t("reactions.rate_hint")}</p>
        <div class="yui-group">
${RATE_LIMIT_FIELDS.map((f) =>
  numRowHtml({ id: f.id, labelKey: f.labelKey, subKey: f.subKey, min: 1, max: RATE_LIMIT_MAX }),
).join("")}
        </div>
      </div>`
    : "";

  // Session section (window-only) — token occupancy readout.
  const sessionHtml = hasSession
    ? `
      <div class="yui-sec">
        ${secHeadHtml(t("session.section"))}
        <div class="yui-group yui-session">
          <div class="yui-stack yui-session__stat">
            <div class="yui-session__statline">
              <span class="yui-session__label">${t("session.context")}</span>
              <span class="yui-session__value"></span>
            </div>
          </div>
          <div class="yui-stack yui-session__deleg" hidden>
            <h3 class="yui-session__deleg-title">${t("deleg.list_title")}</h3>
            <p class="yui-session__deleg-lost" hidden><span class="yui-session__deleg-lost-dot" aria-hidden="true"></span><span>${t("deleg.chip_lost")}</span></p>
            <div class="yui-session__deleg-rows"></div>
          </div>
        </div>
      </div>`
    : "";

  const talkRowsHtml = switchRowsHtml("talk");

  // Thinking filler section — its enable switch rides the title row.
  const fillerRow = visibleSwitchRows.find(
    (row) => row.tab === "talk" && row.position === "filler",
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
        <details class="yui-filler-more">
          <summary><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>${t("filler.more")}</summary>
          <div class="yui-group">${fillerStackHtml("filler.long_wait_label", "filler.long_wait_sub", "yui-filler-long-wait-textarea", "filler.long_wait_aria")}${fillerStackHtml("filler.timeout_label", "filler.timeout_sub", "yui-filler-timeout-textarea", "filler.timeout_aria")}${fillerStackHtml("filler.unreachable_label", "filler.unreachable_sub", "yui-filler-unreachable-textarea", "filler.unreachable_aria")}${fillerStackHtml("filler.tool_label", "filler.tool_sub", "yui-filler-tool-textarea", "filler.tool_aria")}
          </div>
        </details>
      </div>`
    : "";

  // Window variant: native titlebar owns the header — no custom bar rendered.
  const headerHtml = isWindow
    ? ""
    : `
    <div class="yui-quick__bar">
      <span class="yui-quick__grip" aria-hidden="true" title="${t("panel.drag_hint")}">
        <i></i><i></i><i></i><i></i><i></i><i></i>
      </span>
      <span class="yui-quick__title" title="${t("panel.drag_hint")}">${t("panel.title")}</span>
      <span class="yui-quick__bar-actions">
        <button class="yui-iconbtn yui-iconbtn--popout" type="button" aria-label="${t("panel.pop_out")}" data-tip="${t("panel.pop_out")}">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M14 5h5v5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M19 5l-7 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M18 13v4a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
        ${
          showMessage
            ? `
        <button class="yui-iconbtn yui-iconbtn--message" type="button" aria-label="${t("panel.message")}" data-tip="${t("panel.message")}">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M5 6h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-8l-4 3v-3H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>`
            : ""
        }
        <button class="yui-iconbtn yui-iconbtn--close" type="button" aria-label="${t("panel.close")}" data-tip="${t("panel.close")}">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
        </button>
      </span>
    </div>`;

  // A narrow panel keeps the label; the icon-only rail drops it with the tooltip.
  const tabHtml = (id: string, icon: string, opts?: { tipKey?: string }): string =>
    tabButtonHtml(id, icon, { selected: id === "talk", tipKey: opts?.tipKey });
  const panelOpenHtml = (id: string): string => tabPanelOpenHtml(id, { hidden: id !== "talk" });

  return `
    ${headerHtml}
    <div class="yui-quick__cols">
      <div class="yui-tabs" role="tablist" aria-label="${t("panel.tablist_label")}" aria-orientation="vertical">${tabHtml("conn", TAB_ICON_CONN)}${tabHtml("talk", TAB_ICON_TALK)}${tabHtml("char", TAB_ICON_CHAR)}${tabHtml("input", TAB_ICON_INPUT)}${tabHtml("react", TAB_ICON_REACT, { tipKey: "tabs.react_hint" })}${showHistory ? tabHtml("hist", TAB_ICON_HIST) : ""}${tabHtml("general", TAB_ICON_GENERAL)}
      </div>
      <div class="yui-quick__body">
${panelOpenHtml("conn")}
      </div>
${panelOpenHtml("talk")}
        <div class="yui-sec">
          <div class="yui-group">
            <div class="yui-row">
              <div class="yui-row__main">
                <span class="yui-row__label">${t("reasoning.label")}</span>
                <span class="yui-row__sub">${t("reasoning.sub")}</span>
              </div>
              <div class="yui-seg yui-effort-seg" role="radiogroup" aria-label="${t("reasoning.label")}">${segButtonsHtml}</div>
            </div>${talkRowsHtml}
          </div>
        </div>
        <div class="yui-sec">
          ${secHeadHtml(t("instructions.label"), `<button class="yui-reset" type="button">${t("instructions.reset")}</button>`)}
          <p class="yui-sec__note">${t("instructions.sub")}</p>
          <textarea class="yui-textarea" spellcheck="false" rows="4" maxlength="${INSTRUCTIONS_MAX_LEN}" aria-label="${t("instructions.label")}"></textarea>
        </div>${fillerHtml}
      </div>
${panelOpenHtml("char")}
      </div>
${panelOpenHtml("input")}
        <div class="yui-sec">
          <div class="yui-group">
            <div class="yui-row">
              <div class="yui-row__main">
                <span class="yui-row__label">
                  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <rect x="3" y="5" width="18" height="13" rx="2" stroke="currentColor" stroke-width="1.5"/>
                    <path d="M3 9h18" stroke="currentColor" stroke-width="1.5"/>
                  </svg>
                  ${t("screenshot.label")}
                </span>
                <span class="yui-row__sub">${t("screenshot.foot_off")}</span>
              </div>
              <button class="yui-switch yui-screenshot-switch" type="button" role="switch" aria-checked="false" aria-label="${t("screenshot.label")}"></button>
            </div>
            <div class="yui-stack yui-source">
              <span class="yui-row__label">${t("screenshot.source_label")}</span>
              <div class="yui-monitors" role="radiogroup" aria-label="${t("screenshot.source_aria")}"></div>
            </div>
          </div>
        </div>
        <div class="yui-sec">
          <div class="yui-group">
            <div class="yui-row">
              <div class="yui-row__main">
                <span class="yui-row__label">
                  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M12 4.5v7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                    <path d="M8 9.5v1.8a4 4 0 0 0 8 0V9.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                    <path d="M12 15.5v3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                    <path d="M9.5 18.5h5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                  </svg>
                  ${t("voice_input.label")}
                </span>
                <span class="yui-row__sub">${t("voice_input.sub")}</span>
              </div>
              <button class="yui-switch yui-voice-switch" type="button" role="switch" aria-checked="false" aria-label="${t("voice_input.label")}"></button>
            </div>${switchRowsHtml("input")}
            <div class="yui-gain">
              <div class="yui-gain__head">
                <span class="yui-gain__label">${t("voice_input.silence_label")}</span>
                <span class="yui-gain__value yui-vad__value">1500 ms</span>
              </div>
              <span class="yui-gain__sub">${t("voice_input.silence_sub")}</span>
              <input class="yui-gain__slider yui-vad__slider" type="range" aria-label="${t("voice_input.silence_aria")}" />
            </div>${switchRowsHtml("input", "after-vad")}
          </div>
        </div>
      </div>
${panelOpenHtml("react")}${screenHtml}
        <div class="yui-loop-cue-section"></div>
        <div class="yui-cue-sections"></div>${watchersHtml}
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
        </div>${sharedHtml}${rateLimitHtml}
      </div>
${
  showHistory
    ? `${panelOpenHtml("hist")}
      </div>
`
    : ""
}${panelOpenHtml("general")}
        <div class="yui-sec">
          <div class="yui-group">
            <div class="yui-row">
              <div class="yui-row__main">
                <span class="yui-row__label">${t("language.label")}</span>
                <span class="yui-row__sub">${t("language.sub")}</span>
              </div>
              <div class="yui-seg yui-lang-seg" role="radiogroup" aria-label="${t("language.aria")}">${langButtonsHtml}</div>
            </div>${switchRowsHtml("general")}${
              showDevtools
                ? `
            <div class="yui-row">
              <div class="yui-row__main">
                <span class="yui-row__label">${t("devtools.label")}</span>
                <span class="yui-row__sub">${t("devtools.sub")}</span>
              </div>
              <button class="yui-link-btn yui-devtools-open" type="button">${t("devtools.open")}</button>
            </div>`
                : ""
            }
          </div>
        </div>${sessionHtml}
      </div>
      </div>
    </div>
  `;
}
