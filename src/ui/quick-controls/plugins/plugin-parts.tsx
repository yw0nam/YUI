/** Markup pieces the Plugins page's sections share. */

import {
  createContext,
  type ReactNode,
  type RefObject,
  useContext,
  useLayoutEffect,
  useRef,
} from "react";
import type { PluginHostPlugin } from "../../../io/mcp-host/mcp-host";
import { t } from "../../i18n";
import { WARN_GLYPH } from "../glyphs";
import { SOURCES } from "./plugin-sources";

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

function WarningGlyph() {
  return <span className="yui-plg-glyph">{WARN_GLYPH}</span>;
}

const SOURCE_ICONS: Record<PluginHostPlugin["source"], ReactNode> = {
  official: SEAL_ICON,
  community: PEOPLE_ICON,
  local: FOLDER_ICON,
};

const WARNING_ICONS: Partial<Record<PluginHostPlugin["source"], ReactNode>> = {
  community: <WarningGlyph />,
  local: FOLDER_ICON,
};

export function Spinner() {
  return <span className="yui-plg-spin" aria-hidden="true" />;
}

export function Badge({ source }: { source: PluginHostPlugin["source"] }) {
  return (
    <span className="yui-plg-badge">
      {SOURCE_ICONS[source]}
      {t(`plugins.source_${source}`)}
    </span>
  );
}

/** Step 1's warning under the shield line, when the source carries one. */
export function SourceWarning({ source }: { source: PluginHostPlugin["source"] }) {
  const warning = SOURCES[source].warning;
  if (!warning) return null;
  return (
    <p className={warning.strong ? "yui-plg-warn yui-plg-warn--strong" : "yui-plg-warn"}>
      {WARNING_ICONS[source]}
      <span>{t(warning.key)}</span>
    </p>
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
      <WarningGlyph />
      <span className="yui-plg-err__text">
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

/** Set after the page's first commit; a block that mounts later reads it to fade in. */
const EnterOnMount = createContext<RefObject<boolean>>({ current: false });

export function KeyedEnterProvider({
  animate,
  children,
}: {
  animate: RefObject<boolean>;
  children: ReactNode;
}) {
  return <EnterOnMount.Provider value={animate}>{children}</EnterOnMount.Provider>;
}

/** One block of the page, faded in when it mounts after the page's first commit. */
export function KeyedBlock({
  className,
  children,
  ...rest
}: {
  className?: string;
  "data-pid"?: string;
  role?: string;
  "aria-label"?: string;
  children?: ReactNode;
}) {
  const animate = useContext(EnterOnMount);
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (animate.current) ref.current?.classList.add("yui-keyed-enter");
  }, [animate]);
  return (
    <div ref={ref} className={className} {...rest}>
      {children}
    </div>
  );
}
