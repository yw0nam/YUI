/**
 * The card section's import and export actions: the pick/create/save round trips, the
 * inline error line, and the logs. The section wires the clicks and owns the redraw.
 */

import { toV2Envelope } from "../../../../config/validators/persona/serialize-card";
import type { Card } from "../../../../config/validators/persona/types";
import { sanitizeFileStem } from "../../../../io/assets/card/card-export";
import type { ImportedCard } from "../../../../io/assets/card/card-import";
import { cardName } from "../../../../io/chat/card/resolve-card";
import type { Logger } from "../../../../logger";
import { t } from "../../../i18n";

export interface CardIoPorts {
  importCard: () => Promise<ImportedCard | null>;
  exportCard: (text: string, fileName: string) => Promise<"written" | "cancelled">;
  createPresetFromCard: (card: Card, thumbnailTempId?: string) => Promise<string>;
}

export interface CardIo {
  /** Runs the import or export when the click sits on one of the action buttons. */
  handle(e: MouseEvent): void;
}

export function createCardIo(deps: {
  errorEl: HTMLElement;
  ports: CardIoPorts;
  currentCard: () => Card;
  entry: () => { id: string; name: string };
  log: Logger;
}): CardIo {
  const showError = (message: string): void => {
    deps.errorEl.textContent = message;
    deps.errorEl.hidden = false;
  };
  const clearError = (): void => {
    deps.errorEl.hidden = true;
    deps.errorEl.textContent = "";
  };

  async function handleImport(): Promise<void> {
    try {
      const imported = await deps.ports.importCard();
      if (!imported) return;
      const id = await deps.ports.createPresetFromCard(imported.card, imported.thumbnailTempId);
      clearError();
      // The windows reload into the new preset right after; the log line is the record.
      deps.log.info("card_import", { preset: id });
    } catch (err) {
      const name = err instanceof Error ? err.message : String(err);
      // Only an unreadable payload means the file holds no card; everything else is a failure.
      showError(
        t(
          name === "card_unreadable" || name === "no card in png"
            ? "card.import_error"
            : "card.import_failed",
        ),
      );
      deps.log.error("card_import_failed", { error: String(err) });
    }
  }

  async function handleExport(): Promise<void> {
    try {
      const card = deps.currentCard();
      const name = cardName(card, deps.entry());
      const result = await deps.ports.exportCard(
        JSON.stringify(toV2Envelope(card, name)),
        `${sanitizeFileStem(name)}.json`,
      );
      if (result === "written") {
        clearError();
        deps.log.info("card_export");
      }
    } catch (err) {
      showError(t("card.export_error"));
      deps.log.error("card_export_failed", { error: String(err) });
    }
  }

  return {
    handle(e: MouseEvent): void {
      const target = e.target as HTMLElement;
      if (target.closest(".yui-card-import")) void handleImport();
      else if (target.closest(".yui-card-export")) void handleExport();
    },
  };
}
