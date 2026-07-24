/**
 * Converts logical asset paths (`/configs`, `/vrms/x.vrm`, `/references/…`) into URLs for the runtime environment.
 *
 * dev/browser passes the input through unchanged to preserve vite static serving. Tauri packaging
 * strips the leading slash to a resource-relative path, then resolveResource → convertFileSrc to build a
 * webview-fetchable absolute URL for the bundled resource. The bundle mapping matches src-tauri/tauri.conf.json
 * `bundle.resources` keeping `configs/`, `vrms/`, and `references/` at the resource root as-is.
 *
 * The Tauri API is injectable — tests verify the branching without hitting the real @tauri-apps/api.
 */

import { isTauri } from "./tauri-env";

/** Minimal API surface needed to resolve Tauri bundle resources. */
export interface TauriAssetApi {
  resolveResource(path: string): Promise<string>;
  convertFileSrc(path: string): string;
}

interface ResolveAssetUrlOptions {
  /** Detects the Tauri runtime. Defaults to the shared runtime-detection function. */
  isTauri?: () => boolean;
  /** Detects dev (vite live serving). Defaults to import.meta.env.DEV. In dev, resource rewriting is skipped. */
  isDev?: () => boolean;
  /** Tauri API loader (injectable). Defaults to a dynamic import from @tauri-apps/api. */
  tauri?: () => Promise<TauriAssetApi>;
}

function defaultIsDev(): boolean {
  return !!import.meta.env?.DEV;
}

async function defaultTauri(): Promise<TauriAssetApi> {
  const [{ resolveResource }, { convertFileSrc }] = await Promise.all([
    import("@tauri-apps/api/path"),
    import("@tauri-apps/api/core"),
  ]);
  return { resolveResource, convertFileSrc };
}

/** Already-absolute schemes (http(s)/asset/blob/data etc.) are not conversion targets. */
function isAbsoluteUrl(path: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(path);
}

/** webview-loadable src schemes that legitimately come from convertFileSrc/dev. */
const SAFE_USER_SRC_SCHEME = /^(asset|blob|https?):/i;
/** Dangerous schemes that must not pass through as an asset src. */
const DANGEROUS_SCHEME = /^(javascript|data|file|vbscript):/i;
/** A single-letter drive (e.g. "C:\…") is a Windows absolute path, not a scheme. */
const WINDOWS_DRIVE = /^[a-z]:[\\/]/i;

/** "/configs/x.json?t=1" → { rel: "configs/x.json", query: "?t=1" }. */
function splitPath(logicalPath: string): { rel: string; query: string } {
  const qIdx = logicalPath.indexOf("?");
  const query = qIdx >= 0 ? logicalPath.slice(qIdx) : "";
  const noQuery = qIdx >= 0 ? logicalPath.slice(0, qIdx) : logicalPath;
  return { rel: noQuery.replace(/^\/+/, ""), query };
}

/**
 * Converts a logical path into a fetchable URL for the current runtime.
 * dev (both browser and Tauri dev, vite live serving): input as-is → preserves hot reload.
 * prod Tauri packaging: bundled-resource absolute URL (query preserved). Already-absolute URLs are left as-is in any environment.
 */
export async function resolveAssetUrl(
  logicalPath: string,
  opts: ResolveAssetUrlOptions = {},
): Promise<string> {
  const runtimeIsTauri = opts.isTauri ?? isTauri;
  const isDev = opts.isDev ?? defaultIsDev;
  if (!runtimeIsTauri() || isDev() || isAbsoluteUrl(logicalPath)) return logicalPath;

  const tauri = await (opts.tauri ?? defaultTauri)();
  const { rel, query } = splitPath(logicalPath);
  const abs = await tauri.resolveResource(rel);
  return tauri.convertFileSrc(abs) + query;
}

/**
 * Converts an imported VRM/voice app-data file path into a webview-loadable URL.
 * Passes through only known-safe schemes (asset/blob/http(s)) coming from convertFileSrc/dev, and
 * blocks dangerous schemes (javascript/data/file/vbscript) by returning an empty string as an unusable src.
 * Scheme-less absolute paths and Windows drive paths are converted via convertFileSrc (under Tauri).
 * The empty string for unusable input is treated as a failure at the call site (renderer load/voice registration).
 */
export async function resolveUserFileSrc(
  absPath: string,
  opts: ResolveAssetUrlOptions = {},
): Promise<string> {
  if (DANGEROUS_SCHEME.test(absPath)) return "";
  if (SAFE_USER_SRC_SCHEME.test(absPath)) return absPath; // already fetchable — do not re-convert
  const runtimeIsTauri = opts.isTauri ?? isTauri;
  // Has a scheme but matches neither the safe list nor a drive path → unknown; block it.
  if (isAbsoluteUrl(absPath) && !WINDOWS_DRIVE.test(absPath)) return "";
  if (!runtimeIsTauri()) return absPath; // dev/browser: serve the absolute fs path as-is
  const tauri = await (opts.tauri ?? defaultTauri)();
  return tauri.convertFileSrc(absPath);
}
