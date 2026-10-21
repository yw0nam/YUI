/** The tools a pet window declares beside generate_express: browser in every window, the avatar tools in main only. */

import type { AvatarExecutor } from "../../io/bridge/inbox/avatar-executor";
import { createBrowserRelay } from "../../io/browser/browser-relay";
import { createAvatarTools } from "../../io/chat/tools/avatar";
import { createBrowserTool } from "../../io/chat/tools/browser/browser-tool";
import type { ClientTool } from "../../io/chat/tools/client-tools";
import type { ScreenQueryPorts } from "../../io/chat/tools/screen/screen-query";
import { presetIdForWindow } from "../../settings/preset/active-preset";
import { isTauri } from "../../tauri-env";

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
