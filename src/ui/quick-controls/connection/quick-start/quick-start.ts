/**
 * Quick start: the Connection page's free Gemini path — what is sent and the daily limit, the key
 * page link, and the key field. One model-list read confirms the pasted key, and only a confirmed
 * key writes anything.
 */

import type { EndpointsConfig } from "../../../../contract";
import type { createSpeakerSelection } from "../../../../io/voice/voices/speaker-selection";
import type {
  ApiKeySettingsStore,
  ChatKeySettingsStore,
} from "../../../../settings/backend/api-key-settings";
import type {
  createEndpointsSettings,
  EndpointOverrides,
} from "../../../../settings/backend/endpoints-settings";
import type { createProactiveSettings } from "../../../../settings/cues/proactive-settings";
import type { createScheduleSettings } from "../../../../settings/cues/schedule-settings";
import type { FlagSettingsStore } from "../../../../settings/persisted-store";
import { t } from "../../../i18n";
import { CHATKEY_EYE_SVG, GEMINI_KEY_URL, GEMINI_PRESET } from "../../constants";
import { keyLinkHtml, secHeadHtml } from "../../markup";
import { ICON_WARN } from "../../plugins/plugin-parts";
import { helpSectionHtml } from "../../sections/help/help-section";
import { toggleKeyReveal } from "../../sections/key-row/key-row";
import { createModelRead, type ModelReadPhase } from "../chat/model-read";
import { createVoiceStep } from "./voice-step";
import "./quick-start.css";

const ICON_DONE = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

type SpeakerSelectionStore = ReturnType<typeof createSpeakerSelection>;

