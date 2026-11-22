/** Markup pieces the Plugins page's sections share. */

import { type ReactNode, type RefObject, useEffect, useRef } from "react";
import type { PluginHostPlugin } from "../../../io/mcp-host/mcp-host";
import { t } from "../../i18n";

/** The warning icon for text markup; the two Connection quick-start files import this string. */
export const ICON_WARN = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="2"/><path d="M12 7.5v5.5M12 16.2v.1" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;

const WARN_ICON = (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="2" />
    <path d="M12 7.5v5.5M12 16.2v.1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

const FOLDER_ICON = (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path
      d="M3.5 7.2c0-1 .8-1.7 1.7-1.7h4l2 2.2h7.6c1 0 1.7.8 1.7 1.7v7.9c0 1-.8 1.7-1.7 1.7H5.2c-1 0-1.7-.8-1.7-1.7V7.2Z"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinejoin="round"
    />
  </svg>
);

export const CHEV_ICON = (
  <svg className="yui-plg-chev" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path
      d="M9 6l6 6-6 6"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const SEAL_ICON = (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path
      d="m8.5 12.2 2.4 2.4 4.6-4.8"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const PEOPLE_ICON = (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle cx="9" cy="9" r="3" stroke="currentColor" strokeWidth="2" />
    <path
      d="M3.5 19c1-3 3-4.5 5.5-4.5s4.5 1.5 5.5 4.5M16 6.5a3 3 0 0 1 0 5.5M17.5 14.6c1.6.7 2.6 2 3 4.4"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    />
  </svg>
);

export const SHIELD_ICON = (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path
      d="M12 3.8 5.5 6.3v5.1c0 4.1 2.7 7.4 6.5 8.8 3.8-1.4 6.5-4.7 6.5-8.8V6.3L12 3.8Z"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
    />
    <path
      d="m9.3 12 1.9 1.9 3.6-3.7"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const PLUS_ICON = (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

/** What differs by where a plugin comes from; string fields are i18n keys. */
interface SourceInfo {
  icon: ReactNode;
  review: string;
  /** Step 1's warning under the shield line. */
  warning: { key: string; icon: ReactNode; strong: boolean } | null;
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
    icon: SEAL_ICON,
    review: "plugins.reviewed_official",
    warning: null,
  },
  community: {
    ...FROM_CATALOG,
    icon: PEOPLE_ICON,
    review: "plugins.reviewed_community",
    warning: { key: "plugins.warn_community", icon: WARN_ICON, strong: true },
  },
  local: {
    icon: FOLDER_ICON,
    review: "plugins.reviewed_local",
    warning: { key: "plugins.warn_local", icon: FOLDER_ICON, strong: false },
    removeLabel: "plugins.remove_local",
    confirm: "plugins.confirm_remove_local",
    confirmGo: "plugins.remove_go",
    removeFailed: "plugins.err_remove_local",
    fromCatalog: false,
  },
};

/** A managing call's rejection: its lead's i18n key, the host's string, and the action Retry repeats. */
export interface Failure {
  lead: string;
  message: string;
  retry?: string;
}

/** A section title row: the title on the left, an optional control or state text on the right. */
export function SectionHead({ title, aside }: { title: string; aside?: ReactNode }) {
  return (
    <div className="yui-sec__head">
      <h2 className="yui-sec__title">{title}</h2>
      {aside}
    </div>
  );
}

export function Spinner() {
  return <span className="yui-plg-spin" aria-hidden="true" />;
}

export function Badge({ source }: { source: PluginHostPlugin["source"] }) {
  return (
    <span className="yui-plg-badge">
      {SOURCES[source].icon}
      {t(`plugins.source_${source}`)}
    </span>
  );
}

export function Version({ version }: { version: string | null }) {
  return version ? <span className="yui-plg-ver">{t("plugins.version", { version })}</span> : null;
}

/** An inline error line: YUI's lead, then the host's string as sent. */
export function ErrLine({
  lead,
  message,
  tail,
}: {
  lead: string;
  message: string | null;
  tail?: ReactNode;
}) {
  return (
    <p className="yui-plg-err" role="alert">
      {WARN_ICON}
      <span>
        {lead}
        {message ? ` ${message}` : ""}
      </span>
      {tail}
    </p>
  );
}

/** A translated line with `node` where its `{name}` placeholder sits. */
export function withSlot(
  key: string,
  name: string,
  node: ReactNode,
  vars: Record<string, string | number> = {},
): ReactNode {
  const [before, after = ""] = t(key, vars).split(`{${name}}`);
  return (
    <>
      {before}
      {node}
      {after}
    </>
  );
}

/** Set after the page's first commit; a keyed block that mounts later reads it to fade in. */
export type EnterRef = RefObject<boolean>;

/** Adds the fade-in once, when a block mounts after the page's first commit. */
export function useKeyedEnter(animate: EnterRef): RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (animate.current) ref.current?.classList.add("yui-keyed-enter");
  }, [animate]);
  return ref;
}
