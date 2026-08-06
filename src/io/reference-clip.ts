import { resolveAssetUrl } from "./asset-url";
import { isTauri } from "./tauri-env";

/**
 * Converts a ref_url into a fetchable URL for the current runtime.
 * Tauri packaging resolves to a bundle-resource absolute URL (resolveAssetUrl); Tauri dev and browser keep the
 * vite path, which is then absolutized against origin (a base-less URL is rejected by Tauri fetchCORS).
 * Absolute URLs pass through unchanged; base-less environments (node tests) keep the original.
 */
export async function resolveReferenceClipUrl(refUrl: string): Promise<string> {
  const resolved = isTauri() ? await resolveAssetUrl(refUrl) : refUrl;
  const base = (globalThis as { location?: { href?: string } }).location?.href;
  if (!base) return resolved;
  try {
    return new URL(resolved, base).href;
  } catch {
    return resolved;
  }
}

/** Schemes the ref resolvers produce that the injected fetch (Tauri's reqwest-backed fetchCORS) cannot read. */
const WEBVIEW_ONLY_SCHEME = /^(asset|blob):/i;

/** Fetches a reference clip's bytes, choosing the right fetch for the URL's scheme. */
export async function fetchReferenceClip(
  refUrl: string,
  opts: { fetch?: typeof fetch } = {},
): Promise<Blob> {
  const url = await resolveReferenceClipUrl(refUrl);
  // Only a webview-only scheme escapes the injected fetch — anything else (http(s), relative, file:, data:) stays on it and fails loudly.
  const fetchImpl = WEBVIEW_ONLY_SCHEME.test(url)
    ? globalThis.fetch
    : (opts.fetch ?? globalThis.fetch);
  const res = await fetchImpl(url);
  if (!res.ok) {
    throw new Error(`reference clip fetch failed (HTTP ${res.status}) ${url}`);
  }
  return res.blob();
}
