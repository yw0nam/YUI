/** The bundled guides, and the delegated click on the Connection page's Help buttons. */

import type { GuideKey } from "../../../../contract";
import { isGuideKey } from "../../../../io/guide/guide-docs";
import { t } from "../../../i18n";

export const GUIDES: readonly GuideKey[] = ["controls", "capabilities"];

/** Calls `onGuide` with the guide key and its request text in the current locale. Returns the detach. */
export function bindHelpSection(
  root: HTMLElement,
  onGuide: (guide: GuideKey, text: string) => void,
): () => void {
  const onClick = (e: Event): void => {
    const guide = (e.target as Element).closest<HTMLElement>("[data-guide]")?.dataset.guide;
    if (isGuideKey(guide)) onGuide(guide, t(`help.${guide}.request`));
  };
  root.addEventListener("click", onClick);
  return () => root.removeEventListener("click", onClick);
}
