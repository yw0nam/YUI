/**
 * 모니터 섹션 — 화면 소스 목록 렌더링과 로드 상태를 소유한다.
 * 명시적 deps + shell에서 배선하는 sibling section 패턴을 따른다.
 */
import type { ScreenSource } from "../../contract";
import type { MonitorInfo, ScreenSourceProvider } from "../../io/screen-source-provider";
import type { createScreenshotSettings } from "../../io/screenshot-settings";
import type { Logger } from "../../logger";
import { t } from "../i18n";

type ScreenshotSettingsStore = ReturnType<typeof createScreenshotSettings>;

export interface MonitorsSectionDeps {
  /** 패널 루트(el) — 모니터 목록을 여기서 쿼리한다. */
  root: HTMLElement;
  /** 표시 가능한 화면 소스 목록을 제공한다. */
  sourceProvider: ScreenSourceProvider;
  /** 현재 화면 소스를 읽고 선택한 소스를 저장한다. */
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
        // 라디오 상태 즉시 반영
        monitorsEl.querySelectorAll<HTMLButtonElement>(".yui-mon").forEach((b) => {
          b.setAttribute("aria-checked", "false");
        });
        btn.setAttribute("aria-checked", "true");
      });

      monitorsEl.appendChild(btn);
    }
  }

  // 목록 대신 띄우는 인라인 안내 — VRM/화자 섹션의 .yui-vrm__error 패턴과 동일한 톤.
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
      // monitorsLoaded를 false로 남겨 다음 열림/토글에서 재시도한다.
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
