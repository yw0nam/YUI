/**
 * Reactions section — owns the agent-port, presence, pacer-gap, and rate-limit cap inputs.
 * Same pattern as sibling sections: explicit deps + wired from shell. reflect (store→DOM) handled by reflect layer;
 * this module owns inputs, handlers, subscriptions, teardown only.
 */
import type { createAgentNotifySettings } from "../../../io/settings/agent-notify-settings";
import type {
  GuardrailsSettingsStore,
  RateLimitOverrides,
} from "../../../io/settings/guardrails-settings";
import type { ClampedIntSettingsStore } from "../../../io/settings/persisted-store";
import { RATE_LIMIT_FIELDS } from "../constants";

type AgentNotifySettingsStore = ReturnType<typeof createAgentNotifySettings>;

interface ReactionsSectionDeps {
  /** Panel root (el) — query the agent-port, presence, pacer-gap, and cap inputs here. */
  root: HTMLElement;
  /** Agent notification settings — the agent-port row's store. Absent when the section isn't rendered. */
  agentNotifySettings?: AgentNotifySettingsStore;
  /** Away detection store. Absent when the presence row isn't rendered. */
  presenceSettings?: ClampedIntSettingsStore;
  /** Global proactive gap store. Absent when that row isn't rendered. */
  pacerGapSettings?: ClampedIntSettingsStore;
  /** Guardrail rate-limit overrides. Absent when the cap rows aren't rendered. */
  rateLimitSettings?: GuardrailsSettingsStore;
  /** Reflect layer's agent-notify redraw (reflectAgentNotify). */
  reflectAgentNotify: () => void;
  /** Reflect layer's presence redraw (reflectPresence) — the store subscription and blur both call it. */
  reflectPresence: () => void;
  /** Reflect layer's pacer-gap redraw (reflectPacerGap) — the store subscription and blur both call it. */
  reflectPacerGap: () => void;
  /** Reflect layer's rate-limit redraw (reflectRateLimits) — the store subscription and blur both call it. */
  reflectRateLimits: () => void;
  /** Reflect layer's switch-row redraw — the agent-notify subscription calls both. */
  reflectSwitchRows: () => void;
  /** Popover open state — store subscriptions redraw only while the panel is open. */
  isOpen: () => boolean;
}

interface ReactionsSection {
  /** Permanent teardown — unsubscribe stores and remove all listeners. */
  dispose(): void;
}

export function createReactionsSection(deps: ReactionsSectionDeps): ReactionsSection {
  const {
    root: el,
    agentNotifySettings,
    presenceSettings,
    pacerGapSettings,
    rateLimitSettings,
    reflectAgentNotify,
    reflectPresence,
    reflectPacerGap,
    reflectRateLimits,
    reflectSwitchRows,
    isOpen,
  } = deps;

  const agentPortInput = el.querySelector<HTMLInputElement>("#yui-agent-port");
  const presenceInput = el.querySelector<HTMLInputElement>("#yui-presence");
  const pacerGapInput = el.querySelector<HTMLInputElement>("#yui-pacer-gap");
  const rateLimitInputs = new Map<keyof RateLimitOverrides, HTMLInputElement>();
  for (const field of RATE_LIMIT_FIELDS) {
    const input = el.querySelector<HTMLInputElement>(`#${field.id}`);
    if (input) rateLimitInputs.set(field.key, input);
  }

  const unsubscribeAgentNotify = agentNotifySettings?.subscribe(() => {
    if (isOpen()) {
      reflectSwitchRows();
      reflectAgentNotify();
    }
  });
  const unsubscribePresence = presenceSettings?.subscribe(() => {
    if (isOpen()) reflectPresence();
  });
  const unsubscribePacerGap = pacerGapSettings?.subscribe(() => {
    if (isOpen()) reflectPacerGap();
  });
  const unsubscribeRateLimit = rateLimitSettings?.subscribe(() => {
    if (isOpen()) reflectRateLimits();
  });

  function handleAgentPortChange(): void {
    if (!agentNotifySettings || !agentPortInput) return;
    agentNotifySettings.setPort(Math.round(Number(agentPortInput.value)));
    reflectAgentNotify();
  }
  function handlePresenceChange(): void {
    if (!presenceSettings || !presenceInput) return;
    const v = Math.round(Number(presenceInput.value));
    presenceSettings.set(v * 1000);
    reflectPresence();
  }
  function handlePacerGapChange(): void {
    if (!pacerGapSettings || !pacerGapInput) return;
    const v = Math.round(Number(pacerGapInput.value));
    pacerGapSettings.set(v * 60_000);
    reflectPacerGap();
  }
  // Commit on change (blur / Enter), the same settle point as the agent port — a mid-typing
  // keystroke must not re-cap the live limiter. An emptied field clears the override.
  function handleRateLimitChange(e: Event): void {
    const input = e.target;
    if (!rateLimitSettings || !(input instanceof HTMLInputElement)) return;
    const key = RATE_LIMIT_FIELDS.find((f) => f.id === input.id)?.key;
    if (!key) return;
    rateLimitSettings.set({ [key]: Math.round(Number(input.value)) });
    reflectRateLimits();
  }

  agentPortInput?.addEventListener("change", handleAgentPortChange);
  presenceInput?.addEventListener("change", handlePresenceChange);
  presenceInput?.addEventListener("blur", reflectPresence);
  pacerGapInput?.addEventListener("change", handlePacerGapChange);
  pacerGapInput?.addEventListener("blur", reflectPacerGap);
  for (const input of rateLimitInputs.values()) {
    input.addEventListener("change", handleRateLimitChange);
    input.addEventListener("blur", reflectRateLimits);
  }

  return {
    dispose(): void {
      unsubscribeAgentNotify?.();
      unsubscribePresence?.();
      unsubscribePacerGap?.();
      unsubscribeRateLimit?.();
      agentPortInput?.removeEventListener("change", handleAgentPortChange);
      presenceInput?.removeEventListener("change", handlePresenceChange);
      presenceInput?.removeEventListener("blur", reflectPresence);
      pacerGapInput?.removeEventListener("change", handlePacerGapChange);
      pacerGapInput?.removeEventListener("blur", reflectPacerGap);
      for (const input of rateLimitInputs.values()) {
        input.removeEventListener("change", handleRateLimitChange);
        input.removeEventListener("blur", reflectRateLimits);
      }
    },
  };
}
