/**
 * The preset export panel: the inline group under the card section's action row that lists what
 * the `.yui` preset file carries, the rights check, and Cancel / Export….
 */

import { useEffect, useState } from "react";
import type { AvatarOption } from "../../../../config/validators/avatar/types";
import type { VrmInspection } from "../../../../io/assets/preset-file/preset-file-export";
import type { SpeakerOption } from "../../../../io/voice/voices/speaker-selection";
import type { Logger } from "../../../../logger";
import type { PresetEntry } from "../../../../settings/preset/active-preset";
import { t } from "../../../i18n";
import { useSnapshot } from "../../../use-snapshot/use-snapshot";
import type { CardIoPorts, PresetExportParts } from "./card-io";
import "./preset-export-panel.css";

type Subscribe<T> = (cb: (active: T) => void) => () => void;
type Tone = "in" | "out" | "warn";
type Inspected = VrmInspection["license"] | "unreadable";
/** What one listed row says: its status word, the ink, and the optional sub-line. */
interface RowState {
  tone: Tone;
  status: string;
  sub?: string;
}
interface Row extends RowState {
  label: string;
}

/** Each license read as its tone, status key and reason key; no reason shows the VRM's label. */
const VRM_STATUS: Record<Inspected, { tone: Tone; status: string; reason?: string }> = {
  allowed: { tone: "in", status: "preset_export.included" },
  prohibited: {
    tone: "out",
    status: "preset_export.left_out",
    reason: "preset_export.vrm_prohibited",
  },
  unknown: {
    tone: "warn",
    status: "preset_export.check_needed",
    reason: "preset_export.vrm_unknown",
  },
  unreadable: {
    tone: "out",
    status: "preset_export.left_out",
    reason: "preset_export.vrm_unreadable",
  },
};

export function PresetExportPanel({
  open,
  vrmSelection,
  speakerSelection,
  entry,
  cardLabel,
  inspectPresetVrm,
  onExport,
  onClose,
  log,
}: {
  open: boolean;
  vrmSelection: { getActive(): AvatarOption; subscribe: Subscribe<AvatarOption> };
  speakerSelection: { getActive(): SpeakerOption; subscribe: Subscribe<SpeakerOption> };
  /** The preset this window edits. */
  entry: () => PresetEntry;
  /** The name the card goes out under. */
  cardLabel: () => string;
  inspectPresetVrm: CardIoPorts["inspectPresetVrm"];
  /** Writes the preset file; true when it was saved. */
  onExport(parts: PresetExportParts): Promise<boolean>;
  onClose(): void;
  log: Logger;
}) {
  // Both selections clone on read, so the snapshot keeps the value until the source notifies.
  const vrm = useSnapshot(vrmSelection.getActive, vrmSelection.subscribe);
  const voice = useSnapshot(speakerSelection.getActive, speakerSelection.subscribe);
  const [rights, setRights] = useState(false);
  // The last license read, keyed by VRM id; a read for another id is dropped when it lands.
  const [inspected, setInspected] = useState<{ id: string; license: Inspected | null } | null>(
    null,
  );
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (!open || vrm.source !== "user" || inspected?.id === vrm.id) return;
    const id = vrm.id;
    setInspected({ id, license: null });
    inspectPresetVrm(id).then(
      (r) => setInspected((cur) => (cur?.id === id ? { id, license: r.license } : cur)),
      (err) => {
        log.error("preset_vrm_inspect_failed", { error: String(err) });
        setInspected((cur) => (cur?.id === id ? { id, license: "unreadable" } : cur));
      },
    );
  }, [open, vrm, inspected, inspectPresetVrm, log]);

  const vrmState = (): RowState => {
    const label = vrm.label ?? vrm.id;
    if (vrm.source === "bundled")
      return { tone: "in", status: t("preset_export.built_in"), sub: label };
    if (vrm.source !== "user")
      return {
        tone: "out",
        status: t("preset_export.left_out"),
        sub: t("preset_export.vrm_config"),
      };
    const license = inspected?.id === vrm.id ? inspected.license : null;
    if (!license) return { tone: "in", status: "", sub: label };
    const { tone, status, reason } = VRM_STATUS[license];
    return { tone, status: t(status), sub: reason ? t(reason) : label };
  };

  /** The active VRM and voice as the request names them. */
  function parts(): PresetExportParts {
    const e = entry();
    return {
      ...(e.thumbnail ? { thumbnailPresetId: e.id, ...(e.crop ? { crop: e.crop } : {}) } : {}),
      // A VRM from the config file has no copy the receiver can resolve, so it stays out.
      ...(vrm.source === "user"
        ? { vrm: { kind: "user", id: vrm.id, label: vrm.label || vrm.id } }
        : vrm.source === "bundled"
          ? { vrm: { kind: "bundled", id: vrm.id } }
          : {}),
      ...(voice.source === "user" && voice.ref_url
        ? { voice: { id: voice.id, label: voice.label ?? voice.id } }
        : {}),
    };
  }

  const included = t("preset_export.included");
  const request = parts();
  const rows: Row[] = [
    { label: t("preset_export.card"), tone: "in", status: included, sub: cardLabel() },
    ...(request.thumbnailPresetId
      ? [{ label: t("preset_export.thumbnail"), tone: "in" as const, status: included }]
      : []),
    { label: t("preset_export.vrm"), ...vrmState() },
    request.voice
      ? {
          label: t("preset_export.voice"),
          tone: "in",
          status: included,
          sub: t("preset_export.voice_in"),
        }
      : {
          label: t("preset_export.voice"),
          tone: "out",
          status: t("preset_export.left_out"),
          sub: t("preset_export.voice_no_clip"),
        },
  ];

  async function exportNow(): Promise<void> {
    if (rights !== true || exporting) return;
    setExporting(true);
    if (await onExport(request)) onClose();
    else setExporting(false);
  }

  return (
    <div className="yui-preset-export" hidden={!open}>
      <p className="yui-preset-export__title">{t("preset_export.title")}</p>
      <div className="yui-group yui-preset-export__items">
        {rows.map(({ label, tone, status, sub }) => (
          <div className="yui-row yui-preset-export__item" key={label}>
            <div className="yui-row__main">
              <span className="yui-row__label">{label}</span>
              {sub && (
                <span className={tone === "in" ? "yui-row__sub" : `yui-row__sub is-${tone}`}>
                  {sub}
                </span>
              )}
            </div>
            <span className={`yui-preset-export__status is-${tone}`}>{status}</span>
          </div>
        ))}
      </div>
      <p className="yui-sec__foot">{t("preset_export.foot")}</p>
      <div className="yui-group yui-preset-export__rights">
        <div className="yui-row">
          <div className="yui-row__main">
            <span className="yui-row__label">{t("preset_export.rights")}</span>
            <span className="yui-row__sub">{t("preset_export.rights_sub")}</span>
          </div>
          {/* biome-ignore lint/a11y/useSemanticElements: the rights control is a switch-styled button */}
          <button
            className="yui-switch"
            type="button"
            role="checkbox"
            aria-checked={rights}
            aria-label={t("preset_export.rights")}
            onClick={() => setRights((r) => !r)}
          />
        </div>
      </div>
      <div className="yui-preset-export__acts">
        <button className="yui-pill yui-preset-export__cancel" type="button" onClick={onClose}>
          {t("preset_export.cancel")}
        </button>
        <button
          className="yui-pill yui-preset-export__go"
          type="button"
          disabled={exporting || !rights}
          onClick={() => void exportNow()}
        >
          {t("preset_export.go")}
        </button>
      </div>
    </div>
  );
}
