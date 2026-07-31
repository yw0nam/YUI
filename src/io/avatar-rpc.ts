/**
 * avatar-rpc — the webview end of the loopback avatar RPC surface.
 *
 * Rust bridges each `/avatar/*` HTTP request into the `avatar-rpc` Tauri event
 * channel and waits for the matching `avatar_rpc_response` command. This module is
 * the seam for both halves; like `agent-inbox.ts` it degrades silently off-Tauri so
 * it is safe in browser / test environments without the runtime.
 */

import type { Posture, ScreenRect } from "../contract";
import { createLogger } from "../logger";
import { createInbox } from "./create-inbox";
import { isTauri } from "./tauri-env";

const log = createLogger("avatar-rpc");

/** Named screen spot `move_to` targets. */
export type AvatarSpot = "center" | "top-left" | "top-right" | "bottom-left" | "bottom-right";

/** Movement verb carried by a `command` request — mirrors the Rust `AvatarCommand`. */
export type AvatarCommand =
  | { action: "sit_on_window"; app: string }
  | { action: "peek"; side: "left" | "right" }
  | { action: "move_to"; spot: AvatarSpot; monitor?: number }
  | { action: "stand_down" };

export type AvatarRpcMethod = "state" | "perch_targets" | "command";

/** `avatar-rpc` event payload — mirrors the Rust `AvatarRpcRequest`. */
export interface AvatarRpcRequest {
  id: string;
  method: AvatarRpcMethod;
  params?: unknown;
}

/** Pet window origin in physical px, plus the monitor holding it. */
export interface AvatarPosition {
  x: number;
  y: number;
  monitor: number | null;
}

/** `GET /avatar/state` answer. Nulls mean the client cannot currently tell. */
export interface AvatarState {
  position: AvatarPosition | null;
  posture: Posture | null;
  vrm: { id: string; label: string } | null;
  moving: boolean;
}

/** One perch candidate: a foreign window the avatar can sit on or peek around. */
export interface AvatarPerchTargetWindow {
  app: string | null;
  title: string | null;
  rect: ScreenRect;
}

/** `GET /avatar/perch-targets` answer. */
export interface AvatarPerchTargets {
  windows: AvatarPerchTargetWindow[];
  edges: Array<"left" | "right">;
}

/** Why a command did not happen. */
export type AvatarFailure = "not_found" | "blocked" | "interrupted" | "busy" | "unsupported";

/** `POST /avatar/command` answer. */
export type AvatarCommandResult = { ok: true } | { ok: false; reason: AvatarFailure };

/** Subscribe to the `avatar-rpc` Tauri event channel. */
export const onAvatarRpc = createInbox<AvatarRpcRequest>("avatar-rpc");

/** Tauri `invoke` narrowed to the response command (injectable for tests). */
export type AvatarRpcInvoke = (
  cmd: "avatar_rpc_response",
  args: { id: string; result: unknown },
) => Promise<unknown>;

async function resolveInvoke(): Promise<AvatarRpcInvoke | undefined> {
  if (!isTauri()) return undefined;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke as unknown as AvatarRpcInvoke;
}

/**
 * Answer one bridged request by id. Never throws: an unanswered request simply
 * rides out its ingress deadline and becomes a 503.
 */
export async function respondAvatarRpc(
  id: string,
  result: unknown,
  deps?: { invoke?: AvatarRpcInvoke },
): Promise<void> {
  try {
    const invoke = deps?.invoke ?? (await resolveInvoke());
    if (!invoke) {
      log.debug("invoke_unavailable", { degrade: true });
      return;
    }
    await invoke("avatar_rpc_response", { id, result });
  } catch (err) {
    log.debug("respond_failed", { degrade: true, error: String(err) });
  }
}
