/**
 * The First conversation page: what is sent and the daily limit, the key page link, and the key
 * field. One model-list read confirms the pasted key, and only a confirmed key writes anything.
 */

import type { ChatKeySettingsStore } from "../../../settings/backend/api-key-settings";
import type { createEndpointsSettings } from "../../../settings/backend/endpoints-settings";
import type { createProactiveSettings } from "../../../settings/cues/proactive-settings";
import type { createScheduleSettings } from "../../../settings/cues/schedule-settings";
import { t } from "../../i18n";
import { createModelRead, type ModelReadPhase } from "../connection/chat/model-read";
import {
  CHAT_PROVIDER_PRESETS,
  CHATKEY_EYE_SVG,
  FIRST_CONVERSATION_PRESET_ID,
  GEMINI_KEY_URL,
} from "../constants";
import { secHeadHtml } from "../markup";
import { ICON_WARN } from "../plugins/plugin-parts";
import { toggleKeyReveal } from "../sections/key-row/key-row";
import "./first-conversation-page.css";

const ICON_DONE = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

interface FirstConversationPageDeps {
  endpointsSettings: Pick<ReturnType<typeof createEndpointsSettings>, "set">;
  chatKeySettings: Pick<ChatKeySettingsStore, "setApiKey">;
  proactiveSettings: Pick<ReturnType<typeof createProactiveSettings>, "setEnabled">;
  scheduleSettings: Pick<ReturnType<typeof createScheduleSettings>, "setEnabled">;
  getFetch: () => Promise<typeof globalThis.fetch | undefined>;
  /** The key is confirmed and written. */
  onConnected: () => void;
  openConnection: () => void;
}

function factRowHtml(labelKey: string, subKey: string): string {
  return `
          <div class="yui-row">
            <div class="yui-row__main">
              <span class="yui-row__label">${t(labelKey)}</span>
              <span class="yui-row__sub">${t(subKey)}</span>
            </div>
          </div>`;
}

// The opener plugin opens target=_blank anchors; WebKit's plain Tab skips links without a tabindex.
function keyLinkHtml(labelKey: string, className: string): string {
  return `<a class="yui-chat-type__link ${className}" href="${GEMINI_KEY_URL}" target="_blank" rel="noopener noreferrer" tabindex="0">${t(labelKey)}</a>`;
}

function pageHtml(): string {
  return `
    <div class="yui-tab-stack yui-first__setup">
      <div class="yui-sec">
        ${secHeadHtml(t("first.free_title"))}
        <p class="yui-sec__note">${t("first.free_note")}</p>
        <div class="yui-group">${factRowHtml("first.send_label", "first.send_sub")}${factRowHtml("first.limit_label", "first.limit_sub")}
        </div>
      </div>
      <div class="yui-sec">
        ${secHeadHtml(t("first.key_title"))}
        <div class="yui-group">
          <div class="yui-row">
            <div class="yui-row__main">
              <span class="yui-row__label">${t("first.make_label")}</span>
              <span class="yui-row__sub">${t("first.make_sub")}</span>
            </div>
            ${keyLinkHtml("first.make_link", "yui-first__key-link")}
          </div>
          <div class="yui-row yui-chatkey yui-first__paste">
            <div class="yui-row__main">
              <label class="yui-input-row__label" for="yui-first-key">${t("first.paste_label")}</label>
            </div>
            <div class="yui-input-wrap yui-chatkey__wrap">
              <input class="yui-ep-input yui-chatkey__input" id="yui-first-key" type="password" placeholder="${t("first.paste_placeholder")}"
                autocomplete="off" autocapitalize="off" spellcheck="false" />
              <button class="yui-iconbtn yui-chatkey__toggle" type="button" aria-pressed="false" aria-label="${t("chatkey.show")}" data-tip="${t("chatkey.show")}">${CHATKEY_EYE_SVG}</button>
            </div>
            <button class="yui-pill yui-pill--ok yui-first__connect" type="button">${t("first.connect")}</button>
            <p class="yui-first__checking" role="status" hidden><i class="yui-first__dot"></i>${t("first.checking")}</p>
            <div class="yui-first__err" role="alert" hidden>${ICON_WARN}<div><span class="yui-first__err-text"></span> ${keyLinkHtml("first.reopen", "yui-first__reopen")}</div></div>
          </div>
        </div>
      </div>
      <p class="yui-sec__foot">${t("first.own_server")} <button class="yui-link-btn yui-chat-type__link yui-first__own" type="button">${t("first.open_connection")}</button></p>
    </div>
    <p class="yui-first__done" role="status" hidden>${ICON_DONE}<span>${t("first.done")}</span></p>`;
}

export function createFirstConversationPage(deps: FirstConversationPageDeps): {
  el: HTMLElement;
  dispose(): void;
} {
  const { url, model } = CHAT_PROVIDER_PRESETS.find((p) => p.id === FIRST_CONVERSATION_PRESET_ID)!;

  const el = document.createElement("div");
  el.className = "yui-tab-stack";
  el.innerHTML = pageHtml();
  const setup = el.querySelector<HTMLElement>(".yui-first__setup")!;
  const done = el.querySelector<HTMLElement>(".yui-first__done")!;
  const input = el.querySelector<HTMLInputElement>("#yui-first-key")!;
  const toggle = el.querySelector<HTMLButtonElement>(".yui-chatkey__toggle")!;
  const connect = el.querySelector<HTMLButtonElement>(".yui-first__connect")!;
  const checking = el.querySelector<HTMLElement>(".yui-first__checking")!;
  const error = el.querySelector<HTMLElement>(".yui-first__err")!;
  const errorText = el.querySelector<HTMLElement>(".yui-first__err-text")!;
  const reopen = el.querySelector<HTMLElement>(".yui-first__reopen")!;

  const typedKey = (): string => input.value.trim();

  function showError(textKey: string, keyLink = false): void {
    errorText.textContent = t(textKey);
    reopen.hidden = !keyLink;
    error.hidden = false;
    input.focus();
  }

  function onPhase(phase: ModelReadPhase): void {
    const reading = phase.phase === "reading";
    input.disabled = reading;
    connect.disabled = reading;
    checking.hidden = !reading;
    if (phase.phase !== "done") return;
    const { result } = phase;
    if (result.kind === "ok") {
      deps.endpointsSettings.set({ chat_base_url: url, chat_model: model });
      deps.chatKeySettings.setApiKey(typedKey());
      deps.proactiveSettings.setEnabled(false);
      deps.scheduleSettings.setEnabled(false);
      deps.onConnected();
      input.value = "";
      setup.hidden = true;
      done.hidden = false;
    } else if (result.kind === "refused" || (result.kind === "http" && result.status === 400)) {
      // Measured: a bad Gemini key answers HTTP 400 "Please pass a valid API key".
      showError("first.refused", true);
    } else {
      showError("first.failed");
    }
  }

  const read = createModelRead({
    getApiKey: async () => typedKey(),
    getFetch: deps.getFetch,
    onPhase,
  });

  toggle.addEventListener("click", () => toggleKeyReveal(input, toggle, "chatkey"));
  connect.addEventListener("click", () => {
    error.hidden = true;
    if (typedKey() === "") showError("first.need_key");
    else read.start(url!);
  });
  el.querySelector(".yui-first__own")!.addEventListener("click", () => deps.openConnection());

  return { el, dispose: read.dispose };
}
