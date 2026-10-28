/**
 * proto_snapshot and proto_slow — the throwaway bridge tools over the Rust MCP host (issue
 * #1648 prototype). They prove an MCP server's tools ride the client-tool path on every
 * transport: proto_snapshot maps MCP content blocks onto `{text, images}`, proto_slow cancels
 * through the host when the turn stops or the wait passes.
 */

import {
  type ClientTool,
  type ClientToolResult,
  TURN_STOPPED,
} from "../client-tools";
import { createLogger } from "../../../../logger";
import type { ProtoMcpRelay } from "./relay";

const log = createLogger("proto");

const WAIT_MS = 32_000;
/** Covers the test server's 20 s sleep plus the cancel round trip. */
const DESCRIPTION_PREFIX =
  "Prototype tool over the locally hosted MCP server (issue #1648). ";

/** The result shape a call resolves to, or the stopped-turn result once signal aborts. */
function unlessStopped<T>(
  work: Promise<T>,
  signal?: AbortSignal,
): Promise<T | typeof TURN_STOPPED> {
  if (!signal) return work;
  return new Promise((resolve, reject) => {
    const stop = (): void => resolve(TURN_STOPPED);
    signal.addEventListener("abort", stop, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", stop));
  });
}

function formatResult(result: {
  content: { type: string; text?: string; data?: string; mimeType?: string }[];
  isError: boolean;
}): ClientToolResult {
  const text = result.content
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("\n");
  const images = result.content
    .filter((block) => block.type === "image" && block.data)
    .map((block) => `data:${block.mimeType ?? "image/png"};base64,${block.data}`);
  if (result.isError) return `error: ${text || "MCP tool error"}`;
  return images.length ? { text, images } : text;
}

export function createProtoMcpTools(deps: {
  relay: ProtoMcpRelay;
  /** The preset of the calling window; the host stamps it into `_meta`. */
  presetId: () => string;
}): ClientTool[] {
  const protoSnapshot: ClientTool = {
    name: "proto_snapshot",
    definition: {
      type: "function",
      function: {
        name: "proto_snapshot",
        description:
          DESCRIPTION_PREFIX +
          "Returns one text line and one small PNG image of the server's fake snapshot.",
        parameters: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
      },
    },
    execute: async (args, signal) => {
      if (signal?.aborted) return TURN_STOPPED;
      const callId = crypto.randomUUID();
      const work = deps.relay.call("snapshot", args, deps.presetId(), callId);
      const outcome = await unlessStopped(work, signal);
      if (outcome !== TURN_STOPPED) {
        log.info("snapshot_relay_result", {
          blocks: outcome.content.map((b) => ({ type: b.type, data_len: b.data?.length ?? 0 })),
        });
      }
      return outcome === TURN_STOPPED ? outcome : formatResult(outcome);
    },
    waitMs: WAIT_MS,
  };

  const protoSlow: ClientTool = {
    name: "proto_slow",
    definition: {
      type: "function",
      function: {
        name: "proto_slow",
        description:
          DESCRIPTION_PREFIX +
          "Sleeps 20 seconds on the server, then returns done. Cancels server-side when stopped.",
        parameters: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
      },
    },
    execute: async (_args, signal) => {
      if (signal?.aborted) return TURN_STOPPED;
      const callId = crypto.randomUUID();
      const work = deps.relay.call("slow", {}, deps.presetId(), callId);
      // The abort races the 20 s response; the host turns it into notifications/cancelled.
      signal?.addEventListener(
        "abort",
        () => {
          deps.relay.cancel(callId).catch(() => {});
        },
        { once: true },
      );
      const outcome = await unlessStopped(work, signal);
      return outcome === TURN_STOPPED ? outcome : formatResult(outcome);
    },
    waitMs: WAIT_MS,
  };

  return [protoSnapshot, protoSlow];
}
