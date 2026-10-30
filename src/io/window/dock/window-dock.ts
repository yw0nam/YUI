/**
 * The window dock the quick-card and Threads windows share: docked beside its owner pet window,
 * dragged off by the head, snapped back on a near drop, following the owner while docked.
 * While linked (macOS), AppKit moves the window with its owner in the same frame.
 */

import { createLogger } from "../../../logger";
import { isTauri } from "../../../tauri-env";
import { logicalWorkArea, monitorAtLogical, toScreenMonitor } from "../geometry/screen-geometry";
import { invokeDragWindow } from "../pet/gesture/window-drag";
import { attachToOwner, detachFromOwner } from "./dock-link";
import {
  clampDock,
  type DockAnchor,
  type DockPlacement,
  type DockSide,
  type DockSize,
  type DockWorkArea,
  followOwner,
  snapTarget,
} from "./dock-position";

const log = createLogger("window-dock");

/** Self-moves land within a logical px of the placed position; a drag leaves it. */
const SELF_MOVE_TOLERANCE_PX = 1;

/** The owner pet window's read: position and size in logical px, and its move events. */
export interface DockOwner {
  log: { x: number; y: number };
  width: number;
  height: number;
  onMoved: (cb: (event: { payload: { x: number; y: number } }) => void) => Promise<() => void>;
}

/** The docked windows' labels: their drops settle in their own windows, never on a pet. */
export function isDockedWindowLabel(label: string): boolean {
  return label === "threads" || label.startsWith("quick-card");
}

export interface WindowDockDeps<Request> {
  /** The owner pet window's label. */
  ownerLabel: string;
  /** False when the window closed while its dock was being placed; its close already hid it. */
  isOpen?(): boolean;
  /** The window's box in logical px, as last fitted. */
  box(): DockSize;
  /** The visible content's inset from the window edge: the magnet's edge and the docked offsets. */
  inset: number;
  /** The gap between the owner's edge and the window's visible edge while docked. */
  gap: number;
  /** The owner's anchor extent, and the point to read the work area at, for a request. */
  anchor(owner: DockOwner, request: Request): { anchor: DockAnchor; at: { x: number; y: number } };
  /** The bounds a follow or a snap clamps into; the work area by default. */
  clampBounds?(workArea: DockWorkArea): DockWorkArea;
  /** The docked placement beside `anchor` on `side`; absent side, the roomier one. */
  beside(anchor: DockAnchor, workArea: DockWorkArea, side?: DockSide): DockPlacement;
  /** Sizes the window to `box()` before a docked move. */
  fit(): Promise<void>;
  /** The window's boot step, queued after the dock's listeners: hide, then report ready. */
  boot?(): Promise<void>;
  /** The head is the drag handle. */
  onHeadPointerDown(cb: (event: PointerEvent) => void): () => void;
}

