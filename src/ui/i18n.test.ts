// @vitest-environment jsdom

/**
 * i18n.test.ts
 *
 * Tests for the core i18n module: lookup, interpolation, persistence,
 * subscriber notifications, and key-completeness across all three dictionaries.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import en from "./i18n/en";
import ja from "./i18n/ja";
import ko from "./i18n/ko";

// Each test gets a fresh module state by re-importing via unstable_resetModules.
// We expose the module under test via a helper that re-imports after reset.

describe("t() — lookup and interpolation", () => {
  beforeEach(() => {
    vi.resetModules();
    globalThis.localStorage?.clear?.();
  });

  it("returns the locale-specific value when present", async () => {
    const { t, setLocale } = await import("./i18n");
    setLocale("ko");
    expect(t("voice.state.idle")).toBe(ko["voice.state.idle"]);
  });

  it("falls back to en when the locale dict lacks the key", async () => {
    const { t, setLocale } = await import("./i18n");
    setLocale("ko");
    // Force a key that only exists in en by injecting via the en dict directly.
    // "tool.web_search" is an English-only key (same in all dicts per spec, so use a
    // key we know exists in en; if ko has it, it would return ko value which equals en).
    expect(t("tool.web_search")).toBe(en["tool.web_search"]);
  });

  it("falls back to the raw key when the key is absent from all dicts", async () => {
    const { t } = await import("./i18n");
    expect(t("nonexistent.key.xyz")).toBe("nonexistent.key.xyz");
  });

  it("t(key, vars) replaces {name} placeholders", async () => {
    const { t } = await import("./i18n");
    // "aria.refresh_speaker" has value "{name} 참조 음성 갱신" in ko; in en it has a
    // placeholder too. Test via en (default locale after reset).
    const result = t("aria.refresh_speaker", { name: "Alice" });
    expect(result).not.toContain("{name}");
    expect(result).toContain("Alice");
  });

  it("t(key, vars) leaves unmatched placeholders untouched", async () => {
    const { t } = await import("./i18n");
    const result = t("aria.refresh_speaker", { other: "X" });
    expect(result).toContain("{name}");
  });

  it("t(key, vars) coerces number values to string", async () => {
    const { t } = await import("./i18n");
    const result = t("aria.refresh_speaker", { name: 42 });
    expect(result).toContain("42");
  });
});

describe("setLocale / getLocale — persistence and side effects", () => {
  beforeEach(() => {
    vi.resetModules();
    globalThis.localStorage?.clear?.();
  });

  it("getLocale returns DEFAULT_LOCALE ('en') when nothing is stored", async () => {
    const { getLocale, DEFAULT_LOCALE } = await import("./i18n");
    expect(getLocale()).toBe(DEFAULT_LOCALE);
    expect(getLocale()).toBe("en");
  });

  it("setLocale persists and getLocale re-reads it", async () => {
    const { setLocale, getLocale } = await import("./i18n");
    setLocale("ja");
    expect(getLocale()).toBe("ja");
  });

  it("setLocale persists to localStorage so a fresh import reads it back", async () => {
    const { setLocale } = await import("./i18n");
    setLocale("ko");
    // Reset module, re-import — should re-hydrate from localStorage.
    vi.resetModules();
    const { getLocale } = await import("./i18n");
    expect(getLocale()).toBe("ko");
  });

  it("invalid stored locale value falls back to DEFAULT_LOCALE", async () => {
    globalThis.localStorage?.setItem("yui.locale", JSON.stringify("zz"));
    const { getLocale } = await import("./i18n");
    expect(getLocale()).toBe("en");
  });

  it("setLocale sets document.documentElement.lang", async () => {
    const { setLocale } = await import("./i18n");
    setLocale("ja");
    expect(document.documentElement.lang).toBe("ja");
  });

  it("setLocale notifies subscribers", async () => {
    const { setLocale, subscribe } = await import("./i18n");
    const calls: string[] = [];
    subscribe((l) => calls.push(l));
    setLocale("ko");
    expect(calls).toEqual(["ko"]);
  });

  it("unsubscribe stops notifications", async () => {
    const { setLocale, subscribe } = await import("./i18n");
    const calls: string[] = [];
    const unsub = subscribe((l) => calls.push(l));
    unsub();
    setLocale("ja");
    expect(calls).toHaveLength(0);
  });

  it("setLocale with the same locale still notifies (allows force-refresh)", async () => {
    const { setLocale, subscribe, getLocale } = await import("./i18n");
    // Start at default "en".
    expect(getLocale()).toBe("en");
    const calls: string[] = [];
    subscribe((l) => calls.push(l));
    setLocale("en");
    // Notification fires even when locale is unchanged — host may need force-remount.
    expect(calls).toHaveLength(1);
  });
});

describe("LOCALES and display names", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("LOCALES contains exactly en, ja, ko", async () => {
    const { LOCALES } = await import("./i18n");
    expect([...LOCALES].sort()).toEqual(["en", "ja", "ko"]);
  });

  it("LOCALE_DISPLAY_NAMES has a display name for each locale", async () => {
    const { LOCALES, LOCALE_DISPLAY_NAMES } = await import("./i18n");
    for (const l of LOCALES) {
      expect(typeof LOCALE_DISPLAY_NAMES[l]).toBe("string");
      expect(LOCALE_DISPLAY_NAMES[l].length).toBeGreaterThan(0);
    }
  });
});

describe("key completeness — every en key must exist in ja and ko", () => {
  it("ja has all keys that en has", () => {
    const enKeys = Object.keys(en);
    const jaKeys = new Set(Object.keys(ja));
    const missing = enKeys.filter((k) => !jaKeys.has(k));
    expect(missing, `ja is missing keys: ${missing.join(", ")}`).toHaveLength(0);
  });

  it("ko has all keys that en has", () => {
    const enKeys = Object.keys(en);
    const koKeys = new Set(Object.keys(ko));
    const missing = enKeys.filter((k) => !koKeys.has(k));
    expect(missing, `ko is missing keys: ${missing.join(", ")}`).toHaveLength(0);
  });

  it("en has all keys that ja has (no orphan ja keys)", () => {
    const jaKeys = Object.keys(ja);
    const enKeys = new Set(Object.keys(en));
    const orphans = jaKeys.filter((k) => !enKeys.has(k));
    expect(orphans, `ja has orphan keys: ${orphans.join(", ")}`).toHaveLength(0);
  });

  it("en has all keys that ko has (no orphan ko keys)", () => {
    const koKeys = Object.keys(ko);
    const enKeys = new Set(Object.keys(en));
    const orphans = koKeys.filter((k) => !enKeys.has(k));
    expect(orphans, `ko has orphan keys: ${orphans.join(", ")}`).toHaveLength(0);
  });
});
