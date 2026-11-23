/**
 * Manage popover body — the preset rows with inline rename and two-step delete, and the new-preset
 * row that turns into a name field. Writes go to the registry; its notify re-renders the header.
 */

import { type KeyboardEvent, type RefObject, useLayoutEffect, useRef, useState } from "react";
import type { Logger } from "../../../logger";
import type { PresetEntry, PresetState } from "../../../settings/preset/active-preset";
import type { PhotoCrop } from "../../../settings/preset/photo-crop";
import { DEFAULT_PRESET_ID } from "../../../settings/preset/preset-keys";
import { type PresetRegistry, RESERVED_NAMES } from "../../../settings/preset/preset-registry";
import { t } from "../../i18n";
import { COPY_GLYPH, PHOTO_GLYPH, PLUS_GLYPH, REMOVE_GLYPH, RENAME_GLYPH } from "../glyphs";

type Registry = Pick<
  PresetRegistry,
  "get" | "create" | "rename" | "remove" | "activate" | "setThumbnail"
>;

/** A photo to frame in the photo dialog, as the manage list hands it over. */
export interface PhotoRequest {
  entry: PresetEntry;
  url: string;
  picked: boolean;
  pick: () => Promise<string | null>;
  save: (url: string, crop: PhotoCrop) => void;
  saveUrl: (url: string) => void;
}

interface PresetManageProps {
  /** The popover the body renders into. */
  root: RefObject<HTMLElement | null>;
  state: PresetState;
  registry: Registry;
  log: Logger;
  /** The edited preset's name, which a new preset copies. */
  editedName: string;
  /** Whether the preset's window is open. */
  isOpen(id: string): boolean;
  boundId?: string | null;
  presetUrl?: (id: string) => string | null;
  /** Deletes a removed preset's thumbnail file; idempotent, so JSON-card presets are fine. */
  removeCardThumbnail?: (id: string) => Promise<void>;
  /** Opens the photo picker for a preset and returns its new thumbnail URL, null when dismissed; absent, rows offer no photo button. */
  pickPhoto?: (presetId: string) => Promise<string | null>;
  /** Opens the photo dialog. */
  onPhoto(request: PhotoRequest): void;
}

function Hint({ action }: { action: string }) {
  return (
    <span className="yui-preset-row__hint">
      <kbd>Enter</kbd> {t(action)} · <kbd>Esc</kbd> {t("preset.hint_cancel")}
    </span>
  );
}

function isTaken(state: PresetState, name: string, exceptId?: string): boolean {
  return (
    RESERVED_NAMES.has(name.trim().toLowerCase()) ||
    state.list.some((e) => e.id !== exceptId && e.name === name.trim())
  );
}

