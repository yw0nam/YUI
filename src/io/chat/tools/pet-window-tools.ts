/** The tools a pet window declares beside generate_express: rate_relation everywhere, browser under Tauri, the avatar tools in main only. */

import { type PresetEntry, presetIdForWindow } from "../../../settings/preset/active-preset";
import type { RelationsStore } from "../../../settings/relations/relations-store";
import { isTauri } from "../../../tauri-env";
import type { AvatarExecutor } from "../../bridge/inbox/avatar-executor";
import { createBrowserRelay } from "../../browser/browser-relay";
import { createAvatarTools } from "./avatar";
import { createBrowserTool } from "./browser/browser-tool";
import type { ClientTool } from "./client-tools";
import { createRateRelationTool } from "./relation";
import type { ScreenQueryPorts } from "./screen/screen-query";

export function createPetWindowTools(deps: {
  bound: boolean;
  getExecutor: () => AvatarExecutor | null;
  screen: ScreenQueryPorts;
  /** The browser switch, read when a call runs. */
  browserEnabled: () => boolean;
  relations: RelationsStore;
  /** The other open presets rate_relation can name. */
  targets: () => PresetEntry[];
}): ClientTool[] {
  const rate = createRateRelationTool({ store: deps.relations, targets: deps.targets });
  if (!isTauri()) return [rate];
  return [
    rate,
    ...(deps.bound ? [] : createAvatarTools(deps.getExecutor, deps.screen)),
    createBrowserTool({
      relay: createBrowserRelay(),
      enabled: deps.browserEnabled,
      presetId: presetIdForWindow,
    }),
  ];
}
