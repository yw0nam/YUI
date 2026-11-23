/** Quick start's own React root, in the shape Connection's views and the composer call. */

import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { QuickStart, type QuickStartDeps, type QuickStartHandle } from "./quick-start";

export function createQuickStart(deps: QuickStartDeps): {
  el: HTMLElement;
  /** Reads the stores onto the two states: the setup or the connected one. */
  reflect(): void;
  /** The key field here is the server's in use: no server yet, or the Quick start one. */
  holdsKey(): boolean;
  /** Opens the key field, in the connected state too, and focuses it. */
  focusKey(): void;
  /** The view came into view: once connected, checks the stored key. */
  entered(): void;
  /** The window came back to the front: checks the stored key while this view is in view. */
  windowFocused(): void;
  dispose(): void;
} {
  const el = document.createElement("div");
  el.className = "yui-tab-stack";
  const root = createRoot(el);
  const handle: QuickStartHandle = { current: null };
  const reflect = (): void =>
    flushSync(() => root.render(createElement(QuickStart, { ...deps, handle })));
  const entered = (): void => flushSync(() => handle.current?.entered());
  reflect();
  return {
    el,
    reflect,
    holdsKey: () => handle.current?.holdsKey() ?? false,
    focusKey: () => flushSync(() => handle.current?.focusKey()),
    entered,
    windowFocused: () => {
      if (!el.closest("[hidden]")) entered();
    },
    dispose: () => root.unmount(),
  };
}
