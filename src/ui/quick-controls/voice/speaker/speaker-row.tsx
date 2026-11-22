/** One speaker radio: a div holding the row's buttons, since a button in a button is invalid. */

import { type MouseEvent, useLayoutEffect, useRef } from "react";
import type { SpeakerOption } from "../../../../io/voice/voices/speaker-selection";
import { t } from "../../../i18n";
import { RenameInput } from "../../asset-list/rename-input";
import type { AssetList } from "../../asset-list/use-asset-list";
import { REMOVE_SVG, RENAME_SVG } from "../../constants";
import type { RefreshState } from "./use-reference-refresh";

const SPK_PLAY_SVG = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>`;
const SPK_PAUSE_SVG = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="7" y="6" width="3.4" height="12" rx="0.8"/><rect x="13.6" y="6" width="3.4" height="12" rx="0.8"/></svg>`;
const SPK_REFRESH_SVG = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M20 11a8 8 0 1 0-1.6 4.8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M20 5v5h-5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const SPK_CHECK_SVG = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

export interface SpeakerRowProps {
  option: SpeakerOption;
  list: AssetList<SpeakerOption>;
  /** The provider takes voices: each row has a remove button, and a user row a rename button. */
  managed: boolean;
  /** The provider takes a clip again under the voice's own id. */
  canReupload: boolean;
  refreshState: RefreshState | undefined;
  playing: boolean;
  onRefresh(option: SpeakerOption): void;
  onToggleAudition(option: SpeakerOption): void;
}

// A control does not also select the row.
const stop = (e: MouseEvent, act: () => void): void => {
  e.stopPropagation();
  act();
};

