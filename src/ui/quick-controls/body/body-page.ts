/** The Body page: its view, and what the panel's open redraws. */

import { createElement } from "react";
import { createPageRevision, type PageView, pageStack } from "../page-view";
import { BodyPageView } from "./body-page-view";
import { createRelationsPort, type RelationsDeps } from "./relations/relations-port";
import type { VrmSectionProps } from "./vrm/vrm-section";

export interface BodyPage extends PageView {
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
      pageStack((n) => createElement(BodyPageView, { ...props, revision: n }), { revision }),
    refresh: revision.bump,
  };
}
