/**
 * Config store — loadConfig 위에 reactive 스냅샷 + 핫리로드를 얹는다.
 *
 * 책임:
 *  - 최초 load() 후 검증된 AppConfig 스냅샷 보관 → get().
 *  - subscribe(fn): config 변경 시 (새 config, 바뀐 section 집합) 통지. VRM/motion/proactivity
 *    같은 핫스왑 대상은 구독자가 반응한다(예: main.ts가 avatar 변경 시 renderer.loadVRM 재호출).
 *  - 핫리로드: start(intervalMs) → 주기적으로 재fetch·재검증 → section별 변경 감지 → 통지.
 *    잘못된 편집(ConfigError)은 **현재 config를 유지**하고 onError로만 통지한다 → 편집 실수가
 *    실행 중 앱을 깨지 않는다.
 *
 * 민감값(API 키) 정책: SecretProvider는 reload 시 재바인딩되지만, 이미 만들어진
 * 클라이언트의 런타임 교체는 강제하지 않는다 — **다음 호출부터** 새 값이 반영된다.
 *
 * 파일 감시 방식: 의존성 0의 **폴링**(재fetch + section별 직렬화 비교). dev(vite 정적 서빙)·Tauri
 * webview 양쪽에서 추가 플러그인 없이 동작한다. Tauri fs-watch로 교체 가능 —
 * 구독/스냅샷 계약은 그대로 두고 트리거만 바꾸면 된다.
 */

import {
  type AppConfig,
  type ConfigSection,
  type LoadConfigOptions,
  loadConfig,
  type SecretProvider,
} from "./load";

/** 폴링 기본 주기(ms). 너무 잦으면 fetch 낭비, 너무 느리면 편집 반영 지연. */
const DEFAULT_POLL_MS = 1500;

export type ConfigListener = (config: AppConfig, changed: ReadonlySet<ConfigSection>) => void;
export type ConfigErrorListener = (err: unknown) => void;

export interface ConfigStore {
  /** 최초 1회 로드. 이후 get()이 유효해진다. 실패 시 throw(부트스트랩에서 처리). */
  load(): Promise<AppConfig>;
  /** 현재 스냅샷. load() 전 호출 시 throw. */
  get(): AppConfig;
  /** 재fetch·재검증 후 변경분 통지. 실패해도 현재 스냅샷은 보존하고 false 반환. */
  reload(): Promise<boolean>;
  /** 변경 구독. 즉시 1회 통지하지 않는다(현재 값은 get()으로). unsubscribe 반환. */
  subscribe(fn: ConfigListener): () => void;
  /** 핫리로드 폴링 시작(중복 호출 무시). */
  start(intervalMs?: number): void;
  /** 폴링 중지. */
  stop(): void;
  /** reload 중 발생한 ConfigError 등을 받는다(폴링은 throw하지 않으므로). */
  onError(fn: ConfigErrorListener): () => void;
  /** 시크릿 조회(api_key 등). load 시 주입된 provider. */
  readonly secrets: SecretProvider;
}

export interface ConfigStoreOptions extends LoadConfigOptions {
  /** api 키 등 시크릿 조회 — 미지정 시 빈 plainSecretProvider. */
  secrets?: SecretProvider;
}

const ALL_SECTIONS: readonly ConfigSection[] = [
  "endpoints",
  "avatar",
  "emotionRegistry",
  "motions",
  "guardrails",
  "sources",
];

/** 두 AppConfig 간 바뀐 section 집합(직렬화 비교 — 순서 무관 비교는 불필요, 파일 그대로 매핑). */
function diffSections(a: AppConfig, b: AppConfig): Set<ConfigSection> {
  const changed = new Set<ConfigSection>();
  for (const s of ALL_SECTIONS) {
    if (JSON.stringify(a[s]) !== JSON.stringify(b[s])) changed.add(s);
  }
  return changed;
}

export function createConfigStore(opts: ConfigStoreOptions = {}): ConfigStore {
  const { secrets: secretsOpt, ...loadOpts } = opts;
  const secrets: SecretProvider = secretsOpt ?? {
    async get() {
      return undefined;
    },
  };

  let current: AppConfig | null = null;
  const listeners = new Set<ConfigListener>();
  const errorListeners = new Set<ConfigErrorListener>();
  let timer: ReturnType<typeof setInterval> | null = null;
  let polling = false; // 재진입(직전 reload 미완) 방지

  // 핫리로드 재fetch는 매번 캐시를 회피해야 한다(브라우저/webview HTTP 캐시).
  function bustOpts(): LoadConfigOptions {
    // app 런타임에서는 Date.now() 허용. reader 주입(테스트)이면 cacheBust는 무시된다.
    return { ...loadOpts, cacheBust: String(Date.now()) };
  }

  // ⚠ 절대 reject하지 않는다(에러는 onError로 흘리고 false 반환). start()의 폴링 재진입
  //   가드(polling 플래그 + .finally)가 이 불변에 의존한다.
  async function reload(): Promise<boolean> {
    let next: AppConfig;
    try {
      next = await loadConfig(current ? bustOpts() : loadOpts);
    } catch (err) {
      for (const fn of errorListeners) fn(err);
      return false;
    }
    if (current === null) {
      current = next;
      return true;
    }
    const changed = diffSections(current, next);
    if (changed.size === 0) return false;
    current = next;
    for (const fn of listeners) fn(next, changed);
    return true;
  }

  return {
    async load() {
      current = await loadConfig(loadOpts);
      return current;
    },
    get() {
      if (current === null) {
        throw new Error("[config] store.get() before load() — load()를 먼저 await 하라");
      }
      return current;
    },
    reload,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    onError(fn) {
      errorListeners.add(fn);
      return () => errorListeners.delete(fn);
    },
    start(intervalMs = DEFAULT_POLL_MS) {
      if (timer !== null) return;
      timer = setInterval(() => {
        if (polling) return;
        polling = true;
        void reload().finally(() => {
          polling = false;
        });
      }, intervalMs);
    },
    stop() {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    },
    secrets,
  };
}
