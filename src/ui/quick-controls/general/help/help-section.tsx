/** The Help section: one Ask button per bundled guide, then the caller's extra rows. */

import type { ReactNode } from "react";
import type { GuideKey } from "../../../../contract";
import { t } from "../../../i18n";
import { GUIDES } from "../../sections/help/help-section";

export function HelpSection({
  onGuide,
  children,
}: {
  /** Absent where a delegated listener on the panel handles the `data-guide` buttons. */
  onGuide?: (guide: GuideKey, text: string) => void;
  children?: ReactNode;
}) {
  return (
    <div className="yui-sec">
      <div className="yui-sec__head">
        <h2 className="yui-sec__title">{t("help.section")}</h2>
      </div>
      <div className="yui-group">
        {GUIDES.map((guide) => (
          <div className="yui-row" key={guide}>
            <div className="yui-row__main">
              <span className="yui-row__label">{t(`help.${guide}.label`)}</span>
              <span className="yui-row__sub">{t(`help.${guide}.sub`)}</span>
            </div>
            <button
              className="yui-link-btn yui-help-btn"
              type="button"
              data-guide={guide}
              onClick={onGuide && (() => onGuide(guide, t(`help.${guide}.request`)))}
            >
              {t("help.ask")}
            </button>
          </div>
        ))}
        {children}
      </div>
    </div>
  );
}
