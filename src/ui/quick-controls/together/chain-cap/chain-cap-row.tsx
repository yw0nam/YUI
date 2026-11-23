/** The chain cap row: a NumberField over the bundled default. */

import { useSyncExternalStore } from "react";
import {
  type GuardrailsSettingsStore,
  RATE_LIMIT_MAX,
  type RateLimitDefaults,
} from "../../../../settings/backend/guardrails-settings";
import { NumberField } from "../../../controls/number-field";
import { t } from "../../../i18n";
import { CHAIN_CAP_FIELD } from "../../constants";

export function ChainCapRow({
  store,
  defaults,
}: {
  store: GuardrailsSettingsStore;
  defaults?: RateLimitDefaults;
}) {
  const override = useSyncExternalStore(store.subscribe, () => store.current().addressed_chain_max);
  const effective = override > 0 ? override : (defaults?.addressed_chain_max ?? 0);
  return (
    <div className="yui-row">
      <div className="yui-row__main">
        <label className="yui-input-row__label" htmlFor={CHAIN_CAP_FIELD.id}>
          {t(CHAIN_CAP_FIELD.labelKey)}
        </label>
        <span className="yui-input-row__sub">{t(CHAIN_CAP_FIELD.subKey)}</span>
      </div>
      <NumberField
        id={CHAIN_CAP_FIELD.id}
        value={effective > 0 ? effective : null}
        min={1}
        max={RATE_LIMIT_MAX}
        onCommit={(next) => store.set({ addressed_chain_max: Math.round(next ?? 0) })}
      />
    </div>
  );
}
