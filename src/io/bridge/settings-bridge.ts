/**
 * Cross-window settings bridge — a typed bus linking the pop-out settings window ↔ main window.
 *
 * The localStorage `storage` event does not propagate reliably between Tauri webview windows,
 * so each channel here rides the cross-window bridge core.
 */

import type { GuideKey, ScreenRect } from "../../contract";
import type { SettingsPage } from "../../settings/panels/settings-pages";
import { isSettingsPage } from "../../settings/panels/settings-pages";
import type { DelegationItem } from "../chat/push/push-frames";
import type { PushSocketState } from "../chat/push/push-socket";
import { isGuideKey } from "../guide/guide-docs";
import type { VoiceInputState } from "../voice/stt-vad";
import { type BridgeTransport, createBridgeCore, type WindowKind } from "./core/bridge-core";
import { type Channel, type ChannelMethods, createChannelMethods } from "./core/channel-table";
import type { MessageControlOp } from "./message/message-bridge";
import type { MessageSurfaceOp } from "./message/surface-ops";
import type { ReasoningState } from "./reasoning/reasoning-store";

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

/** A pet window telling its quick-card window where to open, in window-relative logical px. */
export interface QuickCardOpen {
  /** The character's left and right edge x in the pet window. */
  left: number;
  right: number;
  /** The click's y in the pet window. */
  y: number;
  /** Main only: whether voice input is live right now, so the Listen tile opens seeded. */
  listening?: boolean;
}

/** The Threads window's top-level tabs. */
export type ThreadsTab = "threads" | "terminal";

/** Main asking the Threads window to open on `tab`, grown out of the chip at `chip` (screen logical px) when there is one. */
export interface ThreadsOpen {
  chip?: ScreenRect;
  tab?: ThreadsTab;
}

/** The unified chat window's error action, Backend command or Command reply close for one preset. */
export interface SpeechStreamControl {
  preset: string;
  op: Extract<MessageControlOp, { op: "input-error-action" | "command" | "command-reply-close" }>;
}

const isString = (v: unknown): v is string => typeof v === "string";
const isOptional = (v: unknown, test: (v: unknown) => boolean): boolean =>
  v === undefined || test(v);
const isBool = (v: unknown): v is boolean => typeof v === "boolean";
const isThreadsTab = (v: unknown): v is ThreadsTab => v === "threads" || v === "terminal";

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
    case "commands":
      return (
        Array.isArray(o.commands) &&
        o.commands.every((cmd) => {
          if (cmd === null || typeof cmd !== "object") return false;
          const c = cmd as Record<string, unknown>;
          return isString(c.name) && isString(c.description) && isString(c.args);
        })
      );
    case "command-reply": {
      if (o.reply === null || typeof o.reply !== "object") return false;
      const reply = o.reply as Record<string, unknown>;
      return (
        reply.kind === "clear" ||
        (isString(reply.name) &&
          isOptional(reply.speaker, isString) &&
          (reply.kind === "pending" || (reply.kind === "settled" && isString(reply.text))))
      );
    }
    case "begin":
      return true;
    case "push":
      return isString(o.delta);
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

