/**
 * Message-window opener.
 *
 * openMessageWindow branches on injected env for the Tauri/browser paths only
 * (pure, testable). createMessageWindowController wires the real implementation —
 * WebviewWindow("message"), dynamic-imported inside the Tauri branch so vitest
 * and the browser dev build never load the module.
 */

import { createLogger } from "../../../logger";
import type { MessageWindowSettingsStore } from "../../../settings/panels/message-window-settings";
import { windowLabel } from "../../../settings/preset/pet-windows";
import { isTauri } from "../../../tauri-env";
import {
  COMPANION_COLUMN_WIDTH,
  COMPANION_HANDLE_HEIGHT,
  resolveCompanionPosition,
} from "../geometry/companion-position";

const log = createLogger("message-window");

const MESSAGE_WINDOW_LABEL = "message";
const MESSAGE_WINDOW_URL = "message.html";
const MESSAGE_WINDOW_TITLE = "YUI";

interface MessageWindowEnv {
  isTauri: boolean;
  /** The already-open message window, or null. */
  getExisting(): Promise<{ show(): Promise<void> } | null>;
  create(position: { x: number; y: number } | null): Promise<void>;
  /** Where to open, in logical px — the unit the window constructor takes. */
  resolvePosition(): Promise<{ x: number; y: number } | null>;
}

/** Show the message window, creating it on first use. No-op outside Tauri. */
export async function openMessageWindow(env: MessageWindowEnv): Promise<void> {
  if (!env.isTauri) return;
  const existing = await env.getExisting();
  if (existing) {
    await existing.show();
    return;
  }
  await env.create(await env.resolvePosition());
}

async function tauriMessageWindow(boundId?: string | null): Promise<{
  show(): Promise<void>;
  hide(): Promise<void>;
} | null> {
  const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  return WebviewWindow.getByLabel(
    boundId == null ? MESSAGE_WINDOW_LABEL : windowLabel("message", boundId),
  );
}

async function createTauriMessageWindow(
  position: { x: number; y: number } | null,
  boundId?: string | null,
): Promise<void> {
  const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  const win = new WebviewWindow(
    boundId == null ? MESSAGE_WINDOW_LABEL : windowLabel("message", boundId),
    {
      url:
        boundId == null
          ? MESSAGE_WINDOW_URL
          : `${MESSAGE_WINDOW_URL}?preset=${encodeURIComponent(boundId)}`,
      title: MESSAGE_WINDOW_TITLE,
      width: COMPANION_COLUMN_WIDTH,
      height: COMPANION_HANDLE_HEIGHT,
      resizable: false,
      decorations: false,
      transparent: true,
      shadow: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      focus: false,
      acceptFirstMouse: true,
      ...(position ? { x: position.x, y: position.y } : {}),
    },
  );
  void win.once("tauri://error", (event) =>
    log.error("message_window_create_error", { error: String(event) }),
  );
}

/** Pet-window tray visibility signal. Returns a no-op disposer outside Tauri. */
export function listenTrayToggle(cb: (visible: boolean) => void): () => void {
  if (!isTauri()) return () => {};
  let unlisten: (() => void) | null = null;
  let disposed = false;
  void import("@tauri-apps/api/event")
    .then((m) => m.listen<boolean>("tray_toggle", (event) => cb(!!event.payload)))
    .then((un) => {
      if (disposed) un();
      else unlisten = un;
    })
    .catch((error) => log.warn("tray_toggle_listen_failed", { error: String(error) }));
  return () => {
    disposed = true;
    unlisten?.();
    unlisten = null;
  };
}

/**
 * Show/hide handle for the message window, wired to the real Tauri implementation.
 * Both halves run on one chain — a second create while the first is still in flight
 * would be refused by Tauri for the duplicate label.
 */
export function createMessageWindowController(
  store: Pick<MessageWindowSettingsStore, "get" | "setMode">,
  boundId?: string | null,
): {
  open(): void;
  hide(): void;
} {
  let chain: Promise<void> = Promise.resolve();
  const queue = (step: () => Promise<void>): void => {
    chain = chain.then(step, step);
  };

  return {
    open() {
      queue(async () => {
        try {
          await openMessageWindow({
            isTauri: isTauri(),
            getExisting: () => tauriMessageWindow(boundId),
            create: (position) => createTauriMessageWindow(position, boundId),
            resolvePosition: () => resolveCompanionPosition(store.get()),
          });
        } catch (error) {
          // Speech routed to a window that never opened would vanish with no tell.
          log.error("message_window_open_failed", { error: String(error) });
          store.setMode("docked");
        }
      });
    },
    hide() {
      if (!isTauri()) return;
      queue(async () => {
        try {
          await (await tauriMessageWindow(boundId))?.hide();
        } catch (error) {
          log.warn("message_window_hide_failed", { error: String(error) });
        }
      });
    },
  };
}
