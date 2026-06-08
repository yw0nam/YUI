/**
 * 현재 선택된 VRM을 소유하는 reactive 스토어 (#94 모델 스왑 P2).
 * 선택은 AvatarOption.id(안정 키)로 persist한다 — url이 아님.
 * 렌더러 스왑은 하지 않는다(P4 소관). 선택 상태 보유 + 영속화 + active 옵션 해석만 담당.
 */

import type { AvatarOption } from "../config/load";

/** override는 저장된 id 문자열 또는 null(override 없음). */
export interface VrmSelectionStorage {
  load(): string | null;
  save(id: string | null): void;
}

/** url의 파일명 stem에서 안정 id를 끌어낸다 (예: "/vrms/carlotta.vrm" → "carlotta"). */
function stemFromUrl(url: string): string {
  const path = url.split(/[?#]/, 1)[0];
  const file = path.slice(path.lastIndexOf("/") + 1);
  const stem = file.replace(/\.vrm$/i, "");
  return stem.length > 0 ? stem : "avatar";
}

/** stem을 표시 label로 — 첫 글자만 대문자화(다른 글자는 보존). */
function labelFromStem(stem: string): string {
  return stem.charAt(0).toUpperCase() + stem.slice(1);
}

/** defaultUrl 단일 모델을 manifest 한 항목으로 합성. */
function synthesizeOption(defaultUrl: string): AvatarOption {
  const id = stemFromUrl(defaultUrl);
  return { id, label: labelFromStem(id), url: defaultUrl, source: "bundled" };
}

/** override 후보를 안전한 모양(비어있지 않은 문자열 또는 null)으로 강제. */
function coerceOverride(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

export function createVrmSelection(opts: {
  available?: AvatarOption[];
  defaultUrl: string;
  storage?: VrmSelectionStorage;
}) {
  const storage = opts.storage;

  // manifest(options + defaultUrl)는 setManifest로 갱신 가능하므로 가변.
  // list()는 절대 비지 않는다 — available이 없거나 비면 defaultUrl로 단일 항목 합성.
  function normalize(available: AvatarOption[] | undefined, fallbackUrl: string): AvatarOption[] {
    return available && available.length > 0
      ? available.map((o) => ({ ...o }))
      : [synthesizeOption(fallbackUrl)];
  }

  let defaultUrl = opts.defaultUrl;
  let options: AvatarOption[] = normalize(opts.available, defaultUrl);

  function hasId(id: string): boolean {
    return options.some((o) => o.id === id);
  }

  // 저장된 override를 읽되, 더 이상 list에 없는(stale/removed) id는 없는 것으로 취급.
  let override: string | null = null;
  if (storage) {
    try {
      const loaded = coerceOverride(storage.load());
      if (loaded !== null && hasId(loaded)) override = loaded;
    } catch {
      // storage 오류 시 override 없음으로 폴백
    }
  }

  // 해석 우선순위: (1) override(list에 존재) > (2) defaultUrl 일치 > (3) list[0].
  function resolve(): AvatarOption {
    if (override !== null) {
      const o = options.find((x) => x.id === override);
      if (o) return o;
    }
    return options.find((x) => x.url === defaultUrl) ?? options[0];
  }

  const subscribers = new Set<(active: AvatarOption) => void>();

  function notify(): void {
    const copy = { ...resolve() };
    for (const cb of subscribers) cb(copy);
  }

  return {
    list(): AvatarOption[] {
      return options.map((o) => ({ ...o }));
    },

    getActive(): AvatarOption {
      return { ...resolve() };
    },

    getActiveId(): string {
      return resolve().id;
    },

    select(id: string): void {
      if (!hasId(id)) return; // 알 수 없는 id — garbage persist 방지
      if (resolve().id === id) return; // 이미 active면 no-op
      override = id;
      storage?.save(id);
      notify();
    },

    reset(): void {
      if (override === null) return;
      override = null;
      storage?.save(null);
      notify();
    },

    // config 핫리로드: manifest + default 교체. 사용자 override는 보존하되 새 manifest에
    // 없으면 default 해석으로 폴백. active id가 실제로 바뀐 경우에만 통지.
    setManifest(next: { available?: AvatarOption[]; defaultUrl: string }): void {
      const before = resolve().id;
      defaultUrl = next.defaultUrl;
      options = normalize(next.available, defaultUrl);
      if (override !== null && !hasId(override)) override = null;
      if (resolve().id === before) return;
      notify();
    },

    // 다른 창이 storage를 갱신했을 때 재로드 — 해석 결과가 실제로 바뀌었을 때만 통지.
    reloadFromStorage(): void {
      if (!storage) return;
      const before = resolve().id;
      let loaded: string | null;
      try {
        loaded = coerceOverride(storage.load());
      } catch {
        return;
      }
      const next = loaded !== null && hasId(loaded) ? loaded : null;
      if (override === next) return;
      override = next;
      if (resolve().id === before) return;
      notify();
    },

    subscribe(cb: (active: AvatarOption) => void): () => void {
      subscribers.add(cb);
      return () => subscribers.delete(cb);
    },

    dispose(): void {
      subscribers.clear();
    },
  };
}

/** localStorage 기반 VrmSelectionStorage 어댑터. localStorage 미사용 환경에서 gracefully 무시. */
export function localStorageVrmStorage(key = "yui.vrm"): VrmSelectionStorage {
  return {
    load() {
      try {
        return globalThis.localStorage?.getItem(key) ?? null;
      } catch {
        return null;
      }
    },
    save(id) {
      try {
        if (id === null) globalThis.localStorage?.removeItem(key);
        else globalThis.localStorage?.setItem(key, id);
      } catch {
        // localStorage 사용 불가 시 no-op
      }
    },
  };
}
