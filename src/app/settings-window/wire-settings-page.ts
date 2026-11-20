import type { EndpointsConfig } from "../../contract";
import { isChatConfigured } from "../../dispatcher/backend/backend-caller";
import type { SettingsBridge } from "../../io/bridge/settings-bridge";
import { isSettingsFocus, type PageRequest } from "../../settings/panels/settings-pages";
import { readSettingsPage } from "../../settings/preset/bound-preset";

/** The page and focus the URL asks for, dropped from the URL so a later reload lands where the user is. */
export function takeRequestedPage(): PageRequest | null {
  const page = readSettingsPage();
  if (!page) return null;
  const url = new URL(location.href);
  const focus = url.searchParams.get("focus");
  url.searchParams.delete("page");
  url.searchParams.delete("focus");
  history.replaceState(history.state, "", url);
  return isSettingsFocus(focus) ? { page, focus } : { page };
}

/** Whether the window leads with the Connection page's Quick start; no page while the config failed to load. */
export function opensOnQuickStart(endpoints: EndpointsConfig | null): boolean {
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
  retarget: (id: string, request?: PageRequest) => void;
}): { attach(select: (request: PageRequest) => void): void; dispose(): void } {
  let select: ((request: PageRequest) => void) | null = null;
  let pending: PageRequest | null = null;
  const off = deps.bridge.onSettingsPage(({ preset, page, focus }) => {
    if (preset !== deps.boundId) return;
    const target = preset ?? deps.active();
    const request = page && { page, ...(focus ? { focus } : {}) };
    if (target !== deps.editing()) deps.retarget(target, request);
    else if (request) {
      if (select) select(request);
      else pending = request;
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
