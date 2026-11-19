/** The quick card in its own window beside the character: its head, Quiet group, tiles and rows, and how it opens and closes. */

import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import "./quick-card.css";
import type { ThreadsTab } from "../../io/bridge/settings-bridge";
import type { PushSocketState } from "../../io/chat/push/push-socket";
import { createLogger } from "../../logger";
import type { ChatTransport } from "../../settings/backend/endpoints-settings";
import type { PresetEntry } from "../../settings/preset/active-preset";
import type { SwitchRow } from "../quick-controls/switch-row";
import { QuickCardView } from "./quick-card-view";
import type { DndPort } from "./quiet-group";
import type { PickerPort } from "./rows";
import type { ListenPort } from "./tiles";

const log = createLogger("quick-card");

export interface QuickCard {
  el: HTMLElement;
  /** Shows the card, painting the current store values. */
  open(): void;
  close(): void;
  isOpen(): boolean;
  /** Runs the callback each time the card closes, whatever closed it. */
  onClose(cb: () => void): () => void;
  /** The card's head: the drag handle the window moves by. */
  onHeadPointerDown(cb: (event: PointerEvent) => void): () => void;
  dispose(): void;
}

export interface QuickCardDeps {
  mount: HTMLElement;
  entry(): PresetEntry;
  subscribeEntry(cb: () => void): () => void;
  transport(): { api: ChatTransport; push?: PushSocketState };
  onTransport(cb: () => void): () => void;
  tiles: { voice: SwitchRow; bubble: SwitchRow; unified: SwitchRow };
  /** Null outside the main window: voice input belongs to main. */
  listen: ListenPort | null;
  body: PickerPort;
  voice: PickerPort;
  resetConversation(): void;
  /** Null for main, which cannot be turned off. */
  turnOff: (() => void) | null;
  openAllSettings(): void;
  /** Requests main to open the Threads window on `tab`. */
  openThreads(tab: ThreadsTab): void;
  /** The device-wide do-not-disturb switch. */
  dnd: DndPort;
}

export function createQuickCard(deps: QuickCardDeps): QuickCard {
  const el = document.createElement("div");
  el.className = "yui-qcard";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-labelledby", "yui-qcard-name");
  el.tabIndex = -1;
  const root = createRoot(el);
  let open = false;
  let disposed = false;
  // A new key at each close mounts the contents afresh, so a reopen never lands on the destructive button.
  let generation = 0;
  const closeListeners = new Set<() => void>();
  const headListeners = new Set<(event: PointerEvent) => void>();

  function render(): void {
    flushSync(() =>
      root.render(
        createElement(QuickCardView, {
          key: generation,
          deps,
          log,
          close,
          onHeadPointerDown: (event) => {
            for (const cb of headListeners) cb(event);
          },
        }),
      ),
    );
  }
  render();

  // Escape closes the card only, never the window or a surface behind it.
  el.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    close();
  });

  const onOutsidePointer = (e: PointerEvent): void => {
    if (!el.contains(e.target as Node)) close();
  };

  function show(): void {
    if (disposed || open) return;
    open = true;
    deps.mount.append(el);
    document.addEventListener("pointerdown", onOutsidePointer, true);
    el.focus({ preventScroll: true });
  }

  function hide(): void {
    open = false;
    document.removeEventListener("pointerdown", onOutsidePointer, true);
    if (el.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
    el.remove();
  }

  function close(): void {
    if (!open) return;
    hide();
    generation += 1;
    render();
    for (const cb of closeListeners) cb();
  }

  return {
    el,
    open() {
      show();
    },
    close,
    isOpen: () => open,
    onClose(cb) {
      closeListeners.add(cb);
      return () => closeListeners.delete(cb);
    },
    onHeadPointerDown(cb) {
      headListeners.add(cb);
      return () => headListeners.delete(cb);
    },
    dispose() {
      if (open) {
        hide();
        for (const cb of closeListeners) cb();
      }
      disposed = true;
      root.unmount();
    },
  };
}
