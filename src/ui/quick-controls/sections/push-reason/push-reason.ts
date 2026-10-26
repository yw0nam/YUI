/**
 * The line under a control the push transport cannot use: why, then a link to the Connection page's
 * chat protocol select. The link only moves there; it never changes the transport.
 */

import "./push-reason.css";
import { t } from "../../../i18n";

export function pushReasonHtml(reasonKey: string): string {
  return `<span class="yui-row__sub yui-push-reason" hidden>${t(reasonKey)} <button class="yui-link-btn yui-push-reason__link" type="button">${t("push.to_transport")}</button></span>`;
}

/** Every reason link under `root` opens the Connection page and focuses its chat protocol select. */
export function bindTransportLinks(
  root: HTMLElement,
  selectPage: (id: "conn") => void,
): () => void {
  function handleClick(e: MouseEvent): void {
    if (!(e.target as HTMLElement).closest(".yui-push-reason__link")) return;
    selectPage("conn");
    root.querySelector<HTMLSelectElement>(".yui-chat-type")?.focus();
  }
  root.addEventListener("click", handleClick);
  return () => root.removeEventListener("click", handleClick);
}
