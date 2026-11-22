/** What differs by where a plugin comes from; string fields are i18n keys. */

import type { PluginHostPlugin } from "../../../io/mcp-host/mcp-host";

export interface SourceInfo {
  review: string;
  /** Step 1's warning under the shield line. */
  warning: { key: string; strong: boolean } | null;
  removeLabel: string;
  confirm: string;
  confirmGo: string;
  removeFailed: string;
  /** Installed from the catalog, which offers its updates; a local plugin shows its folder instead. */
  fromCatalog: boolean;
}

const FROM_CATALOG = {
  removeLabel: "plugins.delete",
  confirm: "plugins.confirm_delete",
  confirmGo: "plugins.delete",
  removeFailed: "plugins.err_remove",
  fromCatalog: true,
};

export const SOURCES: Record<PluginHostPlugin["source"], SourceInfo> = {
  official: {
    ...FROM_CATALOG,
    review: "plugins.reviewed_official",
    warning: null,
  },
  community: {
    ...FROM_CATALOG,
    review: "plugins.reviewed_community",
    warning: { key: "plugins.warn_community", strong: true },
  },
  local: {
    review: "plugins.reviewed_local",
    warning: { key: "plugins.warn_local", strong: false },
    removeLabel: "plugins.remove_local",
    confirm: "plugins.confirm_remove_local",
    confirmGo: "plugins.remove_go",
    removeFailed: "plugins.err_remove_local",
    fromCatalog: false,
  },
};

/** A managing call's rejection: its lead's i18n key, the host's string, and whether Retry repeats the update. */
export interface Failure {
  lead: string;
  message: string;
  retry?: boolean;
}
