/** The VRM radiogroup's state and rules: roving focus, swap, rename, armed remove and import. */

import {
  type KeyboardEvent,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
} from "react";
import type { AvatarOption } from "../../../../config/validators/avatar/types";
import type { createVrmSelection } from "../../../../io/assets/vrm-selection";
import type { Logger } from "../../../../logger";
import { REMOVE_CONFIRM_MS, resolveRovedId } from "../../sections/user-asset-list/user-asset-list";

export interface VrmListDeps {
  vrmSelection: ReturnType<typeof createVrmSelection>;
  /** Load the model, then commit the selection. The list never selects on its own. */
  swapVrm: (option: AvatarOption) => Promise<void>;
  /** Pick a file, load it, add the option and select it; a reject shows the inline error. */
  importVrm: () => Promise<void>;
  /** Delete an imported VRM's file (idempotent). */
  removeUserVrm: (id: string) => Promise<void>;
  /** The store's repaints reach the list only while the tab is open. */
  isOpen: () => boolean;
  log: Logger;
  /** Re-measure hover hints after a row's label changes. */
  refreshTooltip?: () => void;
  /** Moves on each open; the list is read again and an armed remove drops. */
  revision: number;
}

interface ListState {
  rovedId: string | null;
  renamingId: string | null;
  errorId: string | null;
  removingId: string | null;
  swappingId: string | null;
  importing: boolean;
  importError: boolean;
  /** The remove waiting for its confirming click, from the open it was armed in. */
  armed: { id: string; revision: number } | null;
  /** The last arm's row and count; it outlives a disarm, so the button keeps its node. */
  lastArm: { id: string; seq: number } | null;
}

const INITIAL: ListState = {
  rovedId: null,
  renamingId: null,
  errorId: null,
  removingId: null,
  swappingId: null,
  importing: false,
  importError: false,
  armed: null,
  lastArm: null,
};

const ROW = ".yui-vrm[role=radio]";

export interface VrmList {
  options: AvatarOption[];
  activeId: string;
  rovedId: string;
  renamingId: string | null;
  armedId: string | null;
  /** Changes when the row's remove button is armed, never when it is disarmed. */
  removeKey(id: string): number;
  errorId: string | null;
  removingId: string | null;
  swappingId: string | null;
  importing: boolean;
  importError: boolean;
  groupRef: RefObject<HTMLDivElement | null>;
  swapTo(option: AvatarOption): Promise<void>;
  startRename(id: string): void;
  commitRename(id: string, label: string): void;
  cancelRename(): void;
  remove(id: string): Promise<void>;
  runImport(): Promise<void>;
  onKeyDown(e: KeyboardEvent<HTMLElement>): void;
}

