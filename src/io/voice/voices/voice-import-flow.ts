/**
 * Bring-your-own-voice import flow, in two steps so a naming row can sit between them:
 * pickVoiceImport opens the OS picker (nothing copied yet), commitVoiceImport copies the
 * file and uploads it to the TTS server under the typed name.
 *
 * Both windows run this identically — the pet window and the settings window each call the
 * TTS server directly — so it lives here rather than being written twice.
 */

import { ttsProviderOf } from "../../../config/tts-provider";
import type { TtsProviderName } from "../../../contract";
import type { Logger } from "../../../logger";
import { voiceIdFromName } from "../../assets/safe-id";
import { removeOrphanImport } from "../../assets/user-asset-import";
import { selectFetch } from "../../chat/stream/chat-client";
import { nextRevision, type SpeakerOption } from "./speaker-selection";
import { VOICE_APIS } from "./voice-apis";
import {
  copyVoiceFile,
  fileStemFromPath,
  pickVoiceFile,
  removeUserVoice as removeUserVoiceFile,
  renameUserVoice,
} from "./voice-import";

/** A picked-but-not-yet-copied import: the source file plus what to seed the naming row with. */
interface PickedVoiceImport {
  srcPath: string;
  seedName: string;
}

/** The slice of the speaker store the commit step writes to. */
interface SpeakerImportTarget {
  list: () => SpeakerOption[];
  /** Every provider's imported voices — an id another provider holds is not taken over. */
  listUser: () => SpeakerOption[];
  addUserOption: (option: SpeakerOption & { source: "user" }) => void;
  select: (id: string) => void;
}

export function createVoiceImportFlow(deps: {
  /** The endpoints fields the upload needs, or null when config is not loaded yet. */
  getEndpoints: () => { tts_base_url?: string; tts_provider?: TtsProviderName } | null;
  /** Resolves the TTS server key (Bearer). Omitted/empty → no auth header. */
  getApiKey?: () => Promise<string | undefined>;
  speakerSelection: SpeakerImportTarget;
  log: Logger;
}): {
  pickVoiceImport: () => Promise<PickedVoiceImport | null>;
  commitVoiceImport: (srcPath: string, name: string) => Promise<void>;
} {
  const { getEndpoints, getApiKey, speakerSelection, log } = deps;

  const pickVoiceImport = async (): Promise<PickedVoiceImport | null> => {
    const srcPath = await pickVoiceFile();
    if (srcPath === null) return null; // cancelled at the OS picker
    return { srcPath, seedName: fileStemFromPath(srcPath) };
  };

  // Copy under a unique staging id, then upload. Once the upload succeeds the staged folder moves
  // to its final id: the name-derived id for a provider that keeps the caller's id (replacing a
  // same-name voice's folder), the id the server assigns for any other. The target is read before
  // the first await, and a switch away from it at any later point leaves the store alone, except
  // for a stored voice whose folder the move already replaced. On failure, delete the staged copy
  // and rethrow without touching the store or a stored voice's clip.
  const commitVoiceImport = async (srcPath: string, name: string): Promise<void> => {
    const eps = getEndpoints();
    if (!eps?.tts_base_url) throw new Error("voice import requires tts_base_url");
    const baseUrl = eps.tts_base_url;
    const provider = ttsProviderOf(eps);
    const api = VOICE_APIS[provider];
    const upsert = api?.upsert;
    if (!upsert) throw new Error(`TTS provider "${provider}" takes no imported voices`);
    let finalId: string | undefined;
    if (api.keepsId) {
      if (!name.trim()) throw new Error("voice name required");
      const id = voiceIdFromName(name);
      if (speakerSelection.listUser().some((o) => o.id === id && o.provider !== provider)) {
        throw new Error(`voice id "${id}" belongs to another TTS provider`);
      }
      finalId = id;
    }
    const superseded = (): boolean => {
      const live = getEndpoints();
      return !live || ttsProviderOf(live) !== provider || live.tts_base_url !== baseUrl;
    };

    const copied = await copyVoiceFile(srcPath, `import-${crypto.randomUUID()}`);
    const label = name.trim() || copied.id;
    // A same-name re-import keeps the id but replaces the clip — bump the persisted revision so
    // the existing cross-window settings sync carries the change into other windows' filler cache key.
    let option: SpeakerOption & { source: "user" } = {
      ...copied,
      label,
      provider,
      revision: nextRevision(speakerSelection.list(), finalId ?? copied.id),
    };
    let folder = copied.id;
    let serverId: string | undefined;
    const cleanUp = (): Promise<void> =>
      // Surface a cleanup failure as a warning rather than swallowing it.
      removeOrphanImport(folder, removeUserVoiceFile, (e) =>
        log.warn("orphan_voice_cleanup_failed", { error: String(e) }),
      );
    try {
      if (!superseded()) {
        const f = await selectFetch();
        // ref_url is an asset:// URL that reference-clip reads through the webview fetch.
        serverId = await upsert({
          baseUrl,
          id: finalId ?? copied.id,
          name: label,
          refUrl: copied.ref_url,
          fetch: f,
          getApiKey,
          logger: log,
        });
        const target = finalId ?? serverId;
        if (target && target !== copied.id && !superseded()) {
          // The native rename refuses an existing destination, so a same-name voice's folder goes first.
          if (finalId) await removeUserVoiceFile(finalId);
          option = { ...option, id: target, ref_url: await renameUserVoice(copied.id, target) };
          folder = target;
        }
      }
    } catch (err) {
      await cleanUp();
      log.error("imported_voice_upload_failed", { error: String(err) });
      throw err;
    }
    if (superseded()) {
      // A folder a stored voice already owns (a same-name Irodori re-import) holds that voice's
      // new clip, so its entry follows the clip; any other folder is an orphan.
      if (speakerSelection.listUser().some((o) => o.id === folder)) {
        speakerSelection.addUserOption(option);
      } else {
        await cleanUp();
      }
      log.warn("voice_import_superseded", { provider, server_voice: serverId ?? null });
      return;
    }
    speakerSelection.addUserOption(option);
    speakerSelection.select(option.id);
  };

  return { pickVoiceImport, commitVoiceImport };
}
