/**
 * 현재 선택된 VRM을 소유하는 reactive 스토어.
 * 선택은 AvatarOption.id(안정 키)로 persist한다 — url이 아님.
 * 렌더러 스왑은 하지 않는다. 선택 상태 보유 + 영속화 + active 옵션 해석만 담당.
 */

import type { AvatarOption } from "../config/load";

/** override는 저장된 id 문자열 또는 null(override 없음). */
export interface VrmSelectionStorage {
  load(): string | null;
  save(id: string | null): void;
}

/** 임포트된 source:"user" 옵션 목록의 영속화 어댑터. */
export interface UserVrmStorage {
  load(): AvatarOption[];
  save(list: AvatarOption[]): void;
}

/** id로 안전한 charset(`^[A-Za-z0-9_-]+$`) — 네이티브 sanitize_stem과 동일. */
const SAFE_ID = /^[A-Za-z0-9_-]+$/;

/** 임포트 옵션 한 건을 안전한 source:"user" AvatarOption으로 강제(불완전하면 null). */
function coerceUserOption(v: unknown): AvatarOption | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.id !== "string" || !SAFE_ID.test(o.id)) return null;
  if (typeof o.url !== "string" || o.url.length === 0) return null;
  const label = typeof o.label === "string" && o.label.length > 0 ? o.label : o.id;
  return { id: o.id, label, url: o.url, source: "user" };
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
  userStorage?: UserVrmStorage;
}) {
  const storage = opts.storage;
  const userStorage = opts.userStorage;

  // manifest(options + defaultUrl)는 setManifest로 갱신 가능하므로 가변.
  // list()는 절대 비지 않는다 — available이 없거나 비면 defaultUrl로 단일 항목 합성.
  function normalize(available: AvatarOption[] | undefined, fallbackUrl: string): AvatarOption[] {
    return available && available.length > 0
      ? available.map((o) => ({ ...o }))
      : [synthesizeOption(fallbackUrl)];
  }

  let defaultUrl = opts.defaultUrl;
  let bundled: AvatarOption[] = normalize(opts.available, defaultUrl);

  // 임포트된 user 옵션 — bundled id와 충돌하는 항목은 버린다(bundled 우선).
  function isBundledId(id: string): boolean {
    return bundled.some((o) => o.id === id);
  }
  let userOptions: AvatarOption[] = [];

  // userStorage의 목록을 in-memory userOptions에 union-merge한다 — bundled id 충돌은 버리고
  // id로 dedupe(reloaded 항목이 우선). 다른 창이 추가한 항목을 잃지 않게 한다.
  function mergeUserOptions(): void {
    if (!userStorage) return;
    let persisted: AvatarOption[];
    try {
      persisted = userStorage.load();
    } catch {
      return; // storage 오류 시 기존 user 옵션 보존
    }
    for (const raw of persisted) {
      const opt = coerceUserOption(raw);
      if (!opt || isBundledId(opt.id)) continue;
      const idx = userOptions.findIndex((u) => u.id === opt.id);
      if (idx >= 0) userOptions[idx] = opt;
      else userOptions.push(opt);
    }
  }
  mergeUserOptions();

  // 해석 대상 전체 목록: bundled 뒤에 user(중복 id 없음).
  function options(): AvatarOption[] {
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

  // 해석 우선순위: (1) override(list에 존재) > (2) defaultUrl 일치 > (3) list[0].
  function resolve(): AvatarOption {
    const all = options();
    if (override !== null) {
      const o = all.find((x) => x.id === override);
      if (o) return o;
    }
    return all.find((x) => x.url === defaultUrl) ?? all[0];
  }

  const subscribers = new Set<(active: AvatarOption) => void>();

  function notify(): void {
    const copy = { ...resolve() };
    for (const cb of subscribers) cb(copy);
  }

  function persistUser(): void {
    userStorage?.save(userOptions.map((o) => ({ ...o })));
  }

  return {
    list(): AvatarOption[] {
      return options().map((o) => ({ ...o }));
    },

    /** bundled ∪ user 전체 옵션(dedup, bundled 우선). list()와 동일 결과. */
    getOptions(): AvatarOption[] {
      return options().map((o) => ({ ...o }));
    },

    /** 임포트한 user 옵션을 추가/갱신. bundled id와 충돌하면 거부. source는 "user"로 강제. */
    addUserOption(opt: AvatarOption): void {
      if (isBundledId(opt.id)) return; // bundled가 항상 우선
      const next: AvatarOption = { ...opt, source: "user" };
      const idx = userOptions.findIndex((o) => o.id === next.id);
      if (idx >= 0) userOptions[idx] = next;
      else userOptions.push(next);
      persistUser();
    },

    /** user 옵션 제거. 현재 선택 중이던 항목이면 default 해석으로 폴백 + 통지. */
    removeUserOption(id: string): void {
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

    /** user 옵션의 label 갱신 + persist + (active면) 통지. unknown/bundled id·빈 label은 no-op. */
    renameUserOption(id: string, label: string): void {
      const trimmed = label.trim();
      if (trimmed.length === 0) return;
      const opt = userOptions.find((o) => o.id === id);
      if (!opt || opt.label === trimmed) return;
      opt.label = trimmed;
      persistUser();
      if (resolve().id === id) notify();
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
      bundled = normalize(next.available, defaultUrl);
      // 새 bundled와 id 충돌하는 user 옵션은 드롭(bundled 우선).
      userOptions = userOptions.filter((u) => !isBundledId(u.id));
      if (override !== null && !hasId(override)) override = null;
      if (resolve().id === before) return;
      notify();
    },

    // 다른 창이 storage를 갱신했을 때 재로드 — user 목록과 override 포인터를 모두 다시 읽고
    // (cross-window lost-update 방지), 해석 결과가 실제로 바뀌었을 때만 통지.
    reloadFromStorage(): void {
      const before = resolve().id;
      mergeUserOptions();
      if (storage) {
        let loaded: string | null;
        try {
          loaded = coerceOverride(storage.load());
        } catch {
          loaded = override;
        }
        override = loaded !== null && hasId(loaded) ? loaded : null;
      }
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

/** localStorage 기반 UserVrmStorage 어댑터(임포트 옵션 목록 JSON). 불완전/손상 항목은 드롭. */
export function localStorageUserVrmStorage(key = "yui.vrm.user"): UserVrmStorage {
  return {
    load() {
      try {
        const raw = globalThis.localStorage?.getItem(key);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.map((v) => coerceUserOption(v)).filter((o): o is AvatarOption => o !== null);
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