export function SpeakerRow({
  option,
  list,
  managed,
  canReupload,
  refreshState,
  playing,
  onRefresh,
  onToggleAudition,
}: SpeakerRowProps) {
  const user = option.source === "user";
  const label = option.label ?? option.id;
  const selected = option.id === list.activeId;
  const renaming = user && option.id === list.renamingId;
  const swapping = option.id === list.swappingId;
  const armed = list.armedId === option.id;
  const swapError = option.id === list.errorId;
  const refreshError = !swapError && refreshState === "error";
  const hasClip = option.ref_url.length > 0;
  const refreshing = refreshState === "refreshing";
  const done = refreshState === "done";
  const error = swapError || refreshError;
  const className = [
    "yui-spk",
    renaming && "yui-spk--renaming",
    armed && "is-remove-armed",
    error && "is-error",
  ]
    .filter(Boolean)
    .join(" ");
  const refreshButton = useRef<HTMLButtonElement>(null);
  // A button that turns disabled loses focus, so a refresh pressed from it hands focus back once it settles.
  const refreshHadFocus = useRef(false);
  useLayoutEffect(() => {
    if (refreshing || !refreshHadFocus.current) return;
    refreshHadFocus.current = false;
    const active = document.activeElement;
    if (!active || active === document.body) refreshButton.current?.focus();
  }, [refreshing]);
  if (renaming) {
    return (
      // biome-ignore lint/a11y/useSemanticElements: the row holds buttons, so it is a div
      <div
        role="radio"
        className={className}
        data-spk-id={option.id}
        aria-checked={selected}
        tabIndex={option.id === list.rovedId ? 0 : -1}
      >
        <RenameInput
          label={label}
          classPrefix="yui-spk"
          namespace="speaker"
          onCommit={(next) => list.commitRename(option.id, next)}
          onCancel={list.cancelRename}
        />
      </div>
    );
  }
  return (
    <>
      {/* biome-ignore lint/a11y/useSemanticElements: the row holds buttons, so it is a div */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: the radiogroup's onKeyDown carries the keys */}
      <div
        role="radio"
        className={className}
        data-spk-id={option.id}
        aria-checked={selected}
        tabIndex={option.id === list.rovedId ? 0 : -1}
        aria-busy={swapping || option.id === list.removingId ? "true" : undefined}
        aria-invalid={error ? "true" : undefined}
        onClick={() => void list.swapTo(option)}
      >
        <span className="yui-spk__tick" aria-hidden="true" />
        <span className="yui-spk__body">
          <span className="yui-spk__name">{label}</span>
        </span>
        {refreshing ? (
          <span className="yui-spk__hint">{t("speaker.refreshing")}</span>
        ) : swapping ? (
          <span className="yui-spk__hint">{t("speaker.swapping")}</span>
        ) : null}
        {user && (
          <button
            className="yui-spk__rename"
            type="button"
            data-tip={t("speaker.rename")}
            aria-label={t("speaker.rename")}
            onClick={(e) => stop(e, () => list.startRename(option.id))}
            // biome-ignore lint/security/noDangerouslySetInnerHtml: a constant glyph
            dangerouslySetInnerHTML={{ __html: RENAME_SVG }}
          />
        )}
        {managed && (
          // Arming remounts the button, so a hint open on the old one closes; a disarm keeps the node.
          <button
            key={list.removeKey(option.id)}
            className={armed ? "yui-spk__remove is-armed" : "yui-spk__remove"}
            type="button"
            data-tip={armed ? t("speaker.remove_confirm") : t("speaker.remove")}
            aria-label={
              armed ? t("speaker.remove_confirm_aria", { name: label }) : t("speaker.remove")
            }
            disabled={list.removingId === option.id}
            onClick={(e) => stop(e, () => void list.remove(option.id))}
            // biome-ignore lint/security/noDangerouslySetInnerHtml: a constant glyph beside the confirm text
            dangerouslySetInnerHTML={{
              __html: `${REMOVE_SVG}<span class="yui-spk__remove-confirm">${t("speaker.remove_confirm")}</span>`,
            }}
          />
        )}
        {managed && canReupload && (
          <button
            ref={refreshButton}
            className={
              refreshing
                ? "yui-spk__refresh is-refreshing"
                : done
                  ? "yui-spk__refresh is-done"
                  : "yui-spk__refresh"
            }
            type="button"
            data-tip={t("speaker.refresh")}
            aria-label={t(
              refreshing
                ? "aria.refresh_speaker_refreshing"
                : done
                  ? "aria.refresh_speaker_done"
                  : "aria.refresh_speaker",
              { name: label },
            )}
            disabled={!hasClip || refreshing}
            onClick={(e) => {
              refreshHadFocus.current = document.activeElement === e.currentTarget;
              stop(e, () => hasClip && onRefresh(option));
            }}
            // biome-ignore lint/security/noDangerouslySetInnerHtml: a constant glyph
            dangerouslySetInnerHTML={{ __html: done ? SPK_CHECK_SVG : SPK_REFRESH_SVG }}
          />
        )}
        {!swapping && (
          <button
            className={playing ? "yui-spk__preview is-playing" : "yui-spk__preview"}
            type="button"
            data-tip={t("speaker.preview")}
            aria-label={t("aria.preview_speaker", { name: label })}
            disabled={!hasClip}
            onClick={(e) => stop(e, () => hasClip && onToggleAudition(option))}
            // biome-ignore lint/security/noDangerouslySetInnerHtml: a constant glyph
            dangerouslySetInnerHTML={{ __html: playing ? SPK_PAUSE_SVG : SPK_PLAY_SVG }}
          />
        )}
        {selected && <span className="yui-spk__badge">{t("speaker.in_use")}</span>}
      </div>
      {swapError ? (
        <p className="yui-spk__error" role="status">
          {t("speaker.swap_error")}
        </p>
      ) : refreshError ? (
        <p className="yui-spk__error" role="status">
          {t("speaker.refresh_error")}
        </p>
      ) : done ? (
        <p
          className="yui-spk__note"
          role="status"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: a constant glyph beside the note
          dangerouslySetInnerHTML={{ __html: `${SPK_CHECK_SVG}${t("speaker.refresh_done")}` }}
        />
      ) : null}
    </>
  );
}
