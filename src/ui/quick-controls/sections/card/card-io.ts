/**
 * The card section's file actions: the import round trip, the PNG card export, the preset file
 * export the panel asks for, the inline status lines, and the logs. The section wires the clicks.
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
import { extensionsWithFiller } from "../../../../settings/voice/card-filler";
import type { FillerSettings } from "../../../../settings/voice/filler-settings";
import { t } from "../../../i18n";

/** The one-shot notice the section reads on its next mount, after the import's activation reload. */
export const CARD_IMPORT_NOTICE_KEY = "yui.card-import-notice";

/** The import errors that mean the file holds no card this client reads. */
const UNREADABLE_ERRORS = new Set(["card_unreadable", "no card in png", "preset file unreadable"]);

export interface CardIoPorts {
  /** Runs the whole card import through preset creation; null when the picker was dismissed. */
  importPreset: () => Promise<{ presetId: string } | null>;
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

export interface CardIo {
  importPreset(): Promise<void>;
  exportPng(): Promise<void>;
  /** Writes the preset file; true when it was saved. */
  exportPreset(parts: PresetExportParts): Promise<boolean>;
}

export function createCardIo(deps: {
  errorEl: HTMLElement;
  doneEl: HTMLElement;
  ports: Pick<CardIoPorts, "importPreset" | "exportPresetFile" | "exportCardPng">;
  currentCard: () => Card;
  entry: () => { id: string; name: string };
  /** The active preset's custom filler pools, carried in the export's extensions.yui. */
  fillerPools: () => FillerSettings["customPools"];
  log: Logger;
}): CardIo {
  const show = (el: HTMLElement, message: string): void => {
    el.textContent = message;
    el.hidden = false;
  };
  const clear = (): void => {
    for (const el of [deps.errorEl, deps.doneEl]) {
      el.hidden = true;
      el.textContent = "";
    }
  };

  /** The V2 envelope with the filler pools merged, and the file stem it is saved under. */
  function cardText(): { json: string; stem: string } {
    const card = deps.currentCard();
    const name = cardName(card, deps.entry());
    const envelope = toV2Envelope(card, name);
    envelope.data.extensions = extensionsWithFiller(
      envelope.data.extensions as Record<string, unknown>,
      deps.fillerPools(),
    );
    return { json: JSON.stringify(envelope), stem: sanitizeFileStem(name) };
  }

  async function exportWith(write: () => Promise<string | null>): Promise<boolean> {
    try {
      const line = await write();
      if (line === null) return false;
      clear();
      show(deps.doneEl, line);
      deps.log.info("card_export");
      return true;
    } catch (err) {
      clear();
      show(deps.errorEl, t("card.export_error"));
      deps.log.error("card_export_failed", { error: String(err) });
      return false;
    }
  }

  return {
    async importPreset(): Promise<void> {
      try {
        const imported = await deps.ports.importPreset();
        if (!imported) return;
        clear();
        // The windows reload into the new preset right after; the log line is the record.
        deps.log.info("card_import", { preset: imported.presetId });
      } catch (err) {
        const name = err instanceof Error ? err.message : String(err);
        clear();
        // Only an unreadable payload means the file holds no card; everything else is a failure.
        show(
          deps.errorEl,
          t(UNREADABLE_ERRORS.has(name) ? "card.import_error" : "card.import_failed"),
        );
        deps.log.error("card_import_failed", { error: String(err) });
      }
    },

    async exportPng(): Promise<void> {
      await exportWith(async () => {
        const { json, stem } = cardText();
        const result = await deps.ports.exportCardPng(`${stem}.png`, json, deps.entry().id);
        return result === "written" ? t("card.export_saved") : null;
      });
    },

    exportPreset(parts: PresetExportParts): Promise<boolean> {
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
  };
}
