/**
 * Cross-window message bus linking the pet window ↔ the message window.
 *
 * Two channels over the settings bridge's transport and envelope: surface ops
 * travel pet → message (what to draw), control ops travel message → pet (what
 * the user did). Both windows own the same `Surfaces` DOM, so the payloads are
 * that API's arguments and nothing more — no judgment crosses the wire.
 */

import type { AttachedThread } from "../../../contract";
import type { AskSlotAnswer } from "../../chat/tools/run/settings-request-frame";
import { type BridgeTransport, createBridgeCore, type WindowKind } from "../core/bridge-core";
import type { MessageSurfaceOp } from "./surface-ops";

const CH_MESSAGE_SURFACE = "yui://message-surface";
const CH_MESSAGE_CONTROL = "yui://message-control";

/** The user's own turn as the bubble quotes it: the message, how it was given, how many images came with it. */
export interface UserQuote {
  text: string;
  via: "text" | "voice";
  images: number;
  /** A turn the unified chat window routed: one character, or everyone. */
  mention?: "character" | "everyone";
  /** The titles of the Threads attached to the message. */
  threads?: string[];
}

/** One signal group as the bubble quotes it: its delivery class, its source, and its label. */
export interface SourceLine {
  delivery: "urgent" | "batched";
  source: string;
  /** The producer's label, or the event type when it gave none. */
  text: string;
}

export type CommandReplyState =
  | { kind: "pending"; name: string; speaker?: string }
  | { kind: "settled"; name: string; text: string; speaker?: string }
  | { kind: "clear" };

/** Message → pet: what the user did, plus the mount handshake. */
export type MessageControlOp =
  | { op: "ask-answer"; answer: AskSlotAnswer }
  | { op: "command-reply-close" }
  | { op: "command"; name: string; args: string }
  | { op: "submit"; text: string; images: string[]; threads: AttachedThread[] }
  | { op: "stop" }
  | { op: "input-open"; open: boolean }
  | { op: "input-error-action" }
  | { op: "speech-action"; index: number }
  | { op: "dock" }
  | { op: "open-settings" }
  | { op: "ready" };

export interface MessageBridge {
  emitSurface(op: MessageSurfaceOp): void;
  onSurface(cb: (op: MessageSurfaceOp) => void): () => void;
  emitControl(op: MessageControlOp): void;
  onControl(cb: (op: MessageControlOp) => void): () => void;
  dispose(): void;
}

export function createMessageBridge(
  transport: BridgeTransport | undefined,
  opts: { windowKind: WindowKind },
): MessageBridge {
  const core = createBridgeCore(transport, opts.windowKind);
  return {
    emitSurface(op) {
      core.emit(CH_MESSAGE_SURFACE, op);
    },
    onSurface(cb) {
      return core.on<MessageSurfaceOp>(
        CH_MESSAGE_SURFACE,
        (op) => {
          if (!op || typeof op.op !== "string") return;
          // The trigger line is text only; a malformed one would draw an empty quote.
          if (op.op === "quote-trigger" && typeof op.text !== "string") return;
          cb(op);
        },
        { scoped: true },
      );
    },
    emitControl(op) {
      core.emit(CH_MESSAGE_CONTROL, op);
    },
    onControl(cb) {
      return core.on<MessageControlOp>(
        CH_MESSAGE_CONTROL,
        (op) => {
          if (op && typeof op.op === "string") cb(op);
        },
        { scoped: true },
      );
    },
    dispose: core.dispose,
  };
}
