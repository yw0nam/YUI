/**
 * How often she speaks up (top of the Proactive page): the device-wide base pace as Less / Normal /
 * More, its foot line, and a link to the per-character Active hours on the Persona page.
 */

import type {
  BasePace,
  BasePaceSettingsStore,
} from "../../../../settings/active-hours/base-pace-settings";
import { PACE_FACTOR } from "../../../../settings/active-hours/spans";
import { t } from "../../../i18n";
import { secHeadHtml } from "../../markup";
import { createStoreSegment } from "../../store-segment";
import "./base-pace-section.css";

const PACES: readonly BasePace[] = ["low", "normal", "high"];

export function basePaceSectionHtml(): string {
  const cells = PACES.map(
    (pace) =>
      `<button class="yui-seg__btn" type="button" role="radio" aria-checked="false" tabindex="-1">${t(`active_hours.pace_${pace}`)}</button>`,
  ).join("");
  return `
        <div class="yui-sec">
          ${secHeadHtml(t("base_pace.title"))}
          <div class="yui-group">
            <div class="yui-stack">
              <div class="yui-seg yui-base-pace-seg" role="radiogroup" aria-label="${t("base_pace.title")}">${cells}</div>
            </div>
          </div>
          <p class="yui-sec__foot">${t("base_pace.foot", { more: 1 / PACE_FACTOR.high, less: PACE_FACTOR.low })}</p>
          <p class="yui-sec__foot">${t("base_pace.link_lead")} <button class="yui-link-btn yui-base-pace__link" type="button">${t("base_pace.link")}</button></p>
        </div>`;
}

/** Binds the segment to the base pace store; the link opens the Persona page. */
export function createBasePaceSection(deps: {
  root: HTMLElement;
  basePaceSettings: BasePaceSettingsStore;
  isOpen: () => boolean;
  openPersona: () => void;
}) {
  const { root, basePaceSettings, isOpen, openPersona } = deps;
  const segment = createStoreSegment({
    segment: root.querySelector<HTMLElement>(".yui-base-pace-seg")!,
    values: PACES,
    get: () => basePaceSettings.get().pace,
    set: basePaceSettings.setPace,
    subscribe: basePaceSettings.subscribe,
    isOpen,
  });
  const link = root.querySelector<HTMLButtonElement>(".yui-base-pace__link")!;
  link.addEventListener("click", openPersona);
  return {
    reflect: segment.reflect,
    dispose(): void {
      segment.dispose();
      link.removeEventListener("click", openPersona);
    },
  };
}
