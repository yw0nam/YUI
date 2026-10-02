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
import { selectFetch } from "../../chat/chat-client";
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

  // Copy, then upload. A provider that keeps the caller's id gets the clip under the name-derived
  // id and replaces it on a same-name re-import; any other provider gets it under a unique staging
  // id that moves to the id the server assigns. The target is read before the first await, and a
  // switch away from it at any later point leaves the store alone. On failure, delete the orphan
  // copy and rethrow without touching the store, leaving the prior selection intact.
  const commitVoiceImport = async (srcPath: string, name: string): Promise<void> => {
    const eps = getEndpoints();
    if (!eps?.tts_base_url) throw new Error("voice import requires tts_base_url");
    const baseUrl = eps.tts_base_url;
    const provider = ttsProviderOf(eps);
    const api = VOICE_APIS[provider];
    const upsert = api?.upsert;
    if (!upsert) throw new Error(`TTS provider "${provider}" takes no imported voices`);
    if (api.keepsId) {
      const id = voiceIdFromName(name);
      if (speakerSelection.listUser().some((o) => o.id === id && o.provider !== provider)) {
        throw new Error(`voice id "${id}" belongs to another TTS provider`);
      }
    }
    const superseded = (): boolean => {
      const live = getEndpoints();
      return !live || ttsProviderOf(live) !== provider || live.tts_base_url !== baseUrl;
    };

    const copied = await copyVoiceFile(
      srcPath,
      api.keepsId ? name : `import-${crypto.randomUUID()}`,
    );
    const label = name.trim() || copied.id;
    // A same-name re-import keeps the id but replaces the clip — bump the persisted revision so
    // the existing cross-window settings sync carries the change into other windows' filler cache key.
    let option: SpeakerOption & { source: "user" } = {
      ...copied,
      label,
      provider,
      revision: nextRevision(speakerSelection.list(), copied.id),
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
          id: copied.id,
          name: label,
          refUrl: copied.ref_url,
          fetch: f,
          getApiKey,
          logger: log,
        });
        if (serverId && serverId !== copied.id && !superseded()) {
          option = { ...option, id: serverId, ref_url: await renameUserVoice(copied.id, serverId) };
          folder = serverId;
        }
      }
    } catch (err) {
      await cleanUp();
      log.error("imported_voice_upload_failed", { error: String(err) });
      throw err;
    }
    if (superseded()) {
      // A folder a stored voice already owns (a same-name Irodori re-import) is that voice's clip.
      if (!speakerSelection.listUser().some((o) => o.id === folder)) await cleanUp();
      log.warn("voice_import_superseded", { provider, server_voice: serverId ?? null });
      return;
    }
    speakerSelection.addUserOption(option);
    speakerSelection.select(option.id);
  };

  return { pickVoiceImport, commitVoiceImport };
}
