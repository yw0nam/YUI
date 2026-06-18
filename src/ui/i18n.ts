/**
 * Core i18n module.
 *
 * Single source for locale type, persisted locale, lookup, interpolation, and
 * subscriber notification. Dictionaries live in ./i18n/{en,ja,ko}.ts.
 */

import { localStorageStore } from "../io/persisted-store";
import en from "./i18n/en";
import ja from "./i18n/ja";
import ko from "./i18n/ko";

export type Locale = "en" | "ja" | "ko";

export const DEFAULT_LOCALE: Locale = "en";

export const LOCALES: Locale[] = ["en", "ja", "ko"];

export const LOCALE_DISPLAY_NAMES: Record<Locale, string> = {
  en: "English",
  ja: "日本語",
  ko: "한국어",
};

const VALID_LOCALES = new Set<string>(LOCALES);

const STORAGE_KEY = "yui.locale";
const _storage = localStorageStore<string>(STORAGE_KEY);

const _dicts: Record<Locale, Record<string, string>> = { en, ja, ko };

function _isValidLocale(v: unknown): v is Locale {
  return typeof v === "string" && VALID_LOCALES.has(v);
}

// Hydrate from storage; fall back to DEFAULT_LOCALE if stored value is invalid.
function _hydrate(): Locale {
  const raw = _storage.load();
  return _isValidLocale(raw) ? raw : DEFAULT_LOCALE;
}

let _locale: Locale = _hydrate();

const _subscribers = new Set<(l: Locale) => void>();

export function getLocale(): Locale {
  return _locale;
}

export function setLocale(l: Locale): void {
  _locale = l;
  _storage.save(l);
  if (typeof document !== "undefined") {
    document.documentElement.lang = l;
  }
  for (const fn of _subscribers) fn(l);
}

/**
 * Looks up a translation key.
 * Order: dict[locale][key] → dict.en[key] → key itself.
 * If vars is provided, replaces {name}-style placeholders in the resolved value.
 */
export function t(key: string, vars?: Record<string, string | number>): string {
  const value = _dicts[_locale][key] ?? _dicts.en[key] ?? key;
  if (!vars) return value;
  return value.replace(/\{(\w+)\}/g, (match, name) => {
    const v = vars[name];
    return v !== undefined ? String(v) : match;
  });
}

/**
 * Registers a subscriber invoked on every setLocale call.
 * Returns an unsubscribe function.
 */
export function subscribe(fn: (l: Locale) => void): () => void {
  _subscribers.add(fn);
  return () => _subscribers.delete(fn);
}
