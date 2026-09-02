// @vitest-environment jsdom

/**
 * i18n.test.ts
 *
 * Tests for the core i18n module: lookup, interpolation, persistence,
 * subscriber notifications, and key-completeness across all three dictionaries.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

describe("OS locale detection — no persisted locale", () => {
  const originalLanguage = navigator.language;

  beforeEach(() => {
    vi.resetModules();
    globalThis.localStorage?.clear?.();
  });

  afterEach(() => {
    Object.defineProperty(navigator, "language", {
      value: originalLanguage,
      configurable: true,
    });
  });

  it("ko-KR system locale resolves to ko", async () => {
    Object.defineProperty(navigator, "language", { value: "ko-KR", configurable: true });
    const { getLocale } = await import("./i18n");
    expect(getLocale()).toBe("ko");
  });

  it("ja-JP system locale resolves to ja", async () => {
    Object.defineProperty(navigator, "language", { value: "ja-JP", configurable: true });
    const { getLocale } = await import("./i18n");
    expect(getLocale()).toBe("ja");
  });

  it("unsupported system locale (de-DE) falls back to en", async () => {
    Object.defineProperty(navigator, "language", { value: "de-DE", configurable: true });
    const { getLocale } = await import("./i18n");
    expect(getLocale()).toBe("en");
  });

  it("persisted yui.locale wins over OS-language detection", async () => {
    Object.defineProperty(navigator, "language", { value: "ko-KR", configurable: true });
    globalThis.localStorage.setItem("yui.locale", JSON.stringify("en"));
    const { getLocale } = await import("./i18n");
    expect(getLocale()).toBe("en");
  });
});

describe("reloadFromStorage — cross-window sync", () => {
  beforeEach(() => {
    vi.resetModules();
    globalThis.localStorage?.clear?.();
  });

  it("applies a locale persisted by another window and notifies subscribers", async () => {
    const { setLocale, getLocale, subscribe, reloadFromStorage } = await import("./i18n");
    setLocale("en");
    const calls: string[] = [];
    subscribe((l) => calls.push(l));
    // Simulate another window persisting "ja" to the shared store (JSON-encoded).
    globalThis.localStorage.setItem("yui.locale", JSON.stringify("ja"));
    reloadFromStorage();
    expect(getLocale()).toBe("ja");
    expect(calls).toEqual(["ja"]);
    expect(document.documentElement.lang).toBe("ja");
  });

  it("is a no-op when the stored locale matches the in-memory one", async () => {
    const { setLocale, subscribe, reloadFromStorage } = await import("./i18n");
    setLocale("ko");
    const calls: string[] = [];
    subscribe((l) => calls.push(l));
    reloadFromStorage();
    expect(calls).toHaveLength(0);
  });

  it("does not re-persist (no echo): the stored value is untouched on reload", async () => {
    const { setLocale, reloadFromStorage } = await import("./i18n");
    setLocale("en");
    globalThis.localStorage.setItem("yui.locale", JSON.stringify("ko"));
    reloadFromStorage();
    expect(globalThis.localStorage.getItem("yui.locale")).toBe(JSON.stringify("ko"));
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

// The session/cue copy renders verbatim (no "·"-splitting in the renderer), so
// duplicated segments and untranslated strings ship straight to the UI. The ko
// " · " label style is deliberate bilingual copy — only en must be single-language.
describe("session & cue copy — shape", () => {
  it("en session labels carry no ' · ' segment", () => {
    expect(en["session.action_label"]).not.toMatch(/ · /);
    expect(en["session.reset"]).not.toMatch(/ · /);
  });

  it("ko session strings are natural Korean (not untranslated English)", () => {
    const hangul = /[가-힣]/;
    for (const key of [
      "session.action_sub",
      "session.confirm_q",
      "session.confirm_go",
      "session.confirm_cancel",
    ]) {
      expect(ko[key], `${key} should be Korean`).toMatch(hangul);
    }
  });

  it("every locale carries the cue delete-confirm keys", () => {
    for (const dict of [en, ja, ko]) {
      expect(dict["cue.confirm_q"]).toBeTruthy();
      expect(dict["cue.confirm_go"]).toBeTruthy();
      expect(dict["cue.confirm_cancel"]).toBeTruthy();
    }
  });
});

// The voice dot pulses amber while listening/asr and settles to a steady amber
// when a turn fires — a difference of motion, not color. Under
// prefers-reduced-motion the pulse is disabled, so those states collapse to an
// identical dot and the text label becomes the sole differentiator. Lock it:
// every voice.state.* label must be distinct within each locale.
describe("voice.state labels — distinct per locale (reduced-motion carrier)", () => {
  for (const [name, dict] of [
    ["en", en],
    ["ja", ja],
    ["ko", ko],
  ] as const) {
    it(`${name}: no two voice.state labels share the same text`, () => {
      const labels = Object.entries(dict)
        .filter(([k]) => k.startsWith("voice.state."))
        .map(([, v]) => v);
      expect(new Set(labels).size).toBe(labels.length);
    });
  }
});
