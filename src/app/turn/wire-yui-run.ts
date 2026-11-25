/** Builds the ports a yui_run script reaches from this window's stores, ask queue, selections and Tauri commands. */

import { invoke } from "@tauri-apps/api/core";
import { helpText } from "../../io/chat/tools/run/help";
import { createInfoApi } from "../../io/chat/tools/run/info-api";
import { type SelectionPort, selectionRows } from "../../io/chat/tools/run/selection-rows";
import { createSettingsApi } from "../../io/chat/tools/run/settings-api";
import { createStateApi } from "../../io/chat/tools/run/state-api";
import type { YuiRunPorts } from "../../io/chat/tools/run/yui-run-tool";
import { createTauriScreenSourceProvider } from "../../io/window/capture/tauri-screen";
import {
  presetIdForWindow,
  readPresetList,
  readPresetName,
} from "../../settings/preset/active-preset";
import { readOpenPresetIds } from "../../settings/preset/pet-windows";
import type { SettingsStores } from "../../settings/settings-stores";
import { t } from "../../ui/i18n";
import type { AskQueue } from "./ask-queue";
import { createSettingsRequest } from "./settings-request";

export function wireYuiRun(deps: {
  stores: SettingsStores;
  asks: Pick<AskQueue, "put" | "remove">;
  lastTogether: { get(): { at: number | null } };
  vrm: SelectionPort;
  speaker: SelectionPort;
}): YuiRunPorts {
  const monitors = createTauriScreenSourceProvider();
  const rows = selectionRows(deps);
  return {
    settings: createSettingsApi({
      stores: deps.stores,
      request: createSettingsRequest({
        asks: deps.asks,
        name: () => readPresetName(presetIdForWindow()),
      }),
      rows,
    }),
    state: createStateApi({
      startedAt: async () => invoke<number>("app_started_at"),
      lastTogether: () => deps.lastTogether.get().at,
      presets: readPresetList,
      openIds: readOpenPresetIds,
      selfId: presetIdForWindow,
      screenRecording: async () => invoke<string>("screen_recording_permission"),
    }),
    info: createInfoApi({
      bodies: () => deps.vrm.list(),
      voices: () => deps.speaker.list(),
      monitors: () => monitors.listMonitors(),
    }),
    help: () => helpText(t, rows),
  };
}
