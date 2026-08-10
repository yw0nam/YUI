/** Quick-controls panel markup — pure string construction (no DOM, no state). */
import { INSTRUCTIONS_MAX_LEN, REASONING_EFFORTS } from "../../io/agent-settings";
import type { EndpointOverrides } from "../../io/endpoints-settings";
import { LOCALE_DISPLAY_NAMES, t } from "../i18n";
import {
  CHAT_API_LABEL_KEYS,
  CHAT_APIS,
  CHATKEY_CLEAR_SVG,
  CHATKEY_EYE_SVG,
  ENDPOINT_FIELDS,
  LANG_PICKER_ORDER,
  RAIL_COLLAPSE_SVG,
  SEG_LABEL_KEYS,
  TAB_ICON_ADV,
  TAB_ICON_CHAR,
  TAB_ICON_INPUT,
  TAB_ICON_REACT,
  TAB_ICON_TALK,
  VOICE_ENGINE_LABEL_KEYS,
  VOICE_ENGINES,
} from "./constants";

/** Initial flags/states the panel HTML needs — computed by the entry where the stores live. */
interface PanelHtmlOptions {
  isWindow: boolean;
  hasSession: boolean;
  showFiller: boolean;
  showViewpoint: boolean;
  showGaze: boolean;
  gazeEnabled: boolean;
  showAgentNotify: boolean;
  agentNotifyEnabled: boolean;
  ttsEnabled: boolean;
  bargeInEnabled: boolean;
  showPresence: boolean;
  showDevtools: boolean;
  /** Initial collapsed state of the sections rail, read from localStorage before first paint. */
  railCollapsed: boolean;
}

