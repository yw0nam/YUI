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
import { ENDPOINT_FIELDS, TTS_PROVIDER_PRESETS } from "../constants";
import {
  endpointRowHtml,
  keyRowHtml,
  secHeadHtml,
  selectRowHtml,
  svcResetRowHtml,
} from "../markup";
import { createChatSection } from "./chat/chat-section";
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
  const chatSection = createChatSection({
    chatRows: rows.chat,
    endpointsSettings,
    getDefaultChatApi,
    pushSocket,
    isOpen,
  });
  el.append(chatSection.el);
  el.insertAdjacentHTML(
    "beforeend",
    `${sttSectionHtml(rows)}${ttsSectionHtml(rows)}${rows.broker ? brokerSectionHtml() : ""}`,
  );
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

  const ttsProviderEl = el.querySelector<HTMLSelectElement>(".yui-tts-provider")!;

  // Endpoint inputs — built from the rendered rows; fields the rows omit have no node to bind.
  const epInputs = new Map<keyof EndpointOverrides, HTMLInputElement>();
  for (const { key } of ENDPOINT_FIELDS) {
    const input = el.querySelector<HTMLInputElement>(`#yui-ep-${key}`);
    if (input) epInputs.set(key, input);
  }

  // TTS provider dropdown — the override, else the bundled default.
  function reflectTtsProvider(): void {
    const next =
      endpointsSettings.get().tts_provider ||
      getEndpointDefaults?.()?.tts_provider ||
      TTS_PROVIDER_PRESETS[0].id;
    if (ttsProviderEl.value !== next) ttsProviderEl.value = next;
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
    chatSection.reflect();
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

  const unsubscribeEndpoints = endpointsSettings.subscribe(() => {
    if (isOpen()) {
      reflectEndpoints();
      chatSection.reflect();
      reflectTtsProvider();
    }
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
      chatSection.dispose();
      endpointsSection.dispose();
      el.remove();
    },
  };
}
