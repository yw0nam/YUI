/** The Permissions page: its React root, and when the monitor list loads. */

import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { ScreenSourceProvider } from "../../../io/window/capture/screen-source-provider";
import type { Logger } from "../../../logger";
import type { createScreenshotSettings } from "../../../settings/capture/screenshot-settings";
import { createMonitorLoad } from "./monitors/monitor-load";
import { PermsPageView } from "./perms-page-view";

type ScreenshotSettingsStore = ReturnType<typeof createScreenshotSettings>;

export interface PermsPage {
  el: HTMLElement;
  /** Loads the monitor list once, when screenshot attach is on. */
  loadMonitorsIfEnabled(): void;
  dispose(): void;
}

export function createPermsPage(deps: {
  settings: ScreenshotSettingsStore;
  sourceProvider: ScreenSourceProvider;
  log: Logger;
  /** Whether the panel is open; a store change loads the list only then. */
  isOpen: () => boolean;
}): PermsPage {
  const { settings, sourceProvider, log, isOpen } = deps;
  const el = document.createElement("div");
  el.className = "yui-tab-stack";
  const monitors = createMonitorLoad({ sourceProvider, log });
  const root = createRoot(el);
  flushSync(() => root.render(createElement(PermsPageView, { settings, monitors, log })));

  function loadMonitorsIfEnabled(): void {
    if (settings.current().enabled && !monitors.isLoaded()) void monitors.load();
  }

  const unsubscribe = settings.subscribe(() => {
    if (isOpen()) loadMonitorsIfEnabled();
  });

  return {
    el,
    loadMonitorsIfEnabled,
    dispose(): void {
      unsubscribe();
      root.unmount();
    },
  };
}
