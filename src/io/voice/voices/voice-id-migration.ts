/**
 * Moves each imported voice persisted under an id outside the TTS server's `[A-Za-z0-9_-]`
 * charset to the id an import of its label gets today, so the voice-list self-heal can upload it.
 * The label, selection and clip carry over; when a re-import of the same name already holds that
 * id, the old voice is dropped for it. An entry whose rename fails stays as it is.
 */

import type { Logger } from "../../../logger";
import { voiceIdFromName } from "../../assets/safe-id";
import type { SpeakerOption } from "./speaker-selection";

const SERVER_VOICE_ID = /^[A-Za-z0-9_-]+$/;

/** The slice of the speaker store the migration touches. */
interface UserVoiceTarget {
  list: () => SpeakerOption[];
  getActiveId: () => string;
  addUserOption: (option: SpeakerOption) => void;
  removeUserOption: (id: string) => void;
  select: (id: string) => void;
}

export async function migrateUserVoiceIds(deps: {
  speakerSelection: UserVoiceTarget;
  /** Moves the local clip from one id to another and resolves its new ref_url. */
  renameUserVoice: (from: string, to: string) => Promise<string>;
  /** Deletes a voice's local clip. */
  removeUserVoice: (id: string) => Promise<void>;
  log: Logger;
}): Promise<void> {
  const { speakerSelection, renameUserVoice, removeUserVoice, log } = deps;
  const stale = speakerSelection
    .list()
    .filter((o) => o.source === "user" && !SERVER_VOICE_ID.test(o.id));
  for (const option of stale) {
    const id = voiceIdFromName(option.label ?? option.id);
    try {
      // A re-import of the same name already holds the id: keep it and drop the old voice.
      const duplicate = speakerSelection.list().some((o) => o.source === "user" && o.id === id);
      if (duplicate) {
        await removeUserVoice(option.id);
      } else {
        const ref_url = await renameUserVoice(option.id, id);
        speakerSelection.addUserOption({ ...option, id, ref_url });
      }
      if (speakerSelection.getActiveId() === option.id) speakerSelection.select(id);
      speakerSelection.removeUserOption(option.id);
      log.info("voice_id_migrated", { from: option.id, to: id, duplicate });
    } catch (err) {
      log.warn("voice_id_migration_failed", { id: option.id, error: String(err) });
    }
  }
}
