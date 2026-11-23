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
export function ScopeLine({
  page,
  edited,
  hiddenWhile,
}: {
  page: string;
  edited: EditedPreset;
  /** Hides the line while it reads true. */
  hiddenWhile?: { get(): boolean; subscribe(cb: () => void): () => void };
}) {
  const name = useEditedName(edited);
  useNotify(hiddenWhile?.subscribe);
  return (
    <p className="yui-tabpanel__scope" data-scope-tab={page} hidden={hiddenWhile?.get()}>
      {(CHARACTER_PAGES as readonly string[]).includes(page)
        ? t("scope.only", { name })
        : t("scope.every")}
    </p>
  );
}

export function CharacterHeadingText({ edited }: { edited: EditedPreset }) {
  return useEditedName(edited);
}
