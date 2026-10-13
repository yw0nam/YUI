/**
 * Browser section of the Input tab — owns the browser-use switch: its markup, the click that flips
 * the store, and the redraw of the switch and its sub text while the panel is open.
 */

import type { Logger } from "../../../../logger";
import type { FlagSettingsStore } from "../../../../settings/persisted-store";
import { t } from "../../../i18n";

const GLOBE_SVG = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <circle cx="12" cy="12" r="8.25" stroke="currentColor" stroke-width="1.5"/>
                    <path d="M3.75 12h16.5M12 3.75c2.3 2.4 3.4 5.1 3.4 8.25s-1.1 5.85-3.4 8.25M12 3.75C9.7 6.15 8.6 8.85 8.6 12s1.1 5.85 3.4 8.25" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                  </svg>`;

export function browserSectionHtml(): string {
  return `
        <div class="yui-sec">
          <div class="yui-group">
            <div class="yui-row">
              <div class="yui-row__main">
                <span class="yui-row__label">
                  ${GLOBE_SVG}
                  ${t("browser.label")}
                </span>
                <span class="yui-row__sub">${t("browser.sub_off")}</span>
              </div>
              <button class="yui-switch yui-browser-switch" type="button" role="switch" aria-checked="false" aria-label="${t("browser.label")}"></button>
            </div>
          </div>
          <p class="yui-sec__foot">${t("browser.foot")}</p>
        </div>`;
}

interface BrowserSection {
  /** Render the switch and its sub text from the store. */
  reflect(): void;
  /** Permanent teardown — unsubscribe the store and remove the click listener. */
  dispose(): void;
}

export function createBrowserSection(deps: {
  /** Panel root holding the section's markup. */
  root: HTMLElement;
  settings: Pick<FlagSettingsStore, "get" | "setEnabled" | "subscribe">;
  log: Logger;
  /** Popover open state — the store subscription redraws only while the panel is open. */
  isOpen: () => boolean;
}): BrowserSection {
  const { root, settings, log, isOpen } = deps;
  const switchBtn = root.querySelector<HTMLButtonElement>(".yui-browser-switch")!;
  const subEl = switchBtn.closest(".yui-row")!.querySelector<HTMLSpanElement>(".yui-row__sub")!;

  function reflect(): void {
    const on = settings.get().enabled;
    switchBtn.setAttribute("aria-checked", String(on));
    subEl.textContent = t(on ? "browser.sub_on" : "browser.sub_off");
  }

  function handleClick(): void {
    const enabled = !settings.get().enabled;
    settings.setEnabled(enabled);
    log.info("browser_toggle", { enabled });
  }

  const unsubscribe = settings.subscribe(() => {
    if (isOpen()) reflect();
  });
  switchBtn.addEventListener("click", handleClick);

  return {
    reflect,
    dispose(): void {
      unsubscribe();
      switchBtn.removeEventListener("click", handleClick);
    },
  };
}
