export function openMicSettings(): void {}

export function micSettingsOpener(_env: {
  tauri: boolean;
  mac: boolean;
}): (() => void) | undefined {
  return undefined;
}
