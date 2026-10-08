/**
 * The chat status line under the key row — the single writer of `.yui-chat-status`: text, dot
 * class, and the action button. Renders the push socket's state; hidden outside push mode.
 */

import type { PushSocketState } from "../../../../io/chat/push/push-socket";
import { t } from "../../../i18n";
import "./chat-status.css";

export interface ChatStatus {
  /** Writes the line for the socket's state, or hides it when undefined (outside push mode). */
  render(state: PushSocketState | undefined): void;
  dispose(): void;
}

export function createChatStatus(section: HTMLElement, deps: { onAction: () => void }): ChatStatus {
  const { onAction } = deps;
  const line = section.querySelector<HTMLParagraphElement>(".yui-chat-status")!;
  const textEl = line.querySelector<HTMLSpanElement>(".yui-chat-status__text")!;
  const actionEl = line.querySelector<HTMLButtonElement>(".yui-chat-status__action")!;

  // One line under the key row: where the push socket stands, and the button that opens the
  // socket without waiting.
  function render(state: PushSocketState | undefined): void {
    line.hidden = state === undefined;
    line.classList.remove("is-ready", "is-waiting", "is-failed");
    actionEl.hidden = true;
    if (state === undefined) {
      textEl.textContent = "";
      return;
    }
    switch (state.kind) {
      case "ready":
        line.classList.add("is-ready");
        textEl.textContent = t("svc.chat_status_connected", { id: state.chat_id });
        return;
      case "connecting":
        line.classList.add("is-waiting");
        textEl.textContent = t("svc.chat_status_connecting");
        return;
      case "reconnecting":
        line.classList.add("is-waiting");
        textEl.textContent = t("svc.chat_status_reconnecting", {
          seconds: Math.ceil(state.delay_ms / 1000),
        });
        actionEl.textContent = t("svc.chat_status_connect_now");
        actionEl.hidden = false;
        return;
      case "failed":
        line.classList.add("is-failed");
        textEl.textContent = t("svc.chat_status_refused");
        actionEl.textContent = t("svc.chat_status_reconnect");
        actionEl.hidden = false;
        return;
      default:
        textEl.textContent = t("svc.chat_status_offline");
    }
  }

  const handleAction = (): void => onAction();
  actionEl.addEventListener("click", handleAction);

  return {
    render,
    dispose(): void {
      actionEl.removeEventListener("click", handleAction);
    },
  };
}
