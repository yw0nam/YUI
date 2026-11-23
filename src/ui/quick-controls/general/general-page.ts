/** The General page: its React root. */

import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { GeneralPageView, type GeneralPageViewProps } from "./general-page-view";

export interface GeneralPage {
  el: HTMLElement;
  dispose(): void;
}

export function createGeneralPage(deps: GeneralPageViewProps & { host: HTMLElement }): GeneralPage {
  const { host, ...view } = deps;
  const el = document.createElement("div");
  el.className = "yui-tab-stack";
  // The page appends itself here before its first render: Base UI registers a radio group's items only while connected.
  host.append(el);
  const root = createRoot(el);
  flushSync(() => root.render(createElement(GeneralPageView, view)));
  return {
    el,
    dispose(): void {
      root.unmount();
    },
  };
}
