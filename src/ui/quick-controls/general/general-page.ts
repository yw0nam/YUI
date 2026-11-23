/** The General page: its view. */

import { createElement, type ReactNode } from "react";
import { GeneralPageView, type GeneralPageViewProps } from "./general-page-view";

export interface GeneralPage {
  /** The page's view; the panel calls it in each of its renders, so a rail switch reaches the page. */
  view(): ReactNode;
}

export function createGeneralPage(deps: GeneralPageViewProps): GeneralPage {
  return {
    view: () =>
      createElement("div", { className: "yui-tab-stack" }, createElement(GeneralPageView, deps)),
  };
}
