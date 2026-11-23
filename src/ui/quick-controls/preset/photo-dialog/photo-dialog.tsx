/**
 * The photo dialog — a modal `<dialog>` that frames a preset's photo under a circular mask
 * with live previews at the sizes a face is drawn. "Use photo" saves the framing; Cancel and Escape
 * save nothing beyond the framing of a photo just picked.
 */

import "./photo-dialog.css";
import { type PointerEvent, useLayoutEffect, useRef, useState } from "react";
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

export interface PhotoDialogProps {
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
  /** The dialog closed; the caller unmounts it. */
  onClosed(): void;
}

/**
 * Measures a photo; a just-picked one saves its default framing then, whether or not a dialog still
 * shows. Settles to the size, "failed" when it cannot be measured, or null when a later write for that
 * preset came first.
 */
function framePhoto(
  p: PhotoDialogProps,
  url: string,
  picked: boolean,
): Promise<PhotoSize | "failed" | null> {
  const mine = picked ? bumpWrite(p.entry.id) : 0;
  const superseded = (): boolean => picked && writes.get(p.entry.id) !== mine;
  return (p.measure ?? loadPhotoSize)(url).then(
    (size) => {
      if (superseded()) return null;
      if (picked) {
        p.save(url, defaultCrop(size));
        p.log.info("photo_default_framed", { preset: p.entry.id });
      }
      return size;
    },
    () => (superseded() ? null : "failed"),
  );
}

/** One preview row: the face, mounted as a vanilla element, then where it shows. */
function Preview(p: {
  entry: PresetEntry;
  url: string;
  px: number;
  where: string;
  crop: PhotoCrop;
}) {
  const row = useRef<HTMLDivElement>(null);
  const img = useRef<HTMLImageElement | null>(null);
  useLayoutEffect(() => {
    const face = avatarEl({ ...p.entry, thumbnail: p.url, crop: undefined }, p.px);
    row.current?.prepend(face);
    img.current = face.querySelector("img");
    return () => face.remove();
  }, [p.entry, p.url, p.px]);
  useLayoutEffect(() => {
    if (img.current) applyCrop(img.current, p.crop);
  });
  return (
    <div ref={row} className="yui-photo-dialog__preview">
      <span>{`${t(p.where)} · ${p.px} px`}</span>
    </div>
  );
}

