/**
 * Quick start's voice section: a Fish Audio key page link, the pasted key, and the turn-on pill.
 * One key check confirms the pasted key, and only a confirmed key writes anything — the Fish
 * preset, the key, TTS on, and the app language's default voice as the active speaker.
 */

import { checkFishKey, type FishKeyCheck } from "../../../../io/voice/voices/fish-key-check";
import type { createSpeakerSelection } from "../../../../io/voice/voices/speaker-selection";
import type { ApiKeySettingsStore } from "../../../../settings/backend/api-key-settings";
import type {
  createEndpointsSettings,
  EndpointOverrides,
} from "../../../../settings/backend/endpoints-settings";
import type { FlagSettingsStore } from "../../../../settings/persisted-store";
import { getLocale, type Locale, t } from "../../../i18n";
import { CHATKEY_EYE_SVG, FISH_KEY_URL, FISH_PRESET } from "../../constants";
import { secHeadHtml } from "../../markup";
import { ICON_WARN } from "../../plugins/plugin-parts";
import { toggleKeyReveal } from "../../sections/key-row/key-row";
import "./quick-start.css";

type EndpointsSettingsStore = ReturnType<typeof createEndpointsSettings>;
type SpeakerSelectionStore = ReturnType<typeof createSpeakerSelection>;

interface VoiceStepDeps {
  endpointsSettings: Pick<EndpointsSettingsStore, "get" | "set">;
  /** The bundled config's endpoints, the fallback for an unset TTS URL. */
  getEndpointDefaults?: () => EndpointOverrides | undefined;
  ttsKeySettings: Pick<ApiKeySettingsStore, "setApiKey">;
  ttsSettings: Pick<FlagSettingsStore, "setEnabled">;
  speakerSelection: Pick<SpeakerSelectionStore, "list" | "addUserOption" | "select">;
  /** The Fish voice per app language, from the bundled config; undefined hides the section. */
  getDefaultVoices: () => Record<Locale, { id: string; name: string }> | undefined;
  getFetch: () => Promise<typeof globalThis.fetch | undefined>;
}

// Tauri's opener plugin opens target=_blank anchors; WebKit's plain Tab skips links without a tabindex.
function fishLinkHtml(labelKey: string, className: string): string {
  return `<a class="yui-chat-type__link ${className}" href="${FISH_KEY_URL}" target="_blank" rel="noopener noreferrer" tabindex="0">${t(labelKey)}</a>`;
}

function pageHtml(): string {
  return `
    <div class="yui-sec yui-start__voice" hidden>
      ${secHeadHtml(t("start.voice_title"))}
      <p class="yui-sec__note">${t("start.voice_note")}</p>
      <div class="yui-start__voice-form">
        <div class="yui-group">
          <div class="yui-row">
            <div class="yui-row__main">
              <span class="yui-row__label">${t("start.voice_make_label")}</span>
              <span class="yui-row__sub">${t("start.voice_make_sub")}</span>
            </div>
            ${fishLinkHtml("start.voice_make_link", "yui-start__voice-link")}
          </div>
          <div class="yui-row yui-chatkey yui-start__voice-paste">
            <div class="yui-row__main">
              <label class="yui-input-row__label" for="yui-start-voice-key">${t("start.voice_paste_label")}</label>
            </div>
            <div class="yui-input-wrap yui-chatkey__wrap">
              <input class="yui-ep-input yui-chatkey__input" id="yui-start-voice-key" type="password" placeholder="${t("start.paste_placeholder")}"
                autocomplete="off" autocapitalize="off" spellcheck="false" />
              <button class="yui-iconbtn yui-chatkey__toggle" type="button" aria-pressed="false" aria-label="${t("chatkey.show")}" data-tip="${t("chatkey.show")}">${CHATKEY_EYE_SVG}</button>
            </div>
            <button class="yui-pill yui-pill--ok yui-start__voice-turn" type="button">${t("start.voice_on")}</button>
            <p class="yui-start__voice-checking" role="status" hidden><i class="yui-start__dot"></i>${t("start.voice_checking")}</p>
            <div class="yui-start__err yui-start__voice-err" role="alert" hidden>${ICON_WARN}<div><span class="yui-start__err-text"></span> ${fishLinkHtml("start.reopen", "yui-start__voice-reopen")}</div></div>
          </div>
        </div>
        <button class="yui-link-btn yui-start__voice-later" type="button">${t("start.voice_later")}</button>
      </div>
      <p class="yui-start__voice-is-on" role="status" hidden></p>
      <p class="yui-start__voice-skipped" hidden>${t("start.voice_skipped")}</p>
      <p class="yui-start__voice-configured" hidden>${t("start.voice_configured")}</p>
    </div>`;
}

