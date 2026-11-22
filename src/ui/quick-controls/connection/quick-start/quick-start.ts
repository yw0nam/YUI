/** Quick start: the Connection page's free Gemini path, a pasted key confirmed by a model-list read and checked again once stored. */

import type { EndpointsConfig } from "../../../../contract";
import type { ModelListResult } from "../../../../io/chat/models/reader";
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
import {
  INITIAL_KEY_STATE,
  type KeyState,
  keyChecked,
  keyView,
  keyWritten,
  openKey,
} from "./key-state";
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
        <div class="yui-group yui-start__keys">
          <div class="yui-row yui-start__keyrow" hidden>
            <div class="yui-row__main">
              <span class="yui-row__label">${t("start.key_label")}</span>
              <span class="yui-row__sub">${t("start.key_sub")}</span>
            </div>
            <button class="yui-link-btn yui-start__replace" type="button">${t("input.action_change_key")}</button>
          </div>
          <div class="yui-row yui-start__make">
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
            <p class="yui-start__key-ok" role="status" hidden>${t("start.key_ok")}</p>
            <div class="yui-start__err" role="alert" hidden>${ICON_WARN}<div><span class="yui-start__err-text"></span> ${keyLinkHtml(GEMINI_KEY_URL, "start.reopen", "yui-start__reopen")}</div></div>
          </div>
        </div>
      </div>
    </div>
    <div class="yui-start__key-stack" hidden>
      <p class="yui-start__done" role="status">${ICON_DONE}<span class="yui-start__done-text"></span></p>
      <p class="yui-start__rejected" role="alert" hidden>${ICON_WARN}<span>${t("start.key_rejected")}</span></p>
    </div>
    <div class="yui-start__connected" hidden>
      ${showHelp ? helpSectionHtml(replayRow) : ""}
    </div>`;
}

// A stored-key check answer is reused on the same key for this long.
const CHECK_REUSE_MS = 60_000;

/** A refused key: a 401 or 403, or the HTTP 400 Gemini answers for a bad key. */
function isRefused(result: ModelListResult): boolean {
  return result.kind === "refused" || (result.kind === "http" && result.status === 400);
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
  /** The key field here is the server's in use: no server yet, or the Quick start one. Quick start's Connect replaces any other server. */
  holdsKey(): boolean;
  /** Opens the key field, in the connected state too, and focuses it. */
  focusKey(): void;
  /** The view came into view: once connected, checks the stored key. */
  entered(): void;
  /** The window came back to the front: checks the stored key while this view is in view. */
  windowFocused(): void;
  dispose(): void;
} {
  const el = document.createElement("div");
  el.className = "yui-tab-stack";
  el.innerHTML = pageHtml(deps.showHelp, deps.onReplay ? replayRowHtml() : "");
  const setup = el.querySelector<HTMLElement>(".yui-start__setup")!;
  const keys = el.querySelector<HTMLElement>(".yui-start__keys")!;
  const keySection = keys.parentElement!;
  const keyRow = el.querySelector<HTMLElement>(".yui-start__keyrow")!;
  const replace = el.querySelector<HTMLButtonElement>(".yui-start__replace")!;
  const makeRow = el.querySelector<HTMLElement>(".yui-start__make")!;
  const paste = el.querySelector<HTMLElement>(".yui-start__paste")!;
  const keyStack = el.querySelector<HTMLElement>(".yui-start__key-stack")!;
  const done = el.querySelector<HTMLElement>(".yui-start__done")!;
  const doneText = el.querySelector<HTMLElement>(".yui-start__done-text")!;
  const rejectedLine = el.querySelector<HTMLElement>(".yui-start__rejected")!;
  const keyOk = el.querySelector<HTMLElement>(".yui-start__key-ok")!;
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
  let state: KeyState = INITIAL_KEY_STATE;

  const isConnected = (): boolean =>
    endpointsUrl() === GEMINI_PRESET.url && deps.chatKeySettings.get().apiKey !== "";

  function reflect(): void {
    const url = endpointsUrl();
    const on = isConnected();
    if (!on) state = INITIAL_KEY_STATE;
    setup.hidden = on;
    keyStack.hidden = !on;
    connected.hidden = !on;
    // Moved only on a state change: re-appending would drop focus from the key field.
    const home = on ? keyStack : keySection;
    if (keys.parentElement !== home) home.append(keys);
    const view = keyView(state, on);
    keyRow.hidden = !view.keyRow;
    replace.hidden = !view.replaceButton;
    makeRow.hidden = !view.makeRow;
    paste.hidden = !view.paste;
    done.hidden = !view.done;
    rejectedLine.hidden = !view.rejected;
    keyOk.hidden = !view.keyOk;
    doneText.textContent = t(view.doneText);
    own.hidden = url === "" || url === GEMINI_PRESET.url;
    voiceStep?.reflect();
  }

  function focusKey(): void {
    if (isConnected()) {
      state = openKey(state);
      entered();
    }
    reflect();
    input.focus();
  }

  function entered(): void {
    if (!isConnected()) return;
    const key = deps.chatKeySettings.get().apiKey;
    if (lastVerdict?.key === key && Date.now() - lastVerdict.at < CHECK_REUSE_MS) {
      showVerdict(lastVerdict.ok);
    } else check.start(GEMINI_PRESET.url);
  }

  function showVerdict(ok: boolean): void {
    state = keyChecked(state, ok);
    reflect();
    if (!ok) input.focus();
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
      const wasConnected = isConnected();
      if (wasConnected) {
        deps.chatKeySettings.setApiKey(typedKey());
      } else {
        deps.endpointsSettings.set({
          chat_base_url: GEMINI_PRESET.url,
          chat_model: GEMINI_PRESET.model,
          chat_api: "chat_completions",
        });
        deps.chatKeySettings.setApiKey(typedKey());
        deps.proactiveSettings.setEnabled(false);
        deps.scheduleSettings.setEnabled(false);
        deps.onConnected();
      }
      input.value = "";
      state = keyWritten(wasConnected);
      reflect();
    } else if (isRefused(result)) {
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

  // The key the stored-key check sent; its answer counts only while that key is still the stored one.
  let checkedKey = "";
  // The last answer on a key: a burst of window focus events sends one request.
  let lastVerdict: { key: string; at: number; ok: boolean } | null = null;
  const check = createModelRead({
    getApiKey: async () => (checkedKey = deps.chatKeySettings.get().apiKey),
    getFetch: deps.getFetch,
    onPhase: (phase) => {
      if (phase.phase !== "done" || checkedKey !== deps.chatKeySettings.get().apiKey) return;
      // A network failure says nothing about the key, so the view stays as it is.
      const { result } = phase;
      if (result.kind !== "ok" && !isRefused(result)) return;
      lastVerdict = { key: checkedKey, at: Date.now(), ok: result.kind === "ok" };
      showVerdict(lastVerdict.ok);
    },
  });

  replace.addEventListener("click", () => {
    state = openKey(state);
    reflect();
    input.focus();
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
    holdsKey: () => endpointsUrl() === "" || endpointsUrl() === GEMINI_PRESET.url,
    focusKey,
    entered,
    windowFocused: () => {
      if (!el.closest("[hidden]")) entered();
    },
    dispose: () => {
      check.dispose();
      read.dispose();
      voiceStep?.dispose();
    },
  };
}
