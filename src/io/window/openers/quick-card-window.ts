/**
 * Quick-card window opener.
 *
 * createQuickCardWindowController creates the preset's quick-card window on the first open
 * request (hidden — placement happens in the card window itself), keeps it for later requests,
 * and holds a request made before the window reports ready until the report arrives. A window
 * left over from a pet window reload is destroyed and created again, so a fresh ready report
 * always follows.
 */

import type { QuickCardOpen, SettingsBridge } from "../../bridge/settings-bridge";
import { createLogger } from "../../../logger";
import { windowLabel } from "../../../settings/preset/pet-windows";
import { isTauri } from "../../../tauri-env";

const log = createLogger("quick-card-window");

/** The card (272px) plus the transparent 8px margin its window adds on every side. */
const CARD_WINDOW_WIDTH = 288;
const CARD_WINDOW_HEIGHT = 120;

interface QuickCardWindowEnv {
  isTauri: boolean;
  /** The already-open card window, or null. */
  getExisting(): Promise<{ close(): Promise<void> } | null>;
  create(): void;
}

async function openQuickCardWindow(env: QuickCardWindowEnv, fresh: boolean): Promise<boolean> {
  if (!env.isTauri) return false;
  if (fresh) await (await env.getExisting())?.close();
  const existing = fresh ? null : await env.getExisting();
  if (!existing) env.create();
  return true;
}

async function tauriQuickCardWindow(boundId: string | null) {
  const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  return WebviewWindow.getByLabel(
    boundId === null ? "quick-card" : windowLabel("quick-card", boundId),
  );
}

function createTauriQuickCardWindow(boundId: string | null): void {
  void (async () => {
    const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    const win = new WebviewWindow(
      boundId === null ? "quick-card" : windowLabel("quick-card", boundId),
      {
        url:
          boundId === null
            ? "quick-card.html"
            : `quick-card.html?preset=${encodeURIComponent(boundId)}`,
        title: "YUI",
        width: CARD_WINDOW_WIDTH,
        height: CARD_WINDOW_HEIGHT,
        resizable: false,
        decorations: false,
        transparent: true,
        shadow: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        visible: false,
        focus: false,
        acceptFirstMouse: true,
      },
    );
    void win.once("tauri://error", (event) =>
      log.error("quick_card_window_create_error", { error: String(event) }),
    );
  })();
}

export function createQuickCardWindowController(deps: {
  boundId: string | null;
  bridge: Pick<SettingsBridge, "emitQuickCardOpen" | "onQuickCardReady">;
}): { open(request: QuickCardOpen): void; dispose(): void } {
  const env: QuickCardWindowEnv = {
    isTauri: isTauri(),
    getExisting: () => tauriQuickCardWindow(deps.boundId),
    create: () => createTauriQuickCardWindow(deps.boundId),
  };
  let created = false;
  let booted = false;
  let pending: QuickCardOpen | null = null;
  let chain: Promise<void> = Promise.resolve();
  const offReady = deps.bridge.onQuickCardReady(() => {
    booted = true;
    if (pending) {
      deps.bridge.emitQuickCardOpen(pending);
      pending = null;
    }
  });
  return {
    open(request) {
      if (!env.isTauri) return;
      chain = chain.then(async () => {
        try {
          const opened = await openQuickCardWindow(env, !created);
          if (!opened) return;
          created = true;
          // The ready report of a reused window has already arrived; only a fresh boot holds the request.
          if (booted && !pending) deps.bridge.emitQuickCardOpen(request);
          else pending = request;
        } catch (error) {
          log.error("quick_card_window_open_failed", { error: String(error) });
        }
      });
    },
    dispose() {
      offReady();
    },
  };
}
