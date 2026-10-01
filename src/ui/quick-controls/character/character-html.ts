/** Character tab markup — the rows the tab renders, in panel order. */

import { t } from "../../i18n";
import { secHeadHtml } from "../markup";

/** Which rows the Character tab renders — and binds, and refreshes. */
export interface CharacterRows {
  /** The VRM list with its import button; every surface renders it. */
  vrms: true;
  /** The mouth-gain slider with its lipsync preview. */
  gain: boolean;
  idleMotion: boolean;
  expressMotion: boolean;
  /** The camera view reset. */
  viewpoint: boolean;
}

/** The surface the tab sits on: the desktop panel, or the phone's full-screen settings view. */
export type CharacterVariant = "panel" | "phone";

const GAIN_EYE_SVG = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M4 10c2.4-2.4 4.9-3.6 8-3.6s5.6 1.2 8 3.6c-2.4 1.1-4.9 1.7-8 1.7s-5.6-.6-8-1.7Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
                    <path d="M4 14c2.4 2.4 4.9 3.6 8 3.6s5.6-1.2 8-3.6c-2.4-1.1-4.9-1.7-8-1.7s-5.6.6-8 1.7Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
                  </svg>`;

const vrmsHtml = (): string => `
        <div class="yui-sec">
          ${secHeadHtml(t("vrm.section"))}
          <div class="yui-group">
            <div class="yui-vrm-scroll">
              <div class="yui-vrms" role="radiogroup" aria-label="${t("vrm.group_aria")}"></div>
            </div>
            <div class="yui-vrm-foot">
              <button class="yui-vrm yui-vrm--add is-ready" type="button">
                <span class="yui-vrm__tick" aria-hidden="true"></span>
                <span class="yui-vrm__body"><span class="yui-vrm__name">${t("vrm.add")}</span></span>
              </button>
              <p class="yui-vrm__import-error" role="status" hidden>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 8v4M12 16h.01" />
                </svg>
                <span>${t("vrm.import_error")}</span>
              </p>
            </div>
          </div>
        </div>`;

const gainHtml = (): string => `
        <div class="yui-sec">
          ${secHeadHtml(t("expression.section"))}
          <div class="yui-group">
            <div class="yui-gain">
              <div class="yui-gain__head">
                <span class="yui-gain__label">
                  ${GAIN_EYE_SVG}
                  ${t("expression.mouth_label")}
                </span>
                <span class="yui-gain__value yui-lipsync-gain__value">2.0×</span>
              </div>
              <span class="yui-gain__sub">${t("expression.mouth_sub")}</span>
              <input class="yui-gain__slider yui-lipsync-gain__slider" type="range" aria-label="${t("expression.mouth_aria")}" />
              <span class="yui-gain__hint">${t("expression.mouth_hint")}</span>
            </div>
          </div>
        </div>`;

const idleMotionHtml = (): string => `
        <div class="yui-sec yui-idle-motion">
          ${secHeadHtml(t("idle_motion.section"))}
          <div class="yui-group yui-motions" role="group" aria-label="${t("idle_motion.group_aria")}"></div>
        </div>`;

const expressMotionHtml = (): string => `
        <div class="yui-sec yui-express-motion">
          ${secHeadHtml(t("express_motion.section"))}
          <p class="yui-sec__note">${t("express_motion.sub")}</p>
          <div class="yui-group yui-express" role="group" aria-label="${t("express_motion.group_aria")}"></div>
        </div>`;

// The panel keeps a link in the section head; the phone shows a labelled row with a touch button.
const viewpointHtml = (variant: CharacterVariant): string =>
  variant === "phone"
    ? `
        <div class="yui-sec">
          ${secHeadHtml(t("viewpoint.view_section"))}
          <div class="yui-group">
            <div class="yui-row">
              <div class="yui-row__main">
                <span class="yui-row__label">${t("viewpoint.reset_view_label")}</span>
                <span class="yui-row__sub">${t("viewpoint.reset_view_sub")}</span>
              </div>
              <button class="yui-link-btn yui-viewpoint-reset" type="button">${t("viewpoint.reset_view_button")}</button>
            </div>
          </div>
        </div>`
    : `
        <div class="yui-sec">
          ${secHeadHtml(t("viewpoint.section"), `<button class="yui-link-btn yui-viewpoint-reset" type="button">${t("viewpoint.reset")}</button>`)}
          <p class="yui-sec__note">${t("viewpoint.sub")}</p>
        </div>`;

export function characterHtml(rows: CharacterRows, variant: CharacterVariant): string {
  return [
    vrmsHtml(),
    rows.gain ? gainHtml() : "",
    rows.idleMotion ? idleMotionHtml() : "",
    rows.expressMotion ? expressMotionHtml() : "",
    rows.viewpoint ? viewpointHtml(variant) : "",
  ].join("");
}
