/**
 * The photo dialog — a modal `<dialog>` that frames a preset's photo under a circular mask
 * with live previews at the sizes a face is drawn. "Use photo" saves the framing; Cancel and Escape
 * save nothing beyond the framing of a photo just picked.
 */

import "./photo-dialog.css";
import { loadPhotoSize } from "../../../../io/assets/card/photo-size";
import type { Logger } from "../../../../logger";
import type { PresetEntry } from "../../../../settings/preset/active-preset";
import {
  defaultCrop,
  faceCrop,
  type PhotoCrop,
  type PhotoSize,
  wholeCrop,
} from "../../../../settings/preset/photo-crop";
import { t } from "../../../i18n";
import { applyCrop, avatarEl } from "../../../unified/avatar";
import {
  CIRCLE,
  clampStage,
  cropOf,
  MARGIN,
  MAX_ZOOM,
  MIN_ZOOM,
  STAGE,
  type Stage,
  stageOf,
  zoomAbout,
} from "./crop-stage";

/** The sizes a face is drawn at, with the place each one shows. */
const PREVIEWS = [
  { px: 36, where: "photo.at_card" },
  { px: 28, where: "photo.at_header" },
  { px: 22, where: "photo.at_chat" },
  { px: 20, where: "photo.at_plate" },
];

/** The newest write per preset; a pick's default framing that resolves after a later write is dropped. */
const writes = new Map<string, number>();
const bumpWrite = (id: string): number => {
  const n = (writes.get(id) ?? 0) + 1;
  writes.set(id, n);
  return n;
};

export interface PhotoDialogDeps {
  entry: PresetEntry;
  url: string;
  /** The URL was just picked and stored with no crop: its default framing is saved once measured. */
  picked: boolean;
  pick: () => Promise<string | null>;
  save: (url: string, crop: PhotoCrop) => void;
  /** Stores a newly picked URL with no crop. */
  saveUrl: (url: string) => void;
  log: Logger;
  measure?: (url: string) => Promise<PhotoSize>;
}

