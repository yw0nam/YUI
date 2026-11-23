/** The Body page: its view, and what the panel's open redraws. */

import { createElement, type ReactNode } from "react";
import { createPageRevision } from "../page-revision";
import { BodyPageView } from "./body-page-view";
import { createRelationsPort, type RelationsDeps } from "./relations/relations-port";
import type { VrmSectionProps } from "./vrm/vrm-section";

export interface BodyPage {
  /** The page's view; the panel calls it in each of its renders, so a rail switch reaches the page. */
  view(): ReactNode;
  /** Re-reads every source, the presets included, and drops an armed remove: the open hook. */
  refresh(): void;
}

export function createBodyPage(
  deps: Omit<VrmSectionProps, "revision"> & {
    /** The view reset section renders with it. */
    onResetView?: () => void;
    /** The relations section renders with it. */
    relations?: RelationsDeps;
  },
): BodyPage {
  const { relations, onResetView, ...vrm } = deps;
  const props = {
    vrm,
    relations:
      relations && createRelationsPort({ ...relations, isOpen: deps.isOpen, log: deps.log }),
    onResetView,
    log: deps.log,
  };
  const revision = createPageRevision();
  return {
    view: () =>
      createElement(
        "div",
        { className: "yui-tab-stack" },
        revision.view((n) => createElement(BodyPageView, { ...props, revision: n })),
      ),
    refresh: revision.bump,
  };
}
