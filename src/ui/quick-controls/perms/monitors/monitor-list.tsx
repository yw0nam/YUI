/** The screen source radiogroup: one radio per monitor, or the notice that says why there is none. */

import { useSyncExternalStore } from "react";
import "./monitor-list.css";
import type { createScreenshotSettings } from "../../../../settings/capture/screenshot-settings";
import { t } from "../../../i18n";
import type { MonitorLoad } from "./monitor-load";

type ScreenshotSettingsStore = ReturnType<typeof createScreenshotSettings>;

export function MonitorList({
  settings,
  monitors,
}: {
  settings: ScreenshotSettingsStore;
  monitors: MonitorLoad;
}) {
  const state = useSyncExternalStore(monitors.subscribe, monitors.state);
  const source = useSyncExternalStore(settings.subscribe, () => settings.current().source);
  return (
    <div className="yui-monitors" role="radiogroup" aria-label={t("screenshot.source_aria")}>
      {state.kind === "list" &&
        state.monitors.map((mon) => {
          const name = t("screenshot.display", { n: mon.index + 1 });
          return (
            // biome-ignore lint/a11y/useSemanticElements: a button row styled by the shared radio-row CSS
            <button
              key={mon.index}
              className="yui-mon"
              type="button"
              role="radio"
              aria-checked={source.kind === "monitor" && source.index === mon.index}
              onClick={() =>
                settings.setSource({ kind: "monitor", index: mon.index, label: mon.label ?? name })
              }
            >
              <span className="yui-mon__tick" aria-hidden="true" />
              <span className="yui-mon__body">
                <span className="yui-mon__name">{name}</span>
                {mon.width !== undefined && mon.height !== undefined && (
                  <span className="yui-mon__meta">{`${mon.width} × ${mon.height}`}</span>
                )}
              </span>
              {mon.primary && (
                <span className="yui-mon__badge">{t("screenshot.monitor_primary")}</span>
              )}
            </button>
          );
        })}
      {state.kind === "empty" && (
        <p className="yui-mon__empty" role="status">
          {t("screenshot.monitors_empty")}
        </p>
      )}
      {state.kind === "error" && (
        <p className="yui-mon__error" role="status">
          {t("screenshot.monitors_error")}
        </p>
      )}
    </div>
  );
}
