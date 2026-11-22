/** The Voice page's speaker list: the radiogroup of voices, the import row, and the paste-a-voice-id field. */

import { useEffect } from "react";
import { voiceIdFromName } from "../../../../io/assets/safe-id";
import type {
  createSpeakerSelection,
  SpeakerOption,
} from "../../../../io/voice/voices/speaker-selection";
import type { Logger } from "../../../../logger";
import { t } from "../../../i18n";
import { RenameInput } from "../../asset-list/rename-input";
import { useAssetList } from "../../asset-list/use-asset-list";
import { ManualVoiceId } from "./manual-voice-id";
import "./speaker-list.css";
import { SpeakerRow } from "./speaker-row";
import { useAudition } from "./use-audition";
import { type PendingImport, usePendingImport } from "./use-pending-import";
import { useReferenceRefresh } from "./use-reference-refresh";

/** The page's handle on the audition, so the panel's close can stop it. */
export interface AuditionPort {
  stop: (() => void) | null;
}

export interface SpeakerSectionProps {
  speakerSelection: ReturnType<typeof createSpeakerSelection>;
  /** Perform the swap and commit the store on success. The list never selects on its own. */
  swapSpeaker: (option: SpeakerOption) => Promise<void>;
  /** Re-upload the speaker's reference clip. Server-side update only; the selection stays. */
  refreshSpeaker: (option: SpeakerOption) => Promise<void>;
  /** Import pick step: stages the copy, returns its staging id and a naming-row seed (null on cancel). */
  pickVoiceImport: () => Promise<PendingImport | null>;
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
  refreshTooltip?: () => void;
  isOpen: () => boolean;
  /** Moves on each open; the list is read again and an armed remove drops. */
  revision: number;
  audition: AuditionPort;
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
  refreshTooltip,
  isOpen,
  revision,
  audition: port,
}: SpeakerSectionProps) {
  const list = useAssetList<SpeakerOption>({
    selection: speakerSelection,
    swap: swapSpeaker,
    removeFile: removeVoice,
    // The server owns every voice; a user-imported one also has a local clip and a store entry.
    removeFromStore: (id) => {
      const source = speakerSelection.list().find((o) => o.id === id)?.source;
      if (source === "user") speakerSelection.removeUserOption(id);
      else speakerSelection.removeBundledOption(id);
    },
    isOpen,
    revision,
    log,
    logPrefix: "voice",
    refreshTooltip,
    classPrefix: "yui-spk",
    datasetKey: "spkId",
  });
  // An id one of another provider's voices holds is not taken over.
  const heldElsewhere = (id: string): boolean =>
    speakerSelection.listUser().some((o) => o.id === id) &&
    !speakerSelection.list().some((o) => o.id === id);
  const imports = usePendingImport({
    pickImport: pickVoiceImport,
    commitImport: commitVoiceImport,
    deriveId: voiceIdFromName,
    // A provider that keeps the caller's id (the one re-upload needs) files the clip under the
    // name-derived id, so that id must not be another provider's voice.
    isImportBlocked: (id) => canReuploadVoices() && heldElsewhere(id),
    hasId: (id) => list.options.some((o) => o.id === id),
    log,
    logPrefix: "voice",
    namespace: "speaker",
    repaint: list.repaint,
  });
  const refreshes = useReferenceRefresh({ refreshSpeaker, log });
  const audition = useAudition();

  // A swap hides the busy row's preview button, and a removed row loses its clip: the clip stops.
  const { playingId, stop: stopAudition } = audition;
  const playingGone = playingId !== null && !list.options.some((o) => o.id === playingId);
  const swapStarted = list.swappingId !== null;
  useEffect(() => {
    if (swapStarted || playingGone) stopAudition();
  }, [swapStarted, playingGone, stopAudition]);
  useEffect(() => {
    port.stop = stopAudition;
    return () => {
      port.stop = null;
    };
  }, [port, stopAudition]);

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
