/** The Motion page: its view, what the panel's open redraws, and the gain preview its close ends. */

import { createElement, type ReactNode } from "react";
import type { Logger } from "../../../logger";
import { createPageRevision } from "../page-revision";
import { createGainPreview } from "./gain/gain-preview";
import { MotionPageView } from "./motion-page-view";
import { createMotionPorts } from "./motion-ports";

export interface MotionPage {
  /** The page's view; the panel calls it in each of its renders, so a rail switch reaches the page. */
  view(): ReactNode;
  /** Re-reads every source, the motion catalog included: the open hook. */
  refresh(): void;
  /** Ends a running gain preview: the close hook. */
  close(): void;
}

export function createMotionPage(
  deps: Parameters<typeof createMotionPorts>[0] & {
    /** Opens the avatar's mouth to this amount while the gain slider moves. */
    onPreview: (mouthOpen: number) => void;
    onPreviewEnd: () => void;
    log: Logger;
  },
): MotionPage {
  const props = { ports: createMotionPorts(deps), preview: createGainPreview(deps), log: deps.log };
  const revision = createPageRevision();
  return {
    view: () =>
      createElement(
        "div",
        { className: "yui-tab-stack" },
        revision.view((n) => createElement(MotionPageView, { ...props, revision: n })),
      ),
    refresh: revision.bump,
    close: props.preview.end,
  };
}
