/**
 * Connection tab — the chat/STT/TTS(/broker) endpoint sections shared by the desktop panel and
 * the phone settings view. `rows` picks, per service, which fields render; the same rows drive
 * markup, handlers and reflection, so only rendered fields are bound.
 */

import type { PushSocketState } from "../../../io/chat/push/push-socket";
import type { Logger } from "../../../logger";
import type {
  ApiKeySettingsStore,
  ChatKeySettingsStore,
} from "../../../settings/backend/api-key-settings";
import type {
  createEndpointsSettings,
  EndpointOverrides,
} from "../../../settings/backend/endpoints-settings";
import { t } from "../../i18n";
import {
  CHAT_API_LABEL_KEYS,
  CHAT_APIS,
  CHAT_PRESET_CUSTOM,
  CHAT_PROVIDER_PRESETS,
  CHATKEY_CLEAR_SVG,
  CHATKEY_EYE_SVG,
  type ChatApi,
  ENDPOINT_FIELDS,
  TTS_PROVIDER_PRESETS,
} from "../constants";
import { secHeadHtml } from "../markup";
import { createEndpointsSection, validateEndpointInput } from "./endpoints-section";

type EndpointsSettingsStore = ReturnType<typeof createEndpointsSettings>;

/** The push transport as the settings panel uses it: a state to show and a conversation to reset. */
export interface PushSocketPanelPort {
  getState(): PushSocketState;
  onState(cb: (state: PushSocketState) => void): () => void;
  sendReset(): boolean;
  /** Drop the backoff wait and open now — what the status line's button asks for. */
  reconnectNow(): void;
}

/** Which rows each service's section renders — and binds, and reflects. */
export interface ConnectionRows {
  /** full: protocol/provider/model rows + URL/key; push: URL/key and the live status line. */
  chat: "full" | "push";
  /** full: provider dropdown + URL/model/key; provider-url-key: no model row. Also gates the disabled STT type row. */
  tts: "full" | "provider-url-key";
  // Deprecated: removed in v0.6.0. Use client-declared tools (src/io/chat/stream/client-tools.ts).
  broker: boolean;
}

export interface ConnectionTab {
  el: HTMLElement;
  /** Reflect every store onto the rendered fields — the open hook. */
  refresh(): void;
  /** Commit dirty key and endpoint inputs to the stores — the close hook. */
  commit(): void;
  /** Scroll the STT section into view and focus its URL field. */
  focusStt(): void;
  dispose(): void;
}

// Endpoint field row template. Label/placeholder/value left empty, filled by the tab's reflect.
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

