/**
 * store.test.ts — createConfigStore reactive snapshot + hot-reload.
 *
 * Principle: no network/fs. Inject a fake reader whose backing map can be MUTATED and directly
 * drive whether reload() detects changes. Does not rely on real timers / start() polling (avoids
 * flakiness) — calls reload() directly.
 */

import { describe, expect, it, vi } from "vitest";
import type { ConfigReader } from "./load";
import { goodFixture } from "./load-test-helpers";
import { plainSecretProvider } from "./secrets";
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
  it("get() returns the snapshot after load() and throws before load()", async () => {
    const store = createConfigStore({ read: mutableReader(goodFixture()) });
    expect(() => store.get()).toThrow(/before load/);

    const cfg = await store.load();
    expect(cfg.avatar.vrm_url).toBe("/vrms/carlotta.vrm");
    expect(store.get()).toBe(cfg);
  });
});

describe("createConfigStore — reload", () => {
  it("with no change, reload() returns false and does not notify subscribers", async () => {
    const store = createConfigStore({ read: mutableReader(goodFixture()) });
    await store.load();

    const sub = vi.fn();
    store.subscribe(sub);

    await expect(store.reload()).resolves.toBe(false);
    expect(sub).not.toHaveBeenCalled();
  });

  it("an avatar.vrm_url change → reload() true, subscriber called once (only avatar changed)", async () => {
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

  it("a bad edit → reload() false, snapshot preserved, onError receives the ConfigError (the app does not throw)", async () => {
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
  ])("$section change → reload() true, changed.has('$section')", async ({
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
  it("stops notifying after unsubscribe", async () => {
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
  it("exposes the plainSecretProvider passed via opts.secrets as store.secrets", async () => {
    const store = createConfigStore({
      read: mutableReader(goodFixture()),
      secrets: plainSecretProvider({ chat_api_key: "sk-xyz" }),
    });
    await expect(store.secrets.get("chat_api_key")).resolves.toBe("sk-xyz");
    await expect(store.secrets.get("missing")).resolves.toBeUndefined();
  });
});
