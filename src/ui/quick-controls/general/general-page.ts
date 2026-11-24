/** The General page: its view. */

import { createElement } from "react";
import { type PageView, pageStack } from "../page-view";
import { GeneralPageView, type GeneralPageViewProps } from "./general-page-view";

export type GeneralPage = PageView;

export function createGeneralPage(deps: GeneralPageViewProps): GeneralPage {
  return {
    view: () => pageStack(() => createElement(GeneralPageView, deps)),
  };
}
