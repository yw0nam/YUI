/**
 * The Connection page: its React root, the view it shows, and what the panel calls on it — the
 * open, the entry, the window's focus, a focus request, the close and the teardown.
 */

import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { PushSocketState } from "../../../io/chat/push/push-socket";
import { ConnectionPageView, type ConnectionView } from "./connection-page-view";
import type { DetailSettingsDeps, DetailSettingsHandle } from "./detail/detail-settings";
import type { QuickStartDeps, QuickStartHandle } from "./quick-start/quick-start";

/** The push transport as the settings panel uses it: a state to show and a conversation to reset. */
export interface PushSocketPanelPort {
  getState(): PushSocketState;
  onState(cb: (state: PushSocketState) => void): () => void;
  sendReset(): boolean;
  /** Drop the backoff wait and open now — what the status line's button asks for. */
  reconnectNow(): void;
}

export interface ConnectionPage {
  el: HTMLElement;
  /** Re-reads every source onto both views: the open hook. */
  refresh(): void;
  /** The page was entered (the panel opened on it, or its rail item was selected). */
  entered(): void;
  /** The window came back to the front: Quick start checks the stored key while it is in view. */
  windowFocused(): void;
  /** Shows the view that holds the chat key of the server in use and focuses that field. */
  focusKey(): void;
  /** Shows Detailed settings and focuses its chat type select without opening it. */
  focusChatType(): void;
  /** Lands the dirty keys, then the dirty endpoint fields. */
  commit(): void;
  /** The panel closed: drop the in-flight model list read. */
  close(): void;
  dispose(): void;
}

export function createConnectionPage(deps: {
  /** The element the page mounts into, inside the Connection page's panel. */
  host: HTMLElement;
  /** The page's scope line, hidden while Quick start shows; absent without the preset strip. */
  scope: HTMLElement | null;
  initial: ConnectionView;
  quick: QuickStartDeps;
  detail: DetailSettingsDeps;
}): ConnectionPage {
  const { host, scope, quick, detail } = deps;
  const el = document.createElement("div");
  el.className = "yui-tab-stack";
  // The page sits in the panel before its first render: Base UI registers a radio group's items only while connected.
  host.append(el);
  const root = createRoot(el);
  const quickHandle: QuickStartHandle = { current: null };
  const detailHandle: DetailSettingsHandle = { current: null };
  let view = deps.initial;

  const render = (): void => {
    flushSync(() =>
      root.render(
        createElement(ConnectionPageView, {
          view,
          onView: select,
          quick,
          detail,
          quickHandle,
          detailHandle,
        }),
      ),
    );
    if (scope) scope.hidden = view === "quick";
  };

  function enter(): void {
    if (view === "detail") detailHandle.current?.entered();
    else flushSync(() => quickHandle.current?.entered());
  }

  // A switch re-reads the view it shows (the render) and enters it.
  function select(next: ConnectionView): void {
    if (view === next) return;
    view = next;
    render();
    enter();
  }

  // Settings search found matches only in the hidden view.
  function handleReveal(e: Event): void {
    const target = (e.target as Element).closest<HTMLElement>("[data-search-view]")?.dataset.view;
    if (target === "quick" || target === "detail") select(target);
  }

  host.addEventListener("yui-search-reveal", handleReveal);
  render();

  const commit = (): void => detailHandle.current?.commit();

  return {
    el,
    refresh: render,
    entered: enter,
    windowFocused(): void {
      const quickView = el.querySelector('.yui-conn-view[data-view="quick"]');
      if (quickView && !quickView.closest("[hidden]"))
        flushSync(() => quickHandle.current?.entered());
    },
    focusKey(): void {
      const target = quickHandle.current?.holdsKey() ? "quick" : "detail";
      select(target);
      if (target === "quick") {
        flushSync(() => quickHandle.current?.focusKey());
        return;
      }
      const input = el.querySelector<HTMLInputElement>("#yui-chatkey-input");
      input?.scrollIntoView?.({ block: "center" });
      input?.focus({ preventScroll: true });
    },
    focusChatType(): void {
      select("detail");
      el.querySelector<HTMLElement>(".yui-chat-type")?.focus();
    },
    commit,
    close: () => detailHandle.current?.close(),
    dispose(): void {
      // Commit first: the locale remount and the window's teardown rely on dispose landing typed keys and endpoints.
      commit();
      host.removeEventListener("yui-search-reveal", handleReveal);
      root.unmount();
      el.remove();
    },
  };
}
