/**
 * Cross-window message bus linking the pet window ↔ the message window.
 *
 * Two channels over the settings bridge's transport and envelope: surface ops
 * travel pet → message (what to draw), control ops travel message → pet (what
 * the user did). Both windows own the same `Surfaces` DOM, so the payloads are
 * that API's arguments and nothing more — no judgment crosses the wire.
 */

import type { AttachmentLimits } from "../config";
import { type BridgeTransport, createBridgeCore, type WindowKind } from "./settings-bridge";

const CH_MESSAGE_SURFACE = "yui://message-surface";
const CH_MESSAGE_CONTROL = "yui://message-control";

/** Pet → message: one call on the message window's local `Surfaces`. */
export type MessageSurfaceOp =
  | { op: "begin" }
  | { op: "push"; delta: string }
  | { op: "end"; defer?: boolean }
  | { op: "finish" }
  | { op: "hide" }
  | { op: "summon-input" }
  | { op: "dismiss-input" }
  | { op: "busy"; busy: boolean }
  | { op: "input-enabled"; enabled: boolean }
  | { op: "input-error"; message: string; action?: { label: string } }
  | { op: "attachment-limits"; limits: AttachmentLimits };

/** Message → pet: what the user did, plus the mount handshake. */
export type MessageControlOp =
  | { op: "submit"; text: string; images: string[] }
  | { op: "stop" }
  | { op: "input-open"; open: boolean }
  | { op: "input-error-action" }
  | { op: "dock" }
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
      return core.on<MessageSurfaceOp>(CH_MESSAGE_SURFACE, (op) => {
        if (op && typeof op.op === "string") cb(op);
      });
    },
    emitControl(op) {
      core.emit(CH_MESSAGE_CONTROL, op);
    },
    onControl(cb) {
      return core.on<MessageControlOp>(CH_MESSAGE_CONTROL, (op) => {
        if (op && typeof op.op === "string") cb(op);
      });
    },
    dispose: core.dispose,
  };
}
