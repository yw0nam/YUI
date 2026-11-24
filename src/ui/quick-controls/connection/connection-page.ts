/**
 * The Connection page: the view it shows, and what the panel calls on it — the open, the entry,
 * the window's focus, a focus request and the close.
 */

import { createElement } from "react";
import { flushSync } from "react-dom";
import type { PushSocketState } from "../../../io/chat/push/push-socket";
import { createPageRevision, type PageView, pageStack } from "../page-view";
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

export interface ConnectionPage extends PageView {
  /** Whether Quick start shows; the page's scope line hides meanwhile. */
  quickShown: { get(): boolean; subscribe(cb: () => void): () => void };
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
}

export function createConnectionPage(deps: {
  initial: ConnectionView;
  quick: QuickStartDeps;
  detail: DetailSettingsDeps;
}): ConnectionPage {
  const { quick, detail } = deps;
  const stack: { current: HTMLDivElement | null } = { current: null };
  const quickHandle: QuickStartHandle = { current: null };
  const detailHandle: DetailSettingsHandle = { current: null };
  let view = deps.initial;
  const revision = createPageRevision();
  const render = revision.bump;

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

  const commit = (): void => detailHandle.current?.commit();

  return {
    view: () =>
      pageStack(
        () =>
          createElement(ConnectionPageView, {
            view,
            onView: select,
            quick,
            detail,
            quickHandle,
            detailHandle,
            stack,
            onReveal: handleReveal,
          }),
        { revision, ref: stack },
      ),
    quickShown: { get: () => view === "quick", subscribe: revision.subscribe },
    refresh: render,
    entered: enter,
    windowFocused(): void {
      const quickView = stack.current?.querySelector('.yui-conn-view[data-view="quick"]');
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
      const input = stack.current?.querySelector<HTMLInputElement>("#yui-chatkey-input");
      input?.scrollIntoView?.({ block: "center" });
      input?.focus({ preventScroll: true });
    },
    focusChatType(): void {
      select("detail");
      stack.current?.querySelector<HTMLElement>(".yui-chat-type")?.focus();
    },
    commit,
    close: () => detailHandle.current?.close(),
  };
}
