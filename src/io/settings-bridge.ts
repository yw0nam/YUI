/**
 * 창 간 설정 브리지 — 팝아웃 설정 창 ↔ 메인 창을 잇는 타입드 버스.
 *
 * localStorage `storage` 이벤트는 Tauri webview 창 사이에서 안정적으로 전파되지 않는다.
 * Tauri v2 `emit(name, payload)`는 모든 창으로 브로드캐스트하고 `listen`이 받는다 —
 * 그 위에 4개 채널(설정 변경 · 입 프리뷰 · 음성 토글 · 음성 상태)을 얹는다.
 *
 * transport는 주입 가능(단위 테스트용)하며, 생략 시 런타임을 감지해 고른다:
 *   Tauri → @tauri-apps/api/event (Tauri 분기 안에서만 dynamic import)
 *   BroadcastChannel → dev 브라우저 멀티탭
 *   둘 다 없으면 no-op.
 * 모든 transport 호출은 try/catch로 감싸 절대 throw하지 않는다.
 */

import { createLogger } from "../logger";

const log = createLogger("settings-bridge");

const CH_SETTINGS_CHANGED = "yui://settings-changed";
const CH_MOUTH_PREVIEW = "yui://mouth-preview";
const CH_VOICE_SET = "yui://voice-set";
const CH_VOICE_STATE = "yui://voice-state";

export interface VoiceStateSnapshot {
  state: string;
}

export interface BridgeTransport {
  emit(name: string, payload?: unknown): void;
  /** Returns a disposer that detaches this listener. */
  listen(name: string, cb: (payload: unknown) => void): () => void;
}

export interface SettingsBridge {
  emitSettingsChanged(): void;
  onSettingsChanged(cb: () => void): () => void;
  emitMouthPreview(mouthOpen: number | null): void;
  onMouthPreview(cb: (mouthOpen: number | null) => void): () => void;
  emitVoiceSet(on: boolean): void;
  onVoiceSet(cb: (on: boolean) => void): () => void;
  emitVoiceState(snapshot: VoiceStateSnapshot): void;
  onVoiceState(cb: (snapshot: VoiceStateSnapshot) => void): () => void;
  dispose(): void;
}

function detectTauri(): boolean {
  return !!(globalThis as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
}

/** Tauri transport. listen은 Promise<UnlistenFn>이므로 동기 disposer로 감싼다. */
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

/** dev 브라우저 멀티탭용 transport. */
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
    if (detectTauri()) return createTauriTransport();
    if (typeof BroadcastChannel !== "undefined") return createBroadcastTransport();
  } catch (err) {
    log.warn("transport_select_failed", { fallback: "noop", error: String(err) });
  }
  return noopTransport;
}

/** envelope: 보낸 창을 식별해 자기 자신이 쏜 이벤트를 무시한다(Tauri global emit 자기 전달 방지). */
interface BridgeEnvelope {
  __src: string;
  payload: unknown;
}

function newSrcId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  return c?.randomUUID?.() ?? `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

export function createSettingsBridge(transport?: BridgeTransport): SettingsBridge {
  const t = transport ?? selectTransport();
  const disposers = new Set<() => void>();
  const srcId = newSrcId();

  const safeEmit = (name: string, payload?: unknown): void => {
    try {
      t.emit(name, { __src: srcId, payload } satisfies BridgeEnvelope);
    } catch (err) {
      log.warn("emit_failed", { error: String(err) });
    }
  };

  const on = <T>(name: string, cb: (payload: T) => void): (() => void) => {
    let off = (): void => {};
    try {
      off = t.listen(name, (raw) => {
        // 정상 envelope: 자기 자신이 쏜 것이면 무시. 손상/구형이면 방어적으로 그대로 전달.
        const env = raw as Partial<BridgeEnvelope> | undefined;
        if (env && typeof env.__src === "string") {
          if (env.__src === srcId) return;
          cb(env.payload as T);
        } else {
          cb(((raw as { payload?: unknown } | undefined)?.payload ?? raw) as T);
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
      return on<unknown>(CH_SETTINGS_CHANGED, () => cb());
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