export function buildPanelHtml(o: PanelHtmlOptions): string {
  const {
    isWindow,
    hasSession,
    showFiller,
    showViewpoint,
    showGaze,
    gazeEnabled,
    showAgentNotify,
    agentNotifyEnabled,
    ttsEnabled,
    bargeInEnabled,
    showPresence,
    showDevtools,
    railCollapsed,
  } = o;
  const segButtonsHtml = REASONING_EFFORTS.map(
    (e) =>
      `<button class="yui-seg__btn" type="button" role="radio" data-effort="${e}" aria-checked="false" tabindex="-1">${t(SEG_LABEL_KEYS[e])}</button>`,
  ).join("");

  // TTS engine dropdown (yui-select) options — irodori/openai. value=provider reflects effectiveProvider.
  const ttsTypeOptionsHtml = VOICE_ENGINES.map(
    (p) => `<option value="${p}">${t(VOICE_ENGINE_LABEL_KEYS[p])}</option>`,
  ).join("");

  // Chat API dropdown (yui-select) options — responses/chat_completions. value=chat_api reflects effectiveChatApi.
  const chatTypeOptionsHtml = CHAT_APIS.map(
    (a) => `<option value="${a}">${t(CHAT_API_LABEL_KEYS[a])}</option>`,
  ).join("");

  // Speaker picker markup — moves from Character tab to TTS·irodori subview. Nodes are queried by el root selector so
  // position changes but speaker JS stays valid. OpenAI hint accompanies it too.
  const speakerPickerHtml = `
        <p class="yui-spks-hint" role="status" hidden>${t("speaker.openai_hint")}</p>
        <div class="yui-spk-scroll">
          <div class="yui-spks" role="radiogroup" aria-label="${t("speaker.group_aria")}"></div>
        </div>
        <div class="yui-spk-foot">
          <button class="yui-spk yui-spk--add is-ready" type="button">
            <span class="yui-spk__tick" aria-hidden="true"></span>
            <span class="yui-spk__body"><span class="yui-spk__name">${t("speaker.add")}</span></span>
          </button>
          <p class="yui-spk__import-error" role="status" hidden>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 8v4M12 16h.01" />
            </svg>
            <span>${t("speaker.import_error")}</span>
          </p>
        </div>`;

  // Language picker seg (3 positions) — display language switch. Host re-mounts via i18n.subscribe.
  const langButtonsHtml = LANG_PICKER_ORDER.map(
    (l) =>
      `<button class="yui-seg__btn" type="button" role="radio" data-locale="${l}" aria-checked="false" tabindex="-1">${LOCALE_DISPLAY_NAMES[l]}</button>`,
  ).join("");

  // Endpoint field row template. Label/placeholder/value left empty, filled by reflectEndpoints.
  // Use type="text" and control validation message directly (avoid browser default URL validation).
  function endpointRowHtml(key: keyof EndpointOverrides): string {
    const def = ENDPOINT_FIELDS.find((f) => f.key === key)!;
    const errId = `yui-ep-err-${key}`;
    const urlClass = def.url ? " yui-ep-input--url" : "";
    const errHtml = def.url
      ? `<p class="yui-input-row__error" id="${errId}" role="status">${t("endpoints.url_error")}</p>`
      : "";
    return `
          <div class="yui-input-row" data-ep-field="${key}">
            <label class="yui-input-row__label" for="yui-ep-${key}">${t(def.labelKey)}</label>
            <span class="yui-input-row__sub">${t("endpoints.field_sub")}</span>
            <div class="yui-input-wrap">
              <input class="yui-ep-input${urlClass}" id="yui-ep-${key}" type="text" spellcheck="false"
                inputmode="${def.url ? "url" : "text"}" autocapitalize="off" autocomplete="off" />
            </div>
            ${errHtml}
          </div>`;
  }

  // Per-service API key row (secret). Uses idPrefix/i18nPrefix to stamp chat/stt/tts from one template.
  // Input always type="password" — toggle reveals plaintext only. value/sublabel filled by reflect.
  function keyRowHtml(idPrefix: string, i18nPrefix: string): string {
    return `
          <div class="yui-input-row yui-chatkey" data-key-prefix="${idPrefix}">
            <label class="yui-input-row__label" for="yui-${idPrefix}-input">${t(`${i18nPrefix}.label`)}</label>
            <span class="yui-input-row__sub"></span>
            <div class="yui-input-wrap yui-chatkey__wrap">
              <input class="yui-ep-input yui-chatkey__input" id="yui-${idPrefix}-input" type="password"
                autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="${t(`${i18nPrefix}.label`)}" />
              <button class="yui-iconbtn yui-chatkey__toggle" type="button" aria-pressed="false" aria-label="${t(`${i18nPrefix}.show`)}" title="${t(`${i18nPrefix}.show`)}">${CHATKEY_EYE_SVG}</button>
              <button class="yui-iconbtn yui-chatkey__clear" type="button" aria-label="${t(`${i18nPrefix}.clear`)}" title="${t(`${i18nPrefix}.clear`)}">${CHATKEY_CLEAR_SVG}</button>
            </div>
          </div>`;
  }

  // Numeric input row — 2-column like .yui-row: label+sub(+hint) left, number input right.
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
    const hintHtml = hintKey ? `<p class="yui-field-hint">${t(hintKey)}</p>` : "";
    return `
          <div class="yui-input-row yui-input-row--inline">
            <div class="yui-input-row__main">
              <label class="yui-input-row__label" for="${id}">${t(labelKey)}</label>
              <span class="yui-input-row__sub">${t(subKey)}</span>
            </div>
            <div class="yui-input-wrap">
              <input class="yui-num-input" id="${id}" type="number" min="${min}" max="${max}" inputmode="numeric" />
              ${suffixHtml}
            </div>
            ${hintHtml}
          </div>`;
  }

  // Session section (window-only). Token occupancy display + conversation reset action. Reset is race-safe via pet window thunk.
  const sessionHtml = hasSession
    ? `
      <div class="yui-quick__divider" aria-hidden="true"></div>
      <span class="yui-quick__section">${t("session.section")}</span>
      <div class="yui-session">
        <div class="yui-session__stat">
          <div class="yui-session__statline">
            <span class="yui-session__label">${t("session.context")}</span>
            <span class="yui-session__value"></span>
          </div>
        </div>
        <div class="yui-quick__divider" aria-hidden="true"></div>
        <div class="yui-session__action">
          <span class="yui-session__action-label">${t("session.action_label")}</span>
          <span class="yui-session__action-sub">${t("session.action_sub")}</span>
        </div>
        <button class="yui-link-btn yui-session__reset" type="button">${t("session.reset")}</button>
        <div class="yui-confirm" hidden>
          <span class="yui-confirm__q">${t("session.confirm_q")}</span>
          <button class="yui-pill yui-pill--go yui-session__confirm" type="button">${t("session.confirm_go")}</button>
          <button class="yui-pill yui-session__cancel" type="button">${t("session.confirm_cancel")}</button>
        </div>
      </div>`
    : "";

  // Window variant: native titlebar owns the header — no custom bar rendered.
  const headerHtml = isWindow
    ? ""
    : `
    <div class="yui-quick__bar" title="${t("panel.drag_hint")}">
      <span class="yui-quick__grip" aria-hidden="true">
        <i></i><i></i><i></i><i></i><i></i><i></i>
      </span>
      <span class="yui-quick__title">${t("panel.title")}</span>
      <span class="yui-quick__bar-actions">
        <button class="yui-iconbtn yui-iconbtn--popout" type="button" aria-label="${t("panel.pop_out")}" title="${t("panel.pop_out")}">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M14 5h5v5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M19 5l-7 7" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M18 13v4a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
        <button class="yui-iconbtn yui-iconbtn--close" type="button" aria-label="${t("panel.close")}" title="${t("panel.close")}">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
          </svg>
        </button>
      </span>
    </div>`;
  const railCollapseLabel = t(railCollapsed ? "panel.rail_expand" : "panel.rail_collapse");

  return `
    ${headerHtml}
    <div class="yui-quick__cols${railCollapsed ? " is-rail-collapsed" : ""}">
      <div class="yui-rail">
        <button class="yui-rail-collapse" type="button" aria-expanded="${String(!railCollapsed)}" aria-label="${railCollapseLabel}" title="${railCollapseLabel}">
          ${RAIL_COLLAPSE_SVG}
        </button>
        <div class="yui-tabs" role="tablist" aria-label="${t("panel.tablist_label")}" style="--tab:0;">
          <span class="yui-tabs__ind" aria-hidden="true"></span>
          <button class="yui-tab" type="button" role="tab" id="yui-tab-talk" aria-selected="true" aria-controls="yui-panel-talk" tabindex="0" title="${t("tabs.talk")}" aria-label="${t("tabs.talk")}">
            ${TAB_ICON_TALK}
            <span class="yui-tab__label">${t("tabs.talk")}</span>
          </button>
          <button class="yui-tab" type="button" role="tab" id="yui-tab-char" aria-selected="false" aria-controls="yui-panel-char" tabindex="-1" title="${t("tabs.char")}" aria-label="${t("tabs.char")}">
            ${TAB_ICON_CHAR}
            <span class="yui-tab__label">${t("tabs.char")}</span>
          </button>
          <button class="yui-tab" type="button" role="tab" id="yui-tab-input" aria-selected="false" aria-controls="yui-panel-input" tabindex="-1" title="${t("tabs.input")}" aria-label="${t("tabs.input")}">
            ${TAB_ICON_INPUT}
            <span class="yui-tab__label">${t("tabs.input")}</span>
          </button>
          <button class="yui-tab" type="button" role="tab" id="yui-tab-adv" aria-selected="false" aria-controls="yui-panel-adv" tabindex="-1" title="${t("tabs.adv")}" aria-label="${t("tabs.adv")}">
            ${TAB_ICON_ADV}
            <span class="yui-tab__label">${t("tabs.adv")}</span>
          </button>
          <button class="yui-tab" type="button" role="tab" id="yui-tab-react" aria-selected="false" aria-controls="yui-panel-react" tabindex="-1" title="${t("tabs.react")}" aria-label="${t("tabs.react")}">
            ${TAB_ICON_REACT}
            <span class="yui-tab__label">${t("tabs.react")}</span>
          </button>
        </div>
      </div>
      <div class="yui-quick__body">

      <div class="yui-tabpanel" role="tabpanel" id="yui-panel-talk" aria-labelledby="yui-tab-talk" tabindex="0">
        <div class="yui-field-row">
          <span class="yui-field-row__label">${t("reasoning.label")}</span>
          <span class="yui-field-row__sub">${t("reasoning.sub")}</span>
          <div class="yui-seg" role="radiogroup" aria-label="${t("reasoning.label")}" style="--seg:0;">
            <span class="yui-seg__ind" aria-hidden="true"></span>
            ${segButtonsHtml}
          </div>
        </div>
        <div class="yui-field-row">
          <span class="yui-field-row__label">${t("language.label")}</span>
          <span class="yui-field-row__sub">${t("language.sub")}</span>
          <div class="yui-seg yui-lang-seg" role="radiogroup" aria-label="${t("language.aria")}" style="--seg:0;">
            <span class="yui-seg__ind" aria-hidden="true"></span>
            ${langButtonsHtml}
          </div>
        </div>
        <div class="yui-field-row">
          <span class="yui-field-row__label">${t("instructions.label")}</span>
          <span class="yui-field-row__sub">${t("instructions.sub")}</span>
          <div class="yui-textarea-wrap">
            <textarea class="yui-textarea" spellcheck="false" rows="4" maxlength="${INSTRUCTIONS_MAX_LEN}" aria-label="${t("instructions.label")}"></textarea>
          </div>
          <button class="yui-reset" type="button">${t("instructions.reset")}</button>
        </div>
        ${
          showFiller
            ? `
        <div class="yui-quick__divider" aria-hidden="true"></div>
        <span class="yui-quick__section">${t("filler.section")}</span>
        <div class="yui-filler">
          <div class="yui-row">
            <div class="yui-row__main">
              <span class="yui-row__label">${t("filler.enable_label")}</span>
              <span class="yui-row__sub">${t("filler.enable_sub")}</span>
            </div>
            <button class="yui-switch yui-filler-switch" type="button" role="switch" aria-checked="false" aria-label="${t("filler.enable_label")}"></button>
          </div>
          <div class="yui-field-row">
            <span class="yui-field-row__label">${t("filler.lang_label")}</span>
            <span class="yui-field-row__sub">${t("filler.lang_sub")}</span>
            <div class="yui-seg yui-filler-lang-seg" role="radiogroup" aria-label="${t("filler.lang_aria")}" style="--seg:0;">
              <span class="yui-seg__ind" aria-hidden="true"></span>
              <button class="yui-seg__btn" type="button" role="radio" data-lang="ja" aria-checked="false" tabindex="-1">日本語</button>
              <button class="yui-seg__btn" type="button" role="radio" data-lang="en" aria-checked="false" tabindex="-1">English</button>
              <button class="yui-seg__btn" type="button" role="radio" data-lang="ko" aria-checked="false" tabindex="-1">한국어</button>
            </div>
          </div>
          <div class="yui-field-row">
            <span class="yui-field-row__label">${t("filler.first_label")}</span>
            <span class="yui-field-row__sub">${t("filler.first_sub")}</span>
            <div class="yui-textarea-wrap">
              <textarea class="yui-textarea yui-filler-first-textarea" spellcheck="false" rows="3" aria-label="${t("filler.first_aria")}"></textarea>
            </div>
          </div>
          <div class="yui-filler__list-sep" aria-hidden="true"></div>
          <div class="yui-field-row">
            <span class="yui-field-row__label">${t("filler.repeat_label")}</span>
            <span class="yui-field-row__sub">${t("filler.repeat_sub")}</span>
            <div class="yui-textarea-wrap">
              <textarea class="yui-textarea yui-filler-repeat-textarea" spellcheck="false" rows="3" aria-label="${t("filler.repeat_aria")}"></textarea>
            </div>
          </div>
          <p class="yui-field-hint yui-filler-hint">${t("filler.hint")}</p>
        </div>`
            : ""
        }
      </div>

      <div class="yui-tabpanel" role="tabpanel" id="yui-panel-char" aria-labelledby="yui-tab-char" tabindex="0" hidden>
        <span class="yui-quick__section">${t("vrm.section")}</span>
        <div class="yui-vrm-scroll">
          <div class="yui-vrms" role="radiogroup" aria-label="${t("vrm.group_aria")}"></div>
        </div>
        <div class="yui-vrm-foot">
          <button class="yui-vrm yui-vrm--add is-ready" type="button">
            <span class="yui-vrm__tick" aria-hidden="true"></span>
            <span class="yui-vrm__body"><span class="yui-vrm__name">${t("vrm.add")}</span></span>
          </button>
          <p class="yui-vrm__import-error" role="status" hidden>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 8v4M12 16h.01" />
            </svg>
            <span>${t("vrm.import_error")}</span>
          </p>
        </div>

        <div class="yui-quick__divider" aria-hidden="true"></div>

        <span class="yui-quick__section">${t("expression.section")}</span>
        <div class="yui-gain">
          <div class="yui-gain__head">
            <span class="yui-gain__label">
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M4 10c2.4-2.4 4.9-3.6 8-3.6s5.6 1.2 8 3.6c-2.4 1.1-4.9 1.7-8 1.7s-5.6-.6-8-1.7Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
                <path d="M4 14c2.4 2.4 4.9 3.6 8 3.6s5.6-1.2 8-3.6c-2.4-1.1-4.9-1.7-8-1.7s-5.6.6-8 1.7Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
              </svg>
              ${t("expression.mouth_label")}
            </span>
            <span class="yui-gain__value">2.0×</span>
          </div>
          <span class="yui-gain__sub">${t("expression.mouth_sub")}</span>
          <input class="yui-gain__slider" type="range" aria-label="${t("expression.mouth_aria")}" />
          <span class="yui-gain__hint">${t("expression.mouth_hint")}</span>
        </div>
        ${
          showViewpoint
            ? `
        <div class="yui-quick__divider" aria-hidden="true"></div>
        <span class="yui-quick__section">${t("viewpoint.section")}</span>
        <div class="yui-field-row">
          <span class="yui-field-row__sub">${t("viewpoint.sub")}</span>
          <button class="yui-reset yui-viewpoint-reset" type="button">${t("viewpoint.reset")}</button>
        </div>`
            : ""
        }
      </div>

      <div class="yui-tabpanel" role="tabpanel" id="yui-panel-input" aria-labelledby="yui-tab-input" tabindex="0" hidden>
        <div class="yui-cue-sections"></div>
        <div class="yui-quick__divider" aria-hidden="true"></div>
        <div class="yui-row">
          <div class="yui-row__main">
            <span class="yui-row__label">
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <rect x="3" y="5" width="18" height="13" rx="2" stroke="currentColor" stroke-width="1.7"/>
                <path d="M3 9h18" stroke="currentColor" stroke-width="1.7"/>
              </svg>
              ${t("screenshot.label")}
            </span>
            <span class="yui-row__sub">${t("screenshot.sub")}</span>
          </div>
          <button class="yui-switch yui-screenshot-switch" type="button" role="switch" aria-checked="false" aria-label="${t("screenshot.label")}"></button>
        </div>
        <div class="yui-source">
          <div class="yui-source__label">${t("screenshot.source_label")}</div>
          <div class="yui-monitors" role="radiogroup" aria-label="${t("screenshot.source_aria")}"></div>
        </div>
        <div class="yui-row yui-row--voice">
          <div class="yui-row__main">
            <span class="yui-row__label">
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M12 4.5v7" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
                <path d="M8 9.5v1.8a4 4 0 0 0 8 0V9.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
                <path d="M12 15.5v3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
                <path d="M9.5 18.5h5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
              </svg>
              ${t("voice_input.label")}
            </span>
            <span class="yui-row__sub">${t("voice_input.sub")}</span>
          </div>
          <button class="yui-switch yui-voice-switch" type="button" role="switch" aria-checked="false" aria-label="${t("voice_input.label")}"></button>
        </div>
        <div class="yui-row">
          <div class="yui-row__main">
            <span class="yui-row__label">
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <rect x="4" y="6" width="16" height="12" rx="2" stroke="currentColor" stroke-width="1.7"/>
                <path d="M9 10l2.5 2.5L15 9" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M4 9h2M18 9h2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
              </svg>
              ${t("tts_output.label")}
            </span>
            <span class="yui-row__sub">${t("tts_output.sub")}</span>
          </div>
          <button class="yui-switch yui-tts-switch" type="button" role="switch" aria-checked="${String(ttsEnabled)}" aria-label="${t("tts_output.aria")}"></button>
        </div>
        <div class="yui-gain">
          <div class="yui-gain__head">
            <span class="yui-gain__label">${t("voice_input.silence_label")}</span>
            <span class="yui-gain__value yui-vad__value">1500 ms</span>
          </div>
          <span class="yui-gain__sub">${t("voice_input.silence_sub")}</span>
          <input class="yui-gain__slider yui-vad__slider" type="range" aria-label="${t("voice_input.silence_aria")}" />
        </div>
        <div class="yui-row">
          <div class="yui-row__main">
            <span class="yui-row__label">${t("voice_input.bargein_label")}</span>
          </div>
          <button class="yui-switch yui-bargein-switch" type="button" role="switch" aria-checked="${String(bargeInEnabled)}" aria-label="${t("voice_input.bargein_aria")}"></button>
        </div>
      </div>

      <div class="yui-tabpanel" role="tabpanel" id="yui-panel-react" aria-labelledby="yui-tab-react" tabindex="0" hidden>
        <div class="yui-loop-cue-section"></div>
        <div class="yui-quick__divider" aria-hidden="true"></div>
        <span class="yui-quick__section">${t("reactions.watchers_title")}</span>
        ${
          showAgentNotify
            ? `<div class="yui-row">
          <div class="yui-row__main">
            <span class="yui-row__label">${t("agentNotify.label")}</span>
            <span class="yui-row__sub">${t("agentNotify.sub")}</span>
          </div>
          <button class="yui-switch yui-agentnotify-switch" type="button" role="switch" aria-checked="${String(agentNotifyEnabled)}" aria-label="${t("agentNotify.aria")}"></button>
        </div>
        ${numRowHtml({ id: "yui-agent-port", labelKey: "reactions.port_label", subKey: "reactions.port_sub", min: 1024, max: 65535, hintKey: "reactions.restart_hint" })}`
            : ""
        }
        <div class="yui-quick__divider" aria-hidden="true"></div>
        <span class="yui-quick__section">${t("workflows.title")}</span>
        <p class="yui-field-hint">${t("workflows.sub")}</p>
        <div class="yui-wf-list"></div>
        <div class="yui-wf-add">
          <div class="yui-input-row" data-wf-field="label">
            <label class="yui-input-row__label-sm" for="yui-wf-label">${t("workflows.label_label")}</label>
            <div class="yui-input-wrap">
              <input class="yui-ep-input yui-wf-label-input" id="yui-wf-label" type="text" placeholder="${t("workflows.label_ph")}" />
            </div>
          </div>
          <div class="yui-input-row" data-wf-field="url">
            <label class="yui-input-row__label-sm" for="yui-wf-url">${t("workflows.url_label")}</label>
            <div class="yui-input-wrap">
              <input class="yui-ep-input yui-wf-url-input" id="yui-wf-url" type="text" inputmode="url" placeholder="${t("workflows.url_ph")}" />
            </div>
            <p class="yui-input-row__error">${t("workflows.url_error")}</p>
          </div>
          <div class="yui-wf-add__actions">
            <button class="yui-pill-add yui-wf-add-btn" type="button" disabled>
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>
              ${t("workflows.add")}
            </button>
          </div>
        </div>
        <div class="yui-quick__divider" aria-hidden="true"></div>
        <span class="yui-quick__section">${t("reactions.shared_title")}</span>
        ${showPresence ? numRowHtml({ id: "yui-presence", labelKey: "reactions.presence_label", subKey: "reactions.presence_sub", min: 10, max: 3600, suffixKey: "reactions.seconds_suffix", hintKey: "reactions.restart_hint" }) : ""}
      </div>

      <div class="yui-tabpanel" role="tabpanel" id="yui-panel-adv" aria-labelledby="yui-tab-adv" tabindex="0" hidden>

        <details class="yui-endpoints yui-svc" data-svc="chat">
          <summary><span class="svc-name">${t("svc.chat")}</span><span class="yui-endpoints__hint yui-chat-summary-hint"></span></summary>
          <div class="yui-endpoints__body">
            <div class="yui-input-row">
              <label class="yui-input-row__label" for="yui-svc-chat-type">${t("svc.type_label")}</label>
              <select class="yui-select yui-chat-type" id="yui-svc-chat-type" aria-label="${t("svc.chat_aria")}">${chatTypeOptionsHtml}</select>
            </div>
            ${endpointRowHtml("chat_base_url")}
            ${endpointRowHtml("chat_model")}
            ${keyRowHtml("chatkey", "chatkey")}
            <button class="yui-reset yui-svc-reset" type="button" data-svc-reset="chat">${t("svc.reset_chat")}</button>
          </div>
        </details>

        <details class="yui-endpoints yui-svc" data-svc="stt">
          <summary><span class="svc-name">${t("svc.stt")}</span><span class="yui-endpoints__hint">${t("svc.stt_hint")}</span></summary>
          <div class="yui-endpoints__body">
            <div class="yui-input-row">
              <label class="yui-input-row__label" for="yui-svc-stt-type">${t("svc.type_label")}</label>
              <select class="yui-select yui-select--single" id="yui-svc-stt-type" disabled><option>${t("svc.stt_type")}</option></select>
            </div>
            ${endpointRowHtml("stt_base_url")}
            ${keyRowHtml("sttkey", "sttkey")}
            <button class="yui-reset yui-svc-reset" type="button" data-svc-reset="stt">${t("svc.reset_stt")}</button>
          </div>
        </details>

        <details class="yui-endpoints yui-svc" data-svc="tts">
          <summary><span class="svc-name">${t("svc.tts")}</span><span class="yui-endpoints__hint yui-tts-summary-hint"></span></summary>
          <div class="yui-endpoints__body">
            <div class="yui-input-row">
              <label class="yui-input-row__label" for="yui-svc-tts-type">${t("svc.type_label")}</label>
              <select class="yui-select yui-tts-type" id="yui-svc-tts-type" aria-label="${t("svc.tts_aria")}">${ttsTypeOptionsHtml}</select>
            </div>
            <div class="yui-tts-irodori" hidden>
              ${endpointRowHtml("irodori_base_url")}
              ${speakerPickerHtml}
            </div>
            <div class="yui-tts-openai" hidden>
              ${endpointRowHtml("tts_base_url")}
              ${endpointRowHtml("tts_voice")}
              ${keyRowHtml("ttskey", "ttskey")}
            </div>
            <button class="yui-reset yui-svc-reset" type="button" data-svc-reset="tts">${t("svc.reset_tts")}</button>
          </div>
        </details>

        <details class="yui-endpoints yui-svc" data-svc="broker">
          <summary><span class="svc-name">${t("svc.broker")}</span><span class="yui-endpoints__hint">${t("svc.broker_hint")}</span></summary>
          <div class="yui-endpoints__body">
            <div class="yui-input-row">
              <label class="yui-input-row__label" for="yui-svc-broker-type">${t("svc.type_label")}</label>
              <select class="yui-select yui-select--single" id="yui-svc-broker-type" disabled><option>${t("svc.broker_type")}</option></select>
            </div>
            ${endpointRowHtml("broker_base_url")}
            <button class="yui-reset yui-svc-reset" type="button" data-svc-reset="broker">${t("svc.reset_broker")}</button>
          </div>
        </details>

        <div class="yui-quick__divider" aria-hidden="true"></div>
        <span class="yui-quick__section">${t("perf.section")}</span>
        <div class="yui-row">
          <div class="yui-row__main">
            <span class="yui-row__label">${t("perf.idle_label")}</span>
            <span class="yui-row__sub">${t("perf.idle_sub")}</span>
          </div>
          <button class="yui-switch yui-idle-throttle-switch" type="button" role="switch" aria-checked="false" aria-label="${t("perf.idle_aria")}"></button>
        </div>
        ${
          showGaze
            ? `<div class="yui-row">
          <div class="yui-row__main">
            <span class="yui-row__label">${t("gaze.label")}</span>
            <span class="yui-row__sub">${t("gaze.sub")}</span>
          </div>
          <button class="yui-switch yui-gaze-switch" type="button" role="switch" aria-checked="${String(gazeEnabled)}" aria-label="${t("gaze.aria")}"></button>
        </div>`
            : ""
        }
        ${sessionHtml}
        ${
          showDevtools
            ? `<div class="yui-quick__divider" aria-hidden="true"></div>
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

      </div>
    </div>
    <p class="yui-quick__foot yui-quick__foot--on">${t("screenshot.foot_on")}</p>
    <p class="yui-quick__foot yui-quick__foot--off">${t("screenshot.foot_off")}</p>
  `;
}