export const channels = {
  /** A pet window's message ops for the unified chat window; delivered to every window. */
  SpeechStream: {
    name: "yui://speech-stream",
    scope: "shared",
    read(event, deliver: (event: SpeechStream) => void) {
      if (event === null || typeof event !== "object") return;
      const { preset, op } = event as Partial<SpeechStream>;
      if (isString(preset) && preset && isStreamOp(op)) deliver({ preset, op });
    },
  },
  /** The unified chat window asking every pet window to restate its name, busy state, commands and Command reply. */
  SpeechStreamAsk: { name: "yui://speech-stream-ask", scope: "shared" },
  /** The unified chat window's stop button or its answer to speech onset: every pet window stops its
   * running turn and speech. */
  StopTurns: { name: "yui://stop-turns", scope: "shared" },
  /** The user started speaking, with barge-in on, while the unified chat window shows; that window answers like its stop button while a character runs. */
  SpeechOnset: { name: "yui://speech-onset", scope: "shared" },
  /** The unified chat window's controls; delivered to every window, receivers filter on `preset`. */
  SpeechStreamControl: {
    name: "yui://speech-stream-control",
    scope: "shared",
    read(event, deliver: (event: SpeechStreamControl) => void) {
      if (event === null || typeof event !== "object") return;
      const { preset, op } = event as Partial<SpeechStreamControl>;
      if (!isString(preset) || !preset || !op) return;
      if (op.op === "input-error-action" || op.op === "command-reply-close")
        deliver({ preset, op: { op: op.op } });
      else if (op.op === "command" && isString(op.name) && isString(op.args))
        deliver({ preset, op: { op: "command", name: op.name, args: op.args } });
    },
  },
  /** A pet window asking an open settings window to show its character and page; delivered to every window, receivers filter on `preset`. */
  SettingsPage: {
    name: "yui://settings-page",
    scope: "shared",
    read(request, deliver: (request: SettingsPageRequest) => void) {
      if (request === null || typeof request !== "object") return;
      const { preset, page } = request as Partial<Record<keyof SettingsPageRequest, unknown>>;
      if (preset !== null && !isString(preset)) return;
      if (page === undefined) deliver({ preset });
      else if (isSettingsPage(page)) deliver({ preset, page });
    },
  },
  /** The settings window asking main's pet window to open Developer Tools; delivered to every window, bound pet windows ignore it. */
  OpenDevtools: { name: "yui://open-devtools", scope: "shared" },
  /** A pet window opening its quick-card window; scoped to the preset. */
  QuickCardOpen: {
    name: "yui://quick-card-open",
    scope: "preset",
    read(request, deliver: (request: QuickCardOpen) => void) {
      if (request === null || typeof request !== "object") return;
      const r = request as Partial<QuickCardOpen>;
      const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
      if (!finite(r.left) || !finite(r.right) || !finite(r.y)) return;
      if (r.listening !== undefined && typeof r.listening !== "boolean") return;
      deliver({
        left: r.left,
        right: r.right,
        y: r.y,
        ...(r.listening === undefined ? {} : { listening: r.listening }),
      });
    },
  },
  /** A quick-card window reporting it has booted; scoped to the preset. */
  QuickCardReady: { name: "yui://quick-card-ready", scope: "preset" },
  /** Main's Threads chip opening the Threads window. */
  ThreadsOpen: {
    name: "yui://threads-open",
    scope: "shared",
    read(request, deliver: (request: ThreadsOpen) => void) {
      const { chip, tab } = (request ?? {}) as { chip?: unknown; tab?: unknown };
      const { x, y, width, height } = (chip ?? {}) as Record<string, unknown>;
      const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
      if (chip !== undefined && ![x, y, width, height].every(finite)) return;
      if (tab !== undefined && !isThreadsTab(tab)) return;
      deliver({
        ...(chip === undefined ? {} : { chip: { x, y, width, height } as ScreenRect }),
        ...(tab === undefined ? {} : { tab }),
      });
    },
  },
  /** The Threads window reporting it has booted. */
  ThreadsReady: { name: "yui://threads-ready", scope: "shared" },
  /** The Threads window is hidden again, after its close or a failed open; the chip leaves its open state. */
  ThreadsClosed: { name: "yui://threads-closed", scope: "shared" },
  /** A quick card asking main to open the Threads window on `tab`; any preset's card reaches main. */
  ThreadsOpenRequest: {
    name: "yui://threads-open-request",
    scope: "shared",
    encode: (tab: ThreadsTab) => ({ tab }),
    read(request, deliver: (tab: ThreadsTab) => void) {
      const tab = (request as { tab?: unknown } | null)?.tab;
      if (isThreadsTab(tab)) deliver(tab);
    },
  },
  SettingsChanged: {
    name: "yui://settings-changed",
    scope: "shared",
    encode: () => undefined,
    read: (_payload, deliver: (from: WindowKind) => void, from) => deliver(from),
  },
  MouthPreview: {
    name: "yui://mouth-preview",
    scope: "preset",
    read: (v: number | null, deliver: (mouthOpen: number | null) => void) => deliver(v ?? null),
  },
  VoiceSet: {
    name: "yui://voice-set",
    scope: "shared",
    read: (v: boolean, deliver: (on: boolean) => void) => deliver(!!v),
  },
  VoiceState: {
    name: "yui://voice-state",
    scope: "shared",
    read: (s: VoiceStateSnapshot, deliver: (snapshot: VoiceStateSnapshot) => void) => deliver(s),
  },
  /** Where the push socket stands. Only the window that owns the socket emits it. */
  PushState: {
    name: "yui://push-state",
    scope: "preset",
    read: (s: PushSocketState, deliver: (state: PushSocketState) => void) => deliver(s),
    mirror: { ask: "PushStateAsk" as const, initial: { kind: "disconnected" } as PushSocketState },
  },
  /** A window with no socket of its own asking the owner to state where it stands. */
  PushStateAsk: { name: "yui://push-state-ask", scope: "preset" },
  /** A window with no socket of its own asking the owner to start a new conversation. */
  PushReset: { name: "yui://push-reset", scope: "preset" },
  /** A window closed the preset's running conversation; that preset's pet window greets. */
  SessionReset: {
    name: "yui://session-reset",
    scope: "preset",
    read(presetId, deliver: (presetId: string) => void) {
      if (typeof presetId === "string") deliver(presetId);
    },
  },
  /** Quick start confirmed its key; this preset's pet window greets. */
  FirstConversationConnected: { name: "yui://first-conversation-connected", scope: "preset" },
  /** Quick start asked to replay the first conversation; this preset's pet window replays it. */
  FirstConversationReplay: { name: "yui://first-conversation-replay", scope: "preset" },
  /** A window with no socket of its own asking the owner to open the socket now. */
  PushReconnect: { name: "yui://push-reconnect", scope: "preset" },
  /** The delegations list the push socket last fed. Only the window that owns the socket emits it. */
  Delegations: {
    name: "yui://delegations",
    scope: "preset",
    read: (items: DelegationItem[], deliver: (items: DelegationItem[]) => void) =>
      deliver(Array.isArray(items) ? items : []),
    mirror: { ask: "DelegationsAsk" as const, initial: [] as DelegationItem[] },
  },
  /** A window with no socket of its own asking the owner to send the current list. */
  DelegationsAsk: { name: "yui://delegations-ask", scope: "preset" },
  /** The reasoning state the push socket last fed. Only the window that owns the socket emits it. */
  Reasoning: {
    name: "yui://reasoning",
    scope: "preset",
    read(state, deliver: (state: ReasoningState) => void) {
      if (state === null || typeof state !== "object") return;
      const s = state as Partial<ReasoningState>;
      if (typeof s.text !== "string" || typeof s.live !== "boolean") return;
      deliver(s as ReasoningState);
    },
    mirror: { ask: "ReasoningAsk" as const, initial: { text: "", live: false } as ReasoningState },
  },
  /** A window with no socket of its own asking the owner to send the current reasoning state. */
  ReasoningAsk: { name: "yui://reasoning-ask", scope: "preset" },
  /** A window with no input source of its own asking the pet window to submit a guide request. */
  HelpGuide: {
    name: "yui://help-guide",
    scope: "preset",
    read(request, deliver: (request: HelpGuideRequest) => void) {
      const r = (request ?? {}) as Partial<HelpGuideRequest>;
      if (isGuideKey(r.guide) && typeof r.text === "string")
        deliver({ guide: r.guide, text: r.text });
    },
  },
  /** The active preset after a window edited the registry; a window booted on another one reloads. Settles once sent. */
  PresetChanged: {
    name: "yui://preset-changed",
    scope: "shared",
    settled: true,
    read(change, deliver: (change: PresetChange) => void) {
      const active = (change as Partial<PresetChange> | null)?.active;
      if (typeof active === "string" && active) deliver({ active });
    },
  },
  PetWindowsChanged: { name: "yui://pet-windows-changed", scope: "shared", settled: true },
  /** A character's reply named this preset; delivered to every window, receivers filter on `to`. */
  CharacterAddressed: {
    name: "yui://character-addressed",
    scope: "shared",
    read(event, deliver: (event: CharacterAddressed) => void) {
      if (event === null || typeof event !== "object") return;
      const e = event as Partial<CharacterAddressed>;
      if (
        typeof e.from === "string" &&
        typeof e.name === "string" &&
        typeof e.to === "string" &&
        typeof e.text === "string" &&
        typeof e.ts === "number"
      ) {
        deliver({
          from: e.from,
          name: e.name,
          to: e.to,
          text: e.text,
          ts: e.ts,
          ...(typeof e.user_message === "string" ? { user_message: e.user_message } : {}),
        });
      }
    },
  },
  /** The unified chat window's message for one preset; delivered to every window, receivers filter on `to`. */
  UserTurnRouted: {
    name: "yui://user-turn-routed",
    scope: "shared",
    read(event, deliver: (event: UserTurnRouted) => void) {
      if (event === null || typeof event !== "object") return;
      const e = event as Partial<UserTurnRouted>;
      if (typeof e.sendId !== "string" || typeof e.to !== "string" || typeof e.text !== "string")
        return;
      const mention = e.mention === "character" || e.mention === "everyone" ? e.mention : undefined;
      if (e.mention !== undefined && mention === undefined) return;
      if (e.via !== undefined && e.via !== "voice") return;
      deliver({
        sendId: e.sendId,
        to: e.to,
        text: e.text,
        ...(mention ? { mention } : {}),
        ...(e.via ? { via: e.via } : {}),
      });
    },
  },
  /** Main's recognized speech while the unified chat window shows; that window routes it. */
  VoiceSegment: {
    name: "yui://voice-segment",
    scope: "shared",
    read(event, deliver: (event: VoiceSegment) => void) {
      const text = (event as Partial<VoiceSegment> | null)?.text;
      if (isString(text) && text) deliver({ text });
    },
  },
  /** A pet window's user turn for one send id is over; the unified chat window advances its sequence. */
  UserTurnDone: {
    name: "yui://user-turn-done",
    scope: "shared",
    read(event, deliver: (event: UserTurnDone) => void) {
      if (event === null || typeof event !== "object") return;
      const e = event as Partial<UserTurnDone>;
      if (typeof e.sendId === "string" && typeof e.preset === "string") {
        deliver({ sendId: e.sendId, preset: e.preset });
      }
    },
  },
} satisfies Record<string, Channel>;

export type SettingsBridge = ChannelMethods<typeof channels> & { dispose(): void };

export function createSettingsBridge(
  transport: BridgeTransport | undefined,
  opts: { windowKind: WindowKind },
): SettingsBridge {
  const core = createBridgeCore(transport, opts.windowKind);
  return { ...createChannelMethods(core, channels), dispose: core.dispose };
}
