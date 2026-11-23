/** The edited preset's name over the panels: each page's scope line and the rail's character heading. */

import { CHARACTER_PAGES } from "../../../settings/panels/settings-pages";
import { presetIdForWindow, presetNameFor } from "../../../settings/preset/active-preset";
import { t } from "../../i18n";
import { useNotify } from "../../use-snapshot/use-notify";
import type { EditedPreset } from "./edited-preset";

function useEditedName(edited: EditedPreset): string {
  useNotify(edited.subscribe);
  return presetNameFor(edited.get(), presetIdForWindow());
}

/** The line above a page's title: only the edited character, or every character. */
export function ScopeLine({ page, edited }: { page: string; edited: EditedPreset }) {
  const name = useEditedName(edited);
  return (
    <p className="yui-tabpanel__scope" data-scope-tab={page}>
      {(CHARACTER_PAGES as readonly string[]).includes(page)
        ? t("scope.only", { name })
        : t("scope.every")}
    </p>
  );
}

export function CharacterHeadingText({ edited }: { edited: EditedPreset }) {
  return useEditedName(edited);
}
