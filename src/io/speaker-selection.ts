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
  source?: "bundled" | "user";
}

/** override는 저장된 id 문자열 또는 null(override 없음). */
export interface SpeakerSelectionStorage {
  load(): string | null;
  save(id: string | null): void;
}

/** 임포트된 source:"user" 옵션 목록의 영속화 어댑터. */
export interface UserSpeakerStorage {
  load(): SpeakerOption[];
  save(list: SpeakerOption[]): void;
}

/** defaultId 단일 화자를 manifest 한 항목으로 합성. ref_url은 비어 있을 수 있다(클립 없음). */
function synthesizeOption(defaultId: string): SpeakerOption {
  return { id: defaultId, label: defaultId, ref_url: "" };
}

/** override 후보를 안전한 모양(비어있지 않은 문자열 또는 null)으로 강제. */
function coerceOverride(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** 임포트 옵션 한 건을 안전한 source:"user" SpeakerOption으로 강제(불완전하면 null). */
function coerceUserSpeaker(v: unknown): SpeakerOption | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.id !== "string" || o.id.length === 0) return null;
  if (typeof o.ref_url !== "string" || o.ref_url.length === 0) return null;
  const label = typeof o.label === "string" && o.label.length > 0 ? o.label : o.id;
  return { id: o.id, label, ref_url: o.ref_url, source: "user" };
}

export function createSpeakerSelection(opts: {
  available?: SpeakerOption[];
  defaultId: string;
  storage?: SpeakerSelectionStorage;
  userStorage?: UserSpeakerStorage;
}) {
  const storage = opts.storage;
  const userStorage = opts.userStorage;

  // manifest(options + defaultId)는 setManifest로 갱신 가능하므로 가변.
  // list()는 절대 비지 않는다 — available이 없거나 비면 defaultId로 단일 항목 합성.
  function normalize(available: SpeakerOption[] | undefined, fallbackId: string): SpeakerOption[] {
    return available && available.length > 0
      ? available.map((o) => ({ ...o }))
      : [synthesizeOption(fallbackId)];
  }

  let defaultId = opts.defaultId;
  let bundled: SpeakerOption[] = normalize(opts.available, defaultId);

  // 임포트된 user 옵션 — bundled id와 충돌하는 항목은 버린다(bundled 우선).
  function isBundledId(id: string): boolean {
    return bundled.some((o) => o.id === id);
  }
  let userOptions: SpeakerOption[] = [];
  if (userStorage) {
    try {
      for (const raw of userStorage.load()) {
        const opt = coerceUserSpeaker(raw);
        if (opt && !isBundledId(opt.id) && !userOptions.some((u) => u.id === opt.id)) {
          userOptions.push(opt);
        }
      }
    } catch {
      // storage 오류 시 user 옵션 없음으로 폴백
    }
  }

  // 해석 대상 전체 목록: bundled 뒤에 user(중복 id 없음).
  function options(): SpeakerOption[] {
    return [...bundled, ...userOptions];
  }

  function hasId(id: string): boolean {
    return options().some((o) => o.id === id);
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
    const all = options();
    if (override !== null) {
      const o = all.find((x) => x.id === override);
      if (o) return o;
    }
    return all.find((x) => x.id === defaultId) ?? all[0];
  }

  const subscribers = new Set<(active: SpeakerOption) => void>();

  function notify(): void {
    const copy = { ...resolve() };
    for (const cb of subscribers) cb(copy);
  }

  function persistUser(): void {
    userStorage?.save(userOptions.map((o) => ({ ...o })));
  }

  return {
    list(): SpeakerOption[] {
      return options().map((o) => ({ ...o }));
    },

    /** bundled ∪ user 전체 옵션(dedup, bundled 우선). list()와 동일 결과. */
    getOptions(): SpeakerOption[] {
      return options().map((o) => ({ ...o }));
    },

    /** 임포트한 user 옵션을 추가/갱신. bundled id와 충돌하면 거부. source는 "user"로 강제. */
    addUserVoice(opt: SpeakerOption): void {
      if (isBundledId(opt.id)) return; // bundled가 항상 우선
      const next: SpeakerOption = { ...opt, source: "user" };
      const idx = userOptions.findIndex((o) => o.id === next.id);
      if (idx >= 0) userOptions[idx] = next;
      else userOptions.push(next);
      persistUser();
    },

    /** user 옵션 제거. 현재 선택 중이던 항목이면 default 해석으로 폴백 + 통지. */
    removeUserVoice(id: string): void {
      const idx = userOptions.findIndex((o) => o.id === id);
      if (idx < 0) return;
      const wasActive = resolve().id === id;
      userOptions.splice(idx, 1);
      persistUser();
      if (!wasActive) return;
      override = null;
      storage?.save(null);
      notify();
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
      bundled = normalize(next.available, defaultId);
      // 새 bundled와 id 충돌하는 user 옵션은 드롭(bundled 우선).
      userOptions = userOptions.filter((u) => !isBundledId(u.id));
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

/** localStorage 기반 UserSpeakerStorage 어댑터(임포트 옵션 목록 JSON). 불완전/손상 항목은 드롭. */
export function localStorageUserSpeakerStorage(key = "yui.speaker.user"): UserSpeakerStorage {
  return {
    load() {
      try {
        const raw = globalThis.localStorage?.getItem(key);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed
          .map((v) => coerceUserSpeaker(v))
          .filter((o): o is SpeakerOption => o !== null);
      } catch {
        return [];
      }
    },
    save(list) {
      try {
        globalThis.localStorage?.setItem(key, JSON.stringify(list));
      } catch {
        // localStorage 사용 불가 시 no-op
      }
    },
  };
}
