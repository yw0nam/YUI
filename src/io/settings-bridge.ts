/**
 * Cross-window settings bridge — a typed bus linking the pop-out settings window ↔ main window.
 *
 * The localStorage `storage` event does not propagate reliably between Tauri webview windows.
 * Tauri v2 `emit(name, payload)` broadcasts to all windows and `listen` receives it —
 * on top of that we layer 4 channels (settings change · mouth preview · voice toggle · voice status).
 *
 * The transport is injectable (for unit tests); when omitted it detects the runtime and picks one:
 *   Tauri → @tauri-apps/api/event (dynamic import only inside the Tauri branch)
 *   BroadcastChannel → dev browser multi-tab
 *   neither → no-op.
 * All transport calls are wrapped in try/catch and never throw.
 */

import { createLogger } from "../logger";
import type { VoiceInputState } from "../ui/voice-input-status";
import { isTauri } from "./tauri-env";

const log = createLogger("settings-bridge");

const CH_SETTINGS_CHANGED = "yui://settings-changed";
const CH_MOUTH_PREVIEW = "yui://mouth-preview";
const CH_VOICE_SET = "yui://voice-set";
const CH_VOICE_STATE = "yui://voice-state";

interface VoiceStateSnapshot {
  state: VoiceInputState;
}

export type WindowKind = "pet" | "settings" | "devtools";

export interface BridgeTransport {
  emit(name: string, payload?: unknown): void;
  /** Returns a disposer that detaches this listener. */
  listen(name: string, cb: (payload: unknown) => void): () => void;
}

export interface SettingsBridge {
  emitSettingsChanged(): void;
  onSettingsChanged(cb: (from: WindowKind | "unknown") => void): () => void;
  emitMouthPreview(mouthOpen: number | null): void;
  onMouthPreview(cb: (mouthOpen: number | null) => void): () => void;
  emitVoiceSet(on: boolean): void;
  onVoiceSet(cb: (on: boolean) => void): () => void;
  emitVoiceState(snapshot: VoiceStateSnapshot): void;
  onVoiceState(cb: (snapshot: VoiceStateSnapshot) => void): () => void;
  dispose(): void;
}

/** Tauri transport. listen returns Promise<UnlistenFn>, so wrap it in a synchronous disposer. */
function createTauriTransport(): BridgeTransport {
  const eventMod = import("@tauri-apps/api/event");
  return {
    emit(name, payload) {
      void eventMod
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

export function createSettingsBridge(
  transport: BridgeTransport | undefined,
  opts: { windowKind: WindowKind },
): SettingsBridge {
  const t = transport ?? selectTransport();
  const disposers = new Set<() => void>();
  const srcId = newSrcId();

  const safeEmit = (name: string, payload?: unknown): void => {
    try {
      t.emit(name, { __src: srcId, __kind: opts.windowKind, payload } satisfies BridgeEnvelope);
    } catch (err) {
      log.warn("emit_failed", { error: String(err) });
    }
  };

  const on = <T>(
    name: string,
    cb: (payload: T, from: WindowKind | "unknown") => void,
  ): (() => void) => {
    let off = (): void => {};
    try {
      off = t.listen(name, (raw) => {
        // Valid envelope: ignore if it's our own. If corrupt/legacy, defensively pass it through as-is.
        const env = raw as Partial<BridgeEnvelope> | undefined;
        if (env && typeof env.__src === "string") {
          if (env.__src === srcId) return;
          cb(env.payload as T, env.__kind ?? "unknown");
        } else {
          cb(((raw as { payload?: unknown } | undefined)?.payload ?? raw) as T, "unknown");
        }
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
  };

  return {
    emitSettingsChanged() {
      safeEmit(CH_SETTINGS_CHANGED);
    },
    onSettingsChanged(cb) {
      return on<unknown>(CH_SETTINGS_CHANGED, (_payload, from) => cb(from));
    },
    emitMouthPreview(mouthOpen) {
      safeEmit(CH_MOUTH_PREVIEW, mouthOpen);
    },
    onMouthPreview(cb) {
      return on<number | null>(CH_MOUTH_PREVIEW, (v) => cb(v ?? null));
    },
    emitVoiceSet(value) {
      safeEmit(CH_VOICE_SET, value);
    },
    onVoiceSet(cb) {
      return on<boolean>(CH_VOICE_SET, (v) => cb(!!v));
    },
    emitVoiceState(snapshot) {
      safeEmit(CH_VOICE_STATE, snapshot);
    },
    onVoiceState(cb) {
      return on<VoiceStateSnapshot>(CH_VOICE_STATE, (s) => cb(s));
    },
    dispose() {
      for (const d of [...disposers]) d();
      disposers.clear();
    },
  };
}
