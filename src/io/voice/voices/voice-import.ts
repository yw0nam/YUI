/**
 * Bring-your-own-voice import — Rust pick → staged copy → naming row → upload.
 *
 * pickVoiceFile opens the audio picker in Rust and stages a copy under the caller's staging
 * id at once; the naming row sits between staging and upload, and Esc on it removes the
 * staged copy (remove_user_voice, idempotent).
 *
 * Thin layer over the Rust `import_voice_file` / `rename_user_voice` / `remove_user_voice`
 * commands. Deps are injectable so tests never touch a real Tauri runtime; the real Tauri
 * APIs are lazily imported (non-Tauri/test envs never load them).
 */

import { createLogger } from "../../../logger";
import { loadInvoke, removeOrphanImport } from "../../assets/user-asset-import";
import type { SpeakerOption } from "./speaker-selection";

const log = createLogger("voice-import");

export interface VoiceImportDeps {
  /** `@tauri-apps/api/core` invoke. */
  invoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T>;
  /** Converts an absolute app-data path to a webview-fetchable URL (async). */
  resolveRefUrl(absPath: string): Promise<string>;
}

/** Only the bits removeUserVoice needs. */
type VoiceRemoveDeps = Pick<VoiceImportDeps, "invoke">;

async function defaultImportDeps(): Promise<VoiceImportDeps> {
  const [{ invoke }, { resolveUserFileSrc }] = await Promise.all([
    import("@tauri-apps/api/core"),
    import("../../../config/asset-url"),
  ]);
  return { invoke, resolveRefUrl: resolveUserFileSrc };
}

interface ImportedVoice {
  id: string;
  refPath: string;
}

/** The staged copy under `stagingId` plus the picked file's stem; null when the picker is cancelled. */
export async function pickVoiceFile(
  stagingId: string,
  deps?: VoiceImportDeps,
): Promise<{ staged: SpeakerOption & { source: "user" }; seedName: string } | null> {
  const d = deps ?? (await defaultImportDeps());
  const picked = await d.invoke<(ImportedVoice & { seedName: string }) | null>(
    "import_voice_file",
    { stagingId },
  );
  if (!picked) return null;
  let ref_url: string;
  try {
    ref_url = await d.resolveRefUrl(picked.refPath);
  } catch (err) {
    // The staged copy would orphan — remove it before surfacing the original error.
    await removeOrphanImport(
      picked.id,
      (id) => d.invoke("remove_user_voice", { id }),
      (e) => log.warn("staged_voice_cleanup_failed", { error: String(e) }),
    );
    throw err;
  }
  return {
    staged: { id: picked.id, label: picked.id, ref_url, source: "user" },
    seedName: picked.seedName,
  };
}

/** Move an imported voice's clip in app-data from id `from` to id `to`; returns its new ref_url. */
export async function renameUserVoice(
  from: string,
  to: string,
  deps?: VoiceImportDeps,
): Promise<string> {
  const d = deps ?? (await defaultImportDeps());
  const { refPath } = await d.invoke<ImportedVoice>("rename_user_voice", { from, to });
  return d.resolveRefUrl(refPath);
}

/** Delete an imported voice's file from app-data. Idempotent on the native side. */
export async function removeUserVoice(id: string, deps?: VoiceRemoveDeps): Promise<void> {
  const d = deps ?? { invoke: await loadInvoke() };
  await d.invoke("remove_user_voice", { id });
}
