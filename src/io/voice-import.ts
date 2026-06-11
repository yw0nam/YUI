/**
 * Bring-your-own-voice import — OS file picker → native copy → user SpeakerOption.
 *
 * Thin layer over the dialog plugin + the Rust `import_voice_file` / `remove_user_voice`
 * commands. Deps are injectable so tests never touch a real Tauri runtime; the real
 * Tauri APIs are lazily imported (non-Tauri/test envs never load them).
 */

import type { SpeakerOption } from "./speaker-selection";

/** Dialog open result shape (path string, array, or {path} per plugin version). */
type OpenResult = string | string[] | { path: string } | null;

export interface VoiceImportDeps {
  /** `@tauri-apps/plugin-dialog` open. */
  openDialog(opts: {
    multiple: boolean;
    filters: Array<{ name: string; extensions: string[] }>;
  }): Promise<OpenResult>;
  /** `@tauri-apps/api/core` invoke. */
  invoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T>;
  /** Converts an absolute app-data path to a webview-fetchable URL (async). */
  resolveRefUrl(absPath: string): Promise<string>;
}

/** Only the bits removeUserVoice needs. */
export type VoiceRemoveDeps = Pick<VoiceImportDeps, "invoke">;

async function defaultDeps(): Promise<VoiceImportDeps> {
  const [{ open }, { invoke }, { resolveUserFileSrc }] = await Promise.all([
    import("@tauri-apps/plugin-dialog"),
    import("@tauri-apps/api/core"),
    import("./asset-url"),
  ]);
  return {
    openDialog: (opts) => open(opts) as Promise<OpenResult>,
    invoke,
    resolveRefUrl: resolveUserFileSrc,
  };
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

interface ImportedVoice {
  id: string;
  refPath: string;
}

/**
 * Open the audio file picker, copy the chosen file into app-data, and return its
 * SpeakerOption (source:"user"). Returns null when the picker is cancelled.
 */
export async function importVoiceFromFile(
  deps?: VoiceImportDeps,
): Promise<(SpeakerOption & { source: "user" }) | null> {
  const d = deps ?? (await defaultDeps());
  const result = await d.openDialog({
    multiple: false,
    filters: [{ name: "Audio", extensions: ["mp3", "wav", "ogg", "m4a", "flac", "aac", "opus", "webm"] }],
  });

  const srcPath = pickedPath(result);
  if (srcPath === null) return null;

  const { id, refPath } = await d.invoke<ImportedVoice>("import_voice_file", { srcPath });
  const ref_url = await d.resolveRefUrl(refPath);
  return { id, label: id, ref_url, source: "user" };
}

/** Delete an imported voice's file from app-data. Idempotent on the native side. */
export async function removeUserVoice(id: string, deps?: VoiceRemoveDeps): Promise<void> {
  const d = deps ?? (await defaultRemoveDeps());
  await d.invoke("remove_user_voice", { id });
}
