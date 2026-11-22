/** The mouth-gain section: the lipsync gain slider, its readout, and its live preview on the avatar. */

import { useSyncExternalStore } from "react";
import type { Logger } from "../../../../logger";
import { LIPSYNC_GAIN_MAX, LIPSYNC_GAIN_MIN } from "../../../../settings/avatar/lipsync-settings";
import { Slider } from "../../../controls/slider";
import { t } from "../../../i18n";
import type { MotionPorts } from "../motion-ports";
import type { GainPreview } from "./gain-preview";

const EYE_ICON = (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path
      d="M4 10c2.4-2.4 4.9-3.6 8-3.6s5.6 1.2 8 3.6c-2.4 1.1-4.9 1.7-8 1.7s-5.6-.6-8-1.7Z"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
    />
    <path
      d="M4 14c2.4 2.4 4.9 3.6 8 3.6s5.6-1.2 8-3.6c-2.4-1.1-4.9-1.7-8-1.7s-5.6.6-8 1.7Z"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
    />
  </svg>
);

export function GainRow({
  lipsync,
  preview,
  log,
}: {
  lipsync: MotionPorts["lipsync"];
  preview: GainPreview;
  log: Logger;
}) {
  const gain = useSyncExternalStore(lipsync.subscribe, () => lipsync.current().gain);

  function end(): void {
    preview.end();
    log.info("mouth_gain_change", { gain: lipsync.current().gain });
  }

  return (
    <div className="yui-sec">
      <div className="yui-sec__head">
        <h2 className="yui-sec__title">{t("expression.section")}</h2>
      </div>
      <div className="yui-group">
        <div className="yui-gain">
          <div className="yui-gain__head">
            <span className="yui-gain__label">
              {EYE_ICON}
              {t("expression.mouth_label")}
            </span>
            <span className="yui-gain__value yui-lipsync-gain__value">{`${gain.toFixed(1)}×`}</span>
          </div>
          <span className="yui-gain__sub">{t("expression.mouth_sub")}</span>
          <Slider
            className="yui-lipsync-gain__slider"
            label={t("expression.mouth_aria")}
            min={LIPSYNC_GAIN_MIN}
            max={LIPSYNC_GAIN_MAX}
            step={0.1}
            value={gain}
            onValueChange={(next) => {
              lipsync.setGain(next);
              preview.show(next);
            }}
            // A keyboard step commits at once, so its preview lasts until blur.
            onValueCommitted={(_next, reason) => {
              if (reason !== "keyboard" && reason !== "input-change") end();
            }}
            onBlur={end}
          />
          <span className="yui-gain__hint">{t("expression.mouth_hint")}</span>
        </div>
      </div>
    </div>
  );
}