export function openPhotoDialog(deps: PhotoDialogDeps): void {
  const { entry, log } = deps;
  const measure = deps.measure ?? loadPhotoSize;
  const dialog = document.createElement("dialog");
  dialog.className = "yui-photo-dialog";
  dialog.setAttribute("aria-labelledby", "yui-photo-dialog-title");
  dialog.innerHTML = `
    <div class="yui-photo-dialog__head"><h2 id="yui-photo-dialog-title"></h2><span>${t("photo.hint")}</span></div>
    <div class="yui-photo-dialog__body">
      <div class="yui-photo-dialog__stagecol">
        <div class="yui-photo-dialog__stage"><img alt="" draggable="false" hidden /><div class="yui-photo-dialog__mask" aria-hidden="true"></div></div>
        <label class="yui-photo-dialog__zoom"><span>${t("photo.zoom")}</span><input class="yui-gain__slider" type="range" step="5" /><output></output></label>
        <div class="yui-photo-dialog__tools">
          <button class="yui-pill" type="button" data-act="face">${t("photo.fit_face")}</button>
          <button class="yui-pill" type="button" data-act="whole">${t("photo.whole")}</button>
          <button class="yui-pill" type="button" data-act="choose">${t("photo.choose")}</button>
        </div>
        <p class="yui-photo-dialog__error" role="status" hidden>${t("preset.photo_failed")}</p>
      </div>
      <div class="yui-photo-dialog__where"><h3>${t("photo.where")}</h3><div class="yui-photo-dialog__previews"></div></div>
    </div>
    <div class="yui-photo-dialog__foot">
      <button class="yui-pill" type="button" data-act="cancel">${t("photo.cancel")}</button>
      <button class="yui-pill yui-photo-dialog__use" type="button" data-act="use" disabled>${t("photo.use")}</button>
    </div>`;
  dialog.querySelector("h2")!.textContent = t("preset.photo", { name: entry.name });
  for (const [name, px] of [
    ["stage", STAGE],
    ["margin", MARGIN],
    ["circle", CIRCLE],
  ] as const)
    dialog.style.setProperty(`--yui-photo-${name}`, `${px}px`);
  const q = <T extends HTMLElement>(sel: string): T => dialog.querySelector<T>(sel)!;
  const stageEl = q(".yui-photo-dialog__stage");
  const img = q<HTMLImageElement>(".yui-photo-dialog__stage > img");
  const slider = q<HTMLInputElement>('input[type="range"]');
  const zoomOut = q<HTMLOutputElement>("output");
  const errorEl = q(".yui-photo-dialog__error");
  const previewsEl = q(".yui-photo-dialog__previews");
  slider.min = String(MIN_ZOOM * 100);
  slider.max = String(MAX_ZOOM * 100);
  slider.value = slider.min;
  const btn = (act: string) => q<HTMLButtonElement>(`[data-act=${act}]`);

  let url = deps.url;
  let size: PhotoSize | null = null;
  let stage: Stage | null = null;
  let picking = false;
  let measuring = false;
  let previewImgs: HTMLImageElement[] = [];

  function syncButtons(): void {
    btn("choose").disabled = picking || measuring;
    btn("use").disabled = size === null;
  }

  function setStage(next: Stage): void {
    if (!size) return;
    stage = next;
    const s = (next.zoom * CIRCLE) / Math.min(size.width, size.height);
    img.style.width = `${size.width * s}px`;
    img.style.left = `${next.left}px`;
    img.style.top = `${next.top}px`;
    slider.value = String(Math.round(next.zoom * 100));
    slider.style.setProperty("--fill", String((next.zoom - MIN_ZOOM) / (MAX_ZOOM - MIN_ZOOM)));
    zoomOut.textContent = `${next.zoom.toFixed(1)}×`;
    const crop = cropOf(next, size);
    for (const p of previewImgs) applyCrop(p, crop);
  }

  function buildPreviews(): void {
    previewsEl.replaceChildren(
      ...PREVIEWS.map(({ px, where }) => {
        const row = document.createElement("div");
        row.className = "yui-photo-dialog__preview";
        const face = avatarEl({ ...entry, thumbnail: url, crop: undefined }, px);
        const caption = document.createElement("span");
        caption.textContent = `${t(where)} · ${px} px`;
        row.append(face, caption);
        return row;
      }),
    );
    previewImgs = [...previewsEl.querySelectorAll("img")];
  }

  async function load(next: string, picked: boolean): Promise<void> {
    url = next;
    size = null;
    measuring = true;
    errorEl.hidden = true;
    syncButtons();
    const mine = picked ? bumpWrite(entry.id) : 0;
    const superseded = (): boolean => picked && writes.get(entry.id) !== mine;
    let measured: PhotoSize;
    try {
      measured = await measure(next);
    } catch {
      if (superseded()) return;
      measuring = false;
      img.hidden = true;
      previewsEl.replaceChildren();
      previewImgs = [];
      errorEl.hidden = false;
      syncButtons();
      return;
    }
    if (superseded()) return;
    if (picked) deps.save(next, defaultCrop(measured));
    size = measured;
    measuring = false;
    img.src = next;
    img.hidden = false;
    buildPreviews();
    setStage(stageOf((!picked && entry.crop) || defaultCrop(measured), measured));
    syncButtons();
  }

  btn("face").addEventListener("click", () => size && setStage(stageOf(faceCrop(size), size)));
  btn("whole").addEventListener("click", () => size && setStage(stageOf(wholeCrop(size), size)));
  btn("choose").addEventListener("click", () => {
    picking = true;
    syncButtons();
    deps
      .pick()
      .then((picked) => {
        picking = false;
        if (picked === null) return syncButtons();
        deps.saveUrl(picked);
        return load(picked, true);
      })
      .catch((error) => {
        picking = false;
        errorEl.hidden = false;
        syncButtons();
        log.warn("photo_pick_failed", { preset: entry.id, error: String(error) });
      });
  });
  btn("cancel").addEventListener("click", () => dialog.close());
  btn("use").addEventListener("click", () => {
    if (!size || !stage) return;
    bumpWrite(entry.id);
    deps.save(url, cropOf(stage, size));
    dialog.close();
  });
  slider.addEventListener("input", () => {
    if (size && stage) setStage(zoomAbout(stage, Number(slider.value) / 100, size));
  });

  let drag: { x: number; y: number; from: Stage } | null = null;
  stageEl.addEventListener("pointerdown", (e) => {
    if (!stage) return;
    stageEl.setPointerCapture(e.pointerId);
    drag = { x: e.clientX, y: e.clientY, from: stage };
  });
  stageEl.addEventListener("pointermove", (e) => {
    if (!drag || !size) return;
    const { x, y, from } = drag;
    setStage(
      clampStage({ ...from, left: from.left + e.clientX - x, top: from.top + e.clientY - y }, size),
    );
  });
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"])
    stageEl.addEventListener(type, () => {
      drag = null;
    });
  // Escape closes the dialog and reaches no other listener: the settings window closes on a document Escape.
  const onEscape = (e: KeyboardEvent): void => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopImmediatePropagation();
    dialog.close();
  };
  document.addEventListener("keydown", onEscape, true);
  dialog.addEventListener("close", () => {
    document.removeEventListener("keydown", onEscape, true);
    dialog.remove();
  });

  document.body.append(dialog);
  dialog.showModal();
  void load(deps.url, deps.picked);
}