export function PresetManage(p: PresetManageProps) {
  const { root, state, registry, log } = p;
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [naming, setNaming] = useState(false);
  // A picked photo the shell refused: the list says so until the next pick or the popover closes.
  const [photoError, setPhotoError] = useState(false);
  const [draft, setDraft] = useState("");
  const [invalid, setInvalid] = useState(false);
  // Each row's URL shown as text where the clipboard refused it.
  const [urlText, setUrlText] = useState<Record<string, string>>({});
  // The control to focus after the next commit, so keyboard users stay where they acted.
  const focusSel = useRef<string | null>(null);

  useLayoutEffect(() => {
    if (!focusSel.current) return;
    root.current?.querySelector<HTMLElement>(focusSel.current)?.focus();
    focusSel.current = null;
  });

  // A preset removed in another window takes its pending rename or confirm with it.
  const renaming = state.list.some((e) => e.id === renamingId) ? renamingId : null;
  const confirming = state.list.some((e) => e.id === confirmId) ? confirmId : null;

  function photo(entry: PresetEntry): void {
    const pick = (): Promise<string | null> => p.pickPhoto!(entry.id);
    const request = {
      entry,
      pick,
      save: (url: string, crop: PhotoCrop) => registry.setThumbnail(entry.id, url, crop),
      saveUrl: (url: string) => registry.setThumbnail(entry.id, url),
    };
    if (entry.thumbnail) {
      p.onPhoto({ ...request, url: entry.thumbnail, picked: false });
      return;
    }
    pick().then(
      (url) => {
        setPhotoError(false);
        if (url === null) return;
        request.saveUrl(url);
        p.onPhoto({ ...request, url, picked: true });
      },
      (err) => {
        log.warn("photo_pick_failed", { preset: entry.id, error: String(err) });
        setPhotoError(true);
      },
    );
  }

  function copy(id: string, url: string): void {
    const failed = (error: unknown): void => {
      log.warn("ingress_url_copy_failed", { error: String(error) });
      setUrlText((shown) => ({ ...shown, [id]: url }));
    };
    try {
      if (!navigator.clipboard?.writeText) {
        failed("Clipboard API unavailable");
        return;
      }
      void navigator.clipboard.writeText(url).catch(failed);
    } catch (error) {
      failed(error);
    }
  }

  function row(entry: PresetEntry) {
    const active = state.active;
    const open = p.isOpen(entry.id);
    const removable =
      entry.id !== DEFAULT_PRESET_ID && entry.id !== active && entry.id !== p.boundId && !open;
    const url = entry.id !== active ? p.presetUrl?.(entry.id) : null;
    return (
      <div key={entry.id} className="yui-preset-row" data-preset-id={entry.id}>
        <span className="yui-preset-row__name">{entry.name}</span>
        {entry.id === active && <span className="yui-preset-row__badge">{t("preset.in_use")}</span>}
        {open && <span className="yui-preset-row__badge">{t("preset.window_open")}</span>}
        <span className="yui-preset-row__acts">
          {p.pickPhoto && (
            <button
              className="yui-preset-row__photo"
              type="button"
              aria-label={t("preset.photo", { name: entry.name })}
              onClick={() => photo(entry)}
            >
              {PHOTO_GLYPH}
            </button>
          )}
          <button
            className="yui-preset-row__rename"
            type="button"
            aria-label={t("preset.rename", { name: entry.name })}
            onClick={() => {
              setRenamingId(entry.id);
              setConfirmId(null);
              setInvalid(false);
              focusSel.current = ".is-renaming input";
            }}
          >
            {RENAME_GLYPH}
          </button>
          {removable && (
            <button
              className="yui-preset-row__remove"
              type="button"
              aria-label={t("preset.remove", { name: entry.name })}
              onClick={() => {
                setConfirmId(entry.id);
                setRenamingId(null);
                focusSel.current = ".yui-preset-row__confirm .yui-pill:not(.yui-pill--go)";
              }}
            >
              {REMOVE_GLYPH}
            </button>
          )}
          {entry.id !== active && (
            // The registry refuses a preset whose window is open; the button shows the rule.
            <button
              type="button"
              className="yui-preset-row__window"
              disabled={open}
              onClick={() => registry.activate(entry.id)}
            >
              {t("preset.use_in_main")}
            </button>
          )}
          {url && (
            <button
              type="button"
              className="yui-preset-row__url"
              aria-label={t("preset.copy_url", { name: entry.name })}
              title={t("reactions.restart_hint")}
              onClick={() => copy(entry.id, url)}
            >
              {COPY_GLYPH}
            </button>
          )}
        </span>
        {url && urlText[entry.id] === url && (
          <code className="yui-preset-row__url-text">{url}</code>
        )}
      </div>
    );
  }

  function renamingRow(entry: PresetEntry) {
    function onKeyDown(e: KeyboardEvent<HTMLInputElement>): void {
      if (e.key !== "Enter" && e.key !== "Escape") return;
      e.preventDefault();
      // Esc cancels the rename only; the popover and the panel stay open.
      e.stopPropagation();
      const next = e.currentTarget.value.trim();
      if (e.key === "Enter" && next !== entry.name) {
        if (!registry.rename(entry.id, next)) {
          setInvalid(true);
          return;
        }
        log.info("preset_rename", { preset: entry.id });
      }
      setRenamingId(null);
      focusSel.current = `[data-preset-id="${entry.id}"] .yui-preset-row__rename`;
    }
    return (
      <div
        key={entry.id}
        className={
          invalid
            ? "yui-preset-row yui-input-row is-renaming is-invalid"
            : "yui-preset-row yui-input-row is-renaming"
        }
      >
        <span className="yui-input-wrap">
          <input
            className="yui-ep-input"
            type="text"
            aria-label={t("preset.name_aria")}
            aria-invalid={invalid}
            defaultValue={entry.name}
            onInput={(e) => setInvalid(isTaken(registry.get(), e.currentTarget.value, entry.id))}
            onKeyDown={onKeyDown}
          />
        </span>
        <Hint action="preset.hint_save" />
      </div>
    );
  }

  function confirmRow(entry: PresetEntry) {
    return (
      // biome-ignore lint/a11y/useSemanticElements: the confirm box the shared confirm CSS styles
      <div
        key={entry.id}
        className="yui-confirm yui-preset-row__confirm"
        role="group"
        aria-label={t("preset.remove", { name: entry.name })}
      >
        <span className="yui-confirm__q">{t("preset.confirm_q", { name: entry.name })}</span>
        <span className="yui-confirm__btns">
          <button className="yui-pill" type="button" onClick={() => setConfirmId(null)}>
            {t("preset.confirm_cancel")}
          </button>
          <button
            className="yui-pill yui-pill--go"
            type="button"
            onClick={() => {
              setConfirmId(null);
              if (registry.remove(entry.id)) {
                p.removeCardThumbnail?.(entry.id).catch((e) =>
                  log.warn("thumbnail_remove_failed", { preset: entry.id, error: String(e) }),
                );
                log.info("preset_remove", { preset: entry.id });
              }
              focusSel.current = ".yui-add-btn";
            }}
          >
            {t("preset.confirm_go")}
          </button>
        </span>
      </div>
    );
  }

  function newField() {
    const taken = isTaken(registry.get(), draft);
    const done = (): void => {
      setNaming(false);
      setDraft("");
      focusSel.current = ".yui-add-btn";
    };
    function onKeyDown(e: KeyboardEvent<HTMLInputElement>): void {
      if (e.key !== "Enter" && e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Enter") {
        const value = e.currentTarget.value;
        if (isTaken(registry.get(), value) || !value.trim()) return;
        done();
        const id = registry.create(value);
        if (id) log.info("preset_create", { preset: id });
      } else {
        done();
      }
    }
    return (
      <div
        key="new"
        className={
          taken
            ? "yui-stack yui-input-row yui-preset-new is-invalid"
            : "yui-stack yui-input-row yui-preset-new"
        }
      >
        <label className="yui-input-row__label" htmlFor="yui-preset-new-name">
          {t("preset.new")}
        </label>
        <span className="yui-row__sub">{t("preset.new_sub", { name: p.editedName })}</span>
        <span className="yui-input-wrap">
          <input
            className="yui-ep-input"
            id="yui-preset-new-name"
            type="text"
            placeholder={t("preset.new_ph")}
            aria-invalid={taken}
            defaultValue={draft}
            onInput={(e) => setDraft(e.currentTarget.value)}
            onKeyDown={onKeyDown}
          />
        </span>
        <p className="yui-input-row__error" role="status">
          {taken ? t("preset.taken", { name: draft.trim() }) : ""}
        </p>
        <Hint action="preset.hint_create" />
      </div>
    );
  }

  return (
    <>
      <div className="yui-group">
        {state.list.map((entry) =>
          entry.id === renaming
            ? renamingRow(entry)
            : entry.id === confirming
              ? confirmRow(entry)
              : row(entry),
        )}
        {naming ? (
          newField()
        ) : (
          <div className="yui-row yui-row--action">
            <button
              className="yui-add-btn"
              type="button"
              onClick={() => {
                setNaming(true);
                setRenamingId(null);
                setConfirmId(null);
                focusSel.current = "#yui-preset-new-name";
              }}
            >
              {PLUS_GLYPH}
              {t("preset.new")}
            </button>
          </div>
        )}
      </div>
      {photoError && (
        <div className="yui-input-row is-invalid">
          <p className="yui-input-row__error" role="status">
            {t("preset.photo_failed")}
          </p>
        </div>
      )}
    </>
  );
}