export function useVrmList(deps: VrmListDeps): VrmList {
  const { vrmSelection, swapVrm, importVrm, removeUserVrm, isOpen, log, refreshTooltip, revision } =
    deps;
  const [state, dispatch] = useReducer(
    (s: ListState, patch: Partial<ListState>): ListState => ({ ...s, ...patch }),
    INITIAL,
  );
  const groupRef = useRef<HTMLDivElement>(null);
  // Whether focus sat in the group before the change that may drop it.
  const hadFocus = useRef(false);
  const swapping = useRef(false);
  const removing = useRef(false);
  const importing = useRef(false);

  const update = useCallback((patch: Partial<ListState>): void => {
    const group = groupRef.current;
    hadFocus.current ||= !!group?.contains(group.ownerDocument.activeElement);
    dispatch(patch);
  }, []);
  // A repaint drops an armed remove.
  const repaint = useCallback((): void => update({ armed: null }), [update]);

  // A swap repaints in its own finally, so the store's notice skips it.
  useEffect(
    () =>
      vrmSelection.subscribe(() => {
        if (isOpen() && !swapping.current) repaint();
      }),
    [vrmSelection, isOpen, repaint],
  );

  const options = vrmSelection.list();
  const activeId = vrmSelection.getActiveId();
  const ids = options.map((o) => o.id);
  const rovedId = resolveRovedId(state.rovedId, ids, activeId);
  const renamingId =
    state.renamingId !== null && ids.includes(state.renamingId) ? state.renamingId : null;
  const armedId =
    state.armed?.revision === revision && ids.includes(state.armed.id) ? state.armed.id : null;

  // A rename or an arm on an option that left the list ends, so a re-added option starts clean.
  useLayoutEffect(() => {
    const renamingGone = state.renamingId !== null && renamingId === null;
    const armedGone = state.armed !== null && armedId === null;
    if (renamingGone || armedGone) {
      dispatch({
        ...(renamingGone && { renamingId: null }),
        ...(armedGone && { armed: null }),
      });
    }
  });

  // The arm ends on the timer, an outside click or Escape.
  useEffect(() => {
    if (armedId === null) return;
    const doc = groupRef.current?.ownerDocument ?? document;
    const timer = setTimeout(repaint, REMOVE_CONFIRM_MS);
    const onClick = (e: MouseEvent): void => {
      if (!(e.target as Element | null)?.closest(".yui-vrm__remove")) repaint();
    };
    const onKey = (e: globalThis.KeyboardEvent): void => {
      if (e.key === "Escape") repaint();
    };
    doc.addEventListener("click", onClick, true);
    doc.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(timer);
      doc.removeEventListener("click", onClick, true);
      doc.removeEventListener("keydown", onKey);
    };
  }, [armedId, repaint]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: a hint re-measures when the armed row changes
  useLayoutEffect(() => refreshTooltip?.(), [armedId, refreshTooltip]);

  // A commit that dropped the group's focused node hands focus back to the roved row.
  useLayoutEffect(() => {
    if (!hadFocus.current) return;
    hadFocus.current = false;
    const group = groupRef.current;
    if (!group || group.contains(group.ownerDocument.activeElement)) return;
    const roved = [...group.querySelectorAll<HTMLElement>(ROW)].find(
      (row) => row.dataset.vrmId === rovedId,
    );
    roved?.focus();
    roved?.scrollIntoView?.({ block: "nearest" });
  });

  async function swapTo(option: AvatarOption): Promise<void> {
    if (swapping.current) return;
    if (option.id === vrmSelection.getActiveId()) return;
    swapping.current = true;
    update({ errorId: null, swappingId: option.id });
    try {
      await swapVrm(option);
      update({ rovedId: option.id });
      log.info("vrm_swap", { id: option.id });
    } catch (err) {
      update({ errorId: option.id });
      log.error("vrm_swap_failed", { id: option.id, error: String(err) });
    } finally {
      swapping.current = false;
      update({ swappingId: null, armed: null });
    }
  }

  async function remove(id: string): Promise<void> {
    if (removing.current) return;
    if (armedId !== id) {
      update({
        armed: { id, revision },
        lastArm: { id, seq: (state.lastArm?.seq ?? 0) + 1 },
      });
      return;
    }
    removing.current = true;
    update({ armed: null, removingId: id, errorId: null });
    const wasActive = vrmSelection.getActiveId() === id;
    log.info("vrm_delete", { id });
    try {
      await removeUserVrm(id);
    } catch (err) {
      // The file stays, so the row stays.
      removing.current = false;
      update({ armed: null, removingId: null, errorId: id });
      log.error("vrm_delete_failed", { id, error: String(err) });
      return;
    }
    removing.current = false;
    vrmSelection.removeUserOption(id);
    // Removing an option that is not the active one does not notify, so the update repaints.
    update({ armed: null, removingId: null });
    if (!wasActive) return;
    try {
      await swapVrm(vrmSelection.getActive());
    } catch (err) {
      log.error("vrm_fallback_swap_failed", { error: String(err) });
      repaint();
    }
  }

  async function runImport(): Promise<void> {
    if (importing.current) return;
    importing.current = true;
    update({ armed: null, importing: true, importError: false });
    try {
      await importVrm();
    } catch (err) {
      update({ importError: true });
      log.error("vrm_import_failed", { error: String(err) });
    } finally {
      importing.current = false;
      update({ armed: null, importing: false });
    }
  }

  function commitRename(id: string, label: string): void {
    if (renamingId !== id) return;
    update({ armed: null, renamingId: null });
    // An empty label is refused by the store, which keeps the old one.
    vrmSelection.renameUserOption(id, label);
    log.info("vrm_rename", { id });
  }

  // Enter and Space select, arrows move the roving tab stop only (wrapping), Home and End jump.
  function onKeyDown(e: KeyboardEvent<HTMLElement>): void {
    if (swapping.current) return;
    const target = e.target as HTMLElement;
    if (target.closest(".yui-vrm--renaming")) return;
    const row = target.closest<HTMLElement>(ROW);
    if (!row) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const option = options.find((o) => o.id === row.dataset.vrmId);
      if (option) void swapTo(option);
      return;
    }
    const rows = [...e.currentTarget.querySelectorAll<HTMLElement>(ROW)];
    const at = Math.max(0, rows.indexOf(row));
    let next: number;
    if (e.key === "ArrowDown" || e.key === "ArrowRight") next = at + 1;
    else if (e.key === "ArrowUp" || e.key === "ArrowLeft") next = at - 1;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = rows.length - 1;
    else return;
    e.preventDefault();
    const to = rows[(next + rows.length) % rows.length];
    update({ rovedId: to.dataset.vrmId ?? null });
    to.focus();
    to.scrollIntoView?.({ block: "nearest" });
  }

  return {
    options,
    activeId,
    rovedId,
    renamingId,
    armedId,
    removeKey: (id) => (state.lastArm?.id === id ? state.lastArm.seq : 0),
    errorId: state.errorId,
    removingId: state.removingId,
    swappingId: state.swappingId,
    importing: state.importing,
    importError: state.importError,
    groupRef,
    swapTo,
    startRename: (id) => update({ armed: null, renamingId: id }),
    commitRename,
    cancelRename: () => update({ armed: null, renamingId: null }),
    remove,
    runImport,
    onKeyDown,
  };
}
