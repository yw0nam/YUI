/**
 * Bring-your-own-voice import — OS file picker → native copy → user SpeakerOption.
 *
 * Split into pickVoiceFile (opens the OS picker, returns a source path only — nothing
 * copied yet) and copyVoiceFile (copies + registers under a caller-supplied name). The
 * split lets a naming row sit between picking and copying: name the voice BEFORE any
 * file touches disk, so cancelling the naming step needs no cleanup.
 *
 * Thin layer over the dialog plugin + the Rust `import_voice_file` / `remove_user_voice`
 * commands. Deps are injectable so tests never touch a real Tauri runtime; the real
 * Tauri APIs are lazily imported (non-Tauri/test envs never load them).
 */

import type { SpeakerOption } from "./speaker-selection";

/** Dialog open result shape (path string, array, or {path} per plugin version). */
type OpenResult = string | string[] | { path: string } | null;

export interface VoicePickDeps {
  /** `@tauri-apps/plugin-dialog` open. */
  openDialog(opts: {
    multiple: boolean;
    filters: Array<{ name: string; extensions: string[] }>;
  }): Promise<OpenResult>;
}

export interface VoiceCopyDeps {
  /** `@tauri-apps/api/core` invoke. */
  invoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T>;
  /** Converts an absolute app-data path to a webview-fetchable URL (async). */
  resolveRefUrl(absPath: string): Promise<string>;
}

/** Only the bits removeUserVoice needs. */
type VoiceRemoveDeps = Pick<VoiceCopyDeps, "invoke">;

async function defaultPickDeps(): Promise<VoicePickDeps> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  return { openDialog: (opts) => open(opts) as Promise<OpenResult> };
}

async function defaultCopyDeps(): Promise<VoiceCopyDeps> {
  const [{ invoke }, { resolveUserFileSrc }] = await Promise.all([
    import("@tauri-apps/api/core"),
    import("./asset-url"),
  ]);
  return { invoke, resolveRefUrl: resolveUserFileSrc };
}

async function defaultRemoveDeps(): Promise<VoiceRemoveDeps> {
  const { invoke } = await import("@tauri-apps/api/core");
  return { invoke };
}

/** Normalize the dialog result to a single source path, or null if nothing chosen. */
function pickedPath(result: OpenResult): string | null {
  if (result == null) return null;
  if (typeof result === "string") return result.length > 0 ? result : null;
  if (Array.isArray(result)) return result.length > 0 ? result[0] : null;
  if (typeof result === "object" && typeof result.path === "string") return result.path;
  return null;
}

/**
 * Open the audio file picker and return the chosen source path — nothing is copied
 * yet. Returns null when the picker is cancelled.
 */
export async function pickVoiceFile(deps?: VoicePickDeps): Promise<string | null> {
  const d = deps ?? (await defaultPickDeps());
  const result = await d.openDialog({
    multiple: false,
    filters: [
      { name: "Audio", extensions: ["mp3", "wav", "ogg", "m4a", "flac", "aac", "opus", "webm"] },
    ],
  });
  return pickedPath(result);
}

/** Extract the filename stem (no extension) from an absolute path — seeds the naming row. */
export function fileStemFromPath(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? path;
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}

interface ImportedVoice {
  id: string;
  refPath: string;
}

/**
 * Copy `srcPath` into app-data under `name` and return its SpeakerOption (source:"user").
 * The native side sanitizes `name` into the id it actually used (and overwrites any
 * existing voice of that id) — the returned id/label reflect that, never the raw input.
 */
export async function copyVoiceFile(
  srcPath: string,
  name: string,
  deps?: VoiceCopyDeps,
): Promise<SpeakerOption & { source: "user" }> {
  const d = deps ?? (await defaultCopyDeps());
  const { id, refPath } = await d.invoke<ImportedVoice>("import_voice_file", {
    srcPath,
    desiredName: name,
  });
  const ref_url = await d.resolveRefUrl(refPath);
  return { id, label: id, ref_url, source: "user" };
}

/** Delete an imported voice's file from app-data. Idempotent on the native side. */
export async function removeUserVoice(id: string, deps?: VoiceRemoveDeps): Promise<void> {
  const d = deps ?? (await defaultRemoveDeps());
  await d.invoke("remove_user_voice", { id });
}

/**
 * Remove an orphaned imported voice after a failed import. A failed removal is
 * surfaced via onError (never swallowed) so multi-MB orphans don't pile up
 * silently; the caller's primary error still rethrows.
 */
export async function removeOrphanVoice(
  id: string,
  remove: (id: string) => Promise<void>,
  onError: (err: unknown) => void,
): Promise<void> {
  try {
    await remove(id);
  } catch (err) {
    onError(err);
  }
}
