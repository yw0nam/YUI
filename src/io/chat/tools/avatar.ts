/**
 * body_action and yui.look: her body as the backend model reaches it.
 *
 * Both are thin adapters over the avatar executor, which the window creates once; a call that
 * lands before the stage created it answers unsupported. body_action's schema speaks the model's
 * words and its execute renders the executor's verdict as the result string.
 */

import type { AvatarExecutor } from "../../bridge/inbox/avatar-executor";
import type { ClientTool } from "./client-tools";
import type { YuiNamespace } from "./run/namespace";
import { queryScreen, type ScreenQueryPorts } from "./screen/screen-query";

/** The moves the executor parses, in the words the model reads. */
const BODY_ACTION_DESCRIPTION =
  "Move the character's body. sit_on_window: sit on the top edge of that app's window — the " +
  "frontmost one whose top edge is reachable; needs app, an app name taken from " +
  "yui.look.perch_targets(). peek: peek around the left or right edge of the frontmost window; " +
  "needs side. " +
  "move_to: move to center or a named corner of the work area; needs spot, and takes monitor to " +
  "move to another display — omit it to stay on the current one. stand: return to the standing " +
  "position; leaves a perch or a peek. The " +
  "result is ok, or one word: not_found (no such window), blocked (every candidate window is " +
  "covered), interrupted (the user is holding her), busy (another move runs), unsupported, or " +
  "timeout — the action is still running, and yui.look.body() tells the outcome.";

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
              enum: ["sit_on_window", "peek", "move_to", "stand"],
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
    timeoutResult: () => "timeout",
    failed: (result) => result !== "ok",
  };
}

/** The avatar tools, in declaration order, over a late-bound executor getter. */
export function createAvatarTools(getExecutor: () => AvatarExecutor | null): ClientTool[] {
  return [createBodyActionTool(getExecutor)];
}

/** The look block as help() prints it; read through createLookApi's declaration. */
const LOOK_DECLARATION = `  look: {
    /** Her posture, window origin and monitor, loaded body, and whether a move runs. */
    body(): Promise<{ position: { x: number; y: number; monitor: number | null } | null; posture: string; vrm: { id: string; label: string } | null; moving: boolean } | "error: unsupported">;
    /** Windows she can sit on and the sides of the frontmost window she can peek from. */
    perch_targets(): Promise<{ windows: { app: string | null; title: string | null; rect: { x: number; y: number; width: number; height: number } }[]; edges: ("left" | "right")[] } | "error: unsupported">;
    /** A screenshot of the display she is on, or of display monitor (yui.info.read().monitors). Needs privacy.screen_requests. */
    screen(monitor?: number): Promise<{ text: string; images: ImageHandle[] } | \`error: \${string}\`>;
  };`;

/** yui.look: her body, perch targets and screen, reached through the run sandbox. */
export function createLookApi(
  getExecutor: () => AvatarExecutor | null,
  screen?: ScreenQueryPorts,
): YuiNamespace {
  // An executor read that fails is a value: only a wrong argument throws.
  const read = async (query: (executor: AvatarExecutor) => Promise<unknown>): Promise<unknown> => {
    const executor = getExecutor();
    if (executor === null) return "error: unsupported";
    try {
      return await query(executor);
    } catch (error) {
      return `error: ${error instanceof Error ? error.message : String(error)}`;
    }
  };
  return {
    methods: {
      body: () => read((executor) => executor.state()),
      perch_targets: () => read((executor) => executor.perchTargets()),
      screen: async (_signal, monitor?) => {
        if (monitor !== null && monitor !== undefined && !Number.isInteger(monitor))
          throw new TypeError("yui.look.screen: monitor must be an integer");
        if (!screen) return "error: unsupported";
        return queryScreen(screen, monitor ?? undefined);
      },
    },
    declaration: LOOK_DECLARATION,
  };
}
