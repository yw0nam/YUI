/** How often she speaks up: the device-wide base pace over her day, its foot line, and the link to Persona › Active hours. */

import { useSyncExternalStore } from "react";
import type {
  BasePace,
  BasePaceSettingsStore,
} from "../../../../settings/active-hours/base-pace-settings";
import { Segment } from "../../../controls/segment/segment";
import { t } from "../../../i18n";
import { DayStrip } from "./day-strip";
import "./pace-section.css";

const PACES: readonly BasePace[] = ["low", "normal", "high"];

export function PaceSection({
  basePaceSettings,
  openPersona,
  ...day
}: { basePaceSettings: BasePaceSettingsStore; openPersona(): void } & Omit<
  Parameters<typeof DayStrip>[0],
  "pace"
>) {
  const pace = useSyncExternalStore(basePaceSettings.subscribe, () => basePaceSettings.get().pace);
  return (
    <div className="yui-sec">
      <div className="yui-sec__head">
        <h2 className="yui-sec__title">{t("base_pace.title")}</h2>
      </div>
      <Segment
        className="yui-base-pace-seg"
        options={PACES.map((value) => ({ value, label: t(`active_hours.pace_${value}`) }))}
        value={pace}
        label={t("base_pace.title")}
        onValueChange={basePaceSettings.setPace}
      />
      <DayStrip pace={pace} {...day} />
      <p className="yui-sec__foot">{t("base_pace.foot")}</p>
      <p className="yui-sec__foot">
        {t("base_pace.link_lead")}{" "}
        <button className="yui-link-btn yui-base-pace__link" type="button" onClick={openPersona}>
          {t("base_pace.link")}
        </button>
      </p>
    </div>
  );
}
