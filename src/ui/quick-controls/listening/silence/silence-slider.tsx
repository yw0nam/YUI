/** The silence threshold slider of the Listening page: it drives the vad store and shows the wait. */

import { useSyncExternalStore } from "react";
import type { Logger } from "../../../../logger";
import type { createVadSettings } from "../../../../settings/voice/vad-settings";
import { VAD_SILENCE_MAX, VAD_SILENCE_MIN } from "../../../../settings/voice/vad-settings";
import { Slider } from "../../../controls/slider";
import { t } from "../../../i18n";

type VadSettingsStore = ReturnType<typeof createVadSettings>;

export function SilenceSlider({ vad, log }: { vad: VadSettingsStore; log: Logger }) {
  const silenceMs = useSyncExternalStore(vad.subscribe, () => vad.current().silenceMs);

  return (
    <div className="yui-gain">
      <div className="yui-gain__head">
        <span className="yui-gain__label">{t("voice_input.silence_label")}</span>
        <span className="yui-gain__value yui-vad__value">{`${silenceMs} ms`}</span>
      </div>
      <span className="yui-gain__sub">{t("voice_input.silence_sub")}</span>
      <Slider
        className="yui-vad__slider"
        label={t("voice_input.silence_aria")}
        min={VAD_SILENCE_MIN}
        max={VAD_SILENCE_MAX}
        step={50}
        value={silenceMs}
        onValueChange={(next) => vad.setSilenceMs(next)}
        onValueCommitted={(next) => log.info("vad_silence_change", { silenceMs: next })}
      />
    </div>
  );
}
