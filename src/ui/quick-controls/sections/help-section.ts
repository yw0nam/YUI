/** Help section of the General tab: one Ask button per bundled guide. */

import type { GuideKey } from "../../../contract";
import { isGuideKey } from "../../../io/guide/guide-docs";
import { t } from "../../i18n";
import { secHeadHtml } from "../markup";

const GUIDES: readonly GuideKey[] = ["controls", "capabilities"];

export function helpSectionHtml(): string {
  const rows = GUIDES.map(
    (guide) => `
            <div class="yui-row">
              <div class="yui-row__main">
                <span class="yui-row__label">${t(`help.${guide}.label`)}</span>
                <span class="yui-row__sub">${t(`help.${guide}.sub`)}</span>
              </div>
              <button class="yui-link-btn yui-help-btn" type="button" data-guide="${guide}">${t("help.ask")}</button>
            </div>`,
  ).join("");
  return `
        <div class="yui-sec">
          ${secHeadHtml(t("help.section"))}
          <div class="yui-group">${rows}
          </div>
        </div>`;
}

/** Calls `onGuide` with the guide key and its request text in the current locale. Returns the detach. */
export function bindHelpSection(
  root: HTMLElement,
  onGuide: (guide: GuideKey, text: string) => void,
): () => void {
  const onClick = (e: Event): void => {
    const guide = (e.target as Element).closest<HTMLElement>("[data-guide]")?.dataset.guide;
    if (isGuideKey(guide)) onGuide(guide, t(`help.${guide}.request`));
  };
  root.addEventListener("click", onClick);
  return () => root.removeEventListener("click", onClick);
}
