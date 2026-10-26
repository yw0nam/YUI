/**
 * Unified chat window opener — one frameless, always-on-top 340 px window labelled `unified`.
 *
 * openUnifiedWindow branches on injected env for the Tauri/browser paths only (pure, testable).
 * createUnifiedWindowController wires the real implementation, dynamic-imported inside the Tauri
 * branch so vitest and the browser dev build never load the module.
 */

import { createLogger } from "../../../logger";
import type { UnifiedWindowSettings } from "../../../settings/unified/unified-window-settings";
import { isTauri } from "../../../tauri-env";
import {
  COMPANION_COLUMN_WIDTH,
  COMPANION_HANDLE_HEIGHT,
  resolveCompanionPosition,
} from "../geometry/companion-position";

const log = createLogger("unified-window");

export const UNIFIED_WINDOW_LABEL = "unified";

interface UnifiedWindowEnv {
  isTauri: boolean;
  /** The already-open unified window, or null. */
  getExisting(): Promise<{ show(): Promise<void>; setFocus(): Promise<void> } | null>;
  create(): Promise<void>;
}

/** Show and focus the unified window, creating it on first use. No-op outside Tauri. */
export async function openUnifiedWindow(env: UnifiedWindowEnv): Promise<void> {
  if (!env.isTauri) return;
  const existing = await env.getExisting();
  if (existing) {
    await existing.show();
    await existing.setFocus();
    return;
  }
  await env.create();
}

/** Destroy the unified window: no close request is emitted, so its own close handler leaves the switch alone. */
export async function closeUnifiedWindow(env: {
  isTauri: boolean;
  getExisting(): Promise<{ destroy(): Promise<void> } | null>;
}): Promise<void> {
  if (!env.isTauri) return;
  await (await env.getExisting())?.destroy();
}

async function tauriUnifiedWindow() {
  const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  return WebviewWindow.getByLabel(UNIFIED_WINDOW_LABEL);
}

async function createTauriUnifiedWindow(stored: UnifiedWindowSettings): Promise<void> {
  const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  const { x, y } = await resolveCompanionPosition(stored);
  const win = new WebviewWindow(UNIFIED_WINDOW_LABEL, {
    url: "unified.html",
    title: "YUI",
    width: COMPANION_COLUMN_WIDTH,
    height: COMPANION_HANDLE_HEIGHT,
    resizable: false,
    decorations: false,
    transparent: true,
    shadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focus: false,
    x,
    y,
  });
  void win.once("tauri://error", (event) =>
    log.error("unified_window_create_error", { error: String(event) }),
  );
}

/** Open/close handle for the unified chat window; both halves run on one chain, since a second create while the first is in flight is refused for the duplicate label. */
export function createUnifiedWindowController(store: {
  get(): UnifiedWindowSettings;
  reloadFromStorage(): void;
}): {
  open(): void;
  close(): void;
} {
  let chain: Promise<void> = Promise.resolve();
  const queue = (step: () => Promise<void>): void => {
    chain = chain.then(step, step);
  };

  return {
    open() {
      queue(async () => {
        try {
          await openUnifiedWindow({
            isTauri: isTauri(),
            getExisting: tauriUnifiedWindow,
            create: () => {
              // The unified window writes its position; this window reads what it last wrote.
              store.reloadFromStorage();
              return createTauriUnifiedWindow(store.get());
            },
          });
        } catch (error) {
          log.warn("unified_window_open_failed", { error: String(error) });
        }
      });
    },
    close() {
      if (!isTauri()) return;
      queue(async () => {
        try {
          await closeUnifiedWindow({ isTauri: true, getExisting: tauriUnifiedWindow });
        } catch (error) {
          log.warn("unified_window_close_failed", { error: String(error) });
        }
      });
    },
  };
}
