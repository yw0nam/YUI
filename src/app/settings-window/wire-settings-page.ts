import type { EndpointsConfig } from "../../contract";
import { isChatConfigured } from "../../dispatcher/backend/backend-caller";
import type { SettingsBridge } from "../../io/bridge/settings-bridge";
import {
  isSettingsFocus,
  type SettingsFocus,
  type SettingsPage,
} from "../../settings/panels/settings-pages";
import { readSettingsPage } from "../../settings/preset/bound-preset";

/** A page to show and the field to focus on it. */
export interface PageRequest {
  page: SettingsPage;
  focus?: SettingsFocus;
}

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

/** The focus as a trailing argument, none when the request names no field. */
const focusArg = (focus?: SettingsFocus): [] | [SettingsFocus] => (focus ? [focus] : []);

/** Answers an opener's page request: show the opener's character (reloading when another is edited), then its page once the panel is attached. */
export function wireSettingsPage(deps: {
  bridge: Pick<SettingsBridge, "onSettingsPage">;
  /** The preset the window is bound to; null for the main character's window. */
  boundId: string | null;
  /** The preset the window currently edits. */
  editing: () => string;
  /** The main character's preset id. */
  active: () => string;
  retarget: (id: string, page?: SettingsPage, focus?: SettingsFocus) => void;
}): {
  attach(select: (page: SettingsPage, focus?: SettingsFocus) => void): void;
  dispose(): void;
} {
  let select: ((page: SettingsPage, focus?: SettingsFocus) => void) | null = null;
  let pending: PageRequest | null = null;
  const off = deps.bridge.onSettingsPage(({ preset, page, focus }) => {
    if (preset !== deps.boundId) return;
    const target = preset ?? deps.active();
    if (target !== deps.editing()) deps.retarget(target, page, ...focusArg(focus));
    else if (page) {
      if (select) select(page, ...focusArg(focus));
      else pending = { page, ...(focus ? { focus } : {}) };
    }
  });
  return {
    attach(fn) {
      select = fn;
      if (pending) fn(pending.page, ...focusArg(pending.focus));
      pending = null;
    },
    dispose: off,
  };
}
