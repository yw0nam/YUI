/** The card's file row, its status lines and the preset export panel. */

import { useState, useSyncExternalStore } from "react";
import type { Logger } from "../../../../logger";
import { t } from "../../../i18n";
import { presetEntry } from "./card-entry";
import type { CardIo, CardIoPorts, CardLine } from "./card-io";
import { takeImportNotice } from "./card-io";
import { PresetExportPanel } from "./preset-export-panel";

export function CardFileRow({
  io,
  importBusy,
  hasPicture,
  cardLabel,
  vrmSelection,
  speakerSelection,
  inspectPresetVrm,
  log,
}: {
  io: CardIo;
  /** Whether this window's card import runs, and its changes. */
  importBusy: CardIoPorts["importBusy"];
  /** Whether the preset carries the picture the PNG export writes into. */
  hasPicture: boolean;
  /** The name the card goes out under. */
  cardLabel(): string;
  vrmSelection: Parameters<typeof PresetExportPanel>[0]["vrmSelection"];
  speakerSelection: Parameters<typeof PresetExportPanel>[0]["speakerSelection"];
  inspectPresetVrm: CardIoPorts["inspectPresetVrm"];
  log: Logger;
}) {
  const [line, setLine] = useState<CardLine | null>(null);
  const [panel, setPanel] = useState({ open: false, epoch: 0 });
  // The one-shot notice the import leaves for this mount.
  const [notice] = useState(takeImportNotice);
  const busy = useSyncExternalStore(importBusy.subscribe, importBusy.isBusy);

  async function importCard(): Promise<void> {
    const next = await io.importPreset();
    if (next) setLine(next);
  }

  async function exportPng(): Promise<void> {
    const next = await io.exportPng();
    if (next) setLine(next);
  }

  async function exportPreset(parts: Parameters<typeof io.exportPreset>[0]): Promise<boolean> {
    const next = await io.exportPreset(parts);
    if (next) setLine(next);
    return next !== null && !next.error;
  }

  return (
    <>
      <div className="yui-row yui-row--action yui-card__io">
        <button
          className="yui-link-btn yui-card-import"
          type="button"
          disabled={busy}
          onClick={() => void importCard()}
        >
          {t("card.import")}
        </button>
        <button
          className="yui-link-btn yui-card-export-preset"
          type="button"
          onClick={() => setPanel((p) => ({ open: true, epoch: p.epoch + 1 }))}
        >
          {t("card.export_preset")}
        </button>
        <button
          className="yui-link-btn yui-card-export-png"
          type="button"
          disabled={!hasPicture}
          onClick={() => void exportPng()}
        >
          {t("card.export_png")}
        </button>
      </div>
      <p className="yui-row__sub yui-card__io-note">
        {hasPicture ? t("card.io_note") : t("card.png_no_picture", { note: t("card.io_note") })}
      </p>
      <p className="yui-card__io-notice" hidden={!notice}>
        {t("card.import_voice_notice")}
      </p>
      <PresetExportPanel
        key={panel.epoch}
        open={panel.open}
        vrmSelection={vrmSelection}
        speakerSelection={speakerSelection}
        entry={presetEntry}
        cardLabel={cardLabel}
        inspectPresetVrm={inspectPresetVrm}
        onExport={exportPreset}
        onClose={() => setPanel((p) => ({ ...p, open: false }))}
        log={log}
      />
      <p className="yui-card__io-done" role="status" hidden={line?.error !== false}>
        {line?.error === false ? line.text : ""}
      </p>
      <p className="yui-card__io-error" role="status" hidden={line?.error !== true}>
        {line?.error === true ? line.text : ""}
      </p>
    </>
  );
}
