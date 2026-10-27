/**
 * quick-card-dock — the quick-card window's placement and motion: docked placement beside the
 * character on an open request, travel with the owner pet window while docked, the head drag
 * that detaches it, and the magnet that snaps a near drop back beside her.
 *
 * All placement math runs in screen logical px (see io/window/geometry/quick-card-position);
 * the physical window reads are converted with each window's own scale factor.
 */

import type { QuickCardOpen, SettingsBridge } from "../../io/bridge/settings-bridge";
import { startDragging } from "../../io/window/geometry/companion-column";
import {
  followOwner,
  type QuickCardPlacement,
  type QuickCardWorkArea,
  quickCardBeside,
  snapTarget,
} from "../../io/window/geometry/quick-card-position";
import {
  logicalWorkArea,
  monitorAtLogical,
  toScreenMonitor,
} from "../../io/window/geometry/screen-geometry";
import { createLogger } from "../../logger";
import { isTauri } from "../../tauri-env";

const log = createLogger("quick-card-dock");

/** Transparent margin around the card inside its window, for the shadow; matches the CSS. */
export const QUICK_CARD_MARGIN_PX = 8;

/** Self-moves land within a logical px of the placed position; a drag goes further at once. */
const SELF_MOVE_TOLERANCE_PX = 1;

interface DockCard {
  open(): void;
  cardSize(): { width: number; height: number };
  el: HTMLElement;
  onHeadPointerDown(cb: (event: PointerEvent) => void): () => void;
}

export function wireQuickCardDock(deps: {
  bridge: Pick<SettingsBridge, "onQuickCardOpen" | "emitQuickCardReady">;
  card: DockCard;
  /** Applies the request's listening flag to the Listen tile without echoing it back. */
  seedListen(listening: boolean): void;
  /** The owner pet window's label. */
  ownerLabel: string;
}): void {
  const margin = QUICK_CARD_MARGIN_PX;
  const box = () => {
    const size = deps.card.cardSize();
    return { width: size.width + margin * 2, height: size.height + margin * 2 };
  };

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
      scale,
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

  function characterOf(ownerLog: { x: number; y: number }, request: QuickCardOpen) {
    return {
      left: ownerLog.x + request.left,
      right: ownerLog.x + request.right,
      y: ownerLog.y + request.y,
    };
  }

  async function moveTo(next: QuickCardPlacement): Promise<void> {
    const win = await ownWindow();
    const { LogicalPosition } = await import("@tauri-apps/api/dpi");
    await win.setPosition(new LogicalPosition(next.x, next.y));
    placement = next;
    expected = { x: next.x, y: next.y };
  }

  async function placeDocked(request: QuickCardOpen): Promise<void> {
    const owner = await readOwner();
    const character = characterOf(owner.log, request);
    const workArea = await workAreaAt({
      x: (character.left + character.right) / 2,
      y: character.y,
    });
    const next = quickCardBeside({
      character,
      window: deps.card.cardSize(),
      margin,
      workArea,
    });
    const win = await ownWindow();
    const { LogicalSize } = await import("@tauri-apps/api/dpi");
    const size = box();
    await win.setSize(new LogicalSize(size.width, size.height));
    await moveTo(next);
    await win.show();
    await win.setFocus();
    lastRequest = request;
    lastOwnerLog = owner.log;
    docked = true;
  }

  async function followOwnerMove(): Promise<void> {
    if (!docked || !lastRequest || !lastOwnerLog || !placement) return;
    const owner = await readOwner();
    const delta = { dx: owner.log.x - lastOwnerLog.x, dy: owner.log.y - lastOwnerLog.y };
    if (!delta.dx && !delta.dy) return;
    const character = characterOf(owner.log, lastRequest);
    const workArea = await workAreaAt({
      x: (character.left + character.right) / 2,
      y: character.y,
    });
    await moveTo(
      followOwner({
        character,
        card: placement,
        delta,
        window: deps.card.cardSize(),
        margin,
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
    const character = characterOf(owner.log, lastRequest);
    const workArea = await workAreaAt({
      x: (character.left + character.right) / 2,
      y: character.y,
    });
    const snap = snapTarget({
      character,
      owner: { y: owner.log.y, height: owner.height },
      card: { x: position.x / scale, y: position.y / scale },
      window: deps.card.cardSize(),
      margin,
      workArea,
    });
    if (!snap) return;
    await moveTo(snap);
    docked = true;
  }

  deps.card.onHeadPointerDown(() => {
    if (!isTauri()) return;
    dragArmed = true;
    queue(async () => {
      await startDragging("quick-card");
      await settleDrop();
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
      ) {
        expected = logical;
        return;
      }
      // The first move of the window itself after a head pointerdown is the drag leaving the dock.
      if (dragArmed && docked) {
        docked = false;
        log.info("quick_card_detached");
      }
    });
    const owner = await readOwner();
    owner.onMoved(() => queue(followOwnerMove));
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
      const height = deps.card.cardSize().height;
      if (height === lastHeight || !placement) return;
      lastHeight = height;
      queue(async () => {
        const current = placement;
        if (!current) return;
        const size = box();
        const win = await ownWindow();
        const { LogicalSize } = await import("@tauri-apps/api/dpi");
        await win.setSize(new LogicalSize(size.width, size.height));
        const workArea = await workAreaAt({
          x: current.x + size.width / 2,
          y: current.y + size.height / 2,
        });
        const clampedX = Math.min(
          Math.max(current.x, workArea.x),
          Math.max(workArea.x, workArea.x + workArea.width - size.width),
        );
        const clampedY = Math.min(
          Math.max(current.y, workArea.y),
          Math.max(workArea.y, workArea.y + workArea.height - size.height),
        );
        if (clampedX !== current.x || clampedY !== current.y)
          await moveTo({ x: clampedX, y: clampedY, side: current.side });
      });
    });
    observer.observe(deps.card.el);
  }

  void deps.bridge.emitQuickCardReady();
}
