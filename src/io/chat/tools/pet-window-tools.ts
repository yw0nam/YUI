/** The tools a pet window declares beside generate_express: browser in every window, the avatar tools in main only. */

import { presetIdForWindow } from "../../../settings/preset/active-preset";
import { isTauri } from "../../../tauri-env";
import type { AvatarExecutor } from "../../bridge/inbox/avatar-executor";
import { createBrowserRelay } from "../../browser/browser-relay";
import { createAvatarTools } from "./avatar";
import { createBrowserTool } from "./browser/browser-tool";
import type { ClientTool } from "./client-tools";
import type { ScreenQueryPorts } from "./screen/screen-query";

export function createPetWindowTools(deps: {
  bound: boolean;
  getExecutor: () => AvatarExecutor | null;
  screen: ScreenQueryPorts;
  /** The browser switch, read when a call runs. */
  browserEnabled: () => boolean;
}): ClientTool[] {
  if (!isTauri()) return [];
  return [
    ...(deps.bound ? [] : createAvatarTools(deps.getExecutor, deps.screen)),
    createBrowserTool({
      relay: createBrowserRelay(),
      enabled: deps.browserEnabled,
      presetId: presetIdForWindow,
    }),
  ];
}