// Per-service API key row (secret). Uses idPrefix to stamp chat/stt/tts from one template.
// Input always type="password" — toggle reveals plaintext only. value/sublabel filled by reflect.
function keyRowHtml(idPrefix: string): string {
  return `
          <div class="yui-row yui-input-row yui-chatkey" data-key-prefix="${idPrefix}">
            <div class="yui-row__main">
              <label class="yui-input-row__label" for="yui-${idPrefix}-input">${t(`${idPrefix}.label`)}</label>
              <span class="yui-input-row__sub"></span>
            </div>
            <div class="yui-input-wrap yui-chatkey__wrap">
              <input class="yui-ep-input yui-chatkey__input" id="yui-${idPrefix}-input" type="password"
                autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="${t(`${idPrefix}.label`)}" />
              <button class="yui-iconbtn yui-chatkey__toggle" type="button" aria-pressed="false" aria-label="${t(`${idPrefix}.show`)}" data-tip="${t(`${idPrefix}.show`)}">${CHATKEY_EYE_SVG}</button>
              <button class="yui-iconbtn yui-chatkey__clear" type="button" aria-label="${t(`${idPrefix}.clear`)}" data-tip="${t(`${idPrefix}.clear`)}">${CHATKEY_CLEAR_SVG}</button>
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

function chatSectionHtml(rows: ConnectionRows): string {
  const full = rows.chat === "full";
  // Chat API dropdown (yui-select) options — value=chat_api reflects effectiveChatApi.
  const chatTypeOptionsHtml = CHAT_APIS.map(
    (a) => `<option value="${a}">${t(CHAT_API_LABEL_KEYS[a])}</option>`,
  ).join("");
  // Chat provider preset dropdown options — brand names + Custom. value=preset id reflects chat_base_url.
  const chatPresetOptionsHtml = `${CHAT_PROVIDER_PRESETS.map(
    (p) => `<option value="${p.id}">${p.name}</option>`,
  ).join("")}<option value="${CHAT_PRESET_CUSTOM}">${t("svc.chat_preset_custom")}</option>`;
  return `
        <section class="yui-sec yui-endpoints yui-svc" data-svc="chat">
          ${secHeadHtml(t("svc.chat"), full ? `<span class="yui-endpoints__hint yui-chat-summary-hint"></span>` : "")}
          <div class="yui-group">
            ${full ? selectRowHtml("yui-svc-chat-type", "svc.type_label", `<select class="yui-select yui-chat-type" id="yui-svc-chat-type" aria-label="${t("svc.chat_aria")}">${chatTypeOptionsHtml}</select>`) : ""}
            ${full ? selectRowHtml("yui-svc-chat-preset", "svc.chat_preset_label", `<select class="yui-select yui-chat-preset" id="yui-svc-chat-preset" aria-label="${t("svc.chat_preset_aria")}">${chatPresetOptionsHtml}</select>`) : ""}
            ${endpointRowHtml("chat_base_url")}
            ${full ? endpointRowHtml("chat_model") : ""}
            ${keyRowHtml("chatkey")}
            <p class="yui-chat-status" role="status" hidden><span class="yui-chat-status__dot" aria-hidden="true"></span><span class="yui-chat-status__text"></span><button class="yui-chat-status__action" type="button" hidden></button></p>
            ${svcResetRowHtml("chat")}
          </div>
        </section>`;
}

function sttSectionHtml(rows: ConnectionRows): string {
  // The disabled type row names the protocol; the desktop rows render it, the phone drops it.
  const typeRow =
    rows.tts === "full"
      ? selectRowHtml(
          "yui-svc-stt-type",
          "svc.type_label",
          `<select class="yui-select yui-select--single" id="yui-svc-stt-type" disabled><option>${t("svc.stt_type")}</option></select>`,
        )
      : "";
  return `
        <section class="yui-sec yui-endpoints yui-svc" data-svc="stt">
          ${secHeadHtml(t("svc.stt"), `<span class="yui-endpoints__hint">${t("svc.stt_hint")}</span>`)}
          <div class="yui-group">
            ${typeRow}
            ${endpointRowHtml("stt_base_url")}
            ${endpointRowHtml("stt_model")}
            ${keyRowHtml("sttkey")}
            ${svcResetRowHtml("stt")}
          </div>
        </section>`;
}

function ttsSectionHtml(rows: ConnectionRows): string {
  const providerOptionsHtml = TTS_PROVIDER_PRESETS.map(
    (p) => `<option value="${p.id}">${p.name}</option>`,
  ).join("");
  return `
        <section class="yui-sec yui-endpoints yui-svc" data-svc="tts">
          ${secHeadHtml(t("svc.tts"), `<span class="yui-endpoints__hint">${t("svc.tts_hint")}</span>`)}
          <div class="yui-group">
            ${selectRowHtml("yui-svc-tts-provider", "svc.tts_type", `<select class="yui-select yui-tts-provider" id="yui-svc-tts-provider" aria-label="${t("svc.tts_preset_aria")}">${providerOptionsHtml}</select>`)}
            ${endpointRowHtml("tts_base_url")}
            ${rows.tts === "full" ? endpointRowHtml("tts_model") : ""}
            ${keyRowHtml("ttskey")}
            ${svcResetRowHtml("tts")}
          </div>
        </section>`;
}

// Deprecated: removed in v0.6.0. Use client-declared tools (src/io/chat/stream/client-tools.ts).
function brokerSectionHtml(): string {
  return `
        <section class="yui-sec yui-endpoints yui-svc" data-svc="broker">
          ${secHeadHtml(t("svc.broker"), `<span class="yui-endpoints__hint">${t("svc.broker_hint")}</span>`)}
          <div class="yui-group">
            ${selectRowHtml("yui-svc-broker-type", "svc.type_label", `<select class="yui-select yui-select--single" id="yui-svc-broker-type" disabled><option>${t("svc.broker_type")}</option></select>`)}
            ${endpointRowHtml("broker_base_url")}
            ${svcResetRowHtml("broker")}
          </div>
        </section>`;
}

export function createConnectionTab(deps: {
  endpointsSettings: EndpointsSettingsStore;
  /** chat API key overrides store. Value is secret — no logging. */
  chatKeySettings: ChatKeySettingsStore;
  /** STT API key overrides store. Value is secret — no logging. */
  sttKeySettings: ApiKeySettingsStore;
  /** TTS (openai-compatible) API key overrides store. Value is secret — no logging. */
  ttsKeySettings: ApiKeySettingsStore;
  /** Default bundled-config endpoints to show as placeholder (undefined if not loaded). */
  getEndpointDefaults?: () => EndpointOverrides | undefined;
  /** Default bundled-config value for the chat protocol when no override (undefined if not loaded). */
  getDefaultChatApi?: () => string | undefined;
  rows: ConnectionRows;
  /** Push transport state for the chat status line. Absent where nothing shows it. */
  pushSocket?: PushSocketPanelPort;
  /** Store subscriptions and the status line skip repaints while the tab is closed. */
  isOpen: () => boolean;
  /** Extra element mounted after the TTS group (the desktop's speaker picker `.yui-group`). */
  ttsExtra?: HTMLElement;
  log: Logger;
}): ConnectionTab {
  const {
    endpointsSettings,
    chatKeySettings,
    sttKeySettings,
    ttsKeySettings,
    getEndpointDefaults,
    getDefaultChatApi,
    rows,
    pushSocket,
    isOpen,
    ttsExtra,
    log,
  } = deps;

  const el = document.createElement("div");
  el.className = "yui-tab-stack";
  el.innerHTML = `${chatSectionHtml(rows)}${sttSectionHtml(rows)}${ttsSectionHtml(rows)}${rows.broker ? brokerSectionHtml() : ""}`;
  if (ttsExtra) {
    el.querySelector<HTMLElement>('.yui-svc[data-svc="tts"]')!.append(ttsExtra);
  }

  const endpointsSection = createEndpointsSection({
    root: el,
    endpointsSettings,
    chatKeySettings,
    sttKeySettings,
    ttsKeySettings,
    getEndpointDefaults,
    reflectEndpoints: () => reflectEndpoints(),
    isOpen,
    log,
  });

  // Chat protocol nodes — the push-only rows render none of the selects/hint/model row.
  const chatTypeEl = el.querySelector<HTMLSelectElement>(".yui-chat-type");
  const chatSummaryHintEl = el.querySelector<HTMLSpanElement>(".yui-chat-summary-hint");
  const chatPresetEl = el.querySelector<HTMLSelectElement>(".yui-chat-preset");
  const ttsProviderEl = el.querySelector<HTMLSelectElement>(".yui-tts-provider")!;
  const chatModelRowEl = el.querySelector<HTMLDivElement>(
    '.yui-input-row[data-ep-field="chat_model"]',
  );
  const chatStatusEl = el.querySelector<HTMLParagraphElement>(".yui-chat-status")!;
  const chatStatusTextEl = chatStatusEl.querySelector<HTMLSpanElement>(".yui-chat-status__text")!;
  const chatStatusActionEl = chatStatusEl.querySelector<HTMLButtonElement>(
    ".yui-chat-status__action",
  )!;

  // Endpoint inputs — built from the rendered rows; fields the rows omit have no node to bind.
  const epInputs = new Map<keyof EndpointOverrides, HTMLInputElement>();
  for (const { key } of ENDPOINT_FIELDS) {
    const input = el.querySelector<HTMLInputElement>(`#yui-ep-${key}`);
    if (input) epInputs.set(key, input);
  }

  function isChatApi(v: string | undefined): v is ChatApi {
    return v !== undefined && (CHAT_APIS as readonly string[]).includes(v);
  }

  // Effective chat API — use valid override if present, else bundled default, else fall back to responses.
  function effectiveChatApi(): ChatApi {
    const ov = endpointsSettings.get().chat_api;
    if (isChatApi(ov)) return ov;
    const def = getDefaultChatApi?.();
    return isChatApi(def) ? def : "responses";
  }

  // Push rows are push whatever the store says (the phone's endpoint accessor is the source, not this store).
  function isPush(): boolean {
    return rows.chat === "push" || effectiveChatApi() === "push";
  }

  /** Where the socket stands, or undefined outside push mode. */
  function pushState(): PushSocketState | undefined {
    return isPush() ? pushSocket?.getState() : undefined;
  }

  // Chat API dropdown value + summary hint, matching effective chat_api.
  // The model row belongs to the request-shaped modes — push carries no model of its own.
  function reflectChatType(): void {
    const eff = effectiveChatApi();
    if (chatTypeEl && chatTypeEl.value !== eff) chatTypeEl.value = eff;
    if (chatSummaryHintEl) chatSummaryHintEl.textContent = t(CHAT_API_LABEL_KEYS[eff]);
    if (chatModelRowEl) chatModelRowEl.hidden = eff === "push";
    reflectChatStatus();
  }

  // Chat provider preset dropdown — the preset the current settings match, else Custom. A preset
  // that names a protocol is matched on it; the rest are matched on the chat_base_url override.
  function reflectChatPreset(): void {
    if (!chatPresetEl) return;
    const api = effectiveChatApi();
    const url = endpointsSettings.get().chat_base_url.trim();
    const match = CHAT_PROVIDER_PRESETS.find((p) =>
      p.chatApi !== undefined ? p.chatApi === api : p.url === url && api !== "push",
    );
    const next = match ? match.id : CHAT_PRESET_CUSTOM;
    if (chatPresetEl.value !== next) chatPresetEl.value = next;
  }

  // TTS provider dropdown — the override, else the bundled default.
  function reflectTtsProvider(): void {
    const next =
      endpointsSettings.get().tts_provider ||
      getEndpointDefaults?.()?.tts_provider ||
      TTS_PROVIDER_PRESETS[0].id;
    if (ttsProviderEl.value !== next) ttsProviderEl.value = next;
  }

  // One line under the key row: where the push socket stands, and the button that opens the
  // socket without waiting. Hidden in the request-shaped modes.
  function reflectChatStatus(): void {
    const state = pushState();
    chatStatusEl.hidden = state === undefined;
    chatStatusEl.classList.remove("is-ready", "is-waiting", "is-failed");
    chatStatusActionEl.hidden = true;
    if (state === undefined) {
      chatStatusTextEl.textContent = "";
      return;
    }
    switch (state.kind) {
      case "ready":
        chatStatusEl.classList.add("is-ready");
        chatStatusTextEl.textContent = t("svc.chat_status_connected", { id: state.chat_id });
        return;
      case "connecting":
        chatStatusEl.classList.add("is-waiting");
        chatStatusTextEl.textContent = t("svc.chat_status_connecting");
        return;
      case "reconnecting":
        chatStatusEl.classList.add("is-waiting");
        chatStatusTextEl.textContent = t("svc.chat_status_reconnecting", {
          seconds: Math.ceil(state.delay_ms / 1000),
        });
        chatStatusActionEl.textContent = t("svc.chat_status_connect_now");
        chatStatusActionEl.hidden = false;
        return;
      case "failed":
        chatStatusEl.classList.add("is-failed");
        chatStatusTextEl.textContent = t("svc.chat_status_refused");
        chatStatusActionEl.textContent = t("svc.chat_status_reconnect");
        chatStatusActionEl.hidden = false;
        return;
      default:
        chatStatusTextEl.textContent = t("svc.chat_status_offline");
    }
  }

  function reflectEndpoints(): void {
    const ov = endpointsSettings.get();
    // Placeholders fill after config loads (panel created before), so refresh every reflect.
    const defaults = getEndpointDefaults?.();
    for (const [key, input] of epInputs) {
      if (defaults) input.placeholder = defaults[key];
      // Do not overwrite while typing (remote changes apply on blur).
      if ((!document.hasFocus() || document.activeElement !== input) && input.value !== ov[key]) {
        input.value = ov[key];
      }
      validateEndpointInput(key, input);
    }
  }

  function refresh(): void {
    reflectEndpoints();
    for (const r of endpointsSection.keyRows) r.reflect();
    reflectChatType();
    reflectChatPreset();
    reflectTtsProvider();
  }

  function commit(): void {
    endpointsSection.commitDirtyKeys();
    endpointsSection.commitDirtyEndpoints();
  }

  function focusStt(): void {
    el.querySelector<HTMLElement>('[data-svc="stt"]')?.scrollIntoView?.({ block: "start" });
    epInputs.get("stt_base_url")?.focus({ preventScroll: true });
  }

  const handleChatStatusAction = (): void => pushSocket?.reconnectNow();
  chatStatusActionEl.addEventListener("click", handleChatStatusAction);

  const unsubscribeEndpoints = endpointsSettings.subscribe(() => {
    if (isOpen()) {
      reflectEndpoints();
      reflectChatType();
      reflectChatPreset();
      reflectTtsProvider();
    }
  });
  // The socket moves on its own — its status line follows whether or not a setting changed.
  const unsubscribePushState = pushSocket?.onState(() => {
    if (isOpen()) reflectChatStatus();
  });

  return {
    el,
    refresh,
    commit,
    focusStt,
    dispose(): void {
      // Commit first: the locale remount relies on dispose landing typed keys and endpoints.
      commit();
      unsubscribeEndpoints();
      unsubscribePushState?.();
      chatStatusActionEl.removeEventListener("click", handleChatStatusAction);
      endpointsSection.dispose();
      el.remove();
    },
  };
}
