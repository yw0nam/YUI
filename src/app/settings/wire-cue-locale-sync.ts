import { getLocale, type Locale, subscribe as subscribeLocale } from "../../ui/i18n";

interface CueLocaleStore {
  syncLocale(next: Locale): void;
}

/** Reseeds the built-in cues left in another language: once now, then on each display-language change. */
export function wireCueLocaleSync(stores: {
  proactiveSettings: CueLocaleStore;
  scheduleSettings: CueLocaleStore;
}): () => void {
  const sync = (locale: Locale): void => {
    stores.proactiveSettings.syncLocale(locale);
    stores.scheduleSettings.syncLocale(locale);
  };
  sync(getLocale());
  return subscribeLocale(sync);
}
