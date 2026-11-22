/** The History page's start-fresh row: a link that arms a confirm, whose go button runs the reset. */

import { useState } from "react";
import { t } from "../../i18n";

export function StartFresh({ onReset }: { onReset(): void }) {
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="yui-group yui-hist__action">
      <div className="yui-row">
        <div className="yui-row__main">
          <span className="yui-session__action-label">{t("session.action_label")}</span>
          <span className="yui-session__action-sub">{t("session.action_sub")}</span>
        </div>
        <button
          className="yui-link-btn yui-session__reset"
          type="button"
          hidden={confirming}
          onClick={() => setConfirming(true)}
        >
          {t("session.reset")}
        </button>
      </div>
      <div className="yui-confirm" hidden={!confirming}>
        <span className="yui-confirm__q">{t("session.confirm_q")}</span>
        <button
          className="yui-pill yui-pill--go yui-session__confirm"
          type="button"
          onClick={() => {
            onReset();
            setConfirming(false);
          }}
        >
          {t("session.confirm_go")}
        </button>
        <button
          className="yui-pill yui-session__cancel"
          type="button"
          onClick={() => setConfirming(false)}
        >
          {t("session.confirm_cancel")}
        </button>
      </div>
    </div>
  );
}
