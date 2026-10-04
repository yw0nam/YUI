/**
 * Cross-window bridge core — the transports, the envelope and the listener bookkeeping every
 * cross-window bus is built on.
 *
 * The transport is injectable (for unit tests); when omitted it detects the runtime and picks one:
 *   Tauri → @tauri-apps/api/event (dynamic import only inside the Tauri branch)
 *   BroadcastChannel → dev browser multi-tab
 *   neither → no-op.
 * All transport calls are wrapped in try/catch and never throw.
 */

import { createLogger } from "../../../logger";
import { isTauri } from "../../../tauri-env";

const log = createLogger("settings-bridge");

export type WindowKind = "pet" | "settings" | "devtools" | "message";

export interface BridgeTransport {
  emit(name: string, payload?: unknown): void;
  /** Returns a disposer that detaches this listener. */
  listen(name: string, cb: (payload: unknown) => void): () => void;
}

/** Tauri transport. listen returns Promise<UnlistenFn>, so wrap it in a synchronous disposer. */
function createTauriTransport(): BridgeTransport {
  const eventMod = import("@tauri-apps/api/event");
  // Tauri runs each emit as its own async task, so each emit waits for the previous one to keep send order.
  let sending: Promise<void> = Promise.resolve();
  return {
    emit(name, payload) {
      sending = sending
        .then(() => eventMod)
        .then((m) => m.emit(name, payload))
        .catch((err) => log.warn("tauri_emit_failed", { error: String(err) }));
    },
    listen(name, cb) {
      let unlisten: (() => void) | null = null;
      let disposed = false;
      void eventMod
        .then((m) => m.listen(name, (event) => cb(event.payload)))
        .then((un) => {
          if (disposed) {
            un();
            return;
          }
          unlisten = un;
        })
        .catch((err) => log.warn("tauri_listen_failed", { error: String(err) }));
      return () => {
        disposed = true;
        unlisten?.();
        unlisten = null;
      };
    },
  };
}

/** Transport for dev browser multi-tab. */
function createBroadcastTransport(): BridgeTransport {
  const channel = new BroadcastChannel("yui-settings");
  const routes = new Map<string, Set<(p: unknown) => void>>();
  channel.onmessage = (ev: MessageEvent) => {
    const data = ev.data as { name?: string; payload?: unknown } | undefined;
    if (!data || typeof data.name !== "string") return;
    const set = routes.get(data.name);
    if (!set) return;
    for (const cb of [...set]) cb(data.payload);
  };
  return {
    emit(name, payload) {
      channel.postMessage({ name, payload });
    },
    listen(name, cb) {
      let set = routes.get(name);
      if (!set) {
        set = new Set();
        routes.set(name, set);
      }
      set.add(cb);
      return () => set!.delete(cb);
    },
  };
}

const noopTransport: BridgeTransport = {
  emit() {},
  listen() {
    return () => {};
  },
};

function selectTransport(): BridgeTransport {
  try {
    if (isTauri()) return createTauriTransport();
    if (typeof BroadcastChannel !== "undefined") return createBroadcastTransport();
  } catch (err) {
    log.warn("transport_select_failed", { fallback: "noop", error: String(err) });
  }
  return noopTransport;
}

/**
 * envelope: `__src` identifies the sending instance so it can ignore its own events (prevents Tauri
 * global emit self-delivery); `__kind` names the sending window so receivers can attribute the change.
 */
interface BridgeEnvelope {
  __src: string;
  __kind: WindowKind;
  payload: unknown;
}

function newSrcId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  return c?.randomUUID?.() ?? `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

/** Envelope + self-filter + listener bookkeeping, shared by every cross-window bus. */
interface BridgeCore {
  emit(name: string, payload?: unknown): void;
  on<T>(name: string, cb: (payload: T, from: WindowKind) => void): () => void;
  dispose(): void;
}

export function createBridgeCore(
  transport: BridgeTransport | undefined,
  windowKind: WindowKind,
): BridgeCore {
  const t = transport ?? selectTransport();
  const disposers = new Set<() => void>();
  const srcId = newSrcId();

  return {
    emit(name, payload) {
      try {
        t.emit(name, { __src: srcId, __kind: windowKind, payload } satisfies BridgeEnvelope);
      } catch (err) {
        log.warn("emit_failed", { error: String(err) });
      }
    },

    on(name, cb) {
      let off = (): void => {};
      try {
        off = t.listen(name, (raw) => {
          // Only enveloped messages are delivered; a bridge skips its own emits.
          const env = raw as Partial<BridgeEnvelope> | undefined;
          if (!env || typeof env.__src !== "string" || typeof env.__kind !== "string") return;
          if (env.__src === srcId) return;
          cb(env.payload as never, env.__kind);
        });
      } catch (err) {
        log.warn("listen_failed", { error: String(err) });
      }
      const disposer = (): void => {
        disposers.delete(disposer);
        try {
          off();
        } catch (err) {
          log.warn("unlisten_failed", { error: String(err) });
        }
      };
      disposers.add(disposer);
      return disposer;
    },

    dispose() {
      for (const d of [...disposers]) d();
      disposers.clear();
    },
  };
}
