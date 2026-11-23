// Page identity — the suffix of each rail button's `yui-tab-*` element id.
// "hist" renders only when a transcript is injected, "plugins" only with the MCP host; the rest are always present.
export const CHARACTER_PAGES = ["conn", "voice", "persona", "body", "hist"] as const;
export const APP_PAGES = [
  "together",
  "listening",
  "perms",
  "plugins",
  "react",
  "motion",
  "general",
] as const;
export type SettingsPage = (typeof CHARACTER_PAGES)[number] | (typeof APP_PAGES)[number];

/** True when `page` holds the edited character's own settings. */
export function isCharacterPage(page: string): boolean {
  return (CHARACTER_PAGES as readonly string[]).includes(page);
}

/** True when `v` is the id of a settings page. */
export function isSettingsPage(v: unknown): v is SettingsPage {
  return (
    typeof v === "string" && ([...CHARACTER_PAGES, ...APP_PAGES] as readonly string[]).includes(v)
  );
}

/** A field a settings request asks the page to focus: the chat key of the connection in use. */
export type SettingsFocus = "chat_key";

/** A settings page to show and the field to focus on it. */
export interface PageRequest {
  page: SettingsPage;
  focus?: SettingsFocus;
}

/** True when `v` is a field a settings request can ask to focus. */
export function isSettingsFocus(v: unknown): v is SettingsFocus {
  return v === "chat_key";
}
