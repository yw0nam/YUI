import type { SettingsBridge } from "../../io/bridge/settings-bridge";

/** Main's pet window opens Developer Tools when the settings window asks; a bound window never listens. */
export function wireDevtoolsRequest(deps: {
  bridge: Pick<SettingsBridge, "onOpenDevtools">;
  boundId: string | null;
  open: () => void;
}): () => void {
  return deps.boundId === null ? deps.bridge.onOpenDevtools(deps.open) : () => {};
}