interface QuickStartDeps {
  endpointsSettings: Pick<ReturnType<typeof createEndpointsSettings>, "get" | "set">;
  chatKeySettings: Pick<ChatKeySettingsStore, "get" | "setApiKey">;
  proactiveSettings: Pick<ReturnType<typeof createProactiveSettings>, "setEnabled">;
  scheduleSettings: Pick<ReturnType<typeof createScheduleSettings>, "setEnabled">;
  /** The bundled config's endpoints, the fallback for an unset chat URL. */
  getEndpointDefaults?: () => EndpointOverrides | undefined;
  getFetch: () => Promise<typeof globalThis.fetch | undefined>;
  /** The key is confirmed and written. */
  onConnected: () => void;
  /** The connected state carries the Help section. */
  showHelp: boolean;
  /** The voice step's stores. An absent TTS flag store keeps the voice step out. */
  ttsKeySettings?: Pick<ApiKeySettingsStore, "setApiKey">;
  ttsSettings?: Pick<FlagSettingsStore, "setEnabled">;
  speakerSelection?: Pick<SpeakerSelectionStore, "list" | "addUserOption" | "pin">;
  /** The Fish voice per app language, from the bundled config; undefined hides the section. */
  getDefaultVoices?: () => NonNullable<EndpointsConfig["tts_default_voices"]> | undefined;
  /** The pet window replays the first conversation. */
  onReplay?: () => void;
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

function pageHtml(showHelp: boolean, replayRow: string): string {
  return `
    <div class="yui-tab-stack yui-start__setup">
      <p class="yui-start__own" hidden>${t("start.own_note")}</p>
      <div class="yui-sec">
        ${secHeadHtml(t("start.free_title"))}
        <p class="yui-sec__note">${t("start.free_note")}</p>
        <div class="yui-group">${factRowHtml("start.send_label", "start.send_sub")}${factRowHtml("start.limit_label", "start.limit_sub")}
        </div>
      </div>
      <div class="yui-sec">
        ${secHeadHtml(t("start.key_title"))}
        <div class="yui-group">
          <div class="yui-row">
            <div class="yui-row__main">
              <span class="yui-row__label">${t("start.make_label")}</span>
              <span class="yui-row__sub">${t("start.make_sub")}</span>
            </div>
            ${keyLinkHtml(GEMINI_KEY_URL, "start.make_link", "yui-start__key-link")}
          </div>
          <div class="yui-row yui-chatkey yui-start__paste">
            <div class="yui-row__main">
              <label class="yui-input-row__label" for="yui-start-key">${t("start.paste_label")}</label>
            </div>
            <div class="yui-input-wrap yui-chatkey__wrap">
              <input class="yui-ep-input yui-chatkey__input" id="yui-start-key" type="password" placeholder="${t("start.paste_placeholder")}"
                autocomplete="off" autocapitalize="off" spellcheck="false" />
              <button class="yui-iconbtn yui-chatkey__toggle" type="button" aria-pressed="false" aria-label="${t("chatkey.show")}" data-tip="${t("chatkey.show")}">${CHATKEY_EYE_SVG}</button>
            </div>
            <button class="yui-pill yui-pill--ok yui-start__connect" type="button">${t("start.connect")}</button>
            <p class="yui-start__checking" role="status" hidden><i class="yui-start__dot"></i>${t("start.checking")}</p>
            <div class="yui-start__err" role="alert" hidden>${ICON_WARN}<div><span class="yui-start__err-text"></span> ${keyLinkHtml(GEMINI_KEY_URL, "start.reopen", "yui-start__reopen")}</div></div>
          </div>
        </div>
      </div>
    </div>
    <div class="yui-start__connected" hidden>
      <p class="yui-start__done" role="status">${ICON_DONE}<span>${t("start.done")}</span></p>
      ${showHelp ? helpSectionHtml(replayRow) : ""}
    </div>`;
}

/** The Help row that replays the first conversation. */
function replayRowHtml(): string {
  return `
          <div class="yui-row">
            <div class="yui-row__main">
              <span class="yui-row__label">${t("help.replay.label")}</span>
              <span class="yui-row__sub">${t("help.replay.sub")}</span>
            </div>
            <button class="yui-link-btn yui-help-btn yui-start__replay" type="button" aria-label="${t("help.replay.aria")}">${t("help.replay.action")}</button>
          </div>`;
}

export function createQuickStart(deps: QuickStartDeps): {
  el: HTMLElement;
  /** Reads the stores onto the two states: the setup or the connected one. */
  reflect(): void;
  dispose(): void;
} {
  const el = document.createElement("div");
  el.className = "yui-tab-stack";
  el.innerHTML = pageHtml(deps.showHelp, deps.onReplay ? replayRowHtml() : "");
  const setup = el.querySelector<HTMLElement>(".yui-start__setup")!;
  const connected = el.querySelector<HTMLElement>(".yui-start__connected")!;
  const voiceStep =
    deps.ttsSettings && deps.ttsKeySettings && deps.speakerSelection
      ? createVoiceStep({
          endpointsSettings: deps.endpointsSettings,
          getEndpointDefaults: deps.getEndpointDefaults,
          ttsKeySettings: deps.ttsKeySettings,
          ttsSettings: deps.ttsSettings,
          speakerSelection: deps.speakerSelection,
          getDefaultVoices: deps.getDefaultVoices ?? (() => undefined),
          getFetch: deps.getFetch,
        })
      : undefined;
  if (voiceStep) connected.insertBefore(voiceStep.el, connected.querySelector(".yui-sec"));
  const own = el.querySelector<HTMLElement>(".yui-start__own")!;
  const input = el.querySelector<HTMLInputElement>("#yui-start-key")!;
  const toggle = el.querySelector<HTMLButtonElement>(".yui-chatkey__toggle")!;
  const connect = el.querySelector<HTMLButtonElement>(".yui-start__connect")!;
  const checking = el.querySelector<HTMLElement>(".yui-start__checking")!;
  const error = el.querySelector<HTMLElement>(".yui-start__err")!;
  const errorText = el.querySelector<HTMLElement>(".yui-start__err-text")!;
  const reopen = el.querySelector<HTMLElement>(".yui-start__reopen")!;

  const typedKey = (): string => input.value.trim();

  function reflect(): void {
    const url = endpointsUrl();
    const isConnected = url === GEMINI_PRESET.url && deps.chatKeySettings.get().apiKey !== "";
    setup.hidden = isConnected;
    connected.hidden = !isConnected;
    own.hidden = url === "" || url === GEMINI_PRESET.url;
    voiceStep?.reflect();
  }

  function endpointsUrl(): string {
    return (
      deps.endpointsSettings.get().chat_base_url ||
      deps.getEndpointDefaults?.()?.chat_base_url ||
      ""
    );
  }

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
      deps.endpointsSettings.set({
        chat_base_url: GEMINI_PRESET.url,
        chat_model: GEMINI_PRESET.model,
        chat_api: "chat_completions",
      });
      deps.chatKeySettings.setApiKey(typedKey());
      deps.proactiveSettings.setEnabled(false);
      deps.scheduleSettings.setEnabled(false);
      deps.onConnected();
      input.value = "";
      reflect();
    } else if (result.kind === "refused" || (result.kind === "http" && result.status === 400)) {
      // Measured: a bad Gemini key answers HTTP 400 "Please pass a valid API key".
      showError("start.refused", true);
    } else {
      showError("start.failed");
    }
  }

  const read = createModelRead({
    getApiKey: async () => typedKey(),
    getFetch: deps.getFetch,
    onPhase,
  });

  toggle.addEventListener("click", () => toggleKeyReveal(input, toggle, "chatkey"));
  el.querySelector<HTMLButtonElement>(".yui-start__replay")?.addEventListener("click", () =>
    deps.onReplay?.(),
  );
  connect.addEventListener("click", () => {
    error.hidden = true;
    if (typedKey() === "") showError("start.need_key");
    else read.start(GEMINI_PRESET.url);
  });

  reflect();

  return {
    el,
    reflect,
    dispose: () => {
      read.dispose();
      voiceStep?.dispose();
    },
  };
}
