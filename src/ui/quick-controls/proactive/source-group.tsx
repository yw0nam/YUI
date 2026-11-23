/** A source group: its switch row over a fold that dims and reads Off while the source is off. */

import { type ReactNode, useSyncExternalStore } from "react";
import type { Logger } from "../../../logger";
import { t } from "../../i18n";
import type { SwitchRow } from "../switch-row";
import { DescriptorRow } from "../switches/descriptor-row";

const subscribeNever = () => () => {};

export function SourceFold({
  title,
  aside,
  off,
  children,
}: {
  title: string;
  aside: string;
  off: boolean;
  children: ReactNode;
}) {
  return (
    <details className={off ? "yui-fold yui-fold--off" : "yui-fold"}>
      <summary>
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M9 6l6 6-6 6"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="yui-fold__title">{title}</span>
        <span className="yui-fold__aside">{off ? t("fold.off") : aside}</span>
      </summary>
      <div className="yui-fold__body">{children}</div>
    </details>
  );
}

export function SourceGroup({
  row,
  log,
  title,
  aside,
  children,
}: {
  row: SwitchRow;
  log: Logger;
  title: string;
  aside: string;
  children?: ReactNode;
}) {
  const enabled = useSyncExternalStore(row.subscribe ?? subscribeNever, () => row.getEnabled());
  return (
    <div className="yui-group">
      <DescriptorRow row={row} log={log} />
      {children === undefined ? null : (
        <SourceFold title={title} aside={aside} off={!enabled}>
          {children}
        </SourceFold>
      )}
    </div>
  );
}
