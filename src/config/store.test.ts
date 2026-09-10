/**
 * store.test.ts — createConfigStore reactive snapshot + hot-reload.
 *
 * Principle: no network/fs. Inject a fake reader whose backing map can be MUTATED and directly
 * drive whether reload() detects changes. Does not rely on real timers / start() polling (avoids
 * flakiness) — calls reload() directly.
 */

import { describe, expect, it, vi } from "vitest";
import { type ConfigReader, plainSecretProvider } from "./load";
import { goodFixture } from "./load-test-helpers";
import { createConfigStore } from "./store";

// ── mutable fake reader ──────────────────────────────────────────────────────

/**
 * Reader that captures the map. When a test changes map[...], the next reload() sees the new value.
 * The reader deep-clones map[file] before handing it over (so the store snapshot is not aliased to the backing map).
 */
function mutableReader(map: Record<string, unknown>): ConfigReader {
  return async (file) => {
    if (!(file in map)) throw new Error(`fake reader: missing ${file}`);
    return structuredClone(map[file]);
  };
}

// ── tests ────────────────────────────────────────────────────────────────────

describe("createConfigStore — load / get", () => {
  it("load() 후 get()이 스냅샷을 반환하고, load() 전 get()은 throw", async () => {
    const store = createConfigStore({ read: mutableReader(goodFixture()) });
    expect(() => store.get()).toThrow(/before load/);

    const cfg = await store.load();
    expect(cfg.avatar.vrm_url).toBe("/vrms/carlotta.vrm");
    expect(store.get()).toBe(cfg);
  });
});

describe("createConfigStore — reload", () => {
  it("변경 없으면 reload()는 false, 구독자에게 통지하지 않는다", async () => {
    const store = createConfigStore({ read: mutableReader(goodFixture()) });
    await store.load();

    const sub = vi.fn();
    store.subscribe(sub);

    await expect(store.reload()).resolves.toBe(false);
    expect(sub).not.toHaveBeenCalled();
  });

  it("avatar.vrm_url 변경 → reload() true, 구독자 1회 호출(avatar만 changed)", async () => {
    const map = goodFixture();
    const store = createConfigStore({ read: mutableReader(map) });
    await store.load();

    const sub = vi.fn();
    store.subscribe(sub);

    // Change only the backing map and reload — the reader reads the new value.
    (map["avatar.json"] as { vrm_url: string }).vrm_url = "/vrms/other.vrm";
    await expect(store.reload()).resolves.toBe(true);

    expect(sub).toHaveBeenCalledTimes(1);
    const [nextCfg, changed] = sub.mock.calls[0];
    expect(nextCfg.avatar.vrm_url).toBe("/vrms/other.vrm");
    expect(changed.has("avatar")).toBe(true);
    expect(changed.has("motions")).toBe(false);
    // get() reflects the new snapshot too.
    expect(store.get().avatar.vrm_url).toBe("/vrms/other.vrm");
  });

  it("잘못된 편집 → reload() false, 스냅샷 보존, onError가 ConfigError 수신(앱 throw 안 함)", async () => {
    const map = goodFixture();
    const store = createConfigStore({ read: mutableReader(map) });
    await store.load();
    const before = store.get();

    const sub = vi.fn();
    const onErr = vi.fn();
    store.subscribe(sub);
    store.onError(onErr);

    // Remove all motions → violates "at least 1" → ConfigError.
    map["motions.json"] = {};
    await expect(store.reload()).resolves.toBe(false);

    // Current snapshot UNCHANGED.
    expect(store.get()).toBe(before);
    expect(sub).not.toHaveBeenCalled();
    expect(onErr).toHaveBeenCalledTimes(1);
    const err = onErr.mock.calls[0][0];
    expect(err).toBeInstanceOf(Error);
    expect((err as { name: string }).name).toBe("ConfigError");
    expect((err as { file: string }).file).toBe("motions.json");
  });
});

describe("createConfigStore — section diff", () => {
  it.each([
    {
      section: "guardrails",
      mutate: (map: Record<string, unknown>) => {
        (map["guardrails.json"] as { rate_limit: { overall_max: number } }).rate_limit.overall_max =
          30;
      },
      readBack: (cfg: { guardrails: { rate_limit: { overall_max: number } } }) =>
        cfg.guardrails.rate_limit.overall_max,
      expected: 30,
      otherSection: "motions",
    },
    {
      section: "hotkeys",
      mutate: (map: Record<string, unknown>) => {
        (map["hotkeys.json"] as { summon_global: string }).summon_global = "Alt+Space";
      },
      readBack: (cfg: { hotkeys: { summon_global: string } }) => cfg.hotkeys.summon_global,
      expected: "Alt+Space",
      otherSection: "avatar",
    },
    {
      section: "filler",
      mutate: (map: Record<string, unknown>) => {
        (map["filler.json"] as { gap_ms: number }).gap_ms = 2000;
      },
      readBack: (cfg: { filler: { gap_ms: number } }) => cfg.filler.gap_ms,
      expected: 2000,
      otherSection: "avatar",
    },
  ])("$section 변경 → reload() true, changed.has('$section')", async ({
    mutate,
    readBack,
    expected,
    section,
    otherSection,
  }) => {
    const map = goodFixture();
    const store = createConfigStore({ read: mutableReader(map) });
    await store.load();

    const sub = vi.fn();
    store.subscribe(sub);

    mutate(map);
    await expect(store.reload()).resolves.toBe(true);

    expect(sub).toHaveBeenCalledTimes(1);
    const [nextCfg, changed] = sub.mock.calls[0];
    expect(readBack(nextCfg)).toBe(expected);
    expect(changed.has(section)).toBe(true);
    expect(changed.has(otherSection)).toBe(false);
  });
});

describe("createConfigStore — subscribe lifecycle", () => {
  it("unsubscribe 후에는 통지가 멈춘다", async () => {
    const map = goodFixture();
    const store = createConfigStore({ read: mutableReader(map) });
    await store.load();

    const sub = vi.fn();
    const unsub = store.subscribe(sub);

    (map["avatar.json"] as { vrm_url: string }).vrm_url = "/vrms/a.vrm";
    await store.reload();
    expect(sub).toHaveBeenCalledTimes(1);

    unsub();
    (map["avatar.json"] as { vrm_url: string }).vrm_url = "/vrms/b.vrm";
    await store.reload();
    // No further calls after unsubscribe.
    expect(sub).toHaveBeenCalledTimes(1);
  });
});

describe("createConfigStore — secrets", () => {
  it("opts.secrets로 넘긴 plainSecretProvider를 store.secrets로 노출한다", async () => {
    const store = createConfigStore({
      read: mutableReader(goodFixture()),
      secrets: plainSecretProvider({ chat_api_key: "sk-xyz" }),
    });
    await expect(store.secrets.get("chat_api_key")).resolves.toBe("sk-xyz");
    await expect(store.secrets.get("missing")).resolves.toBeUndefined();
  });
});