export function PhotoDialog(props: PhotoDialogProps) {
  const { entry, log } = props;
  const dialog = useRef<HTMLDialogElement>(null);
  const closed = useRef(props.onClosed);
  closed.current = props.onClosed;
  // A chosen photo brings its measure, started at the pick so its framing saves even after a Cancel.
  const [source, setSource] = useState<{
    url: string;
    picked: boolean;
    framed?: Promise<PhotoSize | "failed" | null>;
  }>({ url: props.url, picked: props.picked });
  // null while measuring; "failed" when the photo could not be measured.
  const [shown, setShown] = useState<{ size: PhotoSize; stage: Stage } | "failed" | null>(null);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState(false);
  const drag = useRef<{ x: number; y: number; from: Stage } | null>(null);
  const size = shown && shown !== "failed" ? shown.size : null;
  const stage = shown && shown !== "failed" ? shown.stage : null;

  // Escape closes the dialog and reaches no other listener: the settings window closes on a document Escape.
  useLayoutEffect(() => {
    const el = dialog.current!;
    const onEscape = (e: KeyboardEvent): void => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopImmediatePropagation();
      el.close();
    };
    const onClose = (): void => {
      document.removeEventListener("keydown", onEscape, true);
      closed.current();
    };
    document.addEventListener("keydown", onEscape, true);
    el.addEventListener("close", onClose);
    el.showModal();
    return () => {
      document.removeEventListener("keydown", onEscape, true);
      el.removeEventListener("close", onClose);
    };
  }, []);

  // Each photo starts its measure at commit, so a Cancel right after still lets its framing save.
  // biome-ignore lint/correctness/useExhaustiveDependencies: one measure per photo; the other props are the ones the dialog opened with
  useLayoutEffect(() => {
    let current = true;
    void (source.framed ?? framePhoto(props, source.url, source.picked)).then((measured) => {
      if (!current || !measured) return;
      if (measured === "failed") {
        setShown("failed");
        setError(true);
        return;
      }
      setShown({
        size: measured,
        stage: stageOf((!source.picked && entry.crop) || defaultCrop(measured), measured),
      });
    });
    return () => {
      current = false;
    };
  }, [source]);

  const setStage = (next: Stage): void => {
    if (size) setShown({ size, stage: next });
  };

  function choose(): void {
    setPicking(true);
    props
      .pick()
      .then((picked) => {
        setPicking(false);
        if (picked === null) return;
        props.saveUrl(picked);
        setShown(null);
        setError(false);
        setSource({ url: picked, picked: true, framed: framePhoto(props, picked, true) });
      })
      .catch((err) => {
        setPicking(false);
        setError(true);
        log.warn("photo_pick_failed", { preset: entry.id, error: String(err) });
      });
  }

  function use(): void {
    if (!size || !stage) return;
    bumpWrite(entry.id);
    props.save(source.url, cropOf(stage, size));
    log.info("photo_crop_saved", { preset: entry.id });
    dialog.current?.close();
  }

  const scale = size && stage ? (stage.zoom * CIRCLE) / Math.min(size.width, size.height) : 0;
  const zoom = stage?.zoom ?? MIN_ZOOM;
  const crop = size && stage ? cropOf(stage, size) : null;
  const endDrag = (): void => {
    drag.current = null;
  };

  return (
    <dialog
      ref={dialog}
      className="yui-photo-dialog"
      aria-labelledby="yui-photo-dialog-title"
      style={
        {
          "--yui-photo-stage": `${STAGE}px`,
          "--yui-photo-margin": `${MARGIN}px`,
          "--yui-photo-circle": `${CIRCLE}px`,
        } as React.CSSProperties
      }
    >
      <div className="yui-photo-dialog__head">
        <h2 id="yui-photo-dialog-title">{t("preset.photo", { name: entry.name })}</h2>
        <span>{t("photo.hint")}</span>
      </div>
      <div className="yui-photo-dialog__body">
        <div className="yui-photo-dialog__stagecol">
          <div
            className="yui-photo-dialog__stage"
            onPointerDown={(e: PointerEvent<HTMLDivElement>) => {
              if (!stage) return;
              e.currentTarget.setPointerCapture(e.pointerId);
              drag.current = { x: e.clientX, y: e.clientY, from: stage };
            }}
            onPointerMove={(e) => {
              if (!drag.current || !size) return;
              const { x, y, from } = drag.current;
              setStage(
                clampStage(
                  { ...from, left: from.left + e.clientX - x, top: from.top + e.clientY - y },
                  size,
                ),
              );
            }}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onLostPointerCapture={endDrag}
          >
            <img
              alt=""
              draggable={false}
              hidden={!size}
              src={size ? source.url : undefined}
              style={
                size && stage
                  ? {
                      width: `${size.width * scale}px`,
                      left: `${stage.left}px`,
                      top: `${stage.top}px`,
                    }
                  : undefined
              }
            />
            <div className="yui-photo-dialog__mask" aria-hidden="true" />
          </div>
          <label className="yui-photo-dialog__zoom">
            <span>{t("photo.zoom")}</span>
            <input
              className="yui-gain__slider"
              type="range"
              step="5"
              min={MIN_ZOOM * 100}
              max={MAX_ZOOM * 100}
              value={Math.round(zoom * 100)}
              style={
                {
                  "--fill": String((zoom - MIN_ZOOM) / (MAX_ZOOM - MIN_ZOOM)),
                } as React.CSSProperties
              }
              onChange={(e) => {
                if (size && stage)
                  setStage(zoomAbout(stage, Number(e.currentTarget.value) / 100, size));
              }}
            />
            <output>{stage ? `${stage.zoom.toFixed(1)}×` : ""}</output>
          </label>
          <div className="yui-photo-dialog__tools">
            <button
              className="yui-pill"
              type="button"
              data-act="face"
              onClick={() => size && setStage(stageOf(faceCrop(size), size))}
            >
              {t("photo.fit_face")}
            </button>
            <button
              className="yui-pill"
              type="button"
              data-act="whole"
              onClick={() => size && setStage(stageOf(wholeCrop(size), size))}
            >
              {t("photo.whole")}
            </button>
            <button
              className="yui-pill"
              type="button"
              data-act="choose"
              disabled={picking || shown === null}
              onClick={choose}
            >
              {t("photo.choose")}
            </button>
          </div>
          <p className="yui-photo-dialog__error" role="status" hidden={!error}>
            {t("preset.photo_failed")}
          </p>
        </div>
        <div className="yui-photo-dialog__where">
          <h3>{t("photo.where")}</h3>
          <div className="yui-photo-dialog__previews">
            {crop &&
              PREVIEWS.map(({ px, where }) => (
                <Preview
                  key={px}
                  entry={entry}
                  url={source.url}
                  px={px}
                  where={where}
                  crop={crop}
                />
              ))}
          </div>
        </div>
      </div>
      <div className="yui-photo-dialog__foot">
        <button
          className="yui-pill"
          type="button"
          data-act="cancel"
          onClick={() => dialog.current?.close()}
        >
          {t("photo.cancel")}
        </button>
        <button
          className="yui-pill yui-pill--ok"
          type="button"
          data-act="use"
          disabled={!size}
          onClick={use}
        >
          {t("photo.use")}
        </button>
      </div>
    </dialog>
  );
}
