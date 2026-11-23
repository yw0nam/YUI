/** Quick start: the Connection page's free Gemini path, a pasted key confirmed by a model-list read and checked again once stored. */

import { useEffect, useLayoutEffect, useReducer, useRef, useState } from "react";
import { flushSync } from "react-dom";
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
import {
  CHATKEY_EYE_OFF_SVG,
  CHATKEY_EYE_SVG,
  GEMINI_KEY_URL,
  GEMINI_PRESET,
} from "../../constants";
import { HelpSection } from "../../general/help/help-section";
import { WARN_GLYPH } from "../../glyphs";
import { createModelRead } from "../chat/model-read";
import { KeyLink } from "./key-link";
import {
  INITIAL_KEY_STATE,
  type KeyState,
  keyChecked,
  keyView,
  keyWritten,
  openKey,
} from "./key-state";
import { VoiceStep } from "./voice-step";
import "./quick-start.css";

const DONE_GLYPH = (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path
      d="m5 12.5 4.5 4.5L19 7.5"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

type SpeakerSelectionStore = ReturnType<typeof createSpeakerSelection>;

export interface QuickStartDeps {
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

/** What the page calls on Quick start; set while it is mounted. */
export interface QuickStartHandle {
  current: {
    /** The key field here is the server's in use: no server yet, or the Quick start one. Quick start's Connect replaces any other server. */
    holdsKey(): boolean;
    /** Opens the key field, in the connected state too, and focuses it. */
    focusKey(): void;
    /** The view came into view: once connected, checks the stored key. */
    entered(): void;
  } | null;
}

// A stored-key check answer is reused on the same key for this long.
const CHECK_REUSE_MS = 60_000;

/** A refused key: a 401 or 403, or the HTTP 400 Gemini answers for a bad key. */
function isRefused(result: ModelListResult): boolean {
  return result.kind === "refused" || (result.kind === "http" && result.status === 400);
}

interface KeyError {
  textKey: string;
  keyLink: boolean;
}

function FactRow({ labelKey, subKey }: { labelKey: string; subKey: string }) {
  return (
    <div className="yui-row">
      <div className="yui-row__main">
        <span className="yui-row__label">{t(labelKey)}</span>
        <span className="yui-row__sub">{t(subKey)}</span>
      </div>
    </div>
  );
}

/** Reads the stores on every render onto the two states: the setup or the connected one. */
export function QuickStart({ handle, ...deps }: QuickStartDeps & { handle: QuickStartHandle }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [keyState, setKeyState] = useState<KeyState>(INITIAL_KEY_STATE);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<KeyError | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [focusRequest, requestFocus] = useReducer((n: number) => n + 1, 0);

  const [quick] = useState(() => {
    const endpointsUrl = (): string =>
      deps.endpointsSettings.get().chat_base_url ||
      deps.getEndpointDefaults?.()?.chat_base_url ||
      "";
    const isConnected = (): boolean =>
      endpointsUrl() === GEMINI_PRESET.url && deps.chatKeySettings.get().apiKey !== "";
    const typedKey = (): string => inputRef.current?.value.trim() ?? "";

    function showError(textKey: string, keyLink = false): void {
      setError({ textKey, keyLink });
      requestFocus();
    }

    function showVerdict(ok: boolean): void {
      setKeyState((state) => keyChecked(state, ok));
      if (!ok) requestFocus();
    }

    const read = createModelRead({
      getApiKey: async () => typedKey(),
      getFetch: deps.getFetch,
      onPhase: (phase) =>
        flushSync(() => {
          setReading(phase.phase === "reading");
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
            if (inputRef.current) inputRef.current.value = "";
            setKeyState(keyWritten(wasConnected));
          } else if (isRefused(result)) {
            showError("start.refused", true);
          } else {
            showError("start.failed");
          }
        }),
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
        const { ok } = lastVerdict;
        flushSync(() => showVerdict(ok));
      },
    });

    function entered(): void {
      if (!isConnected()) return;
      const key = deps.chatKeySettings.get().apiKey;
      if (lastVerdict?.key === key && Date.now() - lastVerdict.at < CHECK_REUSE_MS) {
        showVerdict(lastVerdict.ok);
      } else check.start(GEMINI_PRESET.url);
    }

    return {
      endpointsUrl,
      isConnected,
      read,
      check,
      entered,
      holdsKey: () => endpointsUrl() === "" || endpointsUrl() === GEMINI_PRESET.url,
      focusKey(): void {
        if (isConnected()) {
          setKeyState(openKey);
          entered();
        }
        requestFocus();
      },
      connect(): void {
        setError(null);
        if (typedKey() === "") showError("start.need_key");
        else read.start(GEMINI_PRESET.url);
      },
    };
  });

  useLayoutEffect(() => {
    handle.current = quick;
    return () => {
      handle.current = null;
    };
  }, [handle, quick]);

  useEffect(
    () => () => {
      quick.check.dispose();
      quick.read.dispose();
    },
    [quick],
  );

  useLayoutEffect(() => {
    if (focusRequest > 0) inputRef.current?.focus();
  }, [focusRequest]);

  const url = quick.endpointsUrl();
  const on = quick.isConnected();
  if (!on && keyState !== INITIAL_KEY_STATE) setKeyState(INITIAL_KEY_STATE);
  const view = keyView(on ? keyState : INITIAL_KEY_STATE, on);
  const revealLabel = t(revealed ? "chatkey.hide" : "chatkey.show");
  const voiceStep =
    deps.ttsSettings && deps.ttsKeySettings && deps.speakerSelection ? (
      <VoiceStep
        endpointsSettings={deps.endpointsSettings}
        getEndpointDefaults={deps.getEndpointDefaults}
        ttsKeySettings={deps.ttsKeySettings}
        ttsSettings={deps.ttsSettings}
        speakerSelection={deps.speakerSelection}
        getDefaultVoices={deps.getDefaultVoices ?? (() => undefined)}
        getFetch={deps.getFetch}
      />
    ) : null;

  // Rendered under the setup's key section, or under the done line once connected.
  const keys = (
    <div className="yui-group yui-start__keys">
      <div className="yui-row yui-start__keyrow" hidden={!view.keyRow}>
        <div className="yui-row__main">
          <span className="yui-row__label">{t("start.key_label")}</span>
          <span className="yui-row__sub">{t("start.key_sub")}</span>
        </div>
        <button
          className="yui-link-btn yui-start__replace"
          type="button"
          hidden={!view.replaceButton}
          onClick={() => {
            setKeyState(openKey);
            requestFocus();
          }}
        >
          {t("input.action_change_key")}
        </button>
      </div>
      <div className="yui-row yui-start__make" hidden={!view.makeRow}>
        <div className="yui-row__main">
          <span className="yui-row__label">{t("start.make_label")}</span>
          <span className="yui-row__sub">{t("start.make_sub")}</span>
        </div>
        <KeyLink url={GEMINI_KEY_URL} labelKey="start.make_link" className="yui-start__key-link" />
      </div>
      <div className="yui-row yui-chatkey yui-start__paste" hidden={!view.paste}>
        <div className="yui-row__main">
          <label className="yui-input-row__label" htmlFor="yui-start-key">
            {t("start.paste_label")}
          </label>
        </div>
        <div className="yui-input-wrap yui-chatkey__wrap">
          <input
            ref={inputRef}
            className="yui-ep-input yui-chatkey__input"
            id="yui-start-key"
            type={revealed ? "text" : "password"}
            placeholder={t("start.paste_placeholder")}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            disabled={reading}
          />
          <button
            className="yui-iconbtn yui-chatkey__toggle"
            type="button"
            aria-pressed={revealed}
            aria-label={revealLabel}
            data-tip={revealLabel}
            onClick={() => setRevealed((shown) => !shown)}
            // biome-ignore lint/security/noDangerouslySetInnerHtml: a constant glyph shared with the key rows
            dangerouslySetInnerHTML={{ __html: revealed ? CHATKEY_EYE_OFF_SVG : CHATKEY_EYE_SVG }}
          />
        </div>
        <button
          className="yui-pill yui-pill--ok yui-start__connect"
          type="button"
          disabled={reading}
          onClick={quick.connect}
        >
          {t("start.connect")}
        </button>
        <p className="yui-start__checking" role="status" hidden={!reading}>
          <i className="yui-start__dot" />
          {t("start.checking")}
        </p>
        <p className="yui-start__key-ok" role="status" hidden={!view.keyOk}>
          {t("start.key_ok")}
        </p>
        <div className="yui-start__err" role="alert" hidden={!error}>
          {WARN_GLYPH}
          <div>
            <span className="yui-start__err-text">{error ? t(error.textKey) : ""}</span>{" "}
            <KeyLink
              url={GEMINI_KEY_URL}
              labelKey="start.reopen"
              className="yui-start__reopen"
              hidden={!error?.keyLink}
            />
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <div className="yui-tab-stack yui-start__setup" hidden={on}>
        <p className="yui-start__own" hidden={url === "" || url === GEMINI_PRESET.url}>
          {t("start.own_note")}
        </p>
        <div className="yui-sec">
          <div className="yui-sec__head">
            <h2 className="yui-sec__title">{t("start.free_title")}</h2>
          </div>
          <p className="yui-sec__note">{t("start.free_note")}</p>
          <div className="yui-group">
            <FactRow labelKey="start.send_label" subKey="start.send_sub" />
            <FactRow labelKey="start.limit_label" subKey="start.limit_sub" />
          </div>
        </div>
        <div className="yui-sec">
          <div className="yui-sec__head">
            <h2 className="yui-sec__title">{t("start.key_title")}</h2>
          </div>
          {on ? null : keys}
        </div>
      </div>
      <div className="yui-start__key-stack" hidden={!on}>
        <p className="yui-start__done" role="status" hidden={!view.done}>
          {DONE_GLYPH}
          <span className="yui-start__done-text">{t(view.doneText)}</span>
        </p>
        <p className="yui-start__rejected" role="alert" hidden={!view.rejected}>
          {WARN_GLYPH}
          <span>{t("start.key_rejected")}</span>
        </p>
        {on ? keys : null}
      </div>
      <div className="yui-start__connected" hidden={!on}>
        {voiceStep}
        {deps.showHelp ? (
          <HelpSection>
            {deps.onReplay ? (
              <div className="yui-row">
                <div className="yui-row__main">
                  <span className="yui-row__label">{t("help.replay.label")}</span>
                  <span className="yui-row__sub">{t("help.replay.sub")}</span>
                </div>
                <button
                  className="yui-link-btn yui-help-btn yui-start__replay"
                  type="button"
                  aria-label={t("help.replay.aria")}
                  onClick={deps.onReplay}
                >
                  {t("help.replay.action")}
                </button>
              </div>
            ) : null}
          </HelpSection>
        ) : null}
      </div>
    </>
  );
}
