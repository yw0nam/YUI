/** Markup pieces the Plugins page's installed and catalog lists share. */

import type { PluginHostPlugin } from "../../../io/mcp-host/mcp-host";
import { t } from "../../i18n";

/** Escapes host and plugin text for element content and attribute values alike. */
export function esc(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export const SPIN = '<span class="yui-plg-spin" aria-hidden="true"></span>';

export const ICON_WARN = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="2"/><path d="M12 7.5v5.5M12 16.2v.1" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
export const ICON_FOLDER = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3.5 7.2c0-1 .8-1.7 1.7-1.7h4l2 2.2h7.6c1 0 1.7.8 1.7 1.7v7.9c0 1-.8 1.7-1.7 1.7H5.2c-1 0-1.7-.8-1.7-1.7V7.2Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>`;
export const ICON_SHIELD = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3.8 5.5 6.3v5.1c0 4.1 2.7 7.4 6.5 8.8 3.8-1.4 6.5-4.7 6.5-8.8V6.3L12 3.8Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M12 8.5v4M12 15.4v.1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;
export const ICON_CHEV = `<svg class="yui-plg-chev" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const ICON_SEAL = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m8.5 12.2 2.4 2.4 4.6-4.8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const ICON_PEOPLE = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="9" cy="9" r="3" stroke="currentColor" stroke-width="2"/><path d="M3.5 19c1-3 3-4.5 5.5-4.5s4.5 1.5 5.5 4.5M16 6.5a3 3 0 0 1 0 5.5M17.5 14.6c1.6.7 2.6 2 3 4.4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;

const SOURCE_ICON: Record<PluginHostPlugin["source"], string> = {
  official: ICON_SEAL,
  community: ICON_PEOPLE,
  local: ICON_FOLDER,
};

export function badgeHtml(source: PluginHostPlugin["source"]): string {
  return `<span class="yui-plg-badge">${SOURCE_ICON[source]}${t(`plugins.source_${source}`)}</span>`;
}

export function versionHtml(version: string | null): string {
  return version ? `<span class="yui-plg-ver">v${esc(version)}</span>` : "";
}

/** An inline error line: YUI's lead, then the host's string as sent. */
export function errLineHtml(lead: string, message: string | null, tail = ""): string {
  return `<p class="yui-plg-err" role="alert">${ICON_WARN}<span>${lead}${message ? ` ${esc(message)}` : ""}</span>${tail}</p>`;
}
