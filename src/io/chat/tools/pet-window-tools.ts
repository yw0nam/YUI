/** The tools a pet window declares beside generate_express: rate_relation and address_character everywhere, browser under Tauri, the avatar tools in main only. */

import { type PresetEntry, presetIdForWindow } from "../../../settings/preset/active-preset";
import type { RelationsStore } from "../../../settings/relations/relations-store";
import { isTauri } from "../../../tauri-env";
import type { AvatarExecutor } from "../../bridge/inbox/avatar-executor";
import { createBrowserRelay } from "../../browser/browser-relay";
import { createAddressCharacterTool } from "./address-character";
import { createAvatarTools } from "./avatar";
import { createBrowserTool } from "./browser/browser-tool";
import type { ClientTool } from "./client-tools";
import { createPluginBridgeTools } from "./plugin-bridge-proto/plugin-bridge-proto";
import { createRateRelationTool } from "./relation";
import type { ScreenQueryPorts } from "./screen/screen-query";

export function createPetWindowTools(deps: {
  bound: boolean;
  getExecutor: () => AvatarExecutor | null;
  screen: ScreenQueryPorts;
  /** The browser switch, read when a call runs. */
  browserEnabled: () => boolean;
  relations: RelationsStore;
  /** The Relations switch, read when a call runs. */
  relationsEnabled: () => boolean;
  /** The other open presets rate_relation can name. */
  targets: () => PresetEntry[];
  /** Records the reply's recipient for the addressed producer; returns the id recorded earlier, if any. */
  recordAddressed: Parameters<typeof createAddressCharacterTool>[0]["record"];
}): ClientTool[] {
  const rate = createRateRelationTool({
    store: deps.relations,
    targets: deps.targets,
    enabled: deps.relationsEnabled,
  });
  const address = createAddressCharacterTool({
    targets: deps.targets,
    record: deps.recordAddressed,
  });
  // PROTOTYPE #1661: the plugin bridge tools in every window.
  const bridge = createPluginBridgeTools();
  if (!isTauri()) return [rate, address, ...bridge];
  return [
    rate,
    address,
    ...bridge,
    ...(deps.bound ? [] : createAvatarTools(deps.getExecutor, deps.screen)),
    createBrowserTool({
      relay: createBrowserRelay(),
      enabled: deps.browserEnabled,
      presetId: presetIdForWindow,
    }),
  ];
}
