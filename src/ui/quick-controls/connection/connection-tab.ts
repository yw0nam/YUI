/** Detailed settings' own React root, in the shape Connection's views and the composer call. */

import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { PushSocketState } from "../../../io/chat/push/push-socket";
import {
  DetailSettings,
  type DetailSettingsDeps,
  type DetailSettingsHandle,
} from "./detail/detail-settings";

/** The push transport as the settings panel uses it: a state to show and a conversation to reset. */
export interface PushSocketPanelPort {
  getState(): PushSocketState;
  onState(cb: (state: PushSocketState) => void): () => void;
  sendReset(): boolean;
  /** Drop the backoff wait and open now — what the status line's button asks for. */
  reconnectNow(): void;
}

export interface ConnectionTab {
  el: HTMLElement;
  /** Re-reads every source onto the rendered fields — the open hook. */
  refresh(): void;
  /** Commit dirty key and endpoint inputs to the stores — the close hook. */
  commit(): void;
  /** Scroll the chat key field into view and focus it. */
  focusChatKey(): void;
  /** The Connection tab was entered — the chat section evaluates its model list read. */
  entered(): void;
  /** The panel closed — drop work that only matters while it is open. */
  close(): void;
  dispose(): void;
}

export function createConnectionTab(
  deps: DetailSettingsDeps & { pushSocket?: PushSocketPanelPort; host: HTMLElement },
): ConnectionTab {
  const { host, ...view } = deps;
  const el = document.createElement("div");
  el.className = "yui-tab-stack";
  // The tab appends itself here before its first render: Base UI registers a radio group's items only while connected.
  host.append(el);
  const root = createRoot(el);
  const handle: DetailSettingsHandle = { current: null };
  const refresh = (): void =>
    flushSync(() => root.render(createElement(DetailSettings, { ...view, handle })));
  const commit = (): void => handle.current?.commit();
  refresh();

  return {
    el,
    refresh,
    commit,
    focusChatKey(): void {
      const input = el.querySelector<HTMLInputElement>("#yui-chatkey-input");
      input?.scrollIntoView?.({ block: "center" });
      input?.focus({ preventScroll: true });
    },
    entered: () => handle.current?.entered(),
    close: () => handle.current?.close(),
    dispose(): void {
      // Commit first: the locale remount relies on dispose landing typed keys and endpoints.
      commit();
      root.unmount();
      el.remove();
    },
  };
}
