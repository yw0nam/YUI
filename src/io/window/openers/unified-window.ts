/**
 * Unified chat window opener — one decorated, resizable window labelled `unified`.
 *
 * openUnifiedWindow branches on injected env for the Tauri/browser paths only (pure, testable).
 * createUnifiedWindowController wires the real implementation, dynamic-imported inside the Tauri
 * branch so vitest and the browser dev build never load the module.
 */

import { createLogger } from "../../../logger";
import { isTauri } from "../../../tauri-env";

const log = createLogger("unified-window");

const UNIFIED_WINDOW_LABEL = "unified";

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

async function tauriUnifiedWindow() {
  const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  return WebviewWindow.getByLabel(UNIFIED_WINDOW_LABEL);
}

async function createTauriUnifiedWindow(): Promise<void> {
  const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  const win = new WebviewWindow(UNIFIED_WINDOW_LABEL, {
    url: "unified.html",
    title: "YUI",
    width: 760,
    height: 640,
    minWidth: 480,
    minHeight: 360,
    resizable: true,
    decorations: true,
    alwaysOnTop: false,
    skipTaskbar: false,
    focus: true,
  });
  void win.once("tauri://error", (event) =>
    log.error("unified_window_create_error", { error: String(event) }),
  );
}

/** Open/close handle for the unified chat window; both halves run on one chain, since a second create while the first is in flight is refused for the duplicate label. */
export function createUnifiedWindowController(): { open(): void; close(): void } {
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
            create: createTauriUnifiedWindow,
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
          await (await tauriUnifiedWindow())?.close();
        } catch (error) {
          log.warn("unified_window_close_failed", { error: String(error) });
        }
      });
    },
  };
}
