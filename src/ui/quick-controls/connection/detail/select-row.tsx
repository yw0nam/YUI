/** A select row: the label on the left, the control (and its description line) after it. */

import type { ReactNode } from "react";
import { t } from "../../../i18n";

export function SelectRow({
  id,
  labelKey,
  children,
}: {
  id: string;
  labelKey: string;
  children: ReactNode;
}) {
  return (
    <div className="yui-row">
      <div className="yui-row__main">
        <label className="yui-input-row__label" htmlFor={id}>
          {t(labelKey)}
        </label>
      </div>
      {children}
    </div>
  );
}
