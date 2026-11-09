/**
 * The preset export panel: the inline group under the card section's action row that lists what
 * the `.yui` preset file carries, the rights check, and Cancel / Export…. It owns its subscriptions,
 * redraw and teardown.
 */

import type { AvatarOption } from "../../../../config/validators/avatar/types";
import type { VrmInspection } from "../../../../io/assets/preset-file/preset-file-export";
import type { SpeakerOption } from "../../../../io/voice/voices/speaker-selection";
import type { Logger } from "../../../../logger";
import type { PresetEntry } from "../../../../settings/preset/active-preset";
import { t } from "../../../i18n";
import { escapeAttr } from "../../markup";
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

export function presetExportPanelHtml(): string {
  const rights = escapeAttr(t("preset_export.rights"));
  return `
          <div class="yui-preset-export" hidden>
            <p class="yui-preset-export__title">${t("preset_export.title")}</p>
            <div class="yui-group yui-preset-export__items"></div>
            <p class="yui-sec__foot">${t("preset_export.foot")}</p>
            <div class="yui-group yui-preset-export__rights">
              <div class="yui-row">
                <div class="yui-row__main">
                  <span class="yui-row__label">${t("preset_export.rights")}</span>
                  <span class="yui-row__sub">${t("preset_export.rights_sub")}</span>
                </div>
                <button class="yui-switch" type="button" role="checkbox" aria-checked="false" aria-label="${rights}"></button>
              </div>
            </div>
            <div class="yui-preset-export__acts">
              <button class="yui-pill yui-preset-export__cancel" type="button">${t("preset_export.cancel")}</button>
              <button class="yui-pill yui-preset-export__go" type="button" disabled>${t("preset_export.go")}</button>
            </div>
          </div>`;
}

export function createPresetExportPanel(deps: {
  /** The `.yui-preset-export` element. */
  root: HTMLElement;
  vrmSelection: { getActive(): AvatarOption; subscribe: Subscribe<AvatarOption> };
  speakerSelection: { getActive(): SpeakerOption; subscribe: Subscribe<SpeakerOption> };
  /** The preset change notice; absent where the panel shows no preset strip. */
  registry?: { subscribe(cb: () => void): () => void };
  entry: () => PresetEntry;
  /** The name the card goes out under. */
  cardLabel: () => string;
  inspectPresetVrm: CardIoPorts["inspectPresetVrm"];
  /** Writes the preset file; true when it was saved. */
  exportPreset: (parts: PresetExportParts) => Promise<boolean>;
  log: Logger;
}): { open(): void; dispose(): void } {
  const { root } = deps;
  const items = root.querySelector<HTMLElement>(".yui-preset-export__items")!;
  const rights = root.querySelector<HTMLButtonElement>('[role="checkbox"]')!;
  const go = root.querySelector<HTMLButtonElement>(".yui-preset-export__go")!;
  // The last license read, keyed by VRM id; a read for another id is dropped when it lands.
  let inspected: { id: string; license: Inspected | null } | null = null;

  const vrmState = (vrm: AvatarOption): RowState => {
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

  function inspect(id: string): void {
    inspected = { id, license: null };
    deps.inspectPresetVrm(id).then(
      (r) => land(id, r.license),
      (err) => {
        deps.log.error("preset_vrm_inspect_failed", { error: String(err) });
        land(id, "unreadable");
      },
    );
  }
  function land(id: string, license: Inspected): void {
    if (inspected?.id !== id) return;
    inspected = { id, license };
    redraw();
  }

  /** The active VRM and voice as the request names them. */
  function parts(): PresetExportParts {
    const e = deps.entry();
    const vrm = deps.vrmSelection.getActive();
    const voice = deps.speakerSelection.getActive();
    return {
      ...(e.thumbnail ? { thumbnailPresetId: e.id, ...(e.crop ? { crop: e.crop } : {}) } : {}),
      // A VRM from the config file has no copy the receiver can resolve, so it stays out.
      ...(vrm.source === "user" || vrm.source === "bundled"
        ? { vrm: { kind: vrm.source, id: vrm.id } }
        : {}),
      ...(voice.source === "user" && voice.ref_url
        ? { voice: { id: voice.id, label: voice.label ?? voice.id } }
        : {}),
    };
  }

  function redraw(): void {
    if (root.hidden) return;
    const vrm = deps.vrmSelection.getActive();
    if (vrm.source === "user" && inspected?.id !== vrm.id) inspect(vrm.id);
    const p = parts();
    const included = t("preset_export.included");
    const rows: Row[] = [
      { label: t("preset_export.card"), tone: "in", status: included, sub: deps.cardLabel() },
      ...(p.thumbnailPresetId
        ? [{ label: t("preset_export.thumbnail"), tone: "in" as const, status: included }]
        : []),
      { label: t("preset_export.vrm"), ...vrmState(vrm) },
      p.voice
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
    items.replaceChildren(
      ...rows.map(({ label, tone, status, sub }) => {
        const row = document.createElement("div");
        row.className = "yui-row yui-preset-export__item";
        const main = document.createElement("div");
        main.className = "yui-row__main";
        const labelEl = document.createElement("span");
        labelEl.className = "yui-row__label";
        labelEl.textContent = label;
        main.append(labelEl);
        if (sub) {
          const subEl = document.createElement("span");
          subEl.className = tone === "in" ? "yui-row__sub" : `yui-row__sub is-${tone}`;
          subEl.textContent = sub;
          main.append(subEl);
        }
        const statusEl = document.createElement("span");
        statusEl.className = `yui-preset-export__status is-${tone}`;
        statusEl.textContent = status;
        row.append(main, statusEl);
        return row;
      }),
    );
    go.disabled = rights.getAttribute("aria-checked") !== "true";
  }

  function close(): void {
    root.hidden = true;
  }

  async function handleClick(e: MouseEvent): Promise<void> {
    const target = e.target as HTMLElement;
    if (target.closest('[role="checkbox"]')) {
      rights.setAttribute("aria-checked", String(rights.getAttribute("aria-checked") !== "true"));
      redraw();
    } else if (target.closest(".yui-preset-export__cancel")) {
      close();
    } else if (target.closest(".yui-preset-export__go") && !go.disabled) {
      go.disabled = true;
      if (await deps.exportPreset(parts())) close();
      else redraw();
    }
  }
  const onClick = (e: MouseEvent): void => void handleClick(e);

  const unsubscribes = [
    deps.vrmSelection.subscribe(redraw),
    deps.speakerSelection.subscribe(redraw),
    deps.registry?.subscribe(redraw),
  ];
  root.addEventListener("click", onClick);

  return {
    open(): void {
      rights.setAttribute("aria-checked", "false");
      inspected = null;
      root.hidden = false;
      redraw();
    },
    dispose(): void {
      for (const off of unsubscribes) off?.();
      root.removeEventListener("click", onClick);
    },
  };
}
