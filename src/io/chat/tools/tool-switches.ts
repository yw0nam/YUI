/**
 * tool-switches — the per-turn on/off state of the switchable in-app tools a window declares.
 *
 * The declaration is switch-independent: a switchable tool rides every request in every state,
 * and the switch only gates execution. This list is what the client_context `tools:` line
 * renders each turn; an empty list omits the line.
 */

import type { ClientContext } from "../../../contract";
import type { ClientTool } from "./client-tools";

/** The switch list of one window, in declaration order. */
export type ToolSwitchList = NonNullable<ClientContext["tool_switches"]>;

/**
 * The switches behind the avatar tools a window declares. Today one switchable tool exists:
 * `look at: screen`, gated by the screenshot request permission. A window that declares no
 * `look` (the phone window, the browser build) has an empty list.
 */
export function toolSwitches(
  avatarTools: readonly ClientTool[],
  lookAllowed: () => boolean,
): ToolSwitchList {
  if (!avatarTools.some((tool) => tool.name === "look")) return [];
  return [{ id: "look.screen", on: lookAllowed() }];
}
