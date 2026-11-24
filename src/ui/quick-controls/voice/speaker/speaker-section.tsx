/** The Voice page's speaker list: the radiogroup of voices, the import row, and the paste-a-voice-id field. */

import type {
  createSpeakerSelection,
  SpeakerOption,
} from "../../../../io/voice/voices/speaker-selection";
import type { PickedVoiceImport } from "../../../../io/voice/voices/voice-import-flow";
import type { Logger } from "../../../../logger";
import { t } from "../../../i18n";
import { RenameInput } from "../../asset-list/rename-input";
import { useAssetList } from "../../asset-list/use-asset-list";
import type { Audition } from "./audition";
import { ManualVoiceId } from "./manual-voice-id";
import { heldElsewhere, removeSpeakerOption } from "./speaker-rules";
import "./speaker-list.css";
import { SpeakerRow } from "./speaker-row";
import { useAudition } from "./use-audition";
import { usePendingImport } from "./use-pending-import";
import { useReferenceRefresh } from "./use-reference-refresh";

export interface SpeakerSectionProps {
  speakerSelection: ReturnType<typeof createSpeakerSelection>;
  /** Perform the swap and commit the store on success. The list never selects on its own. */
  swapSpeaker: (option: SpeakerOption) => Promise<void>;
  /** Re-upload the speaker's reference clip. Server-side update only; the selection stays. */
  refreshSpeaker: (option: SpeakerOption) => Promise<void>;
  /** Import pick step: stages the copy, returns its staging id and a naming-row seed (null on cancel). */
  pickVoiceImport: () => Promise<PickedVoiceImport | null>;
  /** Import commit step: uploads the staged copy under the typed name, then adds the option and selects it. */
  commitVoiceImport: (stagedId: string, name: string) => Promise<void>;
  /** Delete an imported voice's app-data file (idempotent), before the store drops it. */
  removeVoice: (id: string) => Promise<void>;
  /** Whether the TTS provider takes imported voices: off hides delete and re-upload and disables import. */
  canManageVoices: () => boolean;
  /** Whether the TTS provider takes a clip again under the voice's own id: off hides re-upload. */
  canReuploadVoices: () => boolean;
  /** On shows the paste-a-voice-id field. */
  canPasteVoiceId: () => boolean;
  log: Logger;
  isOpen: () => boolean;
  /** Moves on each open; the list is read again and an armed remove drops. */
  revision: number;
  audition: Audition;
}

export function SpeakerSection({
  speakerSelection,
  swapSpeaker,
  refreshSpeaker,
  pickVoiceImport,
  commitVoiceImport,
  removeVoice,
  canManageVoices,
  canReuploadVoices,
  canPasteVoiceId,
  log,
  isOpen,
  revision,
  audition,
}: SpeakerSectionProps) {
  const list = useAssetList<SpeakerOption>({
    selection: speakerSelection,
    swap: swapSpeaker,
    removeFile: removeVoice,
    removeFromStore: (id) => removeSpeakerOption(speakerSelection, id),
    isOpen,
    revision,
    log,
    logPrefix: "voice",
    classPrefix: "yui-spk",
    datasetKey: "spkId",
  });
  const imports = usePendingImport({
    pickImport: pickVoiceImport,
    commitImport: commitVoiceImport,
    // A provider that keeps the caller's id files the clip under the name-derived id, which must not be another provider's voice.
    isImportBlocked: (id) => canReuploadVoices() && heldElsewhere(speakerSelection, id),
    hasId: (id) => list.options.some((o) => o.id === id),
    log,
    repaint: list.repaint,
  });
  const refreshes = useReferenceRefresh({ refreshSpeaker, log });
  const playingId = useAudition(audition, {
    swapping: list.swappingId !== null,
    ids: list.options.map((o) => o.id),
  });

  const managed = canManageVoices();
  const swapping = list.swappingId !== null;
  return (
    <div className="yui-group">
      <div className="yui-spk-scroll">
        <div
          ref={list.groupRef}
          className={swapping ? "yui-spks is-swapping" : "yui-spks"}
          role="radiogroup"
          aria-label={t("speaker.group_aria")}
          aria-busy={swapping ? "true" : undefined}
          onKeyDown={list.onKeyDown}
        >
          {list.options.map((option) => (
            <SpeakerRow
              key={option.id}
              option={option}
              list={list}
              managed={managed}
              canReupload={canReuploadVoices()}
              refreshState={refreshes.states[option.id]}
              playing={playingId === option.id}
              onRefresh={(o) => void refreshes.refresh(o)}
              onToggleAudition={(o) => audition.toggle(o.id, o.ref_url)}
            />
          ))}
          {imports.pending !== null && !imports.committing && (
            <div className="yui-spk yui-spk--renaming">
              <RenameInput
                label={imports.pending.seedName}
                classPrefix="yui-spk"
                namespace="speaker"
                onCommit={imports.commit}
                onCancel={imports.cancel}
                warnFor={imports.warnFor}
              />
            </div>
          )}
          {imports.committing && (
            <div className="yui-spk__loading" role="status">
              <span className="yui-spk__spin" aria-hidden="true" />
              <span className="yui-spk__loading-name">{t("speaker.loading")}</span>
            </div>
          )}
        </div>
      </div>
      <div className="yui-spk-foot">
        <ManualVoiceId speakerSelection={speakerSelection} hidden={!canPasteVoiceId()} />
        <button
          className={managed ? "yui-spk yui-spk--add is-ready" : "yui-spk yui-spk--add"}
          type="button"
          disabled={!managed}
          onClick={() => void imports.start()}
        >
          <span className="yui-spk__tick" aria-hidden="true" />
          <span className="yui-spk__body">
            <span className="yui-spk__name">{t("speaker.add")}</span>
          </span>
        </button>
        <p className="yui-spk__import-error" role="status" hidden={!imports.importError}>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="10" />
            <path d="M12 8v4M12 16h.01" />
          </svg>
          <span>{t("speaker.import_error")}</span>
        </p>
      </div>
    </div>
  );
}
