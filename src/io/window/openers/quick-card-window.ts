/** Creates the preset's hidden quick-card window once, recreating a leftover one, and sends it open requests once it is ready. */

import { createLogger } from "../../../logger";
import { windowLabel } from "../../../settings/preset/pet-windows";
import { isTauri } from "../../../tauri-env";
import type { QuickCardOpen, SettingsBridge } from "../../bridge/settings-bridge";
import { QUICK_CARD_MARGIN_PX, QUICK_CARD_WIDTH_PX } from "../geometry/quick-card-position";

const log = createLogger("quick-card-window");

/** The card plus the transparent margin its window adds on every side; the card window sizes itself on open. */
const QUICK_CARD_WINDOW_WIDTH = QUICK_CARD_WIDTH_PX + QUICK_CARD_MARGIN_PX * 2;
const QUICK_CARD_WINDOW_HEIGHT = 120;
/** How long a leftover window gets to report destroyed before the new one is created anyway. */
const DESTROY_WAIT_MS = 500;

type LeftoverWindow = {
  destroy(): Promise<void>;
  once(event: "tauri://destroyed", cb: () => void): Promise<() => void>;
};

interface QuickCardWindowEnv {
  isTauri: boolean;
  /** The already-open card window, or null. */
  getExisting(): Promise<LeftoverWindow | null>;
  create(): void;
}

/** Destroys the window and waits for its label to free, or for the timeout. */
async function destroyAndWait(win: LeftoverWindow): Promise<void> {
  let done: () => void = () => {};
  const gone = new Promise<void>((resolve) => {
    done = resolve;
  });
  const timer = setTimeout(() => {
    log.warn("quick_card_window_destroy_timeout");
    done();
  }, DESTROY_WAIT_MS);
  const off = await win.once("tauri://destroyed", done);
  await win.destroy();
  await gone;
  clearTimeout(timer);
  off();
}

async function openQuickCardWindow(env: QuickCardWindowEnv, fresh: boolean): Promise<boolean> {
  if (!env.isTauri) return false;
  if (fresh) {
    const leftover = await env.getExisting();
    if (leftover) await destroyAndWait(leftover);
  }
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
        width: QUICK_CARD_WINDOW_WIDTH,
        height: QUICK_CARD_WINDOW_HEIGHT,
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
