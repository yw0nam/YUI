/**
 * One status line under a service's rows: the dot, the state text, and the action button. It shows
 * the push socket's state, the model-list read's view, or a server line's view; null hides it.
 */

import type { PushSocketState } from "../../../../io/chat/push/push-socket";
import { t } from "../../../i18n";
import type { StatusView } from "./model-status";
import { pushStateText } from "./push-state-text";
import "./chat-status.css";

const PUSH_DOT: Record<PushSocketState["kind"], readonly string[]> = {
  ready: ["is-ready"],
  connecting: ["is-waiting"],
  reconnecting: ["is-waiting"],
  failed: ["is-failed"],
  disconnected: [],
};

/** Where the push socket stands, and the button that opens it without waiting. */
export function pushStatusView(state: PushSocketState): StatusView {
  const action =
    state.kind === "reconnecting"
      ? t("svc.chat_status_connect_now")
      : state.kind === "failed"
        ? t("svc.chat_status_reconnect")
        : undefined;
  return { text: pushStateText(state), dot: PUSH_DOT[state.kind], action };
}

export function StatusLine({ view, onAction }: { view: StatusView | null; onAction: () => void }) {
  return (
    <p className={["yui-chat-status", ...(view?.dot ?? [])].join(" ")} hidden={view === null}>
      <span className="yui-chat-status__dot" aria-hidden="true" />
      {/* The live region: React leaves identical text untouched, so screen readers keep quiet. */}
      <span className="yui-chat-status__text" role="status" aria-live="polite" aria-atomic="true">
        {view?.text ?? ""}
      </span>
      <button
        className="yui-chat-status__action"
        type="button"
        hidden={view?.action === undefined}
        onClick={onAction}
      >
        {view?.action}
      </button>
    </p>
  );
}
