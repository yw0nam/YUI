/**
 * Reactions section — owns the agent-port input, the ingress URL, and the Thread rows.
 * Same pattern as sibling sections: explicit deps + wired from shell.
 * This module owns inputs, handlers, subscriptions, redraws, teardown.
 */
import type { createAgentNotifySettings } from "../../../../settings/backend/agent-notify-settings";
import { ingressUrl } from "../../../../settings/backend/agent-notify-settings";
import type { FlagSettingsStore } from "../../../../settings/persisted-store";
import type { ThreadReactionThresholdsSettingsStore } from "../../../../settings/threads/thread-reaction-thresholds-settings";
import type { ThreadTurnsSettingsStore } from "../../../../settings/threads/thread-turns-settings";
import { createThreadReactionThresholdsRow } from "./thread-reaction-thresholds-row";
import { createThreadTurnsRow } from "./thread-turns-row";

type AgentNotifySettingsStore = ReturnType<typeof createAgentNotifySettings>;

interface ReactionsSectionDeps {
  boundId?: string | null;
  /** Panel root (el) — query the agent-port input and the ingress URL here. */
  root: HTMLElement;
  /** Agent notification settings — the agent-port row's store. Absent when the section isn't rendered. */
  agentNotifySettings?: AgentNotifySettingsStore;
  /** Thread turns level store. Absent when its row isn't rendered. */
  threadTurnsSettings?: ThreadTurnsSettingsStore;
  /** Reaction thresholds store. Absent when its rows aren't rendered. */
  threadReactionThresholdsSettings?: ThreadReactionThresholdsSettingsStore;
  /** Thread reactions switch. With the thresholds store, renders the Reaction thresholds rows. */
  threadReactionsSettings?: FlagSettingsStore;
  /** Switch-row redraw — the agent-notify subscription calls both. */
  reflectSwitchRows: () => void;
  /** Panel open state — store subscriptions redraw only while the panel is open. */
  isOpen: () => boolean;
}

interface ReactionsSection {
  /** Render the agent port and the Thread rows from their stores. */
  reflect(): void;
  /** Permanent teardown — unsubscribe stores and remove all listeners. */
  dispose(): void;
}

export function createReactionsSection(deps: ReactionsSectionDeps): ReactionsSection {
  const {
    root: el,
    agentNotifySettings,
    threadTurnsSettings,
    threadReactionThresholdsSettings,
    threadReactionsSettings,
    reflectSwitchRows,
    isOpen,
  } = deps;

  const ingressUrlText = el.querySelector("#yui-ingress-url");
  const agentPortInput = el.querySelector<HTMLInputElement>("#yui-agent-port");
  const agentPortAside = agentPortInput?.closest(".yui-fold")?.querySelector(".yui-fold__aside");

  function reflectAgentNotify(): void {
    if (!agentNotifySettings) return;
    if (agentPortInput) agentPortInput.value = String(agentNotifySettings.get().port);
    if (agentPortAside) agentPortAside.textContent = String(agentNotifySettings.get().port);
    if (ingressUrlText)
      ingressUrlText.textContent = ingressUrl(agentNotifySettings.get().port, deps.boundId ?? null);
  }

  const threadTurns =
    agentNotifySettings && threadTurnsSettings
      ? createThreadTurnsRow({ root: el, threadTurnsSettings, agentNotifySettings, isOpen })
      : undefined;

  const reactionThresholds =
    threadReactionThresholdsSettings && threadReactionsSettings
      ? createThreadReactionThresholdsRow({
          root: el,
          settings: threadReactionThresholdsSettings,
          isOpen,
        })
      : undefined;

  const unsubscribeAgentNotify = agentNotifySettings?.subscribe(() => {
    if (isOpen()) {
      reflectSwitchRows();
      reflectAgentNotify();
    }
  });

  function handleAgentPortChange(): void {
    if (!agentNotifySettings || !agentPortInput) return;
    agentNotifySettings.setPort(Math.round(Number(agentPortInput.value)));
    reflectAgentNotify();
  }
  agentPortInput?.addEventListener("change", handleAgentPortChange);

  return {
    reflect(): void {
      reflectAgentNotify();
      reactionThresholds?.reflect();
      threadTurns?.reflect();
    },
    dispose(): void {
      reactionThresholds?.dispose();
      threadTurns?.dispose();
      unsubscribeAgentNotify?.();
      agentPortInput?.removeEventListener("change", handleAgentPortChange);
    },
  };
}
