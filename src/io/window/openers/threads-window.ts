/** Main's Threads window: created hidden once, sent the chip's screen rect and the tab on each open, its closed report passed on, and an automatic request settled by its presented report. */

import type { ScreenRect } from "../../../contract";
import { createLogger } from "../../../logger";
import { isTauri } from "../../../tauri-env";
import type { SettingsBridge, ThreadsOpen, ThreadsTab } from "../../bridge/settings-bridge";
import { createReadyWindowController } from "./ready-window";

const log = createLogger("threads-window");

/** The Threads window's label. */
export const THREADS_WINDOW_LABEL = "threads";

function createTauriThreadsWindow(onError: () => void): void {
  void (async () => {
    const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    const win = new WebviewWindow(THREADS_WINDOW_LABEL, {
      url: "threads.html",
      title: "YUI",
      resizable: false,
      decorations: false,
      transparent: true,
      shadow: false,
      alwaysOnTop: false,
      skipTaskbar: true,
      visible: false,
      focus: false,
      // The first click into the unfocused window lands as well as focusing it (macOS).
      acceptFirstMouse: true,
    });
    void win.once("tauri://error", (event) => {
      log.error("threads_window_create_error", { error: String(event) });
      onError();
    });
  })();
}

/** A rect in this window's viewport moved to screen logical px. */
async function toScreen(rect: ScreenRect): Promise<ScreenRect> {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const win = getCurrentWindow();
  const [inner, scale] = await Promise.all([win.innerPosition(), win.scaleFactor()]);
  return { ...rect, x: inner.x / scale + rect.x, y: inner.y / scale + rect.y };
}

export interface ThreadsWindowController {
  /** Opens the window on `tab`, grown out of `chip` (a rect in this window's viewport) when given; false where no window opens. */
  open(chip?: ScreenRect, tab?: ThreadsTab): boolean;
  /** True from a request handed to the window until its closed report. */
  isOpen(): boolean;
  /** Opens or raises the window without keyboard focus, selecting `opts.thread` on an open; settles once: "presented" on its own report, "closed" on the closed report, a failure to open, or dispose. */
  present(chip?: ScreenRect, opts?: { thread?: string }): Promise<"presented" | "closed">;
  /** Calls `cb` with true on each open, and with false once the window is hidden again or never opened. */
  onShown(cb: (shown: boolean) => void): () => void;
  dispose(): void;
}

export function createThreadsWindowController(deps: {
  bridge: Pick<
    SettingsBridge,
    "emitThreadsOpen" | "onThreadsReady" | "onThreadsClosed" | "onThreadsPresented"
  >;
}): ThreadsWindowController {
  const listeners = new Set<(shown: boolean) => void>();
  const notify = (shown: boolean): void => {
    for (const cb of listeners) cb(shown);
  };
  const ready = createReadyWindowController({
    label: THREADS_WINDOW_LABEL,
    create: () => createTauriThreadsWindow(closed),
    emitOpen: deps.bridge.emitThreadsOpen,
    onReady: deps.bridge.onThreadsReady,
    onError: () => closed(),
    onSuperseded: ({ present }) => present && settle(present, "closed"),
  });
  // From a request handed to the window until its closed report: a failed request meanwhile leaves it open.
  let open = false;
  const waiters = new Map<string, (result: "presented" | "closed") => void>();
  let seq = 0;
  function settle(id: string, result: "presented" | "closed"): void {
    const waiter = waiters.get(id);
    waiters.delete(id);
    waiter?.(result);
  }
  function settleAll(): void {
    for (const id of [...waiters.keys()]) settle(id, "closed");
  }
  function closed(): void {
    open = false;
    notify(false);
    settleAll();
  }
  const offClosed = deps.bridge.onThreadsClosed(closed);
  const offPresented = deps.bridge.onThreadsPresented(({ present }) =>
    settle(present, "presented"),
  );
  /** Sends `request` once the chip rect is in screen px; false where no window opens. */
  function send(chip: ScreenRect | undefined, request: ThreadsOpen, id?: string): boolean {
    if (!isTauri()) return false;
    notify(true);
    (chip ? toScreen(chip) : Promise.resolve(undefined)).then(
      (screen) => {
        open = true;
        ready.open({ ...(screen ? { chip: screen } : {}), ...request });
      },
      (error) => {
        log.error("threads_window_open_failed", { error: String(error) });
        if (!open) notify(false);
        if (id) settle(id, "closed");
      },
    );
    return true;
  }
  return {
    open: (chip, tab) => send(chip, tab ? { tab } : {}),
    isOpen: () => open,
    present(chip, opts) {
      const id = `present-${++seq}`;
      return new Promise((resolve) => {
        waiters.set(id, resolve);
        const { thread } = opts ?? {};
        const request = {
          ...(thread ? { tab: "threads" as const, thread } : {}),
          focus: false as const,
          present: id,
        };
        if (!send(chip, request, id)) settle(id, "closed");
      });
    },
    onShown(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    dispose() {
      ready.dispose();
      offClosed();
      offPresented();
      settleAll();
      listeners.clear();
    },
  };
}
