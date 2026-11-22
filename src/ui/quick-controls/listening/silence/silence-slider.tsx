/** The silence threshold slider of the Listening page: it drives the vad store and shows the wait. */

import {
  type CSSProperties,
  type FocusEvent,
  type FormEvent,
  type PointerEvent,
  useSyncExternalStore,
} from "react";
import type { Logger } from "../../../../logger";
import type { createVadSettings } from "../../../../settings/voice/vad-settings";
import { VAD_SILENCE_MAX, VAD_SILENCE_MIN } from "../../../../settings/voice/vad-settings";
import { t } from "../../../i18n";

type VadSettingsStore = ReturnType<typeof createVadSettings>;

export function SilenceSlider({ vad, log }: { vad: VadSettingsStore; log: Logger }) {
  const silenceMs = useSyncExternalStore(vad.subscribe, () => vad.current().silenceMs);

  function handleInput(event: FormEvent<HTMLInputElement>): void {
    vad.setSilenceMs(parseInt(event.currentTarget.value, 10));
  }

  function handleEnd(event: FocusEvent<HTMLInputElement> | PointerEvent<HTMLInputElement>): void {
    log.info("vad_silence_change", { silenceMs: parseInt(event.currentTarget.value, 10) });
  }

  const fill = String((silenceMs - VAD_SILENCE_MIN) / (VAD_SILENCE_MAX - VAD_SILENCE_MIN));

  return (
    <div className="yui-gain">
      <div className="yui-gain__head">
        <span className="yui-gain__label">{t("voice_input.silence_label")}</span>
        <span className="yui-gain__value yui-vad__value">{`${silenceMs} ms`}</span>
      </div>
      <span className="yui-gain__sub">{t("voice_input.silence_sub")}</span>
      <input
        className="yui-gain__slider yui-vad__slider"
        type="range"
        aria-label={t("voice_input.silence_aria")}
        min={VAD_SILENCE_MIN}
        max={VAD_SILENCE_MAX}
        step={50}
        value={silenceMs}
        style={{ "--fill": fill } as CSSProperties}
        onInput={handleInput}
        onPointerUp={handleEnd}
        onBlur={handleEnd}
      />
    </div>
  );
}
