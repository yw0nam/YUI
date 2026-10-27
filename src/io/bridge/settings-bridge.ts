/**
 * Cross-window settings bridge — a typed bus linking the pop-out settings window ↔ main window.
 *
 * The localStorage `storage` event does not propagate reliably between Tauri webview windows,
 * so each channel here rides the cross-window bridge core.
 */

import type { GuideKey } from "../../contract";
import type { SettingsPage } from "../../settings/panels/settings-pages";
import { isSettingsPage } from "../../settings/panels/settings-pages";
import type { DelegationItem } from "../chat/push/push-frames";
import type { PushSocketState } from "../chat/push/push-socket";
import { isGuideKey } from "../guide/guide-docs";
import type { VoiceInputState } from "../voice/stt-vad";
import { type BridgeTransport, createBridgeCore, type WindowKind } from "./core/bridge-core";
import type { MessageControlOp, MessageSurfaceOp } from "./message/message-bridge";
import type { ReasoningState } from "./reasoning/reasoning-store";

const CH_SETTINGS_CHANGED = "yui://settings-changed";
const CH_MOUTH_PREVIEW = "yui://mouth-preview";
const CH_VOICE_SET = "yui://voice-set";
const CH_VOICE_STATE = "yui://voice-state";
const CH_PUSH_STATE = "yui://push-state";
const CH_PUSH_STATE_ASK = "yui://push-state-ask";
const CH_PUSH_RESET = "yui://push-reset";
const CH_PUSH_RECONNECT = "yui://push-reconnect";
const CH_SESSION_RESET = "yui://session-reset";
const CH_DELEGATIONS = "yui://delegations";
const CH_DELEGATIONS_ASK = "yui://delegations-ask";
const CH_REASONING = "yui://reasoning";
const CH_REASONING_ASK = "yui://reasoning-ask";
const CH_HELP_GUIDE = "yui://help-guide";
const CH_PET_WINDOWS_CHANGED = "yui://pet-windows-changed";
const CH_PRESET_CHANGED = "yui://preset-changed";
const CH_CHARACTER_ADDRESSED = "yui://character-addressed";
const CH_USER_TURN_ROUTED = "yui://user-turn-routed";
const CH_VOICE_SEGMENT = "yui://voice-segment";
const CH_SPEECH_ONSET = "yui://speech-onset";
const CH_SPEECH_STREAM = "yui://speech-stream";
const CH_SPEECH_STREAM_ASK = "yui://speech-stream-ask";
const CH_STOP_TURNS = "yui://stop-turns";
const CH_SPEECH_STREAM_CONTROL = "yui://speech-stream-control";
const CH_USER_TURN_DONE = "yui://user-turn-done";
const CH_SETTINGS_PAGE = "yui://settings-page";
const CH_OPEN_DEVTOOLS = "yui://open-devtools";

interface VoiceStateSnapshot {
  state: VoiceInputState;
}

/** A Help-section press: the guide asked for and the request text in the pressing window's language. */
export interface HelpGuideRequest {
  guide: GuideKey;
  text: string;
}

export interface PresetChange {
  active: string;
}

/** A pet window asking the open settings window of `preset` (null: the main one) to show that character, on `page` when given. */
export interface SettingsPageRequest {
  preset: string | null;
  page?: SettingsPage;
}

/** One character's reply named another open character; emitted once that reply's playback ended. */
export interface CharacterAddressed {
  /** The speaker's preset id. */
  from: string;
  /** The speaker's preset name. */
  name: string;
  /** The named character's preset id. */
  to: string;
  text: string;
  ts: number;
  user_message?: string;
}

/** The unified chat window routes one user message to one preset's pet window. */
export interface UserTurnRouted {
  sendId: string;
  /** The receiving preset id. */
  to: string;
  text: string;
  mention?: "character" | "everyone";
  via?: "voice";
}

/** Main's recognized speech for the unified chat window. */
export interface VoiceSegment {
  text: string;
}

/** A pet window's user turn for one send id is over, or never started. */
export interface UserTurnDone {
  sendId: string;
  /** The reporting preset id. */
  preset: string;
}

