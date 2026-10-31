/**
 * Character tab — two stacks: the Body page's VRM list with import, relations rows and camera view
 * reset, and the Motion page's mouth-gain, idle and express motion rows. `rows` picks
 * which render; the same rows drive markup, handlers and subscriptions, so only rendered rows are
 * bound.
 */

import type { AvatarOption } from "../../../config/validators/avatar/types";
import type { createVrmSelection } from "../../../io/assets/vrm-selection";
import type { Logger } from "../../../logger";
import type { ExpressMotionSettingsStore } from "../../../settings/avatar/express-motion-settings";
import type {
  IdleMotionSettingsStore,
  IdleVariantPool,
} from "../../../settings/avatar/idle-motion-settings";
import type { createLipsyncSettings } from "../../../settings/avatar/lipsync-settings";
import type { FlagSettingsStore } from "../../../settings/persisted-store";
import type { PresetEntry } from "../../../settings/preset/active-preset";
import type { RelationsStore } from "../../../settings/relations/relations-store";
import { bodyHtml, type CharacterRows, motionHtml } from "./character-html";
import { createExpressMotionList } from "./express-motion/express-motion-section";
import { createGainRow } from "./gain/gain-row";
import { createIdleMotionList } from "./idle-motion/idle-motion-section";
import { createRelationsEditSection } from "./relations/relations-edit-section";
import { bindViewpointReset } from "./viewpoint/viewpoint-row";
import { createVrmList } from "./vrm/vrm-list";

export type { CharacterRows } from "./character-html";

export interface CharacterTab {
  /** The Body page's stack. */
  el: HTMLElement;
  /** The Motion page's stack. */
  motionEl: HTMLElement;
  /** Repaint every rendered row from its store — the open hook. */
  refresh(): void;
  /** End a running gain preview — the close hook. */
  close(): void;
  dispose(): void;
}

export function createCharacterTab(deps: {
  rows: CharacterRows;
  vrmSelection: ReturnType<typeof createVrmSelection>;
  /** Load the model, then commit the selection. The list never selects on its own. */
  swapVrm: (option: AvatarOption) => Promise<void>;
  /** Pick a file, load it, add the option and select it. The list shows an inline error on reject. */
  importVrm: () => Promise<void>;
  /** Delete an imported VRM's file (idempotent). */
  removeUserVrm: (id: string) => Promise<void>;
  /** Skip repaints while the tab is closed. */
  isOpen: () => boolean;
  log: Logger;
  /** Re-measure hover hints after a row's label changes. */
  refreshTooltip?: () => void;
  /** The view reset; required with `rows.viewpoint`. */
  onResetView?: () => void;
  /** Required with `rows.gain`. */
  gain?: {
    lipsync: ReturnType<typeof createLipsyncSettings>;
    onPreview: (mouthOpen: number) => void;
    onPreviewEnd: () => void;
  };
  /** Required with `rows.idleMotion`. */
  idleMotion?: {
    settings: IdleMotionSettingsStore;
    /** The read-only `idle` catalog entry; undefined until configs load. */
    getPool: () => IdleVariantPool | undefined;
  };
  /** Required with `rows.expressMotion`. */
  expressMotion?: {
    settings: ExpressMotionSettingsStore;
    getVocabulary: () => readonly string[];
  };
  /** Required with `rows.relations`. */
  relations?: {
    store: RelationsStore;
    relationsSwitch: FlagSettingsStore;
    /** This window's preset id. */
    self: string;
    presets: () => readonly PresetEntry[];
  };
}): CharacterTab {
  const { rows, vrmSelection, isOpen, log } = deps;

  const el = document.createElement("div");
  el.className = "yui-tab-stack";
  el.innerHTML = bodyHtml(rows);
  const motionEl = document.createElement("div");
  motionEl.className = "yui-tab-stack";
  motionEl.innerHTML = motionHtml(rows);

  const vrmList = createVrmList({
    root: el,
    vrmSelection,
    swapVrm: deps.swapVrm,
    importVrm: deps.importVrm,
    removeUserVrm: deps.removeUserVrm,
    log,
    refreshTooltip: deps.refreshTooltip,
  });
  const vrmsEl = el.querySelector<HTMLDivElement>(".yui-vrms")!;
  const addBtn = el.querySelector<HTMLButtonElement>(".yui-vrm--add")!;
  vrmsEl.addEventListener("keydown", vrmList.handleKeydown);
  addBtn.addEventListener("click", vrmList.handleAddClick);
  // A swap repaints in its own finally, so the subscription skips it.
  const unsubscribeVrm = vrmSelection.subscribe(() => {
    if (isOpen() && !vrmList.isSwapping()) vrmList.render();
  });

  const gainRow = rows.gain
    ? createGainRow({ root: motionEl, ...required(deps.gain, "gain"), isOpen, log })
    : null;

  const idleMotion = rows.idleMotion ? required(deps.idleMotion, "idleMotion") : null;
  const idleMotionList = idleMotion
    ? createIdleMotionList({ root: motionEl, ...idleMotion, log })
    : null;
  const unsubscribeIdleMotion = idleMotion?.settings.subscribe(() => {
    if (isOpen()) idleMotionList?.render();
  });

  const expressMotion = rows.expressMotion ? required(deps.expressMotion, "expressMotion") : null;
  const expressMotionList = expressMotion
    ? createExpressMotionList({ root: motionEl, ...expressMotion, log })
    : null;
  const unsubscribeExpressMotion = expressMotion?.settings.subscribe(() => {
    if (isOpen()) expressMotionList?.render();
  });

  const relationsSection = rows.relations
    ? createRelationsEditSection({
        root: el,
        ...required(deps.relations, "relations"),
        isOpen,
        log,
      })
    : null;

  const unbindViewpoint = rows.viewpoint
    ? bindViewpointReset({ root: el, onReset: required(deps.onResetView, "viewpoint"), log })
    : null;

  return {
    el,
    motionEl,
    refresh(): void {
      gainRow?.refresh();
      vrmList.render();
      idleMotionList?.render();
      expressMotionList?.render();
      relationsSection?.refresh();
    },
    close(): void {
      gainRow?.endPreview();
    },
    dispose(): void {
      unsubscribeVrm();
      unsubscribeIdleMotion?.();
      unsubscribeExpressMotion?.();
      gainRow?.dispose();
      expressMotionList?.dispose();
      relationsSection?.dispose();
      unbindViewpoint?.();
      vrmList.dispose();
      vrmsEl.removeEventListener("keydown", vrmList.handleKeydown);
      addBtn.removeEventListener("click", vrmList.handleAddClick);
      el.remove();
      motionEl.remove();
    },
  };
}

function required<T>(dep: T | undefined, row: string): T {
  if (dep === undefined) throw new Error(`character tab: the ${row} row needs its dependency`);
  return dep;
}
