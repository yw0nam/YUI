/** The tools a pet window declares beside generate_express: rate_relation and address_character everywhere, the bridge tools under Tauri, the avatar and Threads tools in main only. */

import { type PresetEntry, presetIdForWindow } from "../../../settings/preset/active-preset";
import type { RelationsStore } from "../../../settings/relations/relations-store";
import { isTauri } from "../../../tauri-env";
import type { AvatarExecutor } from "../../bridge/inbox/avatar-executor";
import type { McpHost } from "../../mcp-host/mcp-host";
import type { ThreadsClient } from "../../threads/threads-client";
import { createAddressCharacterTool } from "./address-character";
import { createAvatarTools } from "./avatar";
import type { ClientTool } from "./client-tools";
import { createPluginBridgeTools } from "./plugin-bridge/plugin-bridge";
import { createRateRelationTool } from "./relation";
import type { ScreenQueryPorts } from "./screen/screen-query";
import { createThreadsTools } from "./threads/threads-tools";

export function createPetWindowTools(deps: {
  bound: boolean;
  getExecutor: () => AvatarExecutor | null;
  screen: ScreenQueryPorts;
  relations: RelationsStore;
  /** The Relations switch, read when a call runs. */
  relationsEnabled: () => boolean;
  /** The other open presets rate_relation can name. */
  targets: () => PresetEntry[];
  /** Records the reply's recipient for the addressed producer; returns the id recorded earlier, if any. */
  recordAddressed: Parameters<typeof createAddressCharacterTool>[0]["record"];
  /** The MCP host client the bridge tools call. */
  mcpHost: McpHost;
  /** The window's Thread store reader; null outside main's window. */
  threads: Pick<ThreadsClient, "threads"> | null;
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
  if (!isTauri()) return [rate, address];
  return [
    rate,
    address,
    ...(deps.bound ? [] : createAvatarTools(deps.getExecutor, deps.screen)),
    ...(deps.threads ? createThreadsTools(deps.threads) : []),
    ...createPluginBridgeTools({ host: deps.mcpHost, presetId: presetIdForWindow }),
  ];
}
