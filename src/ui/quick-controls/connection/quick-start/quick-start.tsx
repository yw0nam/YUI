/** Quick start: the Connection page's free Gemini path, a pasted key confirmed by a model-list read and checked again once stored. */

import { useEffect, useLayoutEffect, useState } from "react";
import { flushSync } from "react-dom";
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
import { GEMINI_KEY_URL, GEMINI_PRESET } from "../../constants";
import { HelpSection } from "../../general/help/help-section";
import { WARN_GLYPH } from "../../glyphs";
import { createModelRead } from "../chat/model-read";
import { writeGeminiKey } from "./gemini-connect";
import { KeyLink } from "./key-link";
import {
  INITIAL_KEY_STATE,
  type KeyState,
  keyChecked,
  keyView,
  keyWritten,
  openKey,
} from "./key-state";
import { PasteKeyRow, usePasteKey } from "./paste-key-row";
import { createStoredKeyCheck, isRefused } from "./stored-key-check";
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
  const paste = usePasteKey();
  const [keyState, setKeyState] = useState<KeyState>(INITIAL_KEY_STATE);
  const [reading, setReading] = useState(false);

  const [quick] = useState(() => {
    const { typedKey, showError, requestFocus } = paste;
    const endpointsUrl = (): string =>
      deps.endpointsSettings.get().chat_base_url ||
      deps.getEndpointDefaults?.()?.chat_base_url ||
      "";
    const isConnected = (): boolean =>
      endpointsUrl() === GEMINI_PRESET.url && deps.chatKeySettings.get().apiKey !== "";

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
            writeGeminiKey(deps, typedKey(), wasConnected);
            if (paste.inputRef.current) paste.inputRef.current.value = "";
            setKeyState(keyWritten(wasConnected));
          } else if (isRefused(result)) {
            showError("start.refused", true);
          } else {
            showError("start.failed");
          }
        }),
    });

    const check = createStoredKeyCheck({
      getStoredKey: () => deps.chatKeySettings.get().apiKey,
      getFetch: deps.getFetch,
      onVerdict: (ok) => flushSync(() => showVerdict(ok)),
    });

    function entered(): void {
      if (isConnected()) check.run();
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
        paste.clearError();
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

  const url = quick.endpointsUrl();
  const on = quick.isConnected();
  if (!on && keyState !== INITIAL_KEY_STATE) setKeyState(INITIAL_KEY_STATE);
  const view = keyView(on ? keyState : INITIAL_KEY_STATE, on);
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
            paste.requestFocus();
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
      <PasteKeyRow
        id="yui-start-key"
        labelKey="start.paste_label"
        actionKey="start.connect"
        checkingKey="start.checking"
        keyUrl={GEMINI_KEY_URL}
        classes={{
          row: "yui-start__paste",
          action: "yui-start__connect",
          checking: "yui-start__checking",
          error: "yui-start__err",
          reopen: "yui-start__reopen",
        }}
        inputRef={paste.inputRef}
        busy={reading}
        error={paste.error}
        hidden={!view.paste}
        onAction={quick.connect}
      >
        <p className="yui-start__key-ok" role="status" hidden={!view.keyOk}>
          {t("start.key_ok")}
        </p>
      </PasteKeyRow>
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
