/**
 * Bring-your-own-voice import flow, in two steps so a naming row can sit between them:
 * pickVoiceImport stages the picked file's copy under a fresh staging id, commitVoiceImport
 * uploads the staged copy to the TTS server under the typed name and moves the folder there.
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
import { VOICE_APIS, type VoiceApi } from "./voice-apis";
import {
  pickVoiceFile,
  removeUserVoice as removeUserVoiceFile,
  renameUserVoice,
} from "./voice-import";

/** A staged-but-not-yet-named import: the naming row names the staged copy, Esc discards it. */
export interface PickedVoiceImport {
  stagedId: string;
  seedName: string;
  discard: () => Promise<void>;
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
  commitVoiceImport: (stagedId: string, name: string) => Promise<void>;
  registerCopiedVoice: (
    copied: SpeakerOption & { source: "user" },
    label: string,
  ) => Promise<string>;
} {
  const { getEndpoints, getApiKey, speakerSelection, log } = deps;

  // Staged copies keyed by staging id, alive between the pick step and the commit step.
  const staged = new Map<string, SpeakerOption & { source: "user" }>();

  const pickVoiceImport = async (): Promise<PickedVoiceImport | null> => {
    const stagingId = `import-${crypto.randomUUID()}`;
    const picked = await pickVoiceFile(stagingId);
    if (picked === null) return null; // cancelled at the OS picker
    staged.set(stagingId, picked.staged);
    return {
      stagedId: stagingId,
      seedName: picked.seedName,
      discard: () => {
        staged.delete(stagingId);
        return removeUserVoiceFile(stagingId);
      },
    };
  };

  // Surfaces a cleanup failure as a warning rather than swallowing it.
  const cleanFolder = (folder: string): Promise<void> =>
    removeOrphanImport(folder, removeUserVoiceFile, (e) =>
      log.warn("orphan_voice_cleanup_failed", { error: String(e) }),
    );

  // The upload → move → add core the naming row's commit and the preset-file import's
  // registration share. Resolves the provider, uploads the staged copy, moves its folder to
  // the target id (the name-derived id for a provider that keeps the caller's id, the id the
  // server assigns for any other), and adds the store entry — never selects. The target is
  // read before the first await, and a switch away from it at any later point leaves the
  // store alone, except for a stored voice whose folder the move already replaced. Every
  // failure — a pre-upload check or the upload itself — deletes the staged copy and rethrows
  // without touching the store or a stored voice's clip.
  const uploadStaged = async (
    copied: SpeakerOption & { source: "user" },
    label: string,
    chooseId: (api: VoiceApi, provider: TtsProviderName) => string | undefined,
  ): Promise<
    | { kind: "added"; id: string }
    | {
        kind: "superseded";
        folder: string;
        option: SpeakerOption & { source: "user" };
        provider: TtsProviderName;
        serverVoice: string | undefined;
      }
  > => {
    let folder = copied.id;
    try {
      const eps = getEndpoints();
      if (!eps?.tts_base_url) throw new Error("voice import requires tts_base_url");
      const baseUrl = eps.tts_base_url;
      const provider = ttsProviderOf(eps);
      const api = VOICE_APIS[provider];
      const upsert = api?.upsert;
      if (!upsert) throw new Error(`TTS provider "${provider}" takes no imported voices`);
      const finalId = chooseId(api, provider);
      const superseded = (): boolean => {
        const live = getEndpoints();
        return !live || ttsProviderOf(live) !== provider || live.tts_base_url !== baseUrl;
      };

      // A same-name re-import keeps the id but replaces the clip — bump the persisted revision so
      // the existing cross-window settings sync carries the change into other windows' filler cache key.
      let option: SpeakerOption & { source: "user" } = {
        ...copied,
        label,
        provider,
        revision: nextRevision(speakerSelection.list(), finalId ?? copied.id),
      };
      const f = await selectFetch();
      // ref_url is an asset:// URL that reference-clip reads through the webview fetch.
      const serverVoice = await upsert({
        baseUrl,
        id: finalId ?? copied.id,
        name: label,
        refUrl: copied.ref_url,
        fetch: f,
        getApiKey,
        logger: log,
      });
      const target = finalId ?? serverVoice;
      if (target && target !== copied.id && !superseded()) {
        // The native rename refuses an existing destination, so a same-name voice's folder goes first.
        if (finalId) await removeUserVoiceFile(finalId);
        option = { ...option, id: target, ref_url: await renameUserVoice(copied.id, target) };
        folder = target;
      }
      if (superseded()) {
        return { kind: "superseded", folder, option, provider, serverVoice };
      }
      speakerSelection.addUserOption(option);
      return { kind: "added", id: option.id };
    } catch (err) {
      await cleanFolder(folder);
      log.error("voice_import_failed", { error: String(err) });
      throw err;
    }
  };

  const commitVoiceImport = async (stagedId: string, name: string): Promise<void> => {
    const copied = staged.get(stagedId);
    if (!copied) throw new Error("no staged voice");
    staged.delete(stagedId);
    const label = name.trim() || copied.id;
    const out = await uploadStaged(copied, label, (api, provider) => {
      if (!api.keepsId) return undefined;
      if (!name.trim()) throw new Error("voice name required");
      const id = voiceIdFromName(name);
      if (speakerSelection.listUser().some((o) => o.id === id && o.provider !== provider)) {
        throw new Error(`voice id "${id}" belongs to another TTS provider`);
      }
      return id;
    });
    if (out.kind === "superseded") {
      // A folder a stored voice already owns (a same-name Irodori re-import) holds that voice's
      // new clip, so its entry follows the clip; any other folder is an orphan.
      if (speakerSelection.listUser().some((o) => o.id === out.folder)) {
        speakerSelection.addUserOption(out.option);
      } else {
        await cleanFolder(out.folder);
      }
      log.warn("voice_import_superseded", {
        provider: out.provider,
        server_voice: out.serverVoice ?? null,
      });
      return;
    }
    speakerSelection.select(out.id);
  };

  // The preset-file import's commit: the same upload/move/add as the naming row's, but it
  // never selects and never replaces an existing voice — a taken name walks `label 2`,
  // `label 3` until its id is free, and a provider switch mid-upload throws after removing
  // the staged copy instead of re-pointing a stored voice.
  const registerCopiedVoice = async (
    copied: SpeakerOption & { source: "user" },
    label: string,
  ): Promise<string> => {
    const shown = label.trim() || copied.id;
    const out = await uploadStaged(copied, shown, (api) => {
      if (!api.keepsId) return undefined;
      if (!shown) throw new Error("voice name required");
      let name = shown;
      for (
        let n = 2;
        speakerSelection.listUser().some((o) => o.id === voiceIdFromName(name));
        n++
      ) {
        name = `${shown} ${n}`;
      }
      return voiceIdFromName(name);
    });
    if (out.kind === "superseded") {
      await cleanFolder(out.folder);
      log.warn("voice_import_superseded", {
        provider: out.provider,
        server_voice: out.serverVoice ?? null,
      });
      throw new Error("voice import superseded");
    }
    return out.id;
  };

  return { pickVoiceImport, commitVoiceImport, registerCopiedVoice };
}
