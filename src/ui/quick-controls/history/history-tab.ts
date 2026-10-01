/**
 * History tab — the session accordion plus the start-fresh action, shared by the desktop panel
 * and the phone settings view. Read-only viewer over the persisted transcript.
 */

import type { createChatHistoryStore } from "../../../io/chat/chat-history-store";
import type { createSessionDiagnosticsStore } from "../../../io/chat/session-diagnostics";
import type { createSessionStore } from "../../../io/chat/session-store";
import type { Logger } from "../../../logger";
import { t } from "../../i18n";
import type { PushSocketPanelPort } from "../connection/connection-tab";
import { createHistorySection } from "../sections/history-section";

export interface HistoryTab {
  el: HTMLElement;
  /** Disarm a pending confirmation and re-render the session list — the open hook. */
  refresh(): void;
  dispose(): void;
}

// Start-fresh row under the session list. Reset is race-safe via pet window thunk.
function startFreshHtml(): string {
  return `
        <div class="yui-group yui-hist__action">
          <div class="yui-row">
            <div class="yui-row__main">
              <span class="yui-session__action-label">${t("session.action_label")}</span>
              <span class="yui-session__action-sub">${t("session.action_sub")}</span>
            </div>
            <button class="yui-link-btn yui-session__reset" type="button">${t("session.reset")}</button>
          </div>
          <div class="yui-confirm" hidden>
            <span class="yui-confirm__q">${t("session.confirm_q")}</span>
            <button class="yui-pill yui-pill--go yui-session__confirm" type="button">${t("session.confirm_go")}</button>
            <button class="yui-pill yui-session__cancel" type="button">${t("session.confirm_cancel")}</button>
          </div>
        </div>`;
}

export function createHistoryTab(deps: {
  /** Unified conversation transcript. Feeds the list; "Start fresh" closes the running session in it. */
  transcript: Pick<
    ReturnType<typeof createChatHistoryStore>,
    "startNewSession" | "sessions" | "subscribe"
  >;
  sessionDiagnostics?: ReturnType<typeof createSessionDiagnosticsStore>;
  /** Current session id pointer. "Start fresh" clears it along with diagnostics. */
  sessionStore?: ReturnType<typeof createSessionStore>;
  /** Stops the in-flight turn the way the stop button does, before the reset frame goes out. */
  stopTurn?: () => void;
  /** The push transport — "Start fresh" resets the conversation on it in push mode. */
  pushSocket?: PushSocketPanelPort;
  /** Effective chat protocol — push resets the conversation with a frame, not in place. */
  getChatApi: () => string | undefined;
  /** Skip repaints while the tab is closed. */
  isOpen: () => boolean;
  log: Logger;
}): HistoryTab {
  const {
    transcript,
    sessionDiagnostics,
    sessionStore,
    stopTurn,
    pushSocket,
    getChatApi,
    isOpen,
    log,
  } = deps;

  const el = document.createElement("div");
  el.className = "yui-tab-stack";
  // Start fresh needs the transcript plus both reset stores; the list alone renders without them.
  const startFresh = !!sessionDiagnostics && !!sessionStore;
  el.innerHTML = `
        <div class="yui-sec">
          <div class="yui-group yui-hist"></div>
          <p class="yui-hist__foot">${t("history.foot")}</p>
        </div>${startFresh ? startFreshHtml() : ""}`;

  const list = createHistorySection({ root: el, transcript, isOpen });

  const sessionResetBtn = el.querySelector<HTMLButtonElement>(".yui-session__reset");
  // Cue rows also use the .yui-confirm pattern, so scope the session's specifically.
  const sessionConfirmEl = el.querySelector<HTMLDivElement>(".yui-hist__action .yui-confirm");
  const sessionConfirmBtn = el.querySelector<HTMLButtonElement>(".yui-session__confirm");
  const sessionCancelBtn = el.querySelector<HTMLButtonElement>(".yui-session__cancel");

  function showSessionConfirm(): void {
    if (sessionConfirmEl) sessionConfirmEl.hidden = false;
    if (sessionResetBtn) sessionResetBtn.hidden = true;
  }

  function hideSessionConfirm(): void {
    if (sessionConfirmEl) sessionConfirmEl.hidden = true;
    if (sessionResetBtn) sessionResetBtn.hidden = false;
  }

  // Closes the running conversation: the id pointer and diagnostics reset, the transcript keeps
  // its turns behind a session boundary so the History tab can still read them.
  function handleSessionReset(): void {
    // A turn still running stops with the conversation, before the reset frame goes out.
    stopTurn?.();
    sessionStore?.clear();
    sessionDiagnostics?.clear();
    transcript.startNewSession();
    // Push mode keeps its conversation on the backend — it ends only when the frame lands.
    if (getChatApi() === "push") pushSocket?.sendReset();
    hideSessionConfirm();
    log.info("session_reset");
  }

  sessionResetBtn?.addEventListener("click", showSessionConfirm);
  sessionConfirmBtn?.addEventListener("click", handleSessionReset);
  sessionCancelBtn?.addEventListener("click", hideSessionConfirm);

  return {
    el,
    refresh(): void {
      // The confirm is static markup — disarm it so a reopen never lands on the destructive pill.
      hideSessionConfirm();
      list.render();
    },
    dispose(): void {
      sessionResetBtn?.removeEventListener("click", showSessionConfirm);
      sessionConfirmBtn?.removeEventListener("click", handleSessionReset);
      sessionCancelBtn?.removeEventListener("click", hideSessionConfirm);
      list.dispose();
      el.remove();
    },
  };
}
