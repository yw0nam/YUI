/**
 * Preset strip — the character header and the dots button that opens the manage popover, above
 * the tab rail and body, with the edited preset's note and relation line under it. Picking a
 * character hands its id to `onEditTarget`.
 */

import "../row-actions.css";
import "./preset.css";
import { type Ref, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Logger } from "../../../logger";
import {
  type createAgentNotifySettings,
  ingressUrl,
} from "../../../settings/backend/agent-notify-settings";
import type { FlagSettingsStore } from "../../../settings/persisted-store";
import { presetIdForWindow, presetNameFor } from "../../../settings/preset/active-preset";
import { isPresetWindowLive, type PetWindows } from "../../../settings/preset/pet-windows";
import type { PresetRegistry } from "../../../settings/preset/preset-registry";
import type { RelationsStore } from "../../../settings/relations/relations-store";
import { t } from "../../i18n";
import { useNotify } from "../../use-snapshot/use-notify";
import { CharacterHeader } from "./character-header";
import type { EditedPreset } from "./edited-preset";
import { PhotoDialog } from "./photo-dialog/photo-dialog";
import { type PhotoRequest, PresetManage } from "./preset-manage";
import { PresetRelations } from "./relations/relations-section";

const DOTS = (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <circle cx="6" cy="12" r="1.6" />
    <circle cx="12" cy="12" r="1.6" />
    <circle cx="18" cy="12" r="1.6" />
  </svg>
);

export interface PresetHeaderHandle {
  /** Closes the manage popover — the panel closed. */
  close(): void;
}

export interface PresetHeaderProps {
  edited: EditedPreset;
  registry: Pick<
    PresetRegistry,
    "get" | "subscribe" | "activate" | "create" | "rename" | "remove" | "setThumbnail"
  >;
  log: Logger;
  petWindows?: PetWindows;
  boundId?: string | null;
  /** Takes the picked preset as the one the window edits. */
  onEditTarget: (id: string) => void;
  agentNotifySettings?: ReturnType<typeof createAgentNotifySettings>;
  /** This window's preset's relations; absent, the strip shows no relation line. */
  relationsStore?: RelationsStore;
  /** The Relations switch; off, the relation line hides. */
  relationsSwitch: FlagSettingsStore;
  /** Deletes a removed preset's thumbnail file; injected by the app wiring. */
  removeCardThumbnail?: (id: string) => Promise<void>;
  /** Opens the photo picker for a preset; injected under Tauri. */
  pickPhoto?: (presetId: string) => Promise<string | null>;
  /** The bundled chat transport, for a preset without its own; the edit header names it. */
  getDefaultChatApi?: () => string | undefined;
  handle: Ref<PresetHeaderHandle>;
}

export function PresetHeader(p: PresetHeaderProps) {
  const { edited, registry, log, petWindows, boundId = null } = p;
  const shownId = presetIdForWindow();
  useNotify(edited.subscribe);
  useNotify(petWindows?.subscribe);
  useNotify(p.agentNotifySettings?.subscribe);
  const state = edited.get();
  const windows = petWindows?.get();
  const ingress = p.agentNotifySettings?.get();
  const isOpen = (id: string): boolean => !!(windows?.includes(id) || isPresetWindowLive(id));
  const strip = useRef<HTMLDivElement>(null);
  const manageBtn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const [managing, setManaging] = useState(false);
  const [photo, setPhoto] = useState<PhotoRequest | null>(null);

  const name = presetNameFor(state, shownId);
  const key = shownId === state.active ? "main" : isOpen(shownId) ? "window" : "idle";

  function closeManage(restoreFocus: boolean): void {
    setManaging(false);
    if (restoreFocus) manageBtn.current?.focus();
  }
  useImperativeHandle(p.handle, () => ({ close: () => closeManage(false) }));

  // A press outside the popover closes it; a modal dialog over the panel owns its presses.
  useEffect(() => {
    if (!managing) return;
    const onPointer = (e: PointerEvent): void => {
      const target = e.target as Element;
      if (target.closest?.("dialog[open]")) return;
      if (!pop.current?.contains(target) && !manageBtn.current?.contains(target))
        setManaging(false);
    };
    document.addEventListener("pointerdown", onPointer, true);
    return () => document.removeEventListener("pointerdown", onPointer, true);
  }, [managing]);

  // The popover's first control takes focus once it renders.
  useLayoutEffect(() => {
    if (managing) pop.current?.querySelector<HTMLElement>("button, input")?.focus();
  }, [managing]);

  return (
    <div ref={strip} className="yui-preset">
      <div className="yui-preset__row">
        <CharacterHeader
          shownId={shownId}
          list={state.list}
          main={state.active}
          isOpen={isOpen}
          getDefaultChatApi={p.getDefaultChatApi}
          onPick={p.onEditTarget}
        />
        <button
          ref={manageBtn}
          className={
            managing
              ? "yui-iconbtn yui-preset__manage is-pressed"
              : "yui-iconbtn yui-preset__manage"
          }
          type="button"
          aria-label={t("preset.manage")}
          data-tip={t("preset.manage")}
          aria-haspopup="dialog"
          aria-expanded={managing}
          onClick={() => (managing ? closeManage(true) : setManaging(true))}
        >
          {DOTS}
        </button>
      </div>
      <p className="yui-preset__note">{t(`preset.note_${key}`, { name })}</p>
      {p.relationsStore && (
        <PresetRelations
          strip={strip}
          store={p.relationsStore}
          presets={state.list}
          isOpen={isOpen}
          relationsSwitch={p.relationsSwitch}
          closeOn={[state, windows, ingress]}
        />
      )}
      <div
        ref={pop}
        className="yui-preset-pop"
        role="dialog"
        aria-label={t("preset.manage")}
        hidden={!managing}
        // Esc closes the popover alone; the panel stays open behind it.
        onKeyDown={(e) => {
          if (e.key !== "Escape") return;
          e.preventDefault();
          e.stopPropagation();
          closeManage(true);
        }}
      >
        {managing && (
          <PresetManage
            root={pop}
            state={state}
            registry={registry}
            log={log}
            petWindows={petWindows}
            boundId={boundId}
            removeCardThumbnail={p.removeCardThumbnail}
            pickPhoto={p.pickPhoto}
            presetUrl={(id) => (ingress?.enabled ? ingressUrl(ingress.port, id) : null)}
            onPhoto={setPhoto}
          />
        )}
      </div>
      {photo &&
        createPortal(
          <PhotoDialog {...photo} log={log} onClosed={() => setPhoto(null)} />,
          document.body,
        )}
    </div>
  );
}
