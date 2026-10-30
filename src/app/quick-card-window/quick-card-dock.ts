/** The quick-card window's dock wiring: her open request seeds the card, the shared window dock places it beside her. */

import type { QuickCardOpen, SettingsBridge } from "../../io/bridge/settings-bridge";
import { createWindowDock } from "../../io/window/dock/window-dock";
import {
  QUICK_CARD_GAP_PX,
  QUICK_CARD_MARGIN_PX,
  quickCardBeside,
  quickCardBox,
} from "../../io/window/geometry/quick-card-position";
import { createLogger } from "../../logger";
import { isTauri } from "../../tauri-env";

const log = createLogger("quick-card-dock");

export interface QuickCardDockCard {
  open(): void;
  isOpen(): boolean;
  /** The card's content size in logical px. */
  contentSize(): { width: number; height: number };
  el: HTMLElement;
  onHeadPointerDown(cb: (event: PointerEvent) => void): () => void;
}

export function wireQuickCardDock(deps: {
  bridge: Pick<SettingsBridge, "onQuickCardOpen" | "emitQuickCardReady">;
  card: QuickCardDockCard;
  /** Applies the request's listening flag to the Listen tile without echoing it back. */
  seedListen(listening: boolean): void;
  /** The owner pet window's label. */
  ownerLabel: string;
}): { hide(): Promise<void> } {
  const dock = createWindowDock<QuickCardOpen>({
    ownerLabel: deps.ownerLabel,
    isOpen: () => deps.card.isOpen(),
    box: () => quickCardBox(deps.card.contentSize()),
    inset: QUICK_CARD_MARGIN_PX,
    gap: QUICK_CARD_GAP_PX,
    anchor: (owner, request) => {
      const character = {
        left: owner.log.x + request.left,
        right: owner.log.x + request.right,
        y: owner.log.y + request.y,
      };
      return {
        anchor: character,
        at: { x: (character.left + character.right) / 2, y: character.y },
      };
    },
    beside: (character, workArea, side) =>
      quickCardBeside({ character, content: deps.card.contentSize(), workArea, side }),
    fit: async () => {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const { LogicalSize } = await import("@tauri-apps/api/dpi");
      const box = quickCardBox(deps.card.contentSize());
      await getCurrentWindow().setSize(new LogicalSize(box.width, box.height));
    },
    onHeadPointerDown: deps.card.onHeadPointerDown,
    boot: async () => {
      // A reload while the card showed would leave its window shown with no card in it.
      if (isTauri()) {
        await dock
          .hide()
          .catch((error) => log.warn("quick_card_boot_hide_failed", { error: String(error) }));
      }
      void deps.bridge.emitQuickCardReady();
    },
  });

  deps.bridge.onQuickCardOpen((request) => {
    if (request.listening !== undefined) deps.seedListen(request.listening);
    deps.card.open();
    void dock.dock(request).catch(() => undefined);
  });

  // A card resize (the reset confirm growing a row) re-sizes the window and re-clamps it.
  if (typeof ResizeObserver !== "undefined") {
    let lastHeight = 0;
    const observer = new ResizeObserver(() => {
      const height = deps.card.contentSize().height;
      if (height === lastHeight) return;
      lastHeight = height;
      dock.resized();
    });
    observer.observe(deps.card.el);
  }

  return { hide: dock.hide };
}
