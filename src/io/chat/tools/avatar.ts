/**
 * body_action and look — the avatar tools the backend model calls.
 *
 * Thin adapters over the avatar executor: the schema speaks the avatar Mod's words, execute hands
 * the arguments to the executor and renders its verdict as the result string. The window that
 * creates the executor builds them once; a call that lands before the stage created it answers
 * unsupported.
 */

import type { AvatarExecutor } from "../../bridge/inbox/avatar-executor";
import type { ClientTool } from "./client-tools";

/** The moves the executor parses, in the words the model reads. */
const BODY_ACTION_DESCRIPTION =
  "Move the character's body. sit_on_window: sit on the top edge of that app's window — the " +
  "frontmost one whose top edge is reachable; needs app, an app name taken from look at: " +
  "perch_targets. peek: peek around the left or right edge of the frontmost window; needs side. " +
  "move_to: move to center or a named corner of the work area; needs spot, and takes monitor to " +
  "move to another display — omit it to stay on the current one. stand: return to the standing " +
  "position; leaves a perch or a peek, and gets her out of bed. go_to_bed: lay her on a bed at " +
  "the spot she stands on; she sleeps until a click, a message from the user, or stand. The " +
  "result is ok, or one word: not_found (no such window), blocked (every candidate window is " +
  "covered), interrupted (the user is holding her), busy (another move runs), unsupported, or " +
  "timeout — the action is still running, and look at: body tells the outcome.";

function createBodyActionTool(getExecutor: () => AvatarExecutor | null): ClientTool {
  return {
    name: "body_action",
    definition: {
      type: "function",
      function: {
        name: "body_action",
        description: BODY_ACTION_DESCRIPTION,
        parameters: {
          type: "object",
          properties: {
            action: {
              type: "string",
              description: "the move to make",
              enum: ["sit_on_window", "peek", "move_to", "stand", "go_to_bed"],
            },
            app: {
              type: "string",
              description: "for sit_on_window: the app whose window she sits on",
            },
            side: {
              type: "string",
              description: "for peek: which edge of the frontmost window",
              enum: ["left", "right"],
            },
            spot: {
              type: "string",
              description: "for move_to: where on the work area",
              enum: ["center", "top-left", "top-right", "bottom-left", "bottom-right"],
            },
            monitor: {
              type: "integer",
              description: "for move_to: the display to move to; omit to stay on the current one",
            },
          },
          additionalProperties: false,
          required: ["action"],
        },
      },
    },
    execute: async (args) => {
      const executor = getExecutor();
      if (executor === null) return "unsupported";
      const result = await executor.command(args);
      return "error" in result ? `error: ${result.error}` : result.ok ? "ok" : result.reason;
    },
    waitMs: 15000,
    timeoutResult: "timeout",
    failed: (result) => result !== "ok",
  };
}

function createLookTool(getExecutor: () => AvatarExecutor | null): ClientTool {
  return {
    name: "look",
    definition: {
      type: "function",
      function: {
        name: "look",
        description:
          "Read the character's state. at: body returns her posture, her window position and " +
          "monitor, the loaded VRM, and whether a move is running. at: perch_targets returns the " +
          "windows she can sit on — each with app, title and rect — and the screen edges she can " +
          "peek from.",
        parameters: {
          type: "object",
          properties: {
            at: {
              type: "string",
              description: "what to read",
              enum: ["body", "perch_targets"],
            },
          },
          additionalProperties: false,
          required: ["at"],
        },
      },
    },
    execute: async (args) => {
      if (args.at === undefined) return "error: missing field at";
      if (args.at !== "body" && args.at !== "perch_targets") return "error: invalid field at";
      const executor = getExecutor();
      if (executor === null) return "error: unsupported";
      return JSON.stringify(
        args.at === "perch_targets" ? await executor.perchTargets() : await executor.state(),
      );
    },
    waitMs: 2000,
  };
}

/** The avatar tools, in declaration order, over a late-bound executor getter. */
export function createAvatarTools(getExecutor: () => AvatarExecutor | null): ClientTool[] {
  return [createBodyActionTool(getExecutor), createLookTool(getExecutor)];
}
