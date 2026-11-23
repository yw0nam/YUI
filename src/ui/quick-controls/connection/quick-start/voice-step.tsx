/**
 * Quick start's voice section: a Fish Audio key page link, the pasted key, and the turn-on pill.
 * One key check confirms the pasted key, and only a confirmed key writes anything — the Fish
 * preset, the key, TTS on, and the app language's default voice as the active speaker.
 */

import { useEffect, useRef, useState } from "react";
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
import { t } from "../../../i18n";
import { FISH_KEY_URL, FISH_PRESET } from "../../constants";
import { KeyLink } from "./key-link";
import { PasteKeyRow, usePasteKey } from "./paste-key-row";
import { turnOnVoice } from "./voice-turn-on";
import "./quick-start.css";

type EndpointsSettingsStore = ReturnType<typeof createEndpointsSettings>;
type SpeakerSelectionStore = ReturnType<typeof createSpeakerSelection>;

interface VoiceStepDeps {
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

/** Reads the stores on every render: the step, a result line, or hidden. */
export function VoiceStep(deps: VoiceStepDeps) {
  const paste = usePasteKey();
  const [checking, setChecking] = useState(false);
  // "Maybe later" hides the step until the panel rebuilds; never persisted.
  const [skipped, setSkipped] = useState(false);
  // The default voice's name once the ok path turned voice on in this window; it keeps voice_is_on over voice_configured.
  const [turnedOnName, setTurnedOnName] = useState<string | null>(null);
  // A completion after unmount, a newer press or "Maybe later" writes nothing.
  const seq = useRef(0);
  const disposed = useRef(false);

  useEffect(() => {
    disposed.current = false;
    return () => {
      disposed.current = true;
    };
  }, []);

  const voices = deps.getDefaultVoices();
  const url =
    deps.endpointsSettings.get().tts_base_url || deps.getEndpointDefaults?.()?.tts_base_url || "";
  const turnedOnHere = turnedOnName !== null;

  function turnOn(key: string): void {
    const name = turnOnVoice(deps, key);
    if (name === null) return;
    setTurnedOnName(name);
    if (paste.inputRef.current) paste.inputRef.current.value = "";
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
      if (result === "refused") paste.showError("start.voice_refused", true);
      else if (result === "failed") paste.showError("start.voice_failed", false);
      else turnOn(key);
    });
  }

  function handleTurn(): void {
    paste.clearError();
    const key = paste.typedKey();
    if (key === "") paste.showError("start.need_key", false);
    else void press(key);
  }

  function handleLater(): void {
    seq.current++;
    setSkipped(true);
  }

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
          <PasteKeyRow
            id="yui-start-voice-key"
            labelKey="start.voice_paste_label"
            actionKey="start.voice_on"
            checkingKey="start.voice_checking"
            keyUrl={FISH_KEY_URL}
            classes={{
              row: "yui-start__voice-paste",
              action: "yui-start__voice-turn",
              checking: "yui-start__voice-checking",
              error: "yui-start__err yui-start__voice-err",
              reopen: "yui-start__voice-reopen",
            }}
            inputRef={paste.inputRef}
            busy={checking}
            error={paste.error}
            onAction={handleTurn}
          />
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
