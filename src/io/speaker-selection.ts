/**
 * 현재 활성 irodori TTS 화자를 소유하는 reactive 스토어 (PR-B B1).
 * 선택은 SpeakerOption.id(voice registry 등록 키)로 resolve·persist한다.
 * voice registry 등록은 하지 않는다 — 선택 상태 보유 + 영속화 + active 옵션 해석만 담당.
 */

/** irodori 화자 항목 — EndpointsConfig.irodori_voices[number] 와 동일 모양. */
export interface SpeakerOption {
  id: string;
  label?: string;
  ref_url: string;
}

/** override는 저장된 id 문자열 또는 null(override 없음). */
export interface SpeakerSelectionStorage {
  load(): string | null;
  save(id: string | null): void;
}

/** defaultId 단일 화자를 manifest 한 항목으로 합성. ref_url은 비어 있을 수 있다(클립 없음). */
function synthesizeOption(defaultId: string): SpeakerOption {
  return { id: defaultId, label: defaultId, ref_url: "" };
}

/** override 후보를 안전한 모양(비어있지 않은 문자열 또는 null)으로 강제. */
function coerceOverride(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

export function createSpeakerSelection(opts: {
  available?: SpeakerOption[];
  defaultId: string;
  storage?: SpeakerSelectionStorage;
}) {
  const storage = opts.storage;

  // manifest(options + defaultId)는 setManifest로 갱신 가능하므로 가변.
  // list()는 절대 비지 않는다 — available이 없거나 비면 defaultId로 단일 항목 합성.
  function normalize(available: SpeakerOption[] | undefined, fallbackId: string): SpeakerOption[] {
    return available && available.length > 0
      ? available.map((o) => ({ ...o }))
      : [synthesizeOption(fallbackId)];
  }

  let defaultId = opts.defaultId;
  let options: SpeakerOption[] = normalize(opts.available, defaultId);

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

  // 해석 우선순위: (1) override(list에 존재) > (2) defaultId 일치 > (3) list[0].
  function resolve(): SpeakerOption {
    if (override !== null) {
      const o = options.find((x) => x.id === override);
      if (o) return o;
    }
    return options.find((x) => x.id === defaultId) ?? options[0];
  }

  const subscribers = new Set<(active: SpeakerOption) => void>();

  function notify(): void {
    const copy = { ...resolve() };
    for (const cb of subscribers) cb(copy);
  }

  return {
    list(): SpeakerOption[] {
      return options.map((o) => ({ ...o }));
    },

    getActive(): SpeakerOption {
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
    setManifest(next: { available?: SpeakerOption[]; defaultId: string }): void {
      const before = resolve().id;
      defaultId = next.defaultId;
      options = normalize(next.available, defaultId);
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

    subscribe(cb: (active: SpeakerOption) => void): () => void {
      subscribers.add(cb);
      return () => subscribers.delete(cb);
    },

    dispose(): void {
      subscribers.clear();
    },
  };
}

/** localStorage 기반 SpeakerSelectionStorage 어댑터. localStorage 미사용 환경에서 gracefully 무시. */
export function localStorageSpeakerStorage(key = "yui.speaker"): SpeakerSelectionStorage {
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