/** One message-window op a pet window sent, stamped with its preset. */
export interface SpeechStream {
  preset: string;
  op: MessageSurfaceOp;
}

/** The unified chat window's click on an error's fix, back to the preset whose window showed it. */
export interface SpeechStreamControl {
  preset: string;
  op: Extract<MessageControlOp, { op: "input-error-action" }>;
}

const isString = (v: unknown): v is string => typeof v === "string";
const isOptional = (v: unknown, test: (v: unknown) => boolean): boolean =>
  v === undefined || test(v);
const isBool = (v: unknown): v is boolean => typeof v === "boolean";

function isQuote(v: unknown): boolean {
  if (v === null || typeof v !== "object") return false;
  const q = v as Record<string, unknown>;
  return (
    isString(q.text) &&
    (q.via === "text" || q.via === "voice") &&
    typeof q.images === "number" &&
    isOptional(q.mention, (m) => m === "character" || m === "everyone")
  );
}

function isSourceLine(v: unknown): boolean {
  if (v === null || typeof v !== "object") return false;
  const l = v as Record<string, unknown>;
  return (
    (l.delivery === "urgent" || l.delivery === "batched") && isString(l.source) && isString(l.text)
  );
}

/** The ops the speech stream carries, each with its fields' declared types. */
function isStreamOp(v: unknown): v is MessageSurfaceOp {
  if (v === null || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  switch (o.op) {
    case "begin":
      return isOptional(o.paced, isBool);
    case "push":
      return isString(o.delta);
    case "pace":
      return (
        isString(o.text) &&
        (o.durationMs === null ||
          (typeof o.durationMs === "number" && Number.isFinite(o.durationMs) && o.durationMs >= 0))
      );
    case "end":
      return isOptional(o.defer, isBool);
    case "finish":
    case "hide":
    case "settle-quote":
    case "clear-quote":
    case "summon-input":
      return true;
    case "quote":
      return isQuote(o.quote);
    case "quote-signals":
      return Array.isArray(o.lines) && o.lines.every(isSourceLine);
    case "busy":
      return isBool(o.busy);
    case "name":
      return isString(o.name);
    case "input-error":
      return (
        isString(o.message) &&
        isOptional(
          o.action,
          (a) => a !== null && typeof a === "object" && isString((a as { label?: unknown }).label),
        )
      );
    default:
      return false;
  }
}

export interface SettingsBridge {
  /** A pet window's message ops for the unified chat window; delivered to every window. */
  emitSpeechStream(event: SpeechStream): void;
  onSpeechStream(cb: (event: SpeechStream) => void): () => void;
  /** The unified chat window asking every pet window to restate its name and busy state. */
  emitSpeechStreamAsk(): void;
  onSpeechStreamAsk(cb: () => void): () => void;
  /** The unified chat window's stop button or its answer to speech onset: every pet window stops its
   * running turn and speech. */
  emitStopTurns(): void;
  onStopTurns(cb: () => void): () => void;
  /** The user started speaking, with barge-in on, while the unified chat window shows; that window answers like its stop button while a character runs. */
  emitSpeechOnset(): void;
  onSpeechOnset(cb: () => void): () => void;
  /** The unified chat window's click on an error's fix; delivered to every window, receivers filter on `preset`. */
  emitSpeechStreamControl(event: SpeechStreamControl): void;
  onSpeechStreamControl(cb: (event: SpeechStreamControl) => void): () => void;
  /** A pet window asking an open settings window to show its character and page; delivered to every window, receivers filter on `preset`. */
  emitSettingsPage(request: SettingsPageRequest): void;
  onSettingsPage(cb: (request: SettingsPageRequest) => void): () => void;
  /** The settings window asking main's pet window to open Developer Tools; delivered to every window, bound pet windows ignore it. */
  emitOpenDevtools(): void;
  onOpenDevtools(cb: () => void): () => void;
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
  /** A window closed the preset's running conversation; that preset's pet window greets. */
  emitSessionReset(presetId: string): void;
  onSessionReset(cb: (presetId: string) => void): () => void;
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
  /** The active preset after a window edited the registry; a window booted on another one reloads. Settles once sent. */
  emitPresetChanged(change: PresetChange): Promise<void>;
  onPresetChanged(cb: (change: PresetChange) => void): () => void;
  emitPetWindowsChanged(): Promise<void>;
  onPetWindowsChanged(cb: () => void): () => void;
  /** A character's reply named this preset; delivered to every window, receivers filter on `to`. */
  emitCharacterAddressed(event: CharacterAddressed): void;
  onCharacterAddressed(cb: (event: CharacterAddressed) => void): () => void;
  /** The unified chat window's message for one preset; delivered to every window, receivers filter on `to`. */
  emitUserTurnRouted(event: UserTurnRouted): void;
  onUserTurnRouted(cb: (event: UserTurnRouted) => void): () => void;
  /** Main's recognized speech while the unified chat window shows; that window routes it. */
  emitVoiceSegment(event: VoiceSegment): void;
  onVoiceSegment(cb: (event: VoiceSegment) => void): () => void;
  /** A pet window's user turn for one send id is over; the unified chat window advances its sequence. */
  emitUserTurnDone(event: UserTurnDone): void;
  onUserTurnDone(cb: (event: UserTurnDone) => void): () => void;
  dispose(): void;
}

export function createSettingsBridge(
  transport: BridgeTransport | undefined,
  opts: { windowKind: WindowKind },
): SettingsBridge {
  const core = createBridgeCore(transport, opts.windowKind);
  const safeEmit = core.emit;
  const shared = new Set([
    CH_SETTINGS_CHANGED,
    CH_PRESET_CHANGED,
    CH_PET_WINDOWS_CHANGED,
    CH_VOICE_SET,
    CH_VOICE_STATE,
    CH_CHARACTER_ADDRESSED,
    CH_USER_TURN_ROUTED,
    CH_VOICE_SEGMENT,
    CH_SPEECH_ONSET,
    CH_USER_TURN_DONE,
    CH_SPEECH_STREAM,
    CH_SPEECH_STREAM_ASK,
    CH_STOP_TURNS,
    CH_SPEECH_STREAM_CONTROL,
    CH_SETTINGS_PAGE,
    CH_OPEN_DEVTOOLS,
  ]);
  const on: typeof core.on = (name, cb) => core.on(name, cb, { scoped: !shared.has(name) });

  return {
    emitSettingsPage(request) {
      safeEmit(CH_SETTINGS_PAGE, request);
    },
    onSettingsPage(cb) {
      return on<unknown>(CH_SETTINGS_PAGE, (request) => {
        if (request === null || typeof request !== "object") return;
        const { preset, page } = request as Partial<Record<keyof SettingsPageRequest, unknown>>;
        if (preset !== null && !isString(preset)) return;
        if (page === undefined) cb({ preset });
        else if (isSettingsPage(page)) cb({ preset, page });
      });
    },
    emitOpenDevtools() {
      safeEmit(CH_OPEN_DEVTOOLS);
    },
    onOpenDevtools(cb) {
      return on<unknown>(CH_OPEN_DEVTOOLS, () => cb());
    },
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
    emitSessionReset(presetId) {
      safeEmit(CH_SESSION_RESET, presetId);
    },
    onSessionReset(cb) {
      return on<unknown>(CH_SESSION_RESET, (presetId) => {
        if (typeof presetId === "string") cb(presetId);
      });
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
    emitPresetChanged(change) {
      return safeEmit(CH_PRESET_CHANGED, change);
    },
    onPresetChanged(cb) {
      return on<unknown>(CH_PRESET_CHANGED, (change) => {
        const active = (change as Partial<PresetChange> | null)?.active;
        if (typeof active === "string" && active) cb({ active });
      });
    },
    emitPetWindowsChanged() {
      return safeEmit(CH_PET_WINDOWS_CHANGED);
    },
    onPetWindowsChanged(cb) {
      return on(CH_PET_WINDOWS_CHANGED, () => cb());
    },
    emitCharacterAddressed(event) {
      safeEmit(CH_CHARACTER_ADDRESSED, event);
    },
    onCharacterAddressed(cb) {
      return on<unknown>(CH_CHARACTER_ADDRESSED, (event) => {
        if (event === null || typeof event !== "object") return;
        const e = event as Partial<CharacterAddressed>;
        if (
          typeof e.from === "string" &&
          typeof e.name === "string" &&
          typeof e.to === "string" &&
          typeof e.text === "string" &&
          typeof e.ts === "number"
        ) {
          cb({
            from: e.from,
            name: e.name,
            to: e.to,
            text: e.text,
            ts: e.ts,
            ...(typeof e.user_message === "string" ? { user_message: e.user_message } : {}),
          });
        }
      });
    },
    emitUserTurnRouted(event) {
      safeEmit(CH_USER_TURN_ROUTED, event);
    },
    onUserTurnRouted(cb) {
      return on<unknown>(CH_USER_TURN_ROUTED, (event) => {
        if (event === null || typeof event !== "object") return;
        const e = event as Partial<UserTurnRouted>;
        if (typeof e.sendId !== "string" || typeof e.to !== "string" || typeof e.text !== "string")
          return;
        const mention =
          e.mention === "character" || e.mention === "everyone" ? e.mention : undefined;
        if (e.mention !== undefined && mention === undefined) return;
        if (e.via !== undefined && e.via !== "voice") return;
        cb({
          sendId: e.sendId,
          to: e.to,
          text: e.text,
          ...(mention ? { mention } : {}),
          ...(e.via ? { via: e.via } : {}),
        });
      });
    },
    emitVoiceSegment(event) {
      safeEmit(CH_VOICE_SEGMENT, event);
    },
    onVoiceSegment(cb) {
      return on<unknown>(CH_VOICE_SEGMENT, (event) => {
        const text = (event as Partial<VoiceSegment> | null)?.text;
        if (isString(text) && text) cb({ text });
      });
    },
    emitUserTurnDone(event) {
      safeEmit(CH_USER_TURN_DONE, event);
    },
    onUserTurnDone(cb) {
      return on<unknown>(CH_USER_TURN_DONE, (event) => {
        if (event === null || typeof event !== "object") return;
        const e = event as Partial<UserTurnDone>;
        if (typeof e.sendId === "string" && typeof e.preset === "string") {
          cb({ sendId: e.sendId, preset: e.preset });
        }
      });
    },
    emitSpeechStream(event) {
      safeEmit(CH_SPEECH_STREAM, event);
    },
    onSpeechStream(cb) {
      return on<unknown>(CH_SPEECH_STREAM, (event) => {
        if (event === null || typeof event !== "object") return;
        const { preset, op } = event as Partial<SpeechStream>;
        if (isString(preset) && preset && isStreamOp(op)) cb({ preset, op });
      });
    },
    emitSpeechStreamAsk() {
      safeEmit(CH_SPEECH_STREAM_ASK);
    },
    onSpeechStreamAsk(cb) {
      return on<unknown>(CH_SPEECH_STREAM_ASK, () => cb());
    },
    emitStopTurns() {
      safeEmit(CH_STOP_TURNS);
    },
    onStopTurns(cb) {
      return on<unknown>(CH_STOP_TURNS, () => cb());
    },
    emitSpeechOnset() {
      safeEmit(CH_SPEECH_ONSET);
    },
    onSpeechOnset(cb) {
      return on<unknown>(CH_SPEECH_ONSET, () => cb());
    },
    emitSpeechStreamControl(event) {
      safeEmit(CH_SPEECH_STREAM_CONTROL, event);
    },
    onSpeechStreamControl(cb) {
      return on<unknown>(CH_SPEECH_STREAM_CONTROL, (event) => {
        if (event === null || typeof event !== "object") return;
        const { preset, op } = event as Partial<SpeechStreamControl>;
        if (isString(preset) && preset && op?.op === "input-error-action")
          cb({ preset, op: { op: "input-error-action" } });
      });
    },
    dispose: core.dispose,
  };
}
