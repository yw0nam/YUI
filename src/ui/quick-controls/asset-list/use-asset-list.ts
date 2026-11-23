/** The state and rules of a user-managed radiogroup: roving focus, swap, rename and armed remove. */

import {
  type KeyboardEvent,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
} from "react";
import type { Logger } from "../../../logger";
import "../row-actions.css";
import "./asset-list.css";

const REMOVE_CONFIRM_MS = 4000;

/** The roving tab stop: the last roved row while it is listed, else the active one. */
function resolveRovedId(roved: string | null, ids: string[], activeId: string): string {
  return roved !== null && ids.includes(roved) ? roved : activeId;
}

export interface AssetOption {
  id: string;
  label?: string;
}

/** What the list reads from its selection store. */
export interface AssetSelection<T extends AssetOption> {
  list(): T[];
  getActiveId(): string;
  getActive(): T;
  subscribe(cb: () => void): () => void;
  renameUserOption(id: string, label: string): void;
}

export interface AssetListDeps<T extends AssetOption> {
  selection: AssetSelection<T>;
  /** Load the option, then commit the selection. The list never selects on its own. */
  swap: (option: T) => Promise<void>;
  /** Delete the option's file (idempotent), before the store drops it. */
  removeFile: (id: string) => Promise<void>;
  removeFromStore: (id: string) => void;
  /** The store's repaints reach the list only while the tab is open. */
  isOpen: () => boolean;
  /** Moves on each open; the list is read again and an armed remove drops. */
  revision: number;
  log: Logger;
  /** Prefix of the log keys: `${logPrefix}_swap`. */
  logPrefix: string;
  /** The rows' class prefix: `yui-vrm` gives `.yui-vrm[role=radio]`, `.yui-vrm__remove`, `.yui-vrm--renaming`. */
  classPrefix: string;
  /** The row dataset key holding the option id: `vrmId` for `data-vrm-id`. */
  datasetKey: string;
}

interface ListState {
  rovedId: string | null;
  renamingId: string | null;
  errorId: string | null;
  removingId: string | null;
  swappingId: string | null;
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
  armed: null,
  lastArm: null,
};

export interface AssetList<T extends AssetOption> {
  options: T[];
  activeId: string;
  rovedId: string;
  renamingId: string | null;
  armedId: string | null;
  /** Changes when the row's remove button is armed, never when it is disarmed. */
  removeKey(id: string): number;
  errorId: string | null;
  removingId: string | null;
  swappingId: string | null;
  groupRef: RefObject<HTMLDivElement | null>;
  swapTo(option: T): Promise<void>;
  startRename(id: string): void;
  commitRename(id: string, label: string): boolean;
  cancelRename(): void;
  remove(id: string): Promise<void>;
  /** A redraw the list's own actions do not make; it drops an armed remove. */
  repaint(): void;
  onKeyDown(e: KeyboardEvent<HTMLElement>): void;
}

export function useAssetList<T extends AssetOption>(deps: AssetListDeps<T>): AssetList<T> {
  const {
    selection,
    swap,
    removeFile,
    removeFromStore,
    isOpen,
    revision,
    log,
    logPrefix,
    classPrefix,
    datasetKey,
  } = deps;
  const rowSelector = `.${classPrefix}[role=radio]`;
  const [state, dispatch] = useReducer(
    (s: ListState, patch: Partial<ListState>): ListState => ({ ...s, ...patch }),
    INITIAL,
  );
  const groupRef = useRef<HTMLDivElement>(null);
  // Whether focus sat in the group before the change that may drop it.
  const hadFocus = useRef(false);
  const swapping = useRef(false);
  const removing = useRef(false);

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
      selection.subscribe(() => {
        if (isOpen() && !swapping.current) repaint();
      }),
    [selection, isOpen, repaint],
  );

  const options = selection.list();
  const activeId = selection.getActiveId();
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
      if (!(e.target as Element | null)?.closest(`.${classPrefix}__remove`)) repaint();
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
  }, [armedId, repaint, classPrefix]);

  // A commit that dropped the group's focused node hands focus back to the roved row.
  useLayoutEffect(() => {
    if (!hadFocus.current) return;
    hadFocus.current = false;
    const group = groupRef.current;
    if (!group || group.contains(group.ownerDocument.activeElement)) return;
    const roved = [...group.querySelectorAll<HTMLElement>(rowSelector)].find(
      (row) => row.dataset[datasetKey] === rovedId,
    );
    roved?.focus();
    roved?.scrollIntoView?.({ block: "nearest" });
  });

  async function swapTo(option: T): Promise<void> {
    if (swapping.current) return;
    if (option.id === selection.getActiveId()) return;
    swapping.current = true;
    update({ errorId: null, swappingId: option.id });
    try {
      await swap(option);
      update({ rovedId: option.id });
      log.info(`${logPrefix}_swap`, { id: option.id });
    } catch (err) {
      update({ errorId: option.id });
      log.error(`${logPrefix}_swap_failed`, { id: option.id, error: String(err) });
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
    const wasActive = selection.getActiveId() === id;
    log.info(`${logPrefix}_delete`, { id });
    try {
      await removeFile(id);
    } catch (err) {
      // The file stays, so the row stays.
      removing.current = false;
      update({ armed: null, removingId: null, errorId: id });
      log.error(`${logPrefix}_delete_failed`, { id, error: String(err) });
      return;
    }
    removing.current = false;
    removeFromStore(id);
    // Removing an option that is not the active one does not notify, so the update repaints.
    update({ armed: null, removingId: null });
    if (!wasActive) return;
    try {
      await swap(selection.getActive());
    } catch (err) {
      log.error(`${logPrefix}_fallback_swap_failed`, { error: String(err) });
      repaint();
    }
  }

  function commitRename(id: string, label: string): boolean {
    if (renamingId !== id) return false;
    update({ armed: null, renamingId: null });
    // An empty label is refused by the store, which keeps the old one.
    selection.renameUserOption(id, label);
    log.info(`${logPrefix}_rename`, { id });
    return true;
  }

  // Enter and Space select, arrows move the roving tab stop only (wrapping), Home and End jump.
  function onKeyDown(e: KeyboardEvent<HTMLElement>): void {
    if (swapping.current) return;
    const target = e.target as HTMLElement;
    if (target.closest(`.${classPrefix}--renaming`)) return;
    const row = target.closest<HTMLElement>(rowSelector);
    if (!row) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const option = options.find((o) => o.id === row.dataset[datasetKey]);
      if (option) void swapTo(option);
      return;
    }
    const rows = [...e.currentTarget.querySelectorAll<HTMLElement>(rowSelector)];
    const at = Math.max(0, rows.indexOf(row));
    let next: number;
    if (e.key === "ArrowDown" || e.key === "ArrowRight") next = at + 1;
    else if (e.key === "ArrowUp" || e.key === "ArrowLeft") next = at - 1;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = rows.length - 1;
    else return;
    e.preventDefault();
    const to = rows[(next + rows.length) % rows.length];
    update({ rovedId: to.dataset[datasetKey] ?? null });
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
    groupRef,
    swapTo,
    startRename: (id) => update({ armed: null, renamingId: id }),
    commitRename,
    cancelRename: () => update({ armed: null, renamingId: null }),
    remove,
    repaint,
    onKeyDown,
  };
}
