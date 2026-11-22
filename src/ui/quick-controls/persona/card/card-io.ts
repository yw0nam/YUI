/**
 * The card section's file actions: the import round trip, the PNG card export, the preset file
 * export the panel asks for, the one-shot import notice, and the logs. The DOM that shows the
 * outcome belongs to the card view.
 */

import { toV2Envelope } from "../../../../config/validators/persona/serialize-card";
import type { Card } from "../../../../config/validators/persona/types";
import { sanitizeFileStem } from "../../../../io/assets/card/card-export";
import type {
  PresetExportRequest,
  PresetFileExportResult,
  VrmInspection,
} from "../../../../io/assets/preset-file/preset-file-export";
import { cardName } from "../../../../io/chat/card/resolve-card";
import type { Logger } from "../../../../logger";
import { extensionsWithActiveHours } from "../../../../settings/active-hours/card-active-hours";
import type { Span } from "../../../../settings/active-hours/spans";
import { extensionsWithFiller } from "../../../../settings/voice/card-filler";
import type { FillerSettings } from "../../../../settings/voice/filler-settings";
import { t } from "../../../i18n";

/** The one-shot notice the card reads on its next mount, after the import's activation reload. */
export const CARD_IMPORT_NOTICE_KEY = "yui.card-import-notice";

/** The import errors that mean the file holds no card this client reads. */
const UNREADABLE_ERRORS = new Set(["card_unreadable", "no card in png", "preset file unreadable"]);

export interface CardIoPorts {
  /** Runs the whole card import through preset creation; null when the picker was dismissed. */
  importPreset: () => Promise<{ presetId: string } | null | "busy">;
  /** Runs the whole import of one dropped file through preset creation. */
  importDroppedPreset: () => Promise<{ presetId: string } | null | "busy">;
  /** Whether this window's one card import is running, and its changes. */
  importBusy: { isBusy(): boolean; subscribe(listener: () => void): () => void };
  /** Opens the `.yui` save dialog; "cancelled" when dismissed. */
  exportPresetFile: (request: PresetExportRequest) => Promise<PresetFileExportResult>;
  /** Writes the card text into the preset's PNG; "cancelled" when dismissed. */
  exportCardPng: (
    defaultName: string,
    cardJson: string,
    presetId: string,
  ) => Promise<"written" | "cancelled">;
  /** Reads a user VRM's license and size before an export offers it. */
  inspectPresetVrm: (id: string) => Promise<VrmInspection>;
  removeCardThumbnail: (id: string) => Promise<void>;
  /** Absent outside Tauri, where there is no native picker. */
  pickPresetPhoto?: (presetId: string) => Promise<string | null>;
}

/** The parts of a `.yui` request the panel chooses; the card text and file name come from here. */
export type PresetExportParts = Omit<PresetExportRequest, "defaultName" | "cardJson">;

/** What one file action leaves on the card's status row. */
export interface CardLine {
  /** True for the error line, false for the done line. */
  error: boolean;
  text: string;
}

export interface CardIo {
  /** Runs the picker's import; an error line, or null when it imported or was dismissed. */
  importPreset(): Promise<CardLine | null>;
  /** Writes the preset's PNG card; the line to show, or null when the dialog was dismissed. */
  exportPng(): Promise<CardLine | null>;
  /** Writes the preset file; the line to show, or null when the dialog was dismissed. */
  exportPreset(parts: PresetExportParts): Promise<CardLine | null>;
  /** True while an import (picker or drop) runs in this window. */
  isImporting(): boolean;
  /** Imports one dropped file under the window's one-at-a-time rule; the drop cover shows the outcome. */
  importDropped(): Promise<"imported" | "busy" | "unreadable" | "failed">;
}

/** Reads the one-shot voice notice the import leaves behind, and removes the key. */
export function takeImportNotice(): boolean {
  const notice = sessionStorage.getItem(CARD_IMPORT_NOTICE_KEY);
  sessionStorage.removeItem(CARD_IMPORT_NOTICE_KEY);
  return notice === "voice";
}

export function createCardIo(deps: {
  ports: Pick<
    CardIoPorts,
    "importPreset" | "importDroppedPreset" | "importBusy" | "exportPresetFile" | "exportCardPng"
  >;
  currentCard: () => Card;
  entry: () => { id: string; name: string };
  /** The active preset's custom filler pools, carried in the export's extensions.yui. */
  fillerPools: () => FillerSettings["customPools"];
  /** The edited active-hours spans the export writes beside them; null keeps the card's own key. */
  activeHoursSpans: () => Span[] | null;
  log: Logger;
}): CardIo {
  /** The V2 envelope with the filler pools merged, and the file stem it is saved under. */
  function cardText(): { json: string; stem: string } {
    const card = deps.currentCard();
    const name = cardName(card, deps.entry());
    const envelope = toV2Envelope(card, name);
    envelope.data.extensions = extensionsWithFiller(
      envelope.data.extensions as Record<string, unknown>,
      deps.fillerPools(),
    );
    envelope.data.extensions = extensionsWithActiveHours(
      envelope.data.extensions as Record<string, unknown>,
      deps.activeHoursSpans(),
    );
    return { json: JSON.stringify(envelope), stem: sanitizeFileStem(name) };
  }

  async function exportWith(write: () => Promise<string | null>): Promise<CardLine | null> {
    try {
      const text = await write();
      if (text === null) return null;
      deps.log.info("card_export");
      return { error: false, text };
    } catch (err) {
      deps.log.error("card_export_failed", { error: String(err) });
      return { error: true, text: t("card.export_error") };
    }
  }

  /** Runs one import port; the windows reload into the new preset right after, so the log line is the record. */
  async function runImport<Skip extends null | "busy">(
    port: () => Promise<{ presetId: string } | Skip>,
  ): Promise<Skip | "imported" | "unreadable" | "failed"> {
    try {
      const imported = await port();
      if (imported === null || imported === "busy") return imported;
      deps.log.info("card_import", { preset: imported.presetId });
      return "imported";
    } catch (err) {
      deps.log.error("card_import_failed", { error: String(err) });
      const name = err instanceof Error ? err.message : String(err);
      // Only an unreadable payload means the file holds no card; everything else is a failure.
      return UNREADABLE_ERRORS.has(name) ? "unreadable" : "failed";
    }
  }

  return {
    async importPreset(): Promise<CardLine | null> {
      const outcome = await runImport(deps.ports.importPreset);
      // An import that ran reloads the windows into the new preset, so it leaves no line.
      if (outcome !== "unreadable" && outcome !== "failed") return null;
      return {
        error: true,
        text: t(outcome === "unreadable" ? "card.import_error" : "card.import_failed"),
      };
    },

    exportPng(): Promise<CardLine | null> {
      return exportWith(async () => {
        const { json, stem } = cardText();
        const result = await deps.ports.exportCardPng(`${stem}.png`, json, deps.entry().id);
        return result === "written" ? t("card.export_saved") : null;
      });
    },

    exportPreset(parts: PresetExportParts): Promise<CardLine | null> {
      return exportWith(async () => {
        const { json, stem } = cardText();
        const result = await deps.ports.exportPresetFile({
          defaultName: `${stem}.yui`,
          cardJson: json,
          ...parts,
        });
        if (result === "cancelled") return null;
        return t(
          parts.vrm && !result.vrmIncluded ? "card.export_saved_vrm_out" : "card.export_saved",
        );
      });
    },

    isImporting: () => deps.ports.importBusy.isBusy(),

    // A dropped file has no picker to dismiss, so a null result is a failure.
    importDropped: async () => (await runImport(deps.ports.importDroppedPreset)) ?? "failed",
  };
}
