/**
 * Message-window opener and its placement rule.
 *
 * openMessageWindow branches on injected env for the Tauri/browser paths only
 * (pure, testable). createMessageWindowController wires the real implementation —
 * WebviewWindow("message"), dynamic-imported inside the Tauri branch so vitest
 * and the browser dev build never load the module.
 */

import { clampToWorkArea } from "../drag";
import { createLogger } from "../logger";
import type { MessageWindowSettingsStore } from "./message-window-settings";
import { monitorAt, type ScreenMonitor, toScreenMonitor } from "./screen-geometry";
import { isTauri } from "./tauri-env";

const log = createLogger("message-window");

export const MESSAGE_WINDOW_LABEL = "message";
export const MESSAGE_WINDOW_URL = "message.html";
export const MESSAGE_WINDOW_TITLE = "YUI";
/** Fixed column width (logical px) — the bubble and the input size to it. */
export const MESSAGE_WINDOW_WIDTH = 340;
/** Height (logical px) of the idle window — the 26px plate and its border inside the column's 8px padding. */
export const MESSAGE_WINDOW_HANDLE_HEIGHT = 44;
/** Gap (logical px) between the pet window's right edge and the message window. */
const MESSAGE_WINDOW_GAP_PX = 12;

export interface MessageWindowPlacement {
  /** Last stored outer position (physical px), null until the window has been moved. */
  stored: { x: number | null; y: number | null };
  /** Pet window outer bounds (physical px). */
  pet: { position: { x: number; y: number }; size: { width: number; height: number } };
  monitors: ScreenMonitor[];
  scale: number;
  /** Message window box (logical px) the position must keep on screen. */
  size: { width: number; height: number };
}

/**
 * Where the message window opens, in physical px: the stored position when there
 * is one, else beside the pet window's top-right corner — clamped either way into
 * the work area of the monitor holding the pet window.
 */
export function initialMessageWindowPosition({
  stored,
  pet,
  monitors,
  scale,
  size,
}: MessageWindowPlacement): { x: number; y: number } {
  const candidate =
    stored.x !== null && stored.y !== null
      ? { x: stored.x, y: stored.y }
      : {
          x: pet.position.x + pet.size.width + MESSAGE_WINDOW_GAP_PX * scale,
          y: pet.position.y,
        };
  // A window parked on a second display must be clamped there, not dragged back to the pet's.
  const monitor =
    monitorAt(monitors, candidate.x, candidate.y) ??
    monitorAt(monitors, pet.position.x, pet.position.y);
  if (!monitor || scale <= 0) return candidate;
  const clamped = clampToWorkArea(
    candidate.x / scale,
    candidate.y / scale,
    size.width,
    size.height,
    monitor.workArea.position.x / scale,
    monitor.workArea.position.y / scale,
    monitor.workArea.size.width / scale,
    monitor.workArea.size.height / scale,
  );
  return { x: Math.round(clamped.x * scale), y: Math.round(clamped.y * scale) };
}

export interface MessageWindowEnv {
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

async function tauriMessageWindow(): Promise<{
  show(): Promise<void>;
  hide(): Promise<void>;
} | null> {
  const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  return WebviewWindow.getByLabel(MESSAGE_WINDOW_LABEL);
}

async function resolveTauriPosition(
  store: MessageWindowSettingsStore,
): Promise<{ x: number; y: number } | null> {
  const { availableMonitors, getCurrentWindow } = await import("@tauri-apps/api/window");
  const win = getCurrentWindow();
  const [position, size, scale, monitors] = await Promise.all([
    win.outerPosition(),
    win.outerSize(),
    win.scaleFactor(),
    availableMonitors(),
  ]);
  const state = store.get();
  const physical = initialMessageWindowPosition({
    stored: { x: state.x, y: state.y },
    pet: {
      position: { x: position.x, y: position.y },
      size: { width: size.width, height: size.height },
    },
    monitors: monitors.map(toScreenMonitor),
    scale,
    size: { width: MESSAGE_WINDOW_WIDTH, height: MESSAGE_WINDOW_HANDLE_HEIGHT },
  });
  return { x: physical.x / scale, y: physical.y / scale };
}

async function createTauriMessageWindow(position: { x: number; y: number } | null): Promise<void> {
  const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  const win = new WebviewWindow(MESSAGE_WINDOW_LABEL, {
    url: MESSAGE_WINDOW_URL,
    title: MESSAGE_WINDOW_TITLE,
    width: MESSAGE_WINDOW_WIDTH,
    height: MESSAGE_WINDOW_HANDLE_HEIGHT,
    resizable: false,
    decorations: false,
    transparent: true,
    shadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focus: false,
    ...(position ? { x: position.x, y: position.y } : {}),
  });
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
export function createMessageWindowController(store: MessageWindowSettingsStore): {
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
            getExisting: tauriMessageWindow,
            create: createTauriMessageWindow,
            resolvePosition: () => resolveTauriPosition(store),
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
          await (await tauriMessageWindow())?.hide();
        } catch (error) {
          log.warn("message_window_hide_failed", { error: String(error) });
        }
      });
    },
  };
}
