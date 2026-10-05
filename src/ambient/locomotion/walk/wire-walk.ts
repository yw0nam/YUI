import type { DescendConfig, WalkConfig } from "../../../config/load";
import type { MotionKind } from "../../../contract";
import { isReflexTurn } from "../../../dispatcher/backend/backend-caller";
import type { EventBus } from "../../../dispatcher/core/event-bus";
import type { Dispatcher } from "../../../dispatcher/dispatcher";
import { type DescentEdge, toScreenMonitor } from "../../../io/window/geometry/screen-geometry";
import type { Logger } from "../../../logger";
import type { Renderer } from "../../../renderer";
import { isTauri } from "../../../tauri-env";
import type { TravelFrameHandle } from "../travel/wire-travel-frame";
import { createWalker, type Walker } from "./walker";

/**
 * Ambient floor walking. Tauri-only — a stroll moves the OS window, so in a plain browser
 * (Vite dev) this is skipped and bootstrap continues. The returned handle cancels a running
 * stroll for the owners that outrank ambient (user drag, agent command) and owns teardown.
 */
export function wireWalker(deps: {
  bus: EventBus;
  renderer: Renderer;
  travelFrame: TravelFrameHandle;
  getWalkConfig: () => WalkConfig;
  getDescendConfig: () => DescendConfig;
  /** Registry kind of a motion id, for the "nothing else holds the body" gate. */
  getMotionKind: (id: string) => MotionKind | undefined;
  isPeeking: () => boolean;
  isDragging: () => boolean;
  /** Keep the hit-test cursor mapping accurate while the window translates. */
  setHitTestMoving: (moving: boolean) => void;
  /** An ambient stroll ended — bodyReleased is true only when the walker itself handed the
   * clip back, not when another motion had already taken it. */
  onStrollEnd: (bodyReleased: boolean) => void;
  onDescend: (edge: DescentEdge) => void;
  log: Logger;
}): {
  walkTo(toX: number, onAccepted?: () => void, holdClip?: boolean): Promise<"arrived" | "lost">;
  cancel(): void;
  isStrolling(): boolean;
  dispose(): void;
} {
  const { bus, renderer, log } = deps;
  let walker: Walker | null = null;
  let disposed = false;
  const handle = {
    walkTo: async (
      toX: number,
      onAccepted?: () => void,
      holdClip?: boolean,
    ): Promise<"arrived" | "lost"> => (await walker?.walkTo(toX, onAccepted, holdClip)) ?? "lost",
    cancel: () => walker?.cancel(),
    isStrolling: () => walker?.isStrolling() ?? false,
    dispose: () => {
      disposed = true;
      walker?.stop();
    },
  };
  if (!isTauri()) return handle;
  void (async () => {
    const { availableMonitors } = await import("@tauri-apps/api/window");
    await deps.travelFrame.ready;
    if (disposed) return;
    const push = (event_name: string): void => {
      bus.push({ source: "timer_scheduler", event_name, ts: Date.now() });
    };
    walker = createWalker({
      renderer,
      getWindow: deps.travelFrame.getWindow,
      travel: deps.travelFrame.travel,
      listMonitors: async () => (await availableMonitors()).map(toScreenMonitor),
      getConfig: deps.getWalkConfig,
      getDescendConfig: deps.getDescendConfig,
      currentMotionKind: () => {
        const current = renderer.getCurrentMotion();
        return current ? (deps.getMotionKind(current.id) ?? null) : null;
      },
      isPeeking: deps.isPeeking,
      isDragging: deps.isDragging,
      onStart: () => {
        deps.setHitTestMoving(true);
        push("avatar.walk_start");
      },
      onEnd: (bodyReleased) => {
        deps.setHitTestMoving(false);
        push("avatar.walk_end");
        deps.onStrollEnd(bodyReleased);
      },
      onDescend: deps.onDescend,
    });
    walker.start();
  })().catch((err) => log.warn("walker_start_failed", { degrade: true, error: String(err) }));
  return handle;
}

/**
 * A reflex turn is an immediate reaction to being touched; it cancels a running stroll
 * the moment it opens. Every other turn leaves the stroll walking.
 */
export function wireStrollReflexCancel(deps: {
  dispatcher: Pick<Dispatcher, "subscribeBusy" | "inFlight">;
  walker: { cancel(): void };
}): () => void {
  return deps.dispatcher.subscribeBusy((busy) => {
    const trigger = deps.dispatcher.inFlight()?.trigger.event_name;
    if (busy && trigger !== undefined && isReflexTurn(trigger)) deps.walker.cancel();
  });
}
