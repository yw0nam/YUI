/**
 * body_action and look — the avatar tools the backend model calls.
 *
 * Thin adapters over the avatar executor: the schema speaks the model's words, execute hands
 * the arguments to the executor and renders its verdict as the result string. The window that
 * creates the executor builds them once; a call that lands before the stage created it answers
 * unsupported.
 */

import type { AvatarExecutor } from "../../bridge/inbox/avatar-executor";
import type { ClientTool } from "./client-tools";
import { queryScreen, type ScreenQueryPorts } from "./screen/screen-query";

/** The moves the executor parses, in the words the model reads. */
const BODY_ACTION_DESCRIPTION =
  "Move the character's body. sit_on_window: sit on the top edge of that app's window — the " +
  "frontmost one whose top edge is reachable; needs app, an app name taken from look at: " +
  "perch_targets. peek: peek around the left or right edge of the frontmost window; needs side. " +
  "move_to: move to center or a named corner of the work area; needs spot, and takes monitor to " +
  "move to another display — omit it to stay on the current one. stand: return to the standing " +
  "position; leaves a perch or a peek. The " +
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

function createLookTool(
  getExecutor: () => AvatarExecutor | null,
  screen?: ScreenQueryPorts,
): ClientTool {
  return {
    name: "look",
    switch: screen ? { id: "look.screen", on: screen.allowRequests } : undefined,
    definition: {
      type: "function",
      function: {
        name: "look",
        description:
          "Read the character's state. at: body returns her posture, her window position and " +
          "monitor, the loaded VRM, and whether a move is running. at: perch_targets returns the " +
          "windows she can sit on — each with app, title and rect — and the window sides she can " +
          "peek from. at: screen returns a screenshot of the display the character is on, or " +
          "of monitor when given. Screen requests are refused unless the user allows them.",
        parameters: {
          type: "object",
          properties: {
            at: {
              type: "string",
              description: "what to read",
              enum: ["body", "perch_targets", "screen"],
            },
            monitor: {
              type: "integer",
              description:
                "for screen: the display number body_action.monitor uses; ignored for other targets",
            },
          },
          additionalProperties: false,
          required: ["at"],
        },
      },
    },
    execute: async (args) => {
      if (args.at === undefined) return "error: missing field at";
      if (args.at !== "body" && args.at !== "perch_targets" && args.at !== "screen")
        return "error: invalid field at";
      const executor = getExecutor();
      if (executor === null) return "error: unsupported";
      if (args.at === "screen")
        return screen ? queryScreen(screen, args.monitor) : "error: unsupported";
      return JSON.stringify(
        args.at === "perch_targets" ? await executor.perchTargets() : await executor.state(),
      );
    },
    waitMs: 2000,
  };
}

/** The avatar tools, in declaration order, over a late-bound executor getter. */
export function createAvatarTools(
  getExecutor: () => AvatarExecutor | null,
  screen?: ScreenQueryPorts,
): ClientTool[] {
  return [createBodyActionTool(getExecutor), createLookTool(getExecutor, screen)];
}

/** One yui namespace method: the run's signal first, then the script's arguments. */
type NamespaceMethod = (signal: AbortSignal, ...args: unknown[]) => Promise<unknown>;

/** The look block as help() prints it. */
export const LOOK_DECLARATION = `  look: {
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
): {
  methods: { body: NamespaceMethod; perch_targets: NamespaceMethod; screen: NamespaceMethod };
  declaration: string;
} {
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
