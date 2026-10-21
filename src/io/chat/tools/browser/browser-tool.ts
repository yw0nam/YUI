/**
 * browser — the tool that runs backend-written JavaScript in ego lite, in the calling window's own
 * task space.
 *
 * The switch is read when a call runs. The tool checks code and guide, hands code to the relay
 * under the space name of this window's preset, and formats the relay's outcome as the result.
 */

import type { BrowserRelay } from "../../../browser/browser-relay";
import type { ClientTool } from "../client-tools";
import { formatRunOutcome, UNKNOWN } from "./run-result";

const DESCRIPTION =
  "Run JavaScript against the ego lite browser SDK in this character's own task space of the " +
  "ego lite browser on the user's computer. These rules take precedence over the guide. code is " +
  "the body of an async function that runs after the client's prelude: top-level await works; " +
  "static import does not, use await import() instead; the names task and screenshot and every " +
  "name starting with __yui are reserved; variables start fresh on every call. Use the injected " +
  "task; do not call taskSpace(); do not finish the space. Print observations with console.log; " +
  "the output is text. await screenshot(page) attaches an image of the page's viewport. Images " +
  "need an image-capable model. A screenshot fails while the ego lite window is minimized. A " +
  "space the user took over fails with EGO_TASK_SPACE_NAME_IN_USE until the user hands it back " +
  "in ego lite. Error line numbers are 5 more than the line in code. Call with guide: true to " +
  "read the full guide. Calls are refused unless the user allows browser use.";

export function createBrowserTool(deps: {
  relay: BrowserRelay;
  /** The browser switch, read when a call runs. */
  enabled: () => boolean;
  /** The preset of the calling window, which names its task space. */
  presetId: () => string;
}): ClientTool {
  return {
    name: "browser",
    switch: { id: "browser", on: deps.enabled },
    definition: {
      type: "function",
      function: {
        name: "browser",
        description: DESCRIPTION,
        parameters: {
          type: "object",
          properties: {
            code: {
              type: "string",
              description: "the JavaScript to run: the body of an async function",
            },
            guide: {
              type: "boolean",
              description: "true returns the full guide instead of running code",
            },
          },
          additionalProperties: false,
        },
      },
    },
    execute: async (args) => {
      if (!deps.enabled()) return "error: browser is off";
      const code = args.code;
      if (args.guide === true) {
        if (code !== undefined && code !== "") return "error: invalid field code";
        return deps.relay.guide();
      }
      if (typeof code !== "string" || code === "") return "error: missing field code";
      return formatRunOutcome(await deps.relay.run(`yui-${deps.presetId()}`, code));
    },
    // The relay kills the CLI at 28 s; the wait covers it and the image collection after it.
    waitMs: 32_000,
    timeoutResult: () => UNKNOWN,
    failed: (result) => result.startsWith("error:") || result.startsWith("unknown:"),
    localStatus: true,
  };
}
