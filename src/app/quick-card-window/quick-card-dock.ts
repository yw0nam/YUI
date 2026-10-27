/** The quick-card window's placement and motion: docked beside her, following her, detached by a head drag, snapped back. */

import type { QuickCardOpen, SettingsBridge } from "../../io/bridge/settings-bridge";
import {
  clampQuickCard,
  followOwner,
  type QuickCardPlacement,
  type QuickCardWorkArea,
  quickCardBeside,
  quickCardBox,
  snapTarget,
} from "../../io/window/geometry/quick-card-position";
import { invokeDragWindow } from "../../io/window/pet/gesture/window-drag";
import {
  logicalWorkArea,
  monitorAtLogical,
  toScreenMonitor,
} from "../../io/window/geometry/screen-geometry";
import { createLogger } from "../../logger";
import { isTauri } from "../../tauri-env";

const log = createLogger("quick-card-dock");

/** Self-moves land within a logical px of the placed position; a drag leaves it. */
const SELF_MOVE_TOLERANCE_PX = 1;

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
  /** The card's window is shown and has taken focus. */
  onShown(): void;
}): void {
  let lastRequest: QuickCardOpen | null = null;
  let lastOwnerLog: { x: number; y: number } | null = null;
  let placement: QuickCardPlacement | null = null;
  let expected: { x: number; y: number } | null = null;
  let docked = true;
  let dragArmed = false;
  let chain: Promise<void> = Promise.resolve();
  const queue = (step: () => Promise<void>): void => {
    chain = chain
      .then(step)
      .catch((error) => log.warn("dock_step_failed", { error: String(error) }));
  };

  async function readOwner() {
    const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    const owner = await WebviewWindow.getByLabel(deps.ownerLabel);
    if (!owner) throw new Error(`owner window ${deps.ownerLabel} not found`);
    const [position, size, scale] = await Promise.all([
      owner.outerPosition(),
      owner.outerSize(),
      owner.scaleFactor(),
    ]);
    return {
      log: { x: position.x / scale, y: position.y / scale },
      height: size.height / scale,
      onMoved: owner.onMoved.bind(owner),
    };
  }

  async function workAreaAt(point: { x: number; y: number }): Promise<QuickCardWorkArea> {
    const { availableMonitors, primaryMonitor } = await import("@tauri-apps/api/window");
    const [list, primary] = await Promise.all([availableMonitors(), primaryMonitor()]);
    const monitors = list.map(toScreenMonitor);
    const monitor =
      monitorAtLogical(monitors, point.x, point.y) ??
      (primary ? toScreenMonitor(primary) : monitors[0]);
    return monitor ? logicalWorkArea(monitor) : { x: 0, y: 0, width: 0, height: 0 };
  }

  async function ownWindow() {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    return getCurrentWindow();
  }

  /** Her on-screen extent for the request against the owner's position, and the work area she stands in. */
  async function characterArea(ownerLog: { x: number; y: number }, request: QuickCardOpen) {
    const character = {
      left: ownerLog.x + request.left,
      right: ownerLog.x + request.right,
      y: ownerLog.y + request.y,
    };
    const workArea = await workAreaAt({
      x: (character.left + character.right) / 2,
      y: character.y,
    });
    return { character, workArea };
  }

  async function resizeToCard(): Promise<{ width: number; height: number }> {
    const box = quickCardBox(deps.card.contentSize());
    const { LogicalSize } = await import("@tauri-apps/api/dpi");
    await (await ownWindow()).setSize(new LogicalSize(box.width, box.height));
    return box;
  }

  async function moveTo(next: QuickCardPlacement): Promise<void> {
    const { LogicalPosition } = await import("@tauri-apps/api/dpi");
    await (await ownWindow()).setPosition(new LogicalPosition(next.x, next.y));
    placement = next;
    expected = { x: next.x, y: next.y };
  }

  async function placeDocked(request: QuickCardOpen): Promise<void> {
    const owner = await readOwner();
    const { character, workArea } = await characterArea(owner.log, request);
    await resizeToCard();
    await moveTo(quickCardBeside({ character, content: deps.card.contentSize(), workArea }));
    const win = await ownWindow();
    await win.show();
    await win.setFocus();
    deps.onShown();
    lastRequest = request;
    lastOwnerLog = owner.log;
    docked = true;
  }

  async function followOwnerMove(): Promise<void> {
    if (!deps.card.isOpen() || !docked || !lastRequest || !lastOwnerLog || !placement) return;
    const owner = await readOwner();
    const delta = { dx: owner.log.x - lastOwnerLog.x, dy: owner.log.y - lastOwnerLog.y };
    if (!delta.dx && !delta.dy) return;
    const { character, workArea } = await characterArea(owner.log, lastRequest);
    await moveTo(
      followOwner({
        character,
        card: placement,
        delta,
        content: deps.card.contentSize(),
        workArea,
      }),
    );
    lastOwnerLog = owner.log;
  }

  /** A drop after a detach snaps back beside her when it landed near one of her edges. */
  async function settleDrop(): Promise<void> {
    dragArmed = false;
    if (docked || !lastRequest) return;
    const [win, owner] = await Promise.all([ownWindow(), readOwner()]);
    const [position, scale] = await Promise.all([win.outerPosition(), win.scaleFactor()]);
    const { character, workArea } = await characterArea(owner.log, lastRequest);
    const snap = snapTarget({
      character,
      owner: { y: owner.log.y, height: owner.height },
      card: { x: position.x / scale, y: position.y / scale },
      content: deps.card.contentSize(),
      workArea,
    });
    if (!snap) return;
    await moveTo(snap);
    lastOwnerLog = owner.log;
    docked = true;
  }

  // Started from the pointerdown itself: the OS drag needs the button still held.
  deps.card.onHeadPointerDown(() => {
    if (!isTauri()) return;
    dragArmed = true;
    invokeDragWindow().catch((error) => {
      dragArmed = false;
      log.warn("quick_card_drag_failed", { error: String(error) });
    });
  });

  queue(async () => {
    const win = await ownWindow();
    const scale = await win.scaleFactor();
    await win.onMoved(({ payload }) => {
      const logical = { x: payload.x / scale, y: payload.y / scale };
      if (
        expected &&
        Math.abs(logical.x - expected.x) <= SELF_MOVE_TOLERANCE_PX &&
        Math.abs(logical.y - expected.y) <= SELF_MOVE_TOLERANCE_PX
      )
        return;
      // The first move of the window itself after a head pointerdown is the drag leaving the dock.
      if (dragArmed && docked) {
        docked = false;
        log.info("quick_card_detached");
      }
    });
    const owner = await readOwner();
    owner.onMoved(() => queue(followOwnerMove));
    // Every window hears the release of any native drag; only a drag this card started settles here.
    const { listen } = await import("@tauri-apps/api/event");
    await listen("window_drop_release", () => {
      if (dragArmed) queue(settleDrop);
    });
  });

  deps.bridge.onQuickCardOpen((request) => {
    if (request.listening !== undefined) deps.seedListen(request.listening);
    deps.card.open();
    queue(() => placeDocked(request));
  });

  // A card resize (the reset confirm growing a row) re-sizes the window and re-clamps it.
  if (typeof ResizeObserver !== "undefined") {
    let lastHeight = 0;
    const observer = new ResizeObserver(() => {
      const height = deps.card.contentSize().height;
      if (height === lastHeight || !placement) return;
      lastHeight = height;
      queue(async () => {
        const current = placement;
        if (!current) return;
        const box = await resizeToCard();
        const workArea = await workAreaAt({
          x: current.x + box.width / 2,
          y: current.y + box.height / 2,
        });
        const at = clampQuickCard(current, box, workArea);
        if (at.x !== current.x || at.y !== current.y) await moveTo({ ...at, side: current.side });
      });
    });
    observer.observe(deps.card.el);
  }

  void deps.bridge.emitQuickCardReady();
}
