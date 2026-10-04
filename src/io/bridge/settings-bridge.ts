/**
 * Cross-window settings bridge — a typed bus linking the pop-out settings window ↔ main window.
 *
 * The localStorage `storage` event does not propagate reliably between Tauri webview windows,
 * so each channel here rides the cross-window bridge core.
 */

import type { GuideKey } from "../../contract";
import type { DelegationItem, PushSocketState } from "../chat/push/push-socket";
import { isGuideKey } from "../guide/guide-docs";
import type { VoiceInputState } from "../voice/stt-vad";
import { type BridgeTransport, createBridgeCore, type WindowKind } from "./core/bridge-core";
import type { ReasoningState } from "./reasoning-store";

const CH_SETTINGS_CHANGED = "yui://settings-changed";
const CH_MOUTH_PREVIEW = "yui://mouth-preview";
const CH_VOICE_SET = "yui://voice-set";
const CH_VOICE_STATE = "yui://voice-state";
const CH_PUSH_STATE = "yui://push-state";
const CH_PUSH_STATE_ASK = "yui://push-state-ask";
const CH_PUSH_RESET = "yui://push-reset";
const CH_PUSH_RECONNECT = "yui://push-reconnect";
const CH_DELEGATIONS = "yui://delegations";
const CH_DELEGATIONS_ASK = "yui://delegations-ask";
const CH_REASONING = "yui://reasoning";
const CH_REASONING_ASK = "yui://reasoning-ask";
const CH_HELP_GUIDE = "yui://help-guide";

interface VoiceStateSnapshot {
  state: VoiceInputState;
}

/** A Help-section press: the guide asked for and the request text in the pressing window's language. */
export interface HelpGuideRequest {
  guide: GuideKey;
  text: string;
}

export interface SettingsBridge {
  emitSettingsChanged(): void;
  onSettingsChanged(cb: (from: WindowKind) => void): () => void;
  emitMouthPreview(mouthOpen: number | null): void;
  onMouthPreview(cb: (mouthOpen: number | null) => void): () => void;
  emitVoiceSet(on: boolean): void;
  onVoiceSet(cb: (on: boolean) => void): () => void;
  emitVoiceState(snapshot: VoiceStateSnapshot): void;
  onVoiceState(cb: (snapshot: VoiceStateSnapshot) => void): () => void;
  /** Where the push socket stands. Only the window that owns the socket emits it. */
  emitPushState(state: PushSocketState): void;
  onPushState(cb: (state: PushSocketState) => void): () => void;
  /** A window with no socket of its own asking the owner to state where it stands. */
  emitPushStateAsk(): void;
  onPushStateAsk(cb: () => void): () => void;
  /** A window with no socket of its own asking the owner to start a new conversation. */
  emitPushReset(): void;
  onPushReset(cb: () => void): () => void;
  /** A window with no socket of its own asking the owner to open the socket now. */
  emitPushReconnect(): void;
  onPushReconnect(cb: () => void): () => void;
  /** The delegations list the push socket last fed. Only the window that owns the socket emits it. */
  emitDelegations(items: DelegationItem[]): void;
  onDelegations(cb: (items: DelegationItem[]) => void): () => void;
  /** A window with no socket of its own asking the owner to send the current list. */
  emitDelegationsAsk(): void;
  onDelegationsAsk(cb: () => void): () => void;
  /** The reasoning state the push socket last fed. Only the window that owns the socket emits it. */
  emitReasoning(state: ReasoningState): void;
  onReasoning(cb: (state: ReasoningState) => void): () => void;
  /** A window with no socket of its own asking the owner to send the current reasoning state. */
  emitReasoningAsk(): void;
  onReasoningAsk(cb: () => void): () => void;
  /** A window with no input source of its own asking the pet window to submit a guide request. */
  emitHelpGuide(request: HelpGuideRequest): void;
  onHelpGuide(cb: (request: HelpGuideRequest) => void): () => void;
  dispose(): void;
}

export function createSettingsBridge(
  transport: BridgeTransport | undefined,
  opts: { windowKind: WindowKind },
): SettingsBridge {
  const core = createBridgeCore(transport, opts.windowKind);
  const safeEmit = core.emit;
  const on = core.on;

  return {
    emitSettingsChanged() {
      safeEmit(CH_SETTINGS_CHANGED);
    },
    onSettingsChanged(cb) {
      return on<unknown>(CH_SETTINGS_CHANGED, (_payload, from) => cb(from));
    },
    emitMouthPreview(mouthOpen) {
      safeEmit(CH_MOUTH_PREVIEW, mouthOpen);
    },
    onMouthPreview(cb) {
      return on<number | null>(CH_MOUTH_PREVIEW, (v) => cb(v ?? null));
    },
    emitVoiceSet(value) {
      safeEmit(CH_VOICE_SET, value);
    },
    onVoiceSet(cb) {
      return on<boolean>(CH_VOICE_SET, (v) => cb(!!v));
    },
    emitVoiceState(snapshot) {
      safeEmit(CH_VOICE_STATE, snapshot);
    },
    onVoiceState(cb) {
      return on<VoiceStateSnapshot>(CH_VOICE_STATE, (s) => cb(s));
    },
    emitPushState(state) {
      safeEmit(CH_PUSH_STATE, state);
    },
    onPushState(cb) {
      return on<PushSocketState>(CH_PUSH_STATE, (s) => cb(s));
    },
    emitPushStateAsk() {
      safeEmit(CH_PUSH_STATE_ASK);
    },
    onPushStateAsk(cb) {
      return on<unknown>(CH_PUSH_STATE_ASK, () => cb());
    },
    emitPushReset() {
      safeEmit(CH_PUSH_RESET);
    },
    onPushReset(cb) {
      return on<unknown>(CH_PUSH_RESET, () => cb());
    },
    emitPushReconnect() {
      safeEmit(CH_PUSH_RECONNECT);
    },
    onPushReconnect(cb) {
      return on<unknown>(CH_PUSH_RECONNECT, () => cb());
    },
    emitDelegations(items) {
      safeEmit(CH_DELEGATIONS, items);
    },
    onDelegations(cb) {
      return on<DelegationItem[]>(CH_DELEGATIONS, (items) => cb(Array.isArray(items) ? items : []));
    },
    emitDelegationsAsk() {
      safeEmit(CH_DELEGATIONS_ASK);
    },
    onDelegationsAsk(cb) {
      return on<unknown>(CH_DELEGATIONS_ASK, () => cb());
    },
    emitReasoning(state) {
      safeEmit(CH_REASONING, state);
    },
    onReasoning(cb) {
      return on<unknown>(CH_REASONING, (state) => {
        if (state === null || typeof state !== "object") return;
        const s = state as Partial<ReasoningState>;
        if (typeof s.text !== "string" || typeof s.live !== "boolean") return;
        cb(s as ReasoningState);
      });
    },
    emitReasoningAsk() {
      safeEmit(CH_REASONING_ASK);
    },
    onReasoningAsk(cb) {
      return on<unknown>(CH_REASONING_ASK, () => cb());
    },
    emitHelpGuide(request) {
      safeEmit(CH_HELP_GUIDE, request);
    },
    onHelpGuide(cb) {
      return on<unknown>(CH_HELP_GUIDE, (request) => {
        const r = (request ?? {}) as Partial<HelpGuideRequest>;
        if (isGuideKey(r.guide) && typeof r.text === "string") cb({ guide: r.guide, text: r.text });
      });
    },
    dispose: core.dispose,
  };
}
