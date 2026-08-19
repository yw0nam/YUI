/**
 * Bring-your-own-voice import flow, in two steps so a naming row can sit between them:
 * pickVoiceImport opens the OS picker (nothing copied yet), commitVoiceImport copies the
 * file under the typed name and uploads it to the TTS server.
 *
 * Both windows run this identically — the pet window and the settings window each call the
 * TTS server directly — so it lives here rather than being written twice.
 */

import type { Logger } from "../logger";
import { selectFetch } from "./chat-client";
import type { SpeakerOption } from "./speaker-selection";
import { upsertVoice } from "./tts-voices";
import {
  copyVoiceFile,
  fileStemFromPath,
  pickVoiceFile,
  removeOrphanVoice,
  removeUserVoice as removeUserVoiceFile,
} from "./voice-import";

/** A picked-but-not-yet-copied import: the source file plus what to seed the naming row with. */
export interface PickedVoiceImport {
  srcPath: string;
  seedName: string;
}

/** The slice of the speaker store the commit step writes to. */
interface SpeakerImportTarget {
  list: () => SpeakerOption[];
  addUserOption: (option: SpeakerOption & { source: "user" }) => void;
  select: (id: string) => void;
}

export function createVoiceImportFlow(deps: {
  getTtsBaseUrl: () => string | undefined;
  /** Resolves the TTS server key (Bearer). Omitted/empty → no auth header. */
  getApiKey?: () => Promise<string | undefined>;
  speakerSelection: SpeakerImportTarget;
  log: Logger;
}): {
  pickVoiceImport: () => Promise<PickedVoiceImport | null>;
  commitVoiceImport: (srcPath: string, name: string) => Promise<void>;
} {
  const { getTtsBaseUrl, getApiKey, speakerSelection, log } = deps;

  const pickVoiceImport = async (): Promise<PickedVoiceImport | null> => {
    const srcPath = await pickVoiceFile();
    if (srcPath === null) return null; // cancelled at the OS picker
    return { srcPath, seedName: fileStemFromPath(srcPath) };
  };

  // Copy under the typed name, then upload. upsertVoice is create-or-replace, so this is one
  // unconditional call: a duplicate name is an intentional overwrite and a first import is a
  // create. On failure, delete the orphan copy and rethrow without touching the store, leaving
  // the prior selection intact.
  const commitVoiceImport = async (srcPath: string, name: string): Promise<void> => {
    const copied = await copyVoiceFile(srcPath, name);
    // A same-name re-import keeps the id but replaces the clip — bump the persisted revision so
    // the existing cross-window settings sync carries the change into other windows' filler cache key.
    const prevRevision = speakerSelection.list().find((o) => o.id === copied.id)?.revision ?? 0;
    const option = { ...copied, revision: prevRevision + 1 };
    try {
      const baseUrl = getTtsBaseUrl();
      if (!baseUrl) throw new Error("voice import requires tts_base_url");
      const f = await selectFetch();
      // ref_url is an asset:// URL that reference-clip reads through the webview fetch.
      await upsertVoice({ baseUrl, id: option.id, refUrl: option.ref_url, fetch: f, getApiKey });
    } catch (err) {
      // Surface a cleanup failure as a warning rather than swallowing it (the original still throws).
      await removeOrphanVoice(option.id, removeUserVoiceFile, (e) =>
        log.warn("orphan_voice_cleanup_failed", { error: String(e) }),
      );
      log.error("imported_voice_upload_failed", { error: String(err) });
      throw err;
    }
    speakerSelection.addUserOption(option);
    speakerSelection.select(option.id);
  };

  return { pickVoiceImport, commitVoiceImport };
}
