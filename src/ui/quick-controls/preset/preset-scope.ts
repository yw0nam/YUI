import { t } from "../../i18n";
import type { QuickControlsTab } from "../constants";

// Tabs whose settings belong to a preset; every other tab edits device-wide settings.
const SCOPE_KEY: Partial<Record<QuickControlsTab, string>> = {
  conn: "preset.scope_tab",
  talk: "preset.scope_tab",
  char: "preset.scope_char",
  hist: "preset.scope_tab",
};

/** The line above a tab's title: the preset the tab edits, or that its settings are shared. */
export function presetScopeText(tab: string, presetName: string): string {
  return t(SCOPE_KEY[tab as QuickControlsTab] ?? "preset.scope_shared", {
    name: presetName,
    tab: t(`tabs.${tab}`),
  });
}
