// Page identity — the suffix of each rail button's `yui-tab-*` element id.
// "hist" renders only when a transcript is injected, "plugins" only with the plugin host; the rest are always present.
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

/** True when `v` is the id of a settings page. */
export function isSettingsPage(v: unknown): v is SettingsPage {
  return (
    typeof v === "string" && ([...CHARACTER_PAGES, ...APP_PAGES] as readonly string[]).includes(v)
  );
}