export function createVoiceStep(deps: VoiceStepDeps): {
  el: HTMLElement;
  /** Reads the stores onto the section: the step, a result line, or hidden. */
  reflect(): void;
  dispose(): void;
} {
  const root = document.createElement("div");
  root.innerHTML = pageHtml();
  const el = root.firstElementChild as HTMLElement;
  const form = el.querySelector<HTMLElement>(".yui-start__voice-form")!;
  const input = el.querySelector<HTMLInputElement>("#yui-start-voice-key")!;
  const toggle = el.querySelector<HTMLButtonElement>(".yui-chatkey__toggle")!;
  const turn = el.querySelector<HTMLButtonElement>(".yui-start__voice-turn")!;
  const checking = el.querySelector<HTMLElement>(".yui-start__voice-checking")!;
  const error = el.querySelector<HTMLElement>(".yui-start__voice-err")!;
  const errorText = el.querySelector<HTMLElement>(".yui-start__err-text")!;
  const reopen = el.querySelector<HTMLElement>(".yui-start__voice-reopen")!;
  const later = el.querySelector<HTMLButtonElement>(".yui-start__voice-later")!;
  const isOn = el.querySelector<HTMLElement>(".yui-start__voice-is-on")!;
  const skippedLine = el.querySelector<HTMLElement>(".yui-start__voice-skipped")!;
  const configured = el.querySelector<HTMLElement>(".yui-start__voice-configured")!;

  // A completion after dispose, a newer press or "Maybe later" writes nothing.
  let seq = 0;
  let disposed = false;
  // The ok path showed voice_is_on in this window; a later reflect keeps it over voice_configured.
  let turnedOnHere = false;
  // "Maybe later" hides the step until the panel rebuilds; never persisted.
  let skipped = false;

  function showError(textKey: string, withKeyLink: boolean): void {
    errorText.textContent = t(textKey);
    reopen.hidden = !withKeyLink;
    error.hidden = false;
    input.focus();
  }

  function reflect(): void {
    const voices = deps.getDefaultVoices();
    el.hidden = voices === undefined;
    if (!voices) return;
    const url =
      deps.endpointsSettings.get().tts_base_url || deps.getEndpointDefaults?.()?.tts_base_url || "";
    if (url === "") {
      form.hidden = skipped;
      skippedLine.hidden = !skipped;
    } else {
      form.hidden = true;
      skippedLine.hidden = true;
    }
    isOn.hidden = !(url !== "" && turnedOnHere);
    configured.hidden = url === "" || turnedOnHere;
  }

  function turnOn(key: string): void {
    const voices = deps.getDefaultVoices();
    if (!voices) return;
    // The owner switch to fish rides this set: the wired voice-list refresh reads it synchronously.
    deps.endpointsSettings.set({
      tts_provider: "fish",
      tts_base_url: FISH_PRESET.url,
      tts_model: FISH_PRESET.model,
    });
    deps.ttsKeySettings.setApiKey(key);
    deps.ttsSettings.setEnabled(true);
    const voice = voices[getLocale()];
    if (!deps.speakerSelection.list().some((o) => o.id === voice.id)) {
      deps.speakerSelection.addUserOption({
        id: voice.id,
        label: voice.name,
        ref_url: "",
        source: "user",
        provider: "fish",
      });
    }
    deps.speakerSelection.select(voice.id);
    turnedOnHere = true;
    form.hidden = true;
    skippedLine.hidden = true;
    configured.hidden = true;
    isOn.textContent = t("start.voice_is_on", { name: voice.name });
    isOn.hidden = false;
    input.value = "";
  }

  async function press(): Promise<void> {
    const mySeq = ++seq;
    const key = input.value.trim();
    input.disabled = true;
    turn.disabled = true;
    checking.hidden = false;
    let result: FishKeyCheck;
    try {
      const fetchImpl = await deps.getFetch();
      if (disposed || mySeq !== seq) return;
      result = await checkFishKey({ baseUrl: FISH_PRESET.url, key, fetch: fetchImpl });
    } catch {
      result = "failed";
    }
    if (disposed || mySeq !== seq) return;
    input.disabled = false;
    turn.disabled = false;
    checking.hidden = true;
    if (result === "refused") showError("start.voice_refused", true);
    else if (result === "failed") showError("start.voice_failed", false);
    else turnOn(key);
  }

  const onToggle = () => toggleKeyReveal(input, toggle, "chatkey");
  const onTurn = () => {
    error.hidden = true;
    if (input.value.trim() === "") showError("start.need_key", false);
    else void press();
  };
  const onLater = () => {
    seq++;
    skipped = true;
    reflect();
  };
  toggle.addEventListener("click", onToggle);
  turn.addEventListener("click", onTurn);
  later.addEventListener("click", onLater);

  reflect();

  return {
    el,
    reflect,
    dispose: () => {
      disposed = true;
      toggle.removeEventListener("click", onToggle);
      turn.removeEventListener("click", onTurn);
      later.removeEventListener("click", onLater);
    },
  };
}
