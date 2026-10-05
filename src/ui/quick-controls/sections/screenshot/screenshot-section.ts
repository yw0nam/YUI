/**
 * Screenshot section — owns the screenshot-attach switch and the monitor list: the switch node and
 * its click handler, the store subscription, the redraw, and when the monitor list loads.
 */

import type { ScreenSourceProvider } from "../../../../io/window/capture/screen-source-provider";
import type { Logger } from "../../../../logger";
import type { createScreenshotSettings } from "../../../../settings/capture/screenshot-settings";
import { t } from "../../../i18n";
import { createMonitorsSection } from "../monitors/monitors-section";

type ScreenshotSettingsStore = ReturnType<typeof createScreenshotSettings>;

interface ScreenshotSectionDeps {
  /** Panel root (el) — query the switch and the monitor list here; it carries the is-on class. */
  root: HTMLElement;
  /** Screenshot attach on/off and the selected source. */
  settings: ScreenshotSettingsStore;
  /** Provides list of displayable screen sources. */
  sourceProvider: ScreenSourceProvider;
  /** Logger — the switch click and the monitor list failures report here. */
  log: Logger;
  /** Popover open state — the store subscription redraws and loads only while the panel is open. */
  isOpen: () => boolean;
}

interface ScreenshotSection {
  /** Render the switch and its foot text from the store. */
  reflect(): void;
  /** Load the monitor list once, when screenshot attach is on. */
  loadMonitorsIfEnabled(): void;
  /** Permanent teardown — unsubscribe the store and remove the click listener. */
  dispose(): void;
}

export function createScreenshotSection(deps: ScreenshotSectionDeps): ScreenshotSection {
  const { root: el, settings, sourceProvider, log, isOpen } = deps;

  const monitors = createMonitorsSection({ root: el, sourceProvider, settings, log });
  const switchBtn = el.querySelector<HTMLButtonElement>(".yui-screenshot-switch")!;
  const switchSubEl = switchBtn
    .closest(".yui-row")!
    .querySelector<HTMLSpanElement>(".yui-row__sub")!;

  function reflectSettings(): void {
    const s = settings.get();
    const on = s.enabled;
    switchBtn.setAttribute("aria-checked", String(on));
    switchSubEl.textContent = t(on ? "screenshot.foot_on" : "screenshot.foot_off");
    el.classList.toggle("is-on", on);
  }

  function loadMonitorsIfEnabled(): void {
    if (settings.get().enabled && !monitors.isLoaded()) {
      void monitors.load();
    }
  }

  function handleSwitchClick(): void {
    const current = settings.get().enabled;
    settings.setEnabled(!current);
    log.info("screenshot_attach_toggle", { enabled: !current });
    if (!current && !monitors.isLoaded()) {
      void monitors.load();
    }
  }

  const unsubscribe = settings.subscribe(() => {
    if (!isOpen()) return;
    reflectSettings();
    loadMonitorsIfEnabled();
  });

  switchBtn.addEventListener("click", handleSwitchClick);

  return {
    reflect: reflectSettings,
    loadMonitorsIfEnabled,
    dispose(): void {
      unsubscribe();
      switchBtn.removeEventListener("click", handleSwitchClick);
    },
  };
}
