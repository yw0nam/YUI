/** Creates the preset's hidden quick-card window once, recreating a leftover one, and sends it open requests once it is ready. */

import { createLogger } from "../../../logger";
import { windowLabel } from "../../../settings/preset/pet-windows";
import type { QuickCardOpen, SettingsBridge } from "../../bridge/settings-bridge";
import { QUICK_CARD_MARGIN_PX, QUICK_CARD_WIDTH_PX } from "../geometry/quick-card-position";
import { createReadyWindowController } from "./ready-window";

const log = createLogger("quick-card-window");

/** The card plus the transparent margin its window adds on every side; the card window sizes itself on open. */
const QUICK_CARD_WINDOW_WIDTH = QUICK_CARD_WIDTH_PX + QUICK_CARD_MARGIN_PX * 2;
const QUICK_CARD_WINDOW_HEIGHT = 120;

const label = (boundId: string | null): string =>
  boundId === null ? "quick-card" : windowLabel("quick-card", boundId);

function createTauriQuickCardWindow(boundId: string | null): void {
  void (async () => {
    const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    const win = new WebviewWindow(label(boundId), {
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
    });
    void win.once("tauri://error", (event) =>
      log.error("quick_card_window_create_error", { error: String(event) }),
    );
  })();
}

export function createQuickCardWindowController(deps: {
  boundId: string | null;
  bridge: Pick<SettingsBridge, "emitQuickCardOpen" | "onQuickCardReady">;
}): { open(request: QuickCardOpen): void; dispose(): void } {
  return createReadyWindowController({
    label: label(deps.boundId),
    create: () => createTauriQuickCardWindow(deps.boundId),
    emitOpen: deps.bridge.emitQuickCardOpen,
    onReady: deps.bridge.onQuickCardReady,
  });
}
