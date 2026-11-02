import type { EndpointsConfig } from "../../contract";
import { isChatConfigured } from "../../dispatcher/backend/backend-caller";
import type { SettingsBridge } from "../../io/bridge/settings-bridge";
import type { SettingsPage } from "../../settings/panels/settings-pages";
import { readSettingsPage } from "../../settings/preset/bound-preset";

/** The page the URL asks for, dropped from the URL so a later reload lands where the user is. */
export function takeRequestedPage(): SettingsPage | null {
  const page = readSettingsPage();
  if (page) {
    const url = new URL(location.href);
    url.searchParams.delete("page");
    history.replaceState(history.state, "", url);
  }
  return page;
}

/** Whether the window leads with the First conversation page; no page while the config failed to load. */
export function showsFirstConversation(endpoints: EndpointsConfig | null): boolean {
  return endpoints !== null && !isChatConfigured(endpoints);
}

/** Answers an opener's page request: show the opener's character (reloading when another is edited), then its page once the panel is attached. */
export function wireSettingsPage(deps: {
  bridge: Pick<SettingsBridge, "onSettingsPage">;
  /** The preset the window is bound to; null for the main character's window. */
  boundId: string | null;
  /** The preset the window currently edits. */
  editing: () => string;
  /** The main character's preset id. */
  active: () => string;
  retarget: (id: string, page?: SettingsPage) => void;
}): { attach(select: (page: SettingsPage) => void): void; dispose(): void } {
  let select: ((page: SettingsPage) => void) | null = null;
  let pending: SettingsPage | null = null;
  const off = deps.bridge.onSettingsPage(({ preset, page }) => {
    if (preset !== deps.boundId) return;
    const target = preset ?? deps.active();
    if (target !== deps.editing()) deps.retarget(target, page);
    else if (page) {
      if (select) select(page);
      else pending = page;
    }
  });
  return {
    attach(fn) {
      select = fn;
      if (pending) fn(pending);
      pending = null;
    },
    dispose: off,
  };
}
