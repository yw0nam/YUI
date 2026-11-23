/**
 * Quick start's voice section: a Fish Audio key page link, the pasted key, and the turn-on pill.
 * One key check confirms the pasted key, and only a confirmed key writes anything — the Fish
 * preset, the key, TTS on, and the app language's default voice as the active speaker.
 */

import { useEffect, useLayoutEffect, useReducer, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { EndpointsConfig } from "../../../../contract";
import { checkFishKey, type FishKeyCheck } from "../../../../io/voice/voices/fish-key-check";
import type { createSpeakerSelection } from "../../../../io/voice/voices/speaker-selection";
import type { ApiKeySettingsStore } from "../../../../settings/backend/api-key-settings";
import type {
  createEndpointsSettings,
  EndpointOverrides,
} from "../../../../settings/backend/endpoints-settings";
import type { FlagSettingsStore } from "../../../../settings/persisted-store";
import { getLocale, t } from "../../../i18n";
import { CHATKEY_EYE_OFF_SVG, CHATKEY_EYE_SVG, FISH_KEY_URL, FISH_PRESET } from "../../constants";
import { WARN_GLYPH } from "../../glyphs";
import { KeyLink } from "./key-link";
import "./quick-start.css";

type EndpointsSettingsStore = ReturnType<typeof createEndpointsSettings>;
type SpeakerSelectionStore = ReturnType<typeof createSpeakerSelection>;

export interface VoiceStepDeps {
  endpointsSettings: Pick<EndpointsSettingsStore, "get" | "set">;
  /** The bundled config's endpoints, the fallback for an unset TTS URL. */
  getEndpointDefaults?: () => EndpointOverrides | undefined;
  ttsKeySettings: Pick<ApiKeySettingsStore, "setApiKey">;
  ttsSettings: Pick<FlagSettingsStore, "setEnabled">;
  speakerSelection: Pick<SpeakerSelectionStore, "list" | "addUserOption" | "pin">;
  /** The Fish voice per app language, from the bundled config; undefined hides the section. */
  getDefaultVoices: () => NonNullable<EndpointsConfig["tts_default_voices"]> | undefined;
  getFetch: () => Promise<typeof globalThis.fetch | undefined>;
}

interface KeyError {
  textKey: string;
  keyLink: boolean;
}

/** Reads the stores on every render: the step, a result line, or hidden. */
export function VoiceStep(deps: VoiceStepDeps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<KeyError | null>(null);
  const [revealed, setRevealed] = useState(false);
  // "Maybe later" hides the step until the panel rebuilds; never persisted.
  const [skipped, setSkipped] = useState(false);
  // The default voice's name once the ok path turned voice on in this window; it keeps voice_is_on over voice_configured.
  const [turnedOnName, setTurnedOnName] = useState<string | null>(null);
  const [focusRequest, requestFocus] = useReducer((n: number) => n + 1, 0);
  // A completion after unmount, a newer press or "Maybe later" writes nothing.
  const seq = useRef(0);
  const disposed = useRef(false);

  useEffect(() => {
    disposed.current = false;
    return () => {
      disposed.current = true;
    };
  }, []);

  useLayoutEffect(() => {
    if (focusRequest > 0) inputRef.current?.focus();
  }, [focusRequest]);

  const voices = deps.getDefaultVoices();
  const url =
    deps.endpointsSettings.get().tts_base_url || deps.getEndpointDefaults?.()?.tts_base_url || "";
  const turnedOnHere = turnedOnName !== null;

  function showError(textKey: string, keyLink: boolean): void {
    setError({ textKey, keyLink });
    requestFocus();
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
    deps.speakerSelection.pin(voice.id);
    setTurnedOnName(voice.name);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function press(key: string): Promise<void> {
    const mySeq = ++seq.current;
    setChecking(true);
    let result: FishKeyCheck;
    try {
      const fetchImpl = await deps.getFetch();
      if (disposed.current || mySeq !== seq.current) return;
      result = await checkFishKey({ baseUrl: FISH_PRESET.url, key, fetch: fetchImpl });
    } catch {
      result = "failed";
    }
    if (disposed.current || mySeq !== seq.current) return;
    flushSync(() => {
      setChecking(false);
      if (result === "refused") showError("start.voice_refused", true);
      else if (result === "failed") showError("start.voice_failed", false);
      else turnOn(key);
    });
  }

  function handleTurn(): void {
    setError(null);
    const key = inputRef.current?.value.trim() ?? "";
    if (key === "") showError("start.need_key", false);
    else void press(key);
  }

  function handleLater(): void {
    seq.current++;
    setSkipped(true);
  }

  const revealLabel = t(revealed ? "chatkey.hide" : "chatkey.show");

  return (
    <div className="yui-sec yui-start__voice" hidden={voices === undefined}>
      <div className="yui-sec__head">
        <h2 className="yui-sec__title">{t("start.voice_title")}</h2>
      </div>
      <p className="yui-sec__note">{t("start.voice_note")}</p>
      <div className="yui-start__voice-form" hidden={url !== "" || skipped}>
        <div className="yui-group">
          <div className="yui-row">
            <div className="yui-row__main">
              <span className="yui-row__label">{t("start.voice_make_label")}</span>
              <span className="yui-row__sub">{t("start.voice_make_sub")}</span>
            </div>
            <KeyLink
              url={FISH_KEY_URL}
              labelKey="start.voice_make_link"
              className="yui-start__voice-link"
            />
          </div>
          <div className="yui-row yui-chatkey yui-start__voice-paste">
            <div className="yui-row__main">
              <label className="yui-input-row__label" htmlFor="yui-start-voice-key">
                {t("start.voice_paste_label")}
              </label>
            </div>
            <div className="yui-input-wrap yui-chatkey__wrap">
              <input
                ref={inputRef}
                className="yui-ep-input yui-chatkey__input"
                id="yui-start-voice-key"
                type={revealed ? "text" : "password"}
                placeholder={t("start.paste_placeholder")}
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                disabled={checking}
              />
              <button
                className="yui-iconbtn yui-chatkey__toggle"
                type="button"
                aria-pressed={revealed}
                aria-label={revealLabel}
                data-tip={revealLabel}
                onClick={() => setRevealed((shown) => !shown)}
                // biome-ignore lint/security/noDangerouslySetInnerHtml: a constant glyph shared with the key rows
                dangerouslySetInnerHTML={{
                  __html: revealed ? CHATKEY_EYE_OFF_SVG : CHATKEY_EYE_SVG,
                }}
              />
            </div>
            <button
              className="yui-pill yui-pill--ok yui-start__voice-turn"
              type="button"
              disabled={checking}
              onClick={handleTurn}
            >
              {t("start.voice_on")}
            </button>
            <p className="yui-start__voice-checking" role="status" hidden={!checking}>
              <i className="yui-start__dot" />
              {t("start.voice_checking")}
            </p>
            <div className="yui-start__err yui-start__voice-err" role="alert" hidden={!error}>
              {WARN_GLYPH}
              <div>
                <span className="yui-start__err-text">{error ? t(error.textKey) : ""}</span>{" "}
                <KeyLink
                  url={FISH_KEY_URL}
                  labelKey="start.reopen"
                  className="yui-start__voice-reopen"
                  hidden={!error?.keyLink}
                />
              </div>
            </div>
          </div>
        </div>
        <button className="yui-link-btn yui-start__voice-later" type="button" onClick={handleLater}>
          {t("start.voice_later")}
        </button>
      </div>
      <p className="yui-start__voice-is-on" role="status" hidden={!(url !== "" && turnedOnHere)}>
        {turnedOnName === null ? "" : t("start.voice_is_on", { name: turnedOnName })}
      </p>
      <p className="yui-start__voice-skipped" hidden={url !== "" || !skipped}>
        {t("start.voice_skipped")}
      </p>
      <p className="yui-start__voice-configured" hidden={url === "" || turnedOnHere}>
        {t("start.voice_configured")}
      </p>
    </div>
  );
}
