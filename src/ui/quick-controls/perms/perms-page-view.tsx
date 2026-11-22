/** The Permissions page: the screenshot attach and screen request switches, and the screen source list under the first. */

import { type ReactNode, useSyncExternalStore } from "react";
import type { Logger } from "../../../logger";
import type { createScreenshotSettings } from "../../../settings/capture/screenshot-settings";
import { Switch } from "../../controls/switch";
import { t } from "../../i18n";
import { MonitorList } from "./monitors/monitor-list";
import type { MonitorLoad } from "./monitors/monitor-load";

type ScreenshotSettingsStore = ReturnType<typeof createScreenshotSettings>;

const SCREEN_ICON = (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <rect x="3" y="5" width="18" height="13" rx="2" stroke="currentColor" strokeWidth="1.5" />
    <path d="M3 9h18" stroke="currentColor" strokeWidth="1.5" />
  </svg>
);

function SwitchRow(props: {
  label: string;
  sub: string;
  checked: boolean;
  onCheckedChange(checked: boolean): void;
  className: string;
}) {
  return (
    <div className="yui-row">
      <div className="yui-row__main">
        <span className="yui-row__label">
          {SCREEN_ICON}
          {props.label}
        </span>
        <span className="yui-row__sub">{props.sub}</span>
      </div>
      <Switch
        className={props.className}
        label={props.label}
        checked={props.checked}
        onCheckedChange={props.onCheckedChange}
      />
    </div>
  );
}

export function PermsPageView({
  settings,
  monitors,
  log,
}: {
  settings: ScreenshotSettingsStore;
  monitors: MonitorLoad;
  log: Logger;
}): ReactNode {
  const enabled = useSyncExternalStore(settings.subscribe, () => settings.current().enabled);
  const allowed = useSyncExternalStore(settings.subscribe, () => settings.current().allowRequests);
  return (
    <div className="yui-sec">
      <div className="yui-group">
        <SwitchRow
          className="yui-screenshot-switch"
          label={t("screenshot.label")}
          sub={t(enabled ? "screenshot.foot_on" : "screenshot.foot_off")}
          checked={enabled}
          onCheckedChange={(on) => {
            settings.setEnabled(on);
            log.info("screenshot_attach_toggle", { enabled: on });
            if (on && !monitors.isLoaded()) void monitors.load();
          }}
        />
        <div className="yui-stack yui-source" data-on={enabled}>
          <span className="yui-row__label">{t("screenshot.source_label")}</span>
          <MonitorList settings={settings} monitors={monitors} />
        </div>
        <SwitchRow
          className="yui-screenshot-requests-switch"
          label={t("screenshot.request_label")}
          sub={t(allowed ? "screenshot.request_foot_on" : "screenshot.request_foot_off")}
          checked={allowed}
          onCheckedChange={(on) => {
            settings.setAllowRequests(on);
            log.info("screenshot_request_toggle", { allowed: on });
          }}
        />
      </div>
    </div>
  );
}
