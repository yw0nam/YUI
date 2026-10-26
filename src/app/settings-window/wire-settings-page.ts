import type { SettingsBridge } from "../../io/bridge/settings-bridge";
import type { SettingsPage } from "../../settings/panels/settings-pages";

/** Answers an opener's page request: show the opener's character (reloading when another is edited), then its page. */
export function wireSettingsPage(deps: {
  bridge: Pick<SettingsBridge, "onSettingsPage">;
  /** The preset the window is bound to; null for the main character's window. */
  boundId: string | null;
  /** The preset the window currently edits. */
  editing: () => string;
  /** The main character's preset id. */
  active: () => string;
  select: (page: SettingsPage) => void;
  retarget: (id: string, page?: SettingsPage) => void;
}): () => void {
  return deps.bridge.onSettingsPage(({ preset, page }) => {
    if (preset !== deps.boundId) return;
    const target = preset ?? deps.active();
    if (target !== deps.editing()) deps.retarget(target, page);
    else if (page) deps.select(page);
  });
}
