/** Quick-controls panel markup — pure string construction (no DOM, no state). */
import "./sections/session-section.css";
import { INSTRUCTIONS_MAX_LEN, REASONING_EFFORTS } from "../../settings/backend/agent-settings";
import type { EndpointOverrides } from "../../settings/backend/endpoints-settings";
import { RATE_LIMIT_MAX } from "../../settings/backend/guardrails-settings";
import { LOCALE_DISPLAY_NAMES, t } from "../i18n";
import {
  CHAT_API_LABEL_KEYS,
  CHAT_APIS,
  CHAT_PRESET_CUSTOM,
  CHAT_PROVIDER_PRESETS,
  CHATKEY_CLEAR_SVG,
  CHATKEY_EYE_SVG,
  ENDPOINT_FIELDS,
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
import type { SwitchRow } from "./switch-row";

// Escapes the characters that would otherwise break out of an HTML attribute.
function escapeAttr(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

/**
 * Small round `?` that follows a section label whose name alone is not self-explanatory.
 * Markup only — hint-tooltip.ts wires the hover/focus/click tooltip onto `.yui-hint-dot`.
 */
function hintDotHtml(textKey: string): string {
  const text = escapeAttr(t(textKey));
  return `<button type="button" class="yui-hint-dot" aria-label="${text}" data-tip="${text}" data-tip-pin>?</button>`;
}

// Section title row — the title on the left, an optional control or state text on the right.
function secHeadHtml(title: string, aside = ""): string {
  return `<div class="yui-sec__head"><h2 class="yui-sec__title">${title}</h2>${aside}</div>`;
}

const PLUS_SVG = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;

/** Initial flags/states the panel HTML needs — computed by the entry where the stores live. */
interface PanelHtmlOptions {
  isWindow: boolean;
  /** Whether the window-only context-occupancy readout renders. */
  hasSession: boolean;
  /** Whether the History tab carries the start-fresh action — needs the transcript and reset stores. */
  showSessionReset: boolean;
  showViewpoint: boolean;
  /** Whether the idle-motion section renders — true when the idle-motion store is injected. */
  showIdleMotion: boolean;
  /** Whether the express-motion section renders — true when the express-motion store is injected. */
  showExpressMotion: boolean;
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
    showSessionReset,
    showViewpoint,
    showIdleMotion,
    showExpressMotion,
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

  function switchButtonHtml(row: SwitchRow): string {
    return `<button class="yui-switch ${row.selector.slice(1)}" type="button" role="switch" aria-checked="${String(row.initialEnabled)}" aria-label="${t(row.ariaKey)}"></button>`;
  }

  function switchRowHtml(row: SwitchRow): string {
    const label = `<span class="yui-row__label">${row.labelIcon ?? ""}${t(row.labelKey)}</span>`;
    const sub = row.subKey ? `<span class="yui-row__sub">${t(row.subKey)}</span>` : "";
    return `
          <div class="yui-row">
            <div class="yui-row__main">${label}${sub}</div>
            ${switchButtonHtml(row)}
          </div>`;
  }

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

  // Chat API dropdown (yui-select) options — responses/chat_completions. value=chat_api reflects effectiveChatApi.
  const chatTypeOptionsHtml = CHAT_APIS.map(
    (a) => `<option value="${a}">${t(CHAT_API_LABEL_KEYS[a])}</option>`,
  ).join("");

  // Chat provider preset dropdown (yui-select) options — brand names + Custom. value=preset id reflects the current chat_base_url.
  const chatPresetOptionsHtml = `${CHAT_PROVIDER_PRESETS.map(
    (p) => `<option value="${p.id}">${p.name}</option>`,
  ).join("")}<option value="${CHAT_PRESET_CUSTOM}">${t("svc.chat_preset_custom")}</option>`;

  // Speaker picker markup — its own group under the TTS section. Nodes are queried from the
  // el root, so the position can move without invalidating the speaker JS.
  const speakerPickerHtml = `
        <div class="yui-group">
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
          </div>
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
          <div class="yui-row yui-input-row" data-ep-field="${key}">
            <div class="yui-row__main">
              <label class="yui-input-row__label" for="yui-ep-${key}">${t(def.labelKey)}</label>
              <span class="yui-input-row__sub">${t("endpoints.field_sub")}</span>
            </div>
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
          <div class="yui-row yui-input-row yui-chatkey" data-key-prefix="${idPrefix}">
            <div class="yui-row__main">
              <label class="yui-input-row__label" for="yui-${idPrefix}-input">${t(`${i18nPrefix}.label`)}</label>
              <span class="yui-input-row__sub"></span>
            </div>
            <div class="yui-input-wrap yui-chatkey__wrap">
              <input class="yui-ep-input yui-chatkey__input" id="yui-${idPrefix}-input" type="password"
                autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="${t(`${i18nPrefix}.label`)}" />
              <button class="yui-iconbtn yui-chatkey__toggle" type="button" aria-pressed="false" aria-label="${t(`${i18nPrefix}.show`)}" data-tip="${t(`${i18nPrefix}.show`)}">${CHATKEY_EYE_SVG}</button>
              <button class="yui-iconbtn yui-chatkey__clear" type="button" aria-label="${t(`${i18nPrefix}.clear`)}" data-tip="${t(`${i18nPrefix}.clear`)}">${CHATKEY_CLEAR_SVG}</button>
            </div>
          </div>`;
  }

  // Type dropdown row — label on the left, the select on the right.
  function selectRowHtml(id: string, labelKey: string, selectHtml: string): string {
    return `
          <div class="yui-row">
            <div class="yui-row__main"><label class="yui-input-row__label" for="${id}">${t(labelKey)}</label></div>
            ${selectHtml}
          </div>`;
  }

  // Per-service reset — a text button closing the service's group.
  function svcResetRowHtml(svc: string): string {
    return `
          <div class="yui-row yui-row--action">
            <button class="yui-link-btn yui-svc-reset" type="button" data-svc-reset="${svc}">${t(`svc.reset_${svc}`)}</button>
          </div>`;
  }

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

  // Start-fresh row under the session list. Reset is race-safe via pet window thunk.
  const sessionResetHtml = showSessionReset
    ? `
        <div class="yui-group yui-hist__action">
          <div class="yui-row">
            <div class="yui-row__main">
              <span class="yui-session__action-label">${t("session.action_label")}</span>
              <span class="yui-session__action-sub">${t("session.action_sub")}</span>
            </div>
            <button class="yui-link-btn yui-session__reset" type="button">${t("session.reset")}</button>
          </div>
          <div class="yui-confirm" hidden>
            <span class="yui-confirm__q">${t("session.confirm_q")}</span>
            <button class="yui-pill yui-pill--go yui-session__confirm" type="button">${t("session.confirm_go")}</button>
            <button class="yui-pill yui-session__cancel" type="button">${t("session.confirm_cancel")}</button>
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

  // A narrow panel hides the label; aria-label and the tooltip name the icon then.
  function tabHtml(id: string, icon: string, tipKey = `tabs.${id}`): string {
    const selected = id === "talk";
    return `
        <button class="yui-tab" type="button" role="tab" id="yui-tab-${id}" aria-selected="${String(selected)}" aria-controls="yui-panel-${id}" tabindex="${selected ? "0" : "-1"}" data-tip="${t(tipKey)}" aria-label="${t(`tabs.${id}`)}">
          ${icon}
          <span class="yui-tab__label">${t(`tabs.${id}`)}</span>
        </button>`;
  }

  function panelOpenHtml(id: string): string {
    return `
      <div class="yui-tabpanel" role="tabpanel" id="yui-panel-${id}" aria-labelledby="yui-tab-${id}" tabindex="0"${id === "talk" ? "" : " hidden"}>
        <h1 class="yui-tabpanel__title">${t(`tabs.${id}`)}</h1>`;
  }

  return `
    ${headerHtml}
    <div class="yui-quick__cols">
      <div class="yui-tabs" role="tablist" aria-label="${t("panel.tablist_label")}" aria-orientation="vertical">${tabHtml("conn", TAB_ICON_CONN)}${tabHtml("talk", TAB_ICON_TALK)}${tabHtml("char", TAB_ICON_CHAR)}${tabHtml("input", TAB_ICON_INPUT)}${tabHtml("react", TAB_ICON_REACT, "tabs.react_hint")}${showHistory ? tabHtml("hist", TAB_ICON_HIST) : ""}${tabHtml("general", TAB_ICON_GENERAL)}
      </div>
      <div class="yui-quick__body">
${panelOpenHtml("conn")}

        <section class="yui-sec yui-endpoints yui-svc" data-svc="chat">
          ${secHeadHtml(t("svc.chat"), `<span class="yui-endpoints__hint yui-chat-summary-hint"></span>`)}
          <div class="yui-group">
            ${selectRowHtml("yui-svc-chat-type", "svc.type_label", `<select class="yui-select yui-chat-type" id="yui-svc-chat-type" aria-label="${t("svc.chat_aria")}">${chatTypeOptionsHtml}</select>`)}
            ${selectRowHtml("yui-svc-chat-preset", "svc.chat_preset_label", `<select class="yui-select yui-chat-preset" id="yui-svc-chat-preset" aria-label="${t("svc.chat_preset_aria")}">${chatPresetOptionsHtml}</select>`)}
            ${endpointRowHtml("chat_base_url")}
            ${endpointRowHtml("chat_model")}
            ${keyRowHtml("chatkey", "chatkey")}
            <p class="yui-chat-status" role="status" hidden><span class="yui-chat-status__dot" aria-hidden="true"></span><span class="yui-chat-status__text"></span><button class="yui-chat-status__action" type="button" hidden></button></p>
            ${svcResetRowHtml("chat")}
          </div>
        </section>

        <section class="yui-sec yui-endpoints yui-svc" data-svc="stt">
          ${secHeadHtml(t("svc.stt"), `<span class="yui-endpoints__hint">${t("svc.stt_hint")}</span>`)}
          <div class="yui-group">
            ${selectRowHtml("yui-svc-stt-type", "svc.type_label", `<select class="yui-select yui-select--single" id="yui-svc-stt-type" disabled><option>${t("svc.stt_type")}</option></select>`)}
            ${endpointRowHtml("stt_base_url")}
            ${keyRowHtml("sttkey", "sttkey")}
            ${svcResetRowHtml("stt")}
          </div>
        </section>

        <section class="yui-sec yui-endpoints yui-svc" data-svc="tts">
          ${secHeadHtml(t("svc.tts"), `<span class="yui-endpoints__hint">${t("svc.tts_hint")}</span>`)}
          <div class="yui-group">
            ${selectRowHtml("yui-svc-tts-type", "svc.type_label", `<select class="yui-select yui-select--single" id="yui-svc-tts-type" disabled><option>${t("svc.tts_type")}</option></select>`)}
            ${endpointRowHtml("tts_base_url")}
            ${keyRowHtml("ttskey", "ttskey")}
            ${svcResetRowHtml("tts")}
          </div>
          ${speakerPickerHtml}
        </section>

        <section class="yui-sec yui-endpoints yui-svc" data-svc="broker">
          ${secHeadHtml(t("svc.broker"), `<span class="yui-endpoints__hint">${t("svc.broker_hint")}</span>`)}
          <div class="yui-group">
            ${selectRowHtml("yui-svc-broker-type", "svc.type_label", `<select class="yui-select yui-select--single" id="yui-svc-broker-type" disabled><option>${t("svc.broker_type")}</option></select>`)}
            ${endpointRowHtml("broker_base_url")}
            ${svcResetRowHtml("broker")}
          </div>
        </section>
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
        <div class="yui-sec">
          ${secHeadHtml(t("vrm.section"))}
          <div class="yui-group">
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
          </div>
        </div>

        <div class="yui-sec">
          ${secHeadHtml(t("expression.section"))}
          <div class="yui-group">
            <div class="yui-gain">
              <div class="yui-gain__head">
                <span class="yui-gain__label">
                  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M4 10c2.4-2.4 4.9-3.6 8-3.6s5.6 1.2 8 3.6c-2.4 1.1-4.9 1.7-8 1.7s-5.6-.6-8-1.7Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
                    <path d="M4 14c2.4 2.4 4.9 3.6 8 3.6s5.6-1.2 8-3.6c-2.4-1.1-4.9-1.7-8-1.7s-5.6.6-8 1.7Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
                  </svg>
                  ${t("expression.mouth_label")}
                </span>
                <span class="yui-gain__value yui-lipsync-gain__value">2.0×</span>
              </div>
              <span class="yui-gain__sub">${t("expression.mouth_sub")}</span>
              <input class="yui-gain__slider yui-lipsync-gain__slider" type="range" aria-label="${t("expression.mouth_aria")}" />
              <span class="yui-gain__hint">${t("expression.mouth_hint")}</span>
            </div>
          </div>
        </div>
        ${
          showIdleMotion
            ? `
        <div class="yui-sec yui-idle-motion">
          ${secHeadHtml(t("idle_motion.section"))}
          <div class="yui-group yui-motions" role="group" aria-label="${t("idle_motion.group_aria")}"></div>
        </div>`
            : ""
        }
        ${
          showExpressMotion
            ? `
        <div class="yui-sec yui-express-motion">
          ${secHeadHtml(t("express_motion.section"))}
          <p class="yui-sec__note">${t("express_motion.sub")}</p>
          <div class="yui-group yui-express" role="group" aria-label="${t("express_motion.group_aria")}"></div>
        </div>`
            : ""
        }
        ${
          showViewpoint
            ? `
        <div class="yui-sec">
          ${secHeadHtml(t("viewpoint.section"), `<button class="yui-link-btn yui-viewpoint-reset" type="button">${t("viewpoint.reset")}</button>`)}
          <p class="yui-sec__note">${t("viewpoint.sub")}</p>
        </div>`
            : ""
        }
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
        <div class="yui-sec">
          <div class="yui-group yui-hist"></div>
          <p class="yui-hist__foot">${t("history.foot")}</p>
        </div>${sessionResetHtml}
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
