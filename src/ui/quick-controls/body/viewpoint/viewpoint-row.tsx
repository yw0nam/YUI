/** The Body page's view reset: the section whose head carries the button that returns the camera to its default view. */

import type { Logger } from "../../../../logger";
import { t } from "../../../i18n";

export function ViewpointRow({ onReset, log }: { onReset(): void; log: Logger }) {
  return (
    <div className="yui-sec">
      <div className="yui-sec__head">
        <h2 className="yui-sec__title">{t("viewpoint.section")}</h2>
        <button
          className="yui-link-btn yui-viewpoint-reset"
          type="button"
          onClick={() => {
            onReset();
            log.info("viewpoint_reset");
          }}
        >
          {t("viewpoint.reset")}
        </button>
      </div>
      <p className="yui-sec__note">{t("viewpoint.sub")}</p>
    </div>
  );
}
