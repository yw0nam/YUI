/**
 * Moves each imported voice persisted under an id outside the TTS server's `[A-Za-z0-9_-]`
 * charset to the id an import of its label gets today, so the voice-list self-heal can upload it.
 * The label, selection and clip carry over; an entry whose rename fails stays as it is.
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
  log: Logger;
}): Promise<void> {
  const { speakerSelection, renameUserVoice, log } = deps;
  const stale = speakerSelection
    .list()
    .filter((o) => o.source === "user" && !SERVER_VOICE_ID.test(o.id));
  for (const option of stale) {
    const id = voiceIdFromName(option.label ?? option.id);
    try {
      const ref_url = await renameUserVoice(option.id, id);
      const wasActive = speakerSelection.getActiveId() === option.id;
      speakerSelection.addUserOption({
        ...option,
        id,
        ref_url,
        revision: (option.revision ?? 0) + 1,
      });
      if (wasActive) speakerSelection.select(id);
      speakerSelection.removeUserOption(option.id);
      log.info("voice_id_migrated", { from: option.id, to: id });
    } catch (err) {
      log.warn("voice_id_migration_failed", { id: option.id, error: String(err) });
    }
  }
}
