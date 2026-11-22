/** The Motion page: its React root, what the panel's open redraws, and the gain preview its close ends. */

import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { Logger } from "../../../logger";
import { createGainPreview } from "./gain/gain-preview";
import { MotionPageView } from "./motion-page-view";
import { createMotionPorts } from "./motion-ports";

export interface MotionPage {
  el: HTMLElement;
  /** Re-reads every source, the motion catalog included: the open hook. */
  refresh(): void;
  /** Ends a running gain preview: the close hook. */
  close(): void;
  dispose(): void;
}

export function createMotionPage(
  deps: Parameters<typeof createMotionPorts>[0] & {
    /** Opens the avatar's mouth to this amount while the gain slider moves. */
    onPreview: (mouthOpen: number) => void;
    onPreviewEnd: () => void;
    log: Logger;
    /** The page appends itself here before its first render: Base UI registers a slider's thumb only while it is connected. */
    host: HTMLElement;
  },
): MotionPage {
  const el = document.createElement("div");
  el.className = "yui-tab-stack";
  deps.host.append(el);
  const root = createRoot(el);
  const props = { ports: createMotionPorts(deps), preview: createGainPreview(deps), log: deps.log };
  let revision = 0;
  const render = (): void =>
    flushSync(() => root.render(createElement(MotionPageView, { ...props, revision })));
  render();

  return {
    el,
    refresh(): void {
      revision++;
      render();
    },
    close: props.preview.end,
    dispose(): void {
      root.unmount();
    },
  };
}
