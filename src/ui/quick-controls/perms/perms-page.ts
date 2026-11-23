/** The Permissions page: its view, and when the monitor list loads. */

import { createElement } from "react";
import type { ScreenSourceProvider } from "../../../io/window/capture/screen-source-provider";
import type { Logger } from "../../../logger";
import type { createScreenshotSettings } from "../../../settings/capture/screenshot-settings";
import { type PageView, pageStack } from "../page-view";
import { createMonitorLoad } from "./monitors/monitor-load";
import { PermsPageView } from "./perms-page-view";

type ScreenshotSettingsStore = ReturnType<typeof createScreenshotSettings>;

export interface PermsPage extends PageView {
  /** Loads the monitor list once, when screenshot attach is on. */
  loadMonitorsIfEnabled(): void;
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
  const onSettingsChange = (): void => {
    if (isOpen()) loadMonitorsIfEnabled();
  };

  return {
    view: () =>
      pageStack(() => createElement(PermsPageView, { settings, monitors, log, onSettingsChange })),
    loadMonitorsIfEnabled,
  };
}
