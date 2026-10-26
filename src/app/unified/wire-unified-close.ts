import type { FlagSettingsStore } from "../../settings/persisted-store";

/** The window closing itself (× or Cmd+W) turns the Unified chat switch off; a destroy by main's open rule asks nothing. */
export function wireUnifiedClose(deps: {
  onCloseRequested(cb: () => void): void;
  switch: Pick<FlagSettingsStore, "setEnabled">;
  emitSettingsChanged(): void;
}): void {
  deps.onCloseRequested(() => {
    deps.switch.setEnabled(false);
    deps.emitSettingsChanged();
  });
}
