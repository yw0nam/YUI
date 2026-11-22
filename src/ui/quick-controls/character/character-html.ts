/** Motion page markup — the rows the character tab renders, in page order. */

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
  /** The relations rows with their switch; the settings window and the pet popover render it. */
  relations: boolean;
}

const GAIN_EYE_SVG = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M4 10c2.4-2.4 4.9-3.6 8-3.6s5.6 1.2 8 3.6c-2.4 1.1-4.9 1.7-8 1.7s-5.6-.6-8-1.7Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
                    <path d="M4 14c2.4 2.4 4.9 3.6 8 3.6s5.6-1.2 8-3.6c-2.4-1.1-4.9-1.7-8-1.7s-5.6.6-8 1.7Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
                  </svg>`;

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

/** The Motion page's character rows: mouth gain, idle and express motions. */
export function motionHtml(rows: CharacterRows): string {
  return [
    rows.gain ? gainHtml() : "",
    rows.idleMotion ? idleMotionHtml() : "",
    rows.expressMotion ? expressMotionHtml() : "",
  ].join("");
}
