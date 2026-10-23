/** Binds the card module to this window's stores, preset, UI language, and config; read once per turn. */
import type { AppConfig } from "../../config/load";
import type { Locale } from "../../config/validators/persona/types";
import type { EndpointsConfig } from "../../contract";
import { assembleCard } from "../../io/chat/card/assemble-card";
import { resolveCard } from "../../io/chat/card/resolve-card";
import type { PresetEntry } from "../../settings/preset/active-preset";
import type { SettingsStores } from "../../settings/settings-stores";
import { getLocale } from "../../ui/i18n";

export function wireCard(deps: {
  agentSettings: Pick<SettingsStores["agentSettings"], "get">;
  userNameSettings: Pick<SettingsStores["userNameSettings"], "get">;
  getEndpoints: () => EndpointsConfig;
  getConfig: () => Pick<AppConfig, "persona">;
  presetEntry: () => PresetEntry;
}) {
  const { agentSettings, userNameSettings, getEndpoints, getConfig, presetEntry } = deps;
  const userNameIn = (locale: Locale): string =>
    userNameSettings.get().name || getConfig().persona.user_fallback[locale];
  const resolveIn = (locale: Locale) =>
    resolveCard({
      settings: agentSettings.get(),
      locale,
      persona: getConfig().persona,
      presetEntry: presetEntry(),
      chatApi: getEndpoints().chat_api,
    });

  return {
    getCard: () => resolveIn(getLocale()),
    userName: () => userNameIn(getLocale()),
    getCardText(): { system: string; postHistory: string } | null {
      const locale = getLocale();
      const resolved = resolveIn(locale);
      if (!resolved) return null;
      return assembleCard({
        ...resolved,
        framing: getConfig().persona.framing[locale],
        userName: userNameIn(locale),
        chatInstructions: getEndpoints().chat_instructions,
      });
    },
  };
}
