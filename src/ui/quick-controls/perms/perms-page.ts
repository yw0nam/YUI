/** The Permissions page: its view, and when the monitor list loads. */

import { createElement, type ReactNode, useEffect } from "react";
import type { ScreenSourceProvider } from "../../../io/window/capture/screen-source-provider";
import type { Logger } from "../../../logger";
import type { createScreenshotSettings } from "../../../settings/capture/screenshot-settings";
import { createMonitorLoad, type MonitorLoad } from "./monitors/monitor-load";
import { PermsPageView } from "./perms-page-view";

type ScreenshotSettingsStore = ReturnType<typeof createScreenshotSettings>;

export interface PermsPage {
  /** The page's view; the panel calls it in each of its renders, so a rail switch reaches the page. */
  view(): ReactNode;
  /** Loads the monitor list once, when screenshot attach is on. */
  loadMonitorsIfEnabled(): void;
}

/** The view, and a store change that loads the list while the panel is open. */
function PermsPage(p: {
  settings: ScreenshotSettingsStore;
  monitors: MonitorLoad;
  log: Logger;
  onChange(): void;
}) {
  const { settings, monitors, log, onChange } = p;
  useEffect(() => settings.subscribe(onChange), [settings, onChange]);
  return createElement(PermsPageView, { settings, monitors, log });
}

export function createPermsPage(deps: {
  settings: ScreenshotSettingsStore;
  sourceProvider: ScreenSourceProvider;
  log: Logger;
  /** Whether the panel is open; a store change loads the list only then. */
  isOpen: () => boolean;
}): PermsPage {
  const { settings, sourceProvider, log, isOpen } = deps;
  const monitors = createMonitorLoad({ sourceProvider, log });

  function loadMonitorsIfEnabled(): void {
    if (settings.current().enabled && !monitors.isLoaded()) void monitors.load();
  }
  const onChange = (): void => {
    if (isOpen()) loadMonitorsIfEnabled();
  };

  return {
    view: () =>
      createElement(
        "div",
        { className: "yui-tab-stack" },
        createElement(PermsPage, { settings, monitors, log, onChange }),
      ),
    loadMonitorsIfEnabled,
  };
}
