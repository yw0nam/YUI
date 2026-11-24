import type { SettingsBridge } from "../../io/bridge/settings-bridge";

export function wireStageRect(_deps: {
  bridge: Pick<SettingsBridge, "emitSettingsStage" | "onSettingsStageAsk">;
  boundId: string | null;
  stage: HTMLElement;
}): () => void {
  return () => {};
}
