import { t } from "../../i18n";
import { CHARACTER_PAGES } from "../constants";

/** The line above a page's title: only the edited character, or every character. */
export function presetScopeText(page: string, presetName: string): string {
  return (CHARACTER_PAGES as readonly string[]).includes(page)
    ? t("scope.only", { name: presetName })
    : t("scope.every");
}
