/** The General page: its React root. */

import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { GeneralPageView, type GeneralPageViewProps } from "./general-page-view";

export interface GeneralPage {
  el: HTMLElement;
  dispose(): void;
}

export function createGeneralPage(deps: GeneralPageViewProps): GeneralPage {
  const el = document.createElement("div");
  el.className = "yui-tab-stack";
  const root = createRoot(el);
  flushSync(() => root.render(createElement(GeneralPageView, deps)));
  return {
    el,
    dispose(): void {
      root.unmount();
    },
  };
}
