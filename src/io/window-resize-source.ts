/**
 * window-resize-source — Ctrl+wheel over the character resizes the pet window.
 *
 * The pet window is resizable but unreachable by OS edge-drag: everything
 * outside the character silhouette is click-through, and dragging on the
 * silhouette moves the window. Ctrl+wheel is the explicit resize gesture —
 * it only fires while the cursor is on the character (the hit-test disables
 * click-through there), scales both dimensions by a per-notch step with the
 * aspect ratio preserved, and re-anchors so the bottom-center (feet) stays
 * fixed. Ignored while perched: the seat pin owns window-local geometry.
 *
 * Tauri deps are injected (same seam style as window-drop-source) so the
 * module is unit-testable without the Tauri runtime. Never throws to the
 * caller — failures degrade to a warn log.
 */

import { createLogger } from "../logger";

const log = createLogger("window-resize");

/** Per-notch scale step (wheel up = ×step, wheel down = ÷step). */
export const RESIZE_STEP = 1.06;
/** Logical-size clamps — both dimensions must stay inside on every step. */
export const MIN_LOGICAL = { width: 160, height: 240 };
export const MAX_LOGICAL = { width: 2400, height: 1800 };

/** Below this |factor − 1| a step is a no-op (already clamped to the wall). */
const NOOP_EPS = 1e-6;

export interface LogicalBounds {
  pos: { x: number; y: number };
  size: { width: number; height: number };
}

/** Wheel deltaY sign → scale factor: up (negative) grows, down shrinks. */
export function stepFactor(deltaY: number): number {
  return deltaY < 0 ? RESIZE_STEP : 1 / RESIZE_STEP;
}

/**
 * Next window bounds for a scale step: clamps the factor so both dimensions
 * stay within [MIN_LOGICAL, MAX_LOGICAL] (aspect ratio preserved), and
 * re-anchors the position so the bottom-center stays fixed. Returns null
 * when the clamped step is a no-op. All values in logical points.
 */
export function nextBounds(
  pos: { x: number; y: number },
  size: { width: number; height: number },
  factor: number,
): LogicalBounds | null {
  if (size.width <= 0 || size.height <= 0 || !Number.isFinite(factor)) return null;
  const fMin = Math.max(MIN_LOGICAL.width / size.width, MIN_LOGICAL.height / size.height);
  const fMax = Math.min(MAX_LOGICAL.width / size.width, MAX_LOGICAL.height / size.height);
  if (fMin > fMax) return null;
  const f = Math.min(Math.max(factor, fMin), fMax);
  if (Math.abs(f - 1) < NOOP_EPS) return null;
  const width = size.width * f;
  const height = size.height * f;
  return {
    pos: { x: pos.x + (size.width - width) / 2, y: pos.y + (size.height - height) },
    size: { width, height },
  };
}

/** Tauri window seam the source reads/writes at wheel time. */
interface ResizeWindow {
  /** Physical px (Tauri outerPosition). */
  outerPosition(): Promise<{ x: number; y: number }>;
  /** Physical px (Tauri outerSize). */
  outerSize(): Promise<{ width: number; height: number }>;
  scaleFactor(): Promise<number>;
  /** Applies logical-point bounds (adapter wraps LogicalPosition/LogicalSize). */
  setBoundsLogical(
    pos: { x: number; y: number },
    size: { width: number; height: number },
  ): Promise<void>;
}

/** Wheel-event target seam (defaults to the global window). */
interface WheelTarget {
  addEventListener(
    type: "wheel",
    handler: (e: WheelEvent) => void,
    opts?: AddEventListenerOptions,
  ): void;
  removeEventListener(type: "wheel", handler: (e: WheelEvent) => void): void;
}

interface WindowResizeSourceDeps {
  renderer: { isPerched(): boolean };
  /** Resolve the pet window (lazily — `getCurrentWindow()` throws off-Tauri). */
  getWindow: () => ResizeWindow;
  /** Event target (injectable for tests). */
  target?: WheelTarget;
}

export interface WindowResizeSource {
  /** Register the wheel listener. Idempotent. */
  start(): void;
  /** Unregister the wheel listener. */
  stop(): void;
  /** Alias of stop() for HMR-dispose call sites. */
  dispose(): void;
}

export function createWindowResizeSource(deps: WindowResizeSourceDeps): WindowResizeSource {
  const { renderer, getWindow } = deps;
  const target: WheelTarget = deps.target ?? window;

  let listening = false;
  // Steps accumulate multiplicatively while a bounds read/write is in flight,
  // so rapid notches coalesce instead of racing stale reads.
  let pendingFactor = 1;
  let inFlight = false;

  async function flush(): Promise<void> {
    if (inFlight) return;
    inFlight = true;
    try {
      while (Math.abs(pendingFactor - 1) >= NOOP_EPS) {
        const factor = pendingFactor;
        pendingFactor = 1;
        const win = getWindow();
        const [pos, size, scale] = await Promise.all([
          win.outerPosition(),
          win.outerSize(),
          win.scaleFactor(),
        ]);
        const sf = scale > 0 ? scale : 1;
        const next = nextBounds(
          { x: pos.x / sf, y: pos.y / sf },
          { width: size.width / sf, height: size.height / sf },
          factor,
        );
        if (next) {
          await win.setBoundsLogical(next.pos, next.size);
          log.debug("resize.applied", {
            width: Math.round(next.size.width),
            height: Math.round(next.size.height),
          });
        }
      }
    } catch (err) {
      pendingFactor = 1;
      log.warn("resize_failed", { degrade: true, error: String(err) });
    } finally {
      inFlight = false;
    }
  }

  function onWheel(e: WheelEvent): void {
    if (!e.ctrlKey) return;
    // Always claim ctrl+wheel on the character: the webview's own page-zoom
    // must never fire, perched or not.
    e.preventDefault();
    if (renderer.isPerched()) return;
    if (e.deltaY === 0) return;
    pendingFactor *= stepFactor(e.deltaY);
    void flush();
  }

  return {
    start() {
      if (listening) return;
      listening = true;
      target.addEventListener("wheel", onWheel, { passive: false });
    },
    stop() {
      if (!listening) return;
      listening = false;
      target.removeEventListener("wheel", onWheel);
    },
    dispose() {
      this.stop();
    },
  };
}
