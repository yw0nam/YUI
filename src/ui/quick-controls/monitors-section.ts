/**
 * Monitors section — owns screen source list rendering and load state.
 * Follows sibling section pattern: explicit deps + wired from shell.
 */
import type { ScreenSource } from "../../contract";
import type { MonitorInfo, ScreenSourceProvider } from "../../io/screen-source-provider";
import type { createScreenshotSettings } from "../../io/screenshot-settings";
import type { Logger } from "../../logger";
import { t } from "../i18n";

type ScreenshotSettingsStore = ReturnType<typeof createScreenshotSettings>;

export interface MonitorsSectionDeps {
  /** Panel root (el) — query monitor list here. */
  root: HTMLElement;
  /** Provides list of displayable screen sources. */
  sourceProvider: ScreenSourceProvider;
  /** Read current screen source and save selected source. */
  settings: ScreenshotSettingsStore;
  log: Logger;
}

export interface MonitorsSection {
  load(): Promise<void>;
  isLoaded(): boolean;
}

export function createMonitorsSection(deps: MonitorsSectionDeps): MonitorsSection {
  const { root: el, sourceProvider, settings, log } = deps;
  const monitorsEl = el.querySelector<HTMLDivElement>(".yui-monitors")!;
  let monitorsLoaded = false;

  function renderMonitors(monitors: MonitorInfo[], currentSource: ScreenSource): void {
    monitorsEl.innerHTML = "";
    for (const mon of monitors) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.setAttribute("role", "radio");
      const selected = currentSource.kind === "monitor" && currentSource.index === mon.index;
      btn.setAttribute("aria-checked", String(selected));
      btn.className = "yui-mon";

      const metaText =
        mon.width !== undefined && mon.height !== undefined ? `${mon.width} × ${mon.height}` : "";
      const badgeHtml = mon.primary
        ? `<span class="yui-mon__badge">${t("screenshot.monitor_primary")}</span>`
        : "";

      btn.innerHTML = `
        <span class="yui-mon__tick" aria-hidden="true"></span>
        <span class="yui-mon__body">
          <span class="yui-mon__name">${t("screenshot.display", { n: mon.index + 1 })}</span>
          ${metaText ? `<span class="yui-mon__meta">${metaText}</span>` : ""}
        </span>
        ${badgeHtml}
      `;

      btn.addEventListener("click", () => {
        const label = mon.label ?? t("screenshot.display", { n: mon.index + 1 });
        const source: ScreenSource = { kind: "monitor", index: mon.index, label };
        settings.setSource(source);
        // Immediately reflect radio state
        monitorsEl.querySelectorAll<HTMLButtonElement>(".yui-mon").forEach((b) => {
          b.setAttribute("aria-checked", "false");
        });
        btn.setAttribute("aria-checked", "true");
      });

      monitorsEl.appendChild(btn);
    }
  }

  // Inline guidance instead of list — same tone as VRM/speaker section's .yui-vrm__error pattern.
  function renderMonitorsNotice(kind: "error" | "empty"): void {
    monitorsEl.innerHTML = "";
    const notice = document.createElement("p");
    notice.className = kind === "error" ? "yui-mon__error" : "yui-mon__empty";
    notice.setAttribute("role", "status");
    notice.textContent = t(
      kind === "error" ? "screenshot.monitors_error" : "screenshot.monitors_empty",
    );
    monitorsEl.appendChild(notice);
  }

  async function load(): Promise<void> {
    let monitors: MonitorInfo[];
    try {
      monitors = await sourceProvider.listMonitors();
    } catch (err) {
      // Leave monitorsLoaded false so next open/toggle retries.
      log.error("monitor_list_failed", { error: String(err) });
      renderMonitorsNotice("error");
      return;
    }
    monitorsLoaded = true;
    if (monitors.length === 0) {
      renderMonitorsNotice("empty");
      return;
    }
    renderMonitors(monitors, settings.get().source);
  }

  return { load, isLoaded: () => monitorsLoaded };
}
