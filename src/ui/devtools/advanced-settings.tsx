/** The Advanced panel: the context-window limit, saved to the endpoints store when committed. */

import { useSyncExternalStore } from "react";
import type { createEndpointsSettings } from "../../settings/backend/endpoints-settings";
import { NumberField } from "../controls/number-field";
import { t } from "../i18n";

const CONTEXT_WINDOW_ID = "devtools-context-window";

export function AdvancedSettings({
  endpoints,
  defaultContextWindow,
}: {
  endpoints: ReturnType<typeof createEndpointsSettings>;
  /** The configured value, shown while the field is empty. */
  defaultContextWindow?: number;
}) {
  const stored = useSyncExternalStore(
    endpoints.subscribe,
    () => endpoints.get().chat_model_context_window,
  );
  return (
    <>
      <h2 className="devtools-section-title">{t("devtools.advanced.limits")}</h2>
      <div className="yui-row">
        <div className="yui-row__main">
          <label className="yui-row__label" htmlFor={CONTEXT_WINDOW_ID}>
            {t("devtools.advanced.context_window_label")}
          </label>
          <span className="yui-row__sub">{t("devtools.advanced.context_window_sub")}</span>
        </div>
        <NumberField
          id={CONTEXT_WINDOW_ID}
          value={stored === "" ? null : Number(stored)}
          min={1}
          placeholder={
            defaultContextWindow?.toString() ?? t("devtools.advanced.context_window_default")
          }
          onCommit={(next) =>
            endpoints.set({ chat_model_context_window: next === null ? "" : String(next) })
          }
        />
      </div>
    </>
  );
}
