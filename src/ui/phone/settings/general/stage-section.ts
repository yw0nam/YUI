/**
 * General tab, Stage section: the Default/Image segment over the stage background store and the
 * "Choose" row that runs the image import. Writes no DOM once disposed, so an import that ends
 * after the tab is gone only cleans up.
 */

import type { StageBackgroundStore, StageMode } from "../../../../io/assets/stage/stage-background";
import type { Logger } from "../../../../logger";
import { t } from "../../../i18n";
import { secHeadHtml } from "../../../quick-controls/markup";
import "../../../quick-controls/sections/user-asset-list.css";
import { handleSegmentKeydown } from "../../../quick-controls/seg-keyboard";
import "./general-tab.css";

const MODES: readonly StageMode[] = ["default", "image"];

const ERROR_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" /></svg>`;

const sectionHtml = (): string => `
  ${secHeadHtml(t("phone.general.stage_section"))}
  <div class="yui-group">
    <div class="yui-row">
      <div class="yui-seg yui-stage-seg" role="radiogroup" aria-label="${t("phone.general.stage_aria")}">${MODES.map(
        (m) =>
          `<button class="yui-seg__btn" type="button" role="radio" data-mode="${m}" aria-checked="false" tabindex="-1">${t(`phone.general.stage_${m}`)}</button>`,
      ).join("")}</div>
    </div>
    <div class="yui-row">
      <div class="yui-row__main">
        <span class="yui-row__label">${t("phone.general.image_label")}</span>
        <span class="yui-row__sub">${t("phone.general.image_sub")}</span>
      </div>
      <button class="yui-link-btn yui-stage-choose" type="button">${t("phone.general.image_choose")}</button>
    </div>
    <div class="yui-stage__foot" role="status" hidden><p class="yui-stage__import-error">${ERROR_SVG}<span>${t("phone.general.import_error")}</span></p></div>
  </div>`;

export function createStageSection(deps: {
  stageBackground: Pick<StageBackgroundStore, "get" | "setMode" | "subscribe">;
  importStageImage: () => Promise<void>;
  log: Logger;
}): { el: HTMLElement; refresh(): void; dispose(): void } {
  const { stageBackground, importStageImage, log } = deps;

  const el = document.createElement("div");
  el.className = "yui-sec";
  el.innerHTML = sectionHtml();
  const segEl = el.querySelector<HTMLElement>(".yui-stage-seg")!;
  const buttons = Array.from(segEl.querySelectorAll<HTMLButtonElement>(".yui-seg__btn"));
  const chooseBtn = el.querySelector<HTMLButtonElement>(".yui-stage-choose")!;
  const errorEl = el.querySelector<HTMLElement>(".yui-stage__foot")!;
  let disposed = false;
  let importing = false;

  function refresh(): void {
    const { mode, image } = stageBackground.get();
    const [defaultBtn, imageBtn] = buttons;
    const imageHadFocus = document.activeElement === imageBtn;
    imageBtn.disabled = image === null;
    buttons.forEach((btn, i) => {
      const selected = MODES[i] === mode;
      btn.setAttribute("aria-checked", String(selected));
      btn.tabIndex = selected ? 0 : -1;
    });
    if (imageHadFocus && imageBtn.disabled) defaultBtn.focus();
  }

  function moveFocus(index: number): void {
    const btn = buttons[Math.min(buttons.length - 1, Math.max(0, index))];
    if (!btn || btn.disabled) return;
    for (const b of buttons) b.tabIndex = -1;
    btn.tabIndex = 0;
    btn.focus();
  }

  function commit(index: number): void {
    const btn = buttons[index];
    if (!btn || btn.disabled) return;
    const mode = MODES[index];
    log.info("stage_mode_change", { mode });
    stageBackground.setMode(mode);
    btn.focus();
  }

  function handleSegClick(e: MouseEvent): void {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".yui-seg__btn");
    if (btn) commit(buttons.indexOf(btn));
  }

  function handleSegKeydown(e: KeyboardEvent): void {
    handleSegmentKeydown(e, buttons, {
      length: buttons.length,
      getBaseIndex: () => {
        const focused = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const checked = buttons.findIndex((b) => b.getAttribute("aria-checked") === "true");
        return focused >= 0 ? focused : Math.max(0, checked);
      },
      onNavigate: moveFocus,
      onCommit: commit,
    });
  }

  async function handleChooseClick(): Promise<void> {
    if (importing) return;
    importing = true;
    chooseBtn.disabled = true;
    errorEl.hidden = true;
    try {
      await importStageImage();
    } catch (err) {
      log.error("stage_image_import_failed", { error: String(err) });
      if (!disposed) errorEl.hidden = false;
    } finally {
      importing = false;
      if (!disposed) chooseBtn.disabled = false;
    }
  }

  const unsubscribe = stageBackground.subscribe(() => {
    if (!disposed) refresh();
  });
  segEl.addEventListener("click", handleSegClick);
  segEl.addEventListener("keydown", handleSegKeydown);
  chooseBtn.addEventListener("click", handleChooseClick);
  refresh();

  return {
    el,
    refresh,
    dispose(): void {
      disposed = true;
      unsubscribe();
      segEl.removeEventListener("click", handleSegClick);
      segEl.removeEventListener("keydown", handleSegKeydown);
      chooseBtn.removeEventListener("click", handleChooseClick);
      el.remove();
    },
  };
}
