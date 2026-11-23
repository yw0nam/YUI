/**
 * The line under a control the push transport cannot use: why, then a link to the Connection page's
 * chat protocol select. The link only moves there; it never changes the transport.
 */

import "./push-reason.css";
import { t } from "../../../i18n";

export function PushReason({ reasonKey, hidden }: { reasonKey: string; hidden: boolean }) {
  return (
    <span className="yui-row__sub yui-push-reason" hidden={hidden}>
      {`${t(reasonKey)} `}
      <button className="yui-link-btn yui-push-reason__link" type="button">
        {t("push.to_transport")}
      </button>
    </span>
  );
}

/** Every reason link under `root` calls `onLink`, which opens the chat protocol select. */
export function bindTransportLinks(root: HTMLElement, onLink: () => void): () => void {
  function handleClick(e: MouseEvent): void {
    if ((e.target as HTMLElement).closest(".yui-push-reason__link")) onLink();
  }
  root.addEventListener("click", handleClick);
  return () => root.removeEventListener("click", handleClick);
}
