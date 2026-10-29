/** A hidden window created once, recreating a leftover one, that is sent open requests once it reports ready. */

import { createLogger } from "../../../logger";
import { isTauri } from "../../../tauri-env";

const log = createLogger("ready-window");

/** How long a leftover window gets to report destroyed before the new one is created anyway. */
const DESTROY_WAIT_MS = 500;

type LeftoverWindow = {
  destroy(): Promise<void>;
  once(event: "tauri://destroyed", cb: () => void): Promise<() => void>;
};

/** Destroys the window and waits for its label to free, or for the timeout. */
async function destroyAndWait(win: LeftoverWindow, label: string): Promise<void> {
  let done: () => void = () => {};
  const gone = new Promise<void>((resolve) => {
    done = resolve;
  });
  const timer = setTimeout(() => {
    log.warn("window_destroy_timeout", { label });
    done();
  }, DESTROY_WAIT_MS);
  const off = await win.once("tauri://destroyed", done);
  await win.destroy();
  await gone;
  clearTimeout(timer);
  off();
}

export function createReadyWindowController<R>(deps: {
  label: string;
  /** Creates the hidden window under `label`. */
  create(): void;
  emitOpen(request: R): void;
  onReady(cb: () => void): () => void;
  /** An open that failed before its request was sent or held. */
  onError?(error: unknown): void;
}): { open(request: R): void; dispose(): void } {
  let created = false;
  let booted = false;
  let pending: R | null = null;
  let chain: Promise<void> = Promise.resolve();
  const offReady = deps.onReady(() => {
    booted = true;
    if (pending) {
      deps.emitOpen(pending);
      pending = null;
    }
  });
  async function ensureWindow(): Promise<void> {
    const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    const existing = await WebviewWindow.getByLabel(deps.label);
    // A window this controller did not create may still be booting, so it is replaced.
    if (existing && !created) await destroyAndWait(existing, deps.label);
    if (!existing || !created) deps.create();
    created = true;
  }
  return {
    open(request) {
      if (!isTauri()) return;
      chain = chain.then(async () => {
        try {
          await ensureWindow();
          // The ready report of a reused window has already arrived; only a fresh boot holds the request.
          if (booted && !pending) deps.emitOpen(request);
          else pending = request;
        } catch (error) {
          log.error("window_open_failed", { label: deps.label, error: String(error) });
          deps.onError?.(error);
        }
      });
    },
    dispose() {
      offReady();
    },
  };
}
