/** The Listening page: the voice switch, the STT key, the silence threshold, barge-in, the bubble row and the reading dictionary. */

import { type ReactNode, useSyncExternalStore } from "react";
import type { Logger } from "../../../logger";
import type { ApiKeySettingsStore } from "../../../settings/backend/api-key-settings";
import type { FlagSettingsStore } from "../../../settings/persisted-store";
import type { createReadingsSettings } from "../../../settings/voice/readings-settings";
import type { createVadSettings } from "../../../settings/voice/vad-settings";
import type { VoiceInputStatus } from "../../chips/voice-input-status";
import { Switch } from "../../controls/switch";
import { t } from "../../i18n";
import { KeyRow, type KeyRowCommit } from "../sections/key-row/key-row";
import { ReadingsSection } from "./readings/readings-section";
import { SilenceSlider } from "./silence/silence-slider";

type VadSettingsStore = ReturnType<typeof createVadSettings>;
type ReadingsSettingsStore = ReturnType<typeof createReadingsSettings>;

const MIC_ICON = (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M12 4.5v7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <path
      d="M8 9.5v1.8a4 4 0 0 0 8 0V9.5"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
    <path d="M12 15.5v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <path d="M9.5 18.5h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

function SwitchRow(props: {
  className: string;
  label: string;
  aria: string;
  sub?: string;
  icon?: ReactNode;
  checked: boolean;
  onCheckedChange(checked: boolean): void;
}) {
  return (
    <div className="yui-row">
      <div className="yui-row__main">
        <span className="yui-row__label">
          {props.icon}
          {props.label}
        </span>
        {props.sub === undefined ? null : <span className="yui-row__sub">{props.sub}</span>}
      </div>
      <Switch
        className={props.className}
        label={props.aria}
        checked={props.checked}
        onCheckedChange={props.onCheckedChange}
      />
    </div>
  );
}

function VoiceRow({ voiceStatus, log }: { voiceStatus: VoiceInputStatus; log: Logger }) {
  const on = useSyncExternalStore(voiceStatus.subscribe, () => voiceStatus.get().state !== "idle");
  return (
    <SwitchRow
      className="yui-voice-switch"
      label={t("voice_input.label")}
      aria={t("voice_input.label")}
      sub={t("voice_input.sub")}
      icon={MIC_ICON}
      checked={on}
      onCheckedChange={(next) => {
        log.info("voice_input_toggle", { on: next });
        voiceStatus.set(next ? "listening" : "idle");
      }}
    />
  );
}

function BargeInRow({ vad, log }: { vad: VadSettingsStore; log: Logger }) {
  const on = useSyncExternalStore(vad.subscribe, () => vad.current().bargeIn);
  return (
    <SwitchRow
      className="yui-bargein-switch"
      label={t("voice_input.bargein_label")}
      aria={t("voice_input.bargein_aria")}
      checked={on}
      onCheckedChange={(next) => {
        vad.setBargeIn(next);
        log.info("bargein_toggle", { enabled: next });
      }}
    />
  );
}

function BubbleRow({ store, log }: { store: FlagSettingsStore; log: Logger }) {
  const on = useSyncExternalStore(store.subscribe, () => store.current().enabled);
  return (
    <SwitchRow
      className="yui-bubble-persist-switch"
      label={t("bubble_persist.label")}
      aria={t("bubble_persist.aria")}
      sub={t("bubble_persist.sub")}
      checked={on}
      onCheckedChange={(next) => {
        store.setEnabled(next);
        log.info("bubble_persist_toggle", { enabled: next });
      }}
    />
  );
}

export function ListeningPageView({
  showVoiceInput,
  voiceStatus,
  vad,
  sttKeySettings,
  readingsSettings,
  bubblePersistSettings,
  log,
  sttKeyCommit,
}: {
  showVoiceInput: boolean;
  voiceStatus: VoiceInputStatus;
  vad: VadSettingsStore;
  sttKeySettings: ApiKeySettingsStore;
  readingsSettings: ReadingsSettingsStore;
  bubblePersistSettings?: FlagSettingsStore;
  log: Logger;
  sttKeyCommit: KeyRowCommit;
}) {
  return (
    <>
      <div className="yui-sec">
        <div className="yui-group">
          {showVoiceInput ? <VoiceRow voiceStatus={voiceStatus} log={log} /> : null}
          <KeyRow idPrefix="sttkey" store={sttKeySettings} log={log} commit={sttKeyCommit} />
          <SilenceSlider vad={vad} log={log} />
          <BargeInRow vad={vad} log={log} />
          {bubblePersistSettings ? <BubbleRow store={bubblePersistSettings} log={log} /> : null}
        </div>
      </div>
      <ReadingsSection store={readingsSettings} />
    </>
  );
}
