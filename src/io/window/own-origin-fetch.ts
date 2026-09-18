type CorsFetchPlugin = { config: (config: { exclude: RegExp[] }) => void };

/** Windows serves bundled assets from http://tauri.localhost, which the cors-fetch proxy can't reach, so same-origin requests stay native. */
export function excludeOwnOriginFromCorsFetch(origin: string = location.origin): void {
  const plugin = (globalThis as { CORSFetch?: CorsFetchPlugin }).CORSFetch;
  if (!plugin) return;
  const escaped = origin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  plugin.config({ exclude: [new RegExp(`^${escaped}/`)] });
}
