/**
 * A source's fold under its switch row: a chevron summary with its title and the folded rows'
 * summary, over the rows. While the source is off the summary reads Off and the body opens with
 * a line saying the rows apply once it is on.
 */

import { t } from "../i18n";
import { DISCLOSURE_CHEV_SVG } from "./constants";

export function foldHtml(title: string, aside: string, body: string): string {
  return `<details class="yui-fold"><summary>${DISCLOSURE_CHEV_SVG}<span class="yui-fold__title">${title}</span><span class="yui-fold__aside">${aside}</span><span class="yui-fold__aside yui-fold__aside--off" hidden>${t("fold.off")}</span></summary><div class="yui-fold__body"><p class="yui-fold__off" hidden>${t("fold.off_note")}</p>${body}</div></details>`;
}

/** Shows the fold as off or on: the class that dims its rows, the Off summary and the off line. */
export function reflectFoldOff(fold: Element, off: boolean): void {
  fold.classList.toggle("yui-fold--off", off);
  for (const aside of fold.querySelectorAll<HTMLElement>(":scope > summary > .yui-fold__aside")) {
    aside.hidden = aside.classList.contains("yui-fold__aside--off") !== off;
  }
  fold.querySelector<HTMLElement>(":scope > .yui-fold__body > .yui-fold__off")!.hidden = !off;
}
