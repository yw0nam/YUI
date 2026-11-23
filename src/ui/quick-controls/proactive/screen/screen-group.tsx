/** Screen changes: the four screen-watch knobs, their effective values in the fold summary, and the foot. */

import { useSyncExternalStore } from "react";
import type { Logger } from "../../../../logger";
import type {
  ScreenKnobSettingsStore,
  ScreenOverrides,
} from "../../../../settings/capture/screen-settings";
import { t } from "../../../i18n";
import { SCREEN_KNOB_FIELDS } from "../../constants";
import type { SwitchRow } from "../../switch-row";
import { NumberRow } from "../number-row";
import { SourceGroup } from "../source-group";

/** The override when set, else the bundled default, else 0. */
const effective = (
  overrides: Readonly<ScreenOverrides>,
  defaults: ScreenOverrides | undefined,
  key: keyof ScreenOverrides,
): number => (overrides[key] > 0 ? overrides[key] : (defaults?.[key] ?? 0));

export function ScreenGroup({
  row,
  log,
  store,
  defaults,
}: {
  row: SwitchRow;
  log: Logger;
  store: ScreenKnobSettingsStore;
  defaults: ScreenOverrides | undefined;
}) {
  const overrides = useSyncExternalStore(store.subscribe, store.current);
  const aside = SCREEN_KNOB_FIELDS.map((field) => {
    const ms = effective(overrides, defaults, field.key);
    return ms > 0
      ? t("screen.timing_value", { n: Math.round(ms / field.unitMs), unit: t(field.suffixKey) })
      : "";
  })
    .filter(Boolean)
    .join(" · ");

  return (
    <SourceGroup row={row} log={log} title={t("screen.timing")} aside={aside}>
      {SCREEN_KNOB_FIELDS.map((field) => {
        const ms = effective(overrides, defaults, field.key);
        return (
          <NumberRow
            key={field.key}
            id={field.id}
            label={t(field.labelKey)}
            sub={t(field.subKey)}
            min={field.min}
            max={field.max}
            unit={t(field.suffixKey)}
            value={ms > 0 ? Math.round(ms / field.unitMs) : null}
            commit={(typed) => {
              const units =
                typed !== null && typed > 0
                  ? Math.min(Math.max(Math.round(typed), field.min), field.max)
                  : 0;
              store.set({ [field.key]: units * field.unitMs });
            }}
          />
        );
      })}
      <p className="yui-field-hint">{t("screen.foot")}</p>
    </SourceGroup>
  );
}
