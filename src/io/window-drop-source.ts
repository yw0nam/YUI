/**
 * window-drop-source — Rust `window_drop_release` → bus envelope producer.
 *
 * Client-firing, backend-bypassed (firing ≠ judgment): on a drag-release the
 * client decides whether the character's *seat* landed over a foreign window's
 * top-edge catch zone, and emits a tier1 bus event the dispatcher renders
 * locally. No brain, no agent call.
 *
 * Flow on each release:
 *   1. probe = renderer.getPerchProbe(). null (no VRM / projection failed) →
 *      push user.window_sit_exit and stop.
 *   2. seatGlobal = petPxToGlobalPoints(seatPx, outerPosition, scaleFactor).
 *   3. windows = invoke("list_windows")  (front-to-back, topmost first).
 *   4. target = first window whose catch zone contains the seat (topmost wins).
 *   5. hit → user.window_sit_drop { target_window_rect, edge_local_ypx };
 *      miss → user.window_sit_exit.
 *
 * Tauri deps (invoke / getWindow / listen) are injected so the module is unit-
 * testable without the Tauri runtime. Never throws to the caller — failures
 * degrade to a warn log (mirrors os-context.ts).
 */

import { createLogger } from "../logger";
import { petPxToGlobalPoints, inCatchZone } from "../renderer/perch-geometry";
import type { EventBus } from "../dispatcher/event-bus";
import type { WindowRect } from "../contract";

const log = createLogger("window-drop");

/** Tauri event channel carrying the drag-release point (payload unused by the seat hit-test). */
const RELEASE_EVENT = "window_drop_release";

/** Live perch probe surface the producer needs from the renderer. */
export interface PerchProbeSource {
  getPerchProbe(): { seatPx: { x: number; y: number }; charHpx: number } | null;
}

/** Tauri window position/scale accessors the producer reads at drop time. */
export interface DropWindow {
  outerPosition(): Promise<{ x: number; y: number }>;
  scaleFactor(): Promise<number>;
}

/** Tauri `invoke` (only `list_windows` is used here). */
export type DropInvoke = (cmd: "list_windows") => Promise<WindowRect[]>;

/** Tauri `listen` (injectable for tests). */
export type DropListen = (
  event: string,
  handler: (e: { payload: unknown }) => void,
) => Promise<() => void>;

export interface WindowDropSourceDeps {
  bus: EventBus;
  renderer: PerchProbeSource;
  invoke: DropInvoke;
  /** Resolve the pet window (lazily — `getCurrentWindow()` throws off-Tauri). */
  getWindow: () => DropWindow;
  listen: DropListen;
}

export interface WindowDropSource {
  /** Register the release listener. Idempotent. */
  start(): Promise<void>;
  /** Unregister the release listener. */
  stop(): void;
  /** Alias of stop() for HMR-dispose call sites. */
  dispose(): void;
}

/** Push the leave/interrupt envelope (no payload) — reused for miss + no-probe. */
function pushExit(bus: EventBus): void {
  bus.push({
    source: "os_event_watcher",
    event_name: "user.window_sit_exit",
    ts: Date.now(),
    hint_tier: 1,
    dnd_override: true,
  });
}

export function createWindowDropSource(deps: WindowDropSourceDeps): WindowDropSource {
  const { bus, renderer, invoke, getWindow, listen } = deps;
  let unlisten: (() => void) | undefined;

  async function onRelease(): Promise<void> {
    const probe = renderer.getPerchProbe();
    // No VRM / projection unavailable → nothing to perch; leave to idle.
    if (!probe) {
      pushExit(bus);
      return;
    }

    const win = getWindow();
    const [pos, scale, windows] = await Promise.all([
      win.outerPosition(),
      win.scaleFactor(),
      invoke("list_windows"),
    ]);

    const seatGlobal = petPxToGlobalPoints(probe.seatPx, { x: pos.x, y: pos.y }, scale);
    // Front-to-back ⇒ first match is the topmost window.
    const target = windows.find((w) => inCatchZone(seatGlobal, w, probe.charHpx));
    if (!target) {
      pushExit(bus);
      return;
    }

    // Global top edge → pet-window-local px (winOriginPts = pos / scale).
    const sf = scale > 0 ? scale : 1;
    const edgeLocalYpx = target.y - pos.y / sf;
    bus.push({
      source: "os_event_watcher",
      event_name: "user.window_sit_drop",
      ts: Date.now(),
      hint_tier: 1,
      dnd_override: true,
      payload: { target_window_rect: target, edge_local_ypx: edgeLocalYpx },
    });
  }

  return {
    async start() {
      if (unlisten) return;
      try {
        unlisten = await listen(RELEASE_EVENT, () => {
          void onRelease().catch((err) => log.warn("release handling failed — degrade:", err));
        });
      } catch (err) {
        log.warn("listen subscribe failed — degrade:", err);
      }
    },
    stop() {
      unlisten?.();
      unlisten = undefined;
    },
    dispose() {
      this.stop();
    },
  };
}
