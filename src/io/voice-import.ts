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
import { loadInvoke, loadOpenDialog, type OpenResult, pickedPath } from "./user-asset-import";

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

async function defaultCopyDeps(): Promise<VoiceCopyDeps> {
  const [{ invoke }, { resolveUserFileSrc }] = await Promise.all([
    import("@tauri-apps/api/core"),
    import("./asset-url"),
  ]);
  return { invoke, resolveRefUrl: resolveUserFileSrc };
}

/**
 * Open the audio file picker and return the chosen source path — nothing is copied
 * yet. Returns null when the picker is cancelled.
 */
export async function pickVoiceFile(deps?: VoicePickDeps): Promise<string | null> {
  const d = deps ?? { openDialog: await loadOpenDialog() };
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
 * existing voice of that id) — the returned id reflects that, never the raw input. The
 * label keeps the typed name so a collapse (e.g. a non-ASCII name → a hashed ASCII id) doesn't
 * silently discard what the user typed; it falls back to the id only when the name is blank.
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
  return { id, label: name.trim() || id, ref_url, source: "user" };
}

/** Delete an imported voice's file from app-data. Idempotent on the native side. */
export async function removeUserVoice(id: string, deps?: VoiceRemoveDeps): Promise<void> {
  const d = deps ?? { invoke: await loadInvoke() };
  await d.invoke("remove_user_voice", { id });
}
