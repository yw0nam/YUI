/**
 * The Threads window's resize: a handle drag's screen deltas become the window's box, applied at
 * most once an animation frame with the latest move winning, and saved once the last apply lands.
 */

import type { ScreenRect } from "../../contract";
import { type ResizeEdge, resizeThreadsBox } from "../../io/window/geometry/threads-position";
import { createLogger } from "../../logger";

const log = createLogger("threads-resize");

interface Move {
  edge: ResizeEdge;
  dx: number;
  dy: number;
}

export function createThreadsResize(deps: {
  /** The box at the drag's start and the work area of its monitor; null while the window has none. */
  current(): Promise<{ box: ScreenRect; workArea: ScreenRect } | null>;
  apply(box: ScreenRect): Promise<void>;
  save(): void;
  nextFrame(cb: () => void): void;
}): {
  start(): void;
  move(edge: ResizeEdge, dx: number, dy: number): void;
  /** Resolves once the last move is applied and the frame saved. */
  end(): Promise<void>;
} {
  let origin: Promise<{ box: ScreenRect; workArea: ScreenRect } | null> = Promise.resolve(null);
  let pending: Move | null = null;
  let inflight: Promise<void> | null = null;
  let scheduled = false;
  let applied = false;

  function schedule(): void {
    if (scheduled || !pending) return;
    scheduled = true;
    deps.nextFrame(() => {
      scheduled = false;
      pump();
    });
  }

  // One apply at a time; a move that lands meanwhile waits for the next frame.
  function pump(): void {
    if (inflight || !pending) return;
    const { edge, dx, dy } = pending;
    pending = null;
    inflight = (async () => {
      const at = await origin;
      if (!at) return;
      await deps.apply(resizeThreadsBox(at.box, at.workArea, edge, dx, dy));
      applied = true;
    })()
      .catch((error) => log.warn("threads_resize_failed", { error: String(error) }))
      .finally(() => {
        inflight = null;
        schedule();
      });
  }

  return {
    start() {
      origin = deps.current();
      pending = null;
      applied = false;
    },
    move(edge, dx, dy) {
      pending = { edge, dx, dy };
      schedule();
    },
    async end() {
      while (inflight || pending) {
        pump();
        await inflight;
      }
      if (applied) deps.save();
      applied = false;
    },
  };
}
