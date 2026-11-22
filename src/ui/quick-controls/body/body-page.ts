/** The Body page: its React root, and what the panel's open redraws. */

import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { BodyPageView } from "./body-page-view";
import { createRelationsPort, type RelationsDeps } from "./relations/relations-port";
import type { VrmListDeps } from "./vrm/use-vrm-list";

export interface BodyPage {
  el: HTMLElement;
  /** Re-reads every source, the presets included, and drops an armed remove: the open hook. */
  refresh(): void;
  dispose(): void;
}

export function createBodyPage(
  deps: Omit<VrmListDeps, "revision"> & {
    /** The view reset section renders with it. */
    onResetView?: () => void;
    /** The relations section renders with it. */
    relations?: RelationsDeps;
    /** The page appends itself here before its first render: Base UI registers a slider's thumb only while it is connected. */
    host: HTMLElement;
  },
): BodyPage {
  const { relations, onResetView, host, ...vrm } = deps;
  const el = document.createElement("div");
  el.className = "yui-tab-stack";
  host.append(el);
  const root = createRoot(el);
  const props = {
    vrm,
    relations:
      relations && createRelationsPort({ ...relations, isOpen: deps.isOpen, log: deps.log }),
    onResetView,
    log: deps.log,
  };
  let revision = 0;
  const render = (): void =>
    flushSync(() => root.render(createElement(BodyPageView, { ...props, revision })));
  render();

  return {
    el,
    refresh(): void {
      revision++;
      render();
    },
    dispose(): void {
      root.unmount();
    },
  };
}
