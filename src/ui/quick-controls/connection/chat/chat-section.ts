/**
 * Chat section of the Connection tab — the section markup, the chat protocol and provider preset
 * reflection, and the push status line. The tab composes it and routes refresh/dispose to it.
 */

import type { PushSocketState } from "../../../../io/chat/push/push-socket";
import type { createEndpointsSettings } from "../../../../settings/backend/endpoints-settings";
import { t } from "../../../i18n";
import {
  CHAT_APIS,
  CHAT_PRESET_CUSTOM,
  CHAT_PROVIDER_PRESETS,
  type ChatApi,
} from "../../constants";
import {
  endpointRowHtml,
  keyRowHtml,
  secHeadHtml,
  selectRowHtml,
  svcResetRowHtml,
} from "../../markup";
import { chatTypeRowHtml, createChatTypeView } from "../chat-type";
import { createChatStatus } from "./chat-status";

type EndpointsSettingsStore = ReturnType<typeof createEndpointsSettings>;

function chatSectionHtml(chatRows: "full" | "push"): string {
  const full = chatRows === "full";
  // Chat provider preset dropdown options — brand names + Custom. value=preset id reflects chat_base_url.
  const chatPresetOptionsHtml = `${CHAT_PROVIDER_PRESETS.map(
    (p) => `<option value="${p.id}">${p.name}</option>`,
  ).join("")}<option value="${CHAT_PRESET_CUSTOM}">${t("svc.chat_preset_custom")}</option>`;
  return `
        <section class="yui-sec yui-endpoints yui-svc" data-svc="chat">
          ${secHeadHtml(t("svc.chat"), full ? `<span class="yui-endpoints__hint yui-chat-summary-hint"></span>` : "")}
          <div class="yui-group">
            ${full ? chatTypeRowHtml() : ""}
            ${full ? selectRowHtml("yui-svc-chat-preset", "svc.chat_preset_label", `<select class="yui-select yui-chat-preset" id="yui-svc-chat-preset" aria-label="${t("svc.chat_preset_aria")}">${chatPresetOptionsHtml}</select>`) : ""}
            ${endpointRowHtml("chat_base_url")}
            ${full ? endpointRowHtml("chat_model") : ""}
            ${keyRowHtml("chatkey")}
            <p class="yui-chat-status" role="status" hidden><span class="yui-chat-status__dot" aria-hidden="true"></span><span class="yui-chat-status__text"></span><button class="yui-chat-status__action" type="button" hidden></button></p>
            ${svcResetRowHtml("chat")}
          </div>
        </section>`;
}

export interface ChatSection {
  el: HTMLElement;
  /** Reflect the stores onto the rendered chat rows — the tab's refresh hook. */
  reflect(): void;
  dispose(): void;
}

export function createChatSection(deps: {
  /** "full" renders the protocol/preset/model rows; "push" is the phone's URL/key + status line. */
  chatRows: "full" | "push";
  endpointsSettings: EndpointsSettingsStore;
  /** Default bundled-config value for the chat protocol when no override (undefined if not loaded). */
  getDefaultChatApi?: () => string | undefined;
  /** The slice of the push port the status line needs — a state to show and a way to open now. */
  pushSocket?: {
    getState(): PushSocketState;
    onState(cb: (state: PushSocketState) => void): () => void;
    reconnectNow(): void;
  };
  /** The status line skips repaints while the tab is closed. */
  isOpen: () => boolean;
}): ChatSection {
  const { chatRows, endpointsSettings, getDefaultChatApi, pushSocket, isOpen } = deps;

  // A <template> parses the section markup without a throwaway wrapper in the DOM.
  const template = document.createElement("template");
  template.innerHTML = chatSectionHtml(chatRows);
  const el = template.content.firstElementChild as HTMLElement;

  // Chat protocol nodes — the push-only rows render none of the selects/hint/model row.
  const chatTypeEl = el.querySelector<HTMLSelectElement>(".yui-chat-type");
  const chatTypeView = createChatTypeView(el);
  const chatPresetEl = el.querySelector<HTMLSelectElement>(".yui-chat-preset");
  const chatModelRowEl = el.querySelector<HTMLDivElement>(
    '.yui-input-row[data-ep-field="chat_model"]',
  );

  const status = createChatStatus(el, { onAction: () => pushSocket?.reconnectNow() });

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
    return chatRows === "push" || effectiveChatApi() === "push";
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
    chatTypeView.reflect(eff);
    if (chatModelRowEl) chatModelRowEl.hidden = eff === "push";
    status.render(pushState());
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

  function reflect(): void {
    reflectChatType();
    reflectChatPreset();
  }

  // The socket moves on its own — its status line follows whether or not a setting changed.
  const unsubscribePushState = pushSocket?.onState(() => {
    if (isOpen()) status.render(pushState());
  });

  return {
    el,
    reflect,
    dispose(): void {
      unsubscribePushState?.();
      status.dispose();
    },
  };
}
