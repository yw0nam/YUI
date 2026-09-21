type CorsFetchPlugin = { config: (config: { exclude: RegExp[] }) => void };

/** Windows serves bundled assets from http://tauri.localhost, which the cors-fetch proxy can't reach, so same-origin requests stay native. */
export function excludeOwnOriginFromCorsFetch(origin?: string): void {
  const plugin = (globalThis as { CORSFetch?: CorsFetchPlugin }).CORSFetch;
  if (!plugin) return;
  const ownOrigin = origin ?? (globalThis as { location?: Location }).location?.origin;
  if (!ownOrigin) return;
  const escaped = ownOrigin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // This call replaces the plugin's whole exclude list.
  plugin.config({ exclude: [new RegExp(`^${escaped}/`, "i")] });
}