export function createWindowDock<Request>(deps: WindowDockDeps<Request>): {
  /** Places the window docked for the request, then shows, links and focuses it; resolves with the placement. */
  dock(request: Request): Promise<DockPlacement>;
  /** Unlinks the window, then hides it. */
  hide(): Promise<void>;
  /** Re-fits the window and pulls it back into the work area after its content grew. */
  resized(): void;
} {
  // The window's own label, read at boot, names it in the dock logs.
  let label = "";
  let lastRequest: Request | null = null;
  let lastOwnerLog: { x: number; y: number } | null = null;
  let placement: DockPlacement | null = null;
  let expected: { x: number; y: number } | null = null;
  let docked = true;
  let dragArmed = false;
  // While linked, AppKit moves the window with its owner; the dock only switches sides.
  let linked = false;
  let chain: Promise<unknown> = Promise.resolve();
  const queue = <T>(step: () => Promise<T>): Promise<T> => {
    const run = chain.then(step);
    chain = run.then(
      () => {},
      (error) => log.warn("dock_step_failed", { label, error: String(error) }),
    );
    return run;
  };

  async function readOwner(): Promise<DockOwner> {
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
      width: size.width / scale,
      height: size.height / scale,
      onMoved: owner.onMoved.bind(owner),
    };
  }

  async function workAreaAt(point: { x: number; y: number }): Promise<DockWorkArea> {
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

  async function link(): Promise<void> {
    linked = await attachToOwner(deps.ownerLabel);
  }

  /** A linked child its owner could order back in, so the window unlinks first. */
  async function hide(): Promise<void> {
    if (isTauri()) {
      linked = false;
      await detachFromOwner();
    }
    await (await ownWindow()).hide();
    docked = false;
  }

  async function moveTo(next: DockPlacement): Promise<void> {
    const { LogicalPosition } = await import("@tauri-apps/api/dpi");
    await (await ownWindow()).setPosition(new LogicalPosition(next.x, next.y));
    placement = next;
    expected = { x: next.x, y: next.y };
  }

  async function place(request: Request): Promise<DockPlacement> {
    const owner = await readOwner();
    const { anchor, at } = deps.anchor(owner, request);
    const workArea = await workAreaAt(at);
    const next = deps.beside(anchor, workArea);
    await deps.fit();
    await moveTo(next);
    // Closed meanwhile (Escape): its close already hid the window.
    if (deps.isOpen && !deps.isOpen()) return next;
    const win = await ownWindow();
    await win.show();
    await link();
    await win.setFocus();
    lastRequest = request;
    lastOwnerLog = owner.log;
    docked = true;
    return next;
  }

  async function followOwnerMove(): Promise<void> {
    if ((deps.isOpen && !deps.isOpen()) || !docked || !lastRequest || !lastOwnerLog || !placement)
      return;
    const owner = await readOwner();
    const delta = { dx: owner.log.x - lastOwnerLog.x, dy: owner.log.y - lastOwnerLog.y };
    if (!delta.dx && !delta.dy) return;
    const { anchor, at } = deps.anchor(owner, lastRequest);
    const workArea = await workAreaAt(at);
    const next = followOwner({
      window: placement,
      delta,
      box: deps.box(),
      bounds: deps.clampBounds ? deps.clampBounds(workArea) : workArea,
      beside: (side) => deps.beside(anchor, workArea, side),
    });
    if (linked && next.side === placement.side) {
      // AppKit already moved it with its owner; only the record follows.
      placement = { x: placement.x + delta.dx, y: placement.y + delta.dy, side: placement.side };
      expected = { x: placement.x, y: placement.y };
    } else {
      // A flip onto another monitor's work area can change the box.
      await deps.fit();
      await moveTo(next);
    }
    lastOwnerLog = owner.log;
  }

  /** A drop after a detach snaps back beside the owner when it landed near one of its edges. */
  async function settleDrop(): Promise<void> {
    dragArmed = false;
    if (!lastRequest) return;
    // A head click that never moved: still docked, linked again.
    if (docked) return link();
    const [win, owner] = await Promise.all([ownWindow(), readOwner()]);
    const [position, scale] = await Promise.all([win.outerPosition(), win.scaleFactor()]);
    const { anchor, at } = deps.anchor(owner, lastRequest);
    const workArea = await workAreaAt(at);
    const snap = snapTarget({
      anchor,
      owner: { y: owner.log.y, height: owner.height },
      dropped: { x: position.x / scale, y: position.y / scale },
      box: deps.box(),
      inset: deps.inset,
      gap: deps.gap,
      bounds: deps.clampBounds ? deps.clampBounds(workArea) : workArea,
    });
    if (!snap) return;
    await moveTo(snap);
    lastOwnerLog = owner.log;
    docked = true;
    await link();
  }

  // Started from the pointerdown itself: the OS drag needs the button still held.
  deps.onHeadPointerDown(() => {
    if (!isTauri()) return;
    dragArmed = true;
    linked = false;
    // Unlinked first: a child window's drag would otherwise still answer to its owner's moves.
    void (async () => {
      await detachFromOwner();
      await invokeDragWindow();
    })().catch((error) => {
      dragArmed = false;
      log.warn("dock_drag_failed", { label, error: String(error) });
    });
  });

  queue(async () => {
    const win = await ownWindow();
    label = win.label;
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
        log.info("dock_detached", { label });
      }
    });
    const owner = await readOwner();
    // Latest wins: a follow step not yet started already reads the owner's newest position.
    let followQueued = false;
    owner.onMoved(() => {
      if (followQueued) return;
      followQueued = true;
      queue(() => {
        followQueued = false;
        return followOwnerMove();
      });
    });
    // Every window hears the release of any native drag; only a drag this window started settles here.
    const { listen } = await import("@tauri-apps/api/event");
    await listen("window_drop_release", () => {
      if (dragArmed) queue(settleDrop);
    });
  });
  if (deps.boot) queue(deps.boot);

  return {
    dock: (request: Request) => queue(() => place(request)),
    hide,
    resized: (): void => {
      void queue(async () => {
        const current = placement;
        if (!current) return;
        await deps.fit();
        const box = deps.box();
        const workArea = await workAreaAt({
          x: current.x + box.width / 2,
          y: current.y + box.height / 2,
        });
        const at = clampDock(current, box, workArea);
        if (at.x !== current.x || at.y !== current.y) await moveTo({ ...at, side: current.side });
      });
    },
  };
}
