import { createLogger } from "../../../logger";
import type { MotionView } from "./motion-preview";

const log = createLogger("motion-load");

export type LoadMotionPreview = (view: MotionView) => Promise<{ dispose(): void }>;

/** Nothing tried yet, an attempt pending, the preview loaded, or the last attempt failed. */
export type MotionState = "idle" | "loading" | "loaded" | "failed";

export interface MotionLoad {
  state(): MotionState;
  subscribe(cb: () => void): () => void;
  /** Starts an attempt unless one is pending or loaded; resolves once the current attempt settles. */
  begin(): Promise<void>;
  /** The panel's host is in place for the pending attempt: loads the preview into it. */
  attach(view: MotionView): void;
  /** Disposes the loaded preview, or the pending one once it resolves. */
  dispose(): void;
}

export function createMotionLoad(load: LoadMotionPreview): MotionLoad {
  let state: MotionState = "idle";
  let settled = Promise.resolve();
  let settle = () => {};
  let handle: { dispose(): void } | null = null;
  let disposed = false;
  const listeners = new Set<() => void>();
  const set = (next: MotionState) => {
    state = next;
    for (const cb of listeners) cb();
  };

  return {
    state: () => state,
    subscribe(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    begin() {
      if (state === "idle" || state === "failed") {
        settled = new Promise((resolve) => {
          settle = resolve;
        });
        set("loading");
      }
      return settled;
    },
    attach(view) {
      load(view).then(
        (loaded) => {
          if (disposed) loaded.dispose();
          else {
            handle = loaded;
            set("loaded");
          }
          settle();
        },
        (err) => {
          log.error("motion_preview_load_failed", { error: String(err) });
          if (!disposed) set("failed");
          settle();
        },
      );
    },
    dispose() {
      disposed = true;
      handle?.dispose();
    },
  };
}
