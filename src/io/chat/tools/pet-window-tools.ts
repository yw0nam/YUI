/** The declared window tools and the yui API namespaces this window has. */

import { invoke } from "@tauri-apps/api/core";
import { type PresetEntry, presetIdForWindow } from "../../../settings/preset/active-preset";
import type { RelationsStore } from "../../../settings/relations/relations-store";
import { isTauri } from "../../../tauri-env";
import type { AvatarExecutor } from "../../bridge/inbox/avatar-executor";
import { createGuideApi } from "../../guide/guide-docs";
import type { McpHost } from "../../mcp-host/mcp-host";
import type { ThreadsClient } from "../../threads/threads-client";
import { createAddressCharacterTool } from "./address-character";
import { createAvatarTools, createLookApi } from "./avatar";
import type { ClientTool } from "./client-tools";
import { createPluginsApi } from "./plugins/plugins-api";
import { createRateRelationTool } from "./relation";
import { createWaitingApi, type WaitingItem } from "./run/waiting-api";
import { createYuiRunTool, type YuiRunWindowPorts } from "./run/yui-run-tool";
import type { ScreenQueryPorts } from "./screen/screen-query";
import { createTerminalApi } from "./terminal/terminal-api";
import { createThreadsApi } from "./threads/threads-api";

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
  /** The MCP host client yui.plugins calls. */
  mcpHost: McpHost;
  /** The window's Thread store reader; null outside main's window. */
  threads: Pick<ThreadsClient, "threads"> | null;
  /** The waiting rows this window's dispatcher and signal buffers hold, read when a call runs. */
  waiting?: () => WaitingItem[];
  /** What a yui_run script reaches. */
  run: YuiRunWindowPorts;
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
  const namespaces = {
    guide: createGuideApi(),
    terminal: createTerminalApi({ presetId: presetIdForWindow, invoke }),
    plugins: createPluginsApi({ host: deps.mcpHost, presetId: presetIdForWindow }),
    ...(deps.bound ? {} : { look: createLookApi(deps.getExecutor, deps.screen) }),
    ...(deps.threads ? { threads: createThreadsApi(deps.threads) } : {}),
    ...(deps.waiting ? { waiting: createWaitingApi({ waiting: deps.waiting }) } : {}),
  };
  return [
    rate,
    address,
    ...(deps.bound ? [] : createAvatarTools(deps.getExecutor)),
    createYuiRunTool({ ...deps.run, namespaces }),
  ];
}
