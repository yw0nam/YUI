/** The page query binds a pet window to a preset whose membership the registry validates. */
export function readBoundPresetId(search = globalThis.location?.search ?? ""): string | null {
  return new URLSearchParams(search).get("preset") || null;
}
