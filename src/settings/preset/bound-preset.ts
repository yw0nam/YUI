export function readBoundPresetId(search = globalThis.location?.search ?? ""): string | null {
  return new URLSearchParams(search).get("preset") || null;
}
