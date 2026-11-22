/** The chain cap row: the override input over the bundled default, committed on change, reflected while unfocused. */

import { useCallback, useEffect, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import {
  type GuardrailsSettingsStore,
  RATE_LIMIT_MAX,
  type RateLimitDefaults,
} from "../../../../settings/backend/guardrails-settings";
import { t } from "../../../i18n";
import { CHAIN_CAP_FIELD } from "../../constants";

/** The row's reflection from its store and the bundled defaults, which the page facade runs on open. */
export interface ChainCapReflect {
  current: (() => void) | null;
}

export function ChainCapRow({
  store,
  getDefaults,
  reflectRef,
}: {
  store: GuardrailsSettingsStore;
  getDefaults?: () => RateLimitDefaults | undefined;
  reflectRef: ChainCapReflect;
}) {
  // The committed override; a change re-renders the row so the effect repaints the input.
  useSyncExternalStore(store.subscribe, () => store.current().addressed_chain_max);
  const inputRef = useRef<HTMLInputElement>(null);

  // The input shows the override or the bundled default, and never overwrites the user's typing.
  const reflect = useCallback(() => {
    const input = inputRef.current;
    if (!input || document.activeElement === input) return;
    const override = store.current().addressed_chain_max;
    const effective = override > 0 ? override : (getDefaults?.()?.addressed_chain_max ?? 0);
    input.value = effective > 0 ? String(effective) : "";
  }, [store, getDefaults]);

  useLayoutEffect(reflect);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    // The store's validation keeps an out-of-range value's override, and an emptied field clears it.
    const commit = () => {
      store.set({ addressed_chain_max: Math.round(Number(input.value)) });
      reflect();
    };
    input.addEventListener("change", commit);
    input.addEventListener("blur", reflect);
    reflectRef.current = reflect;
    return () => {
      input.removeEventListener("change", commit);
      input.removeEventListener("blur", reflect);
      reflectRef.current = null;
    };
  }, [store, reflect, reflectRef]);

  return (
    <div className="yui-row">
      <div className="yui-row__main">
        <label className="yui-input-row__label" htmlFor={CHAIN_CAP_FIELD.id}>
          {t(CHAIN_CAP_FIELD.labelKey)}
        </label>
        <span className="yui-input-row__sub">{t(CHAIN_CAP_FIELD.subKey)}</span>
      </div>
      <div className="yui-num">
        <input
          ref={inputRef}
          className="yui-num-input"
          id={CHAIN_CAP_FIELD.id}
          type="number"
          min={1}
          max={RATE_LIMIT_MAX}
          inputMode="numeric"
          data-digits={String(RATE_LIMIT_MAX).length}
        />
      </div>
    </div>
  );
}
