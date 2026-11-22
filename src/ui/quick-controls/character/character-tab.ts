/**
 * Character tab — the Body page's mount. The Body page renders itself; this module relays the open
 * and dispose hooks to it.
 */

import type { AvatarOption } from "../../../config/validators/avatar/types";
import type { createVrmSelection } from "../../../io/assets/vrm-selection";
import type { Logger } from "../../../logger";
import { createBodyPage } from "../body/body-page";
import type { RelationsDeps } from "../body/relations/relations-port";

/** Which rows the Character tab renders — and binds, and refreshes. */
export interface CharacterRows {
  /** The VRM list with its import button; every surface renders it. */
  vrms: true;
  /** The camera view reset. */
  viewpoint: boolean;
  /** The relations rows with their switch; the settings window and the pet popover render it. */
  relations: boolean;
}

export interface CharacterTab {
  /** The Body page's stack. */
  el: HTMLElement;
  /** Repaint every rendered row from its store — the open hook. */
  refresh(): void;
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
  /** Required with `rows.relations`. */
  relations?: RelationsDeps;
  /** The Body page appends itself here before its first render. */
  host: HTMLElement;
}): CharacterTab {
  const { rows, isOpen, log } = deps;

  const bodyPage = createBodyPage({
    vrmSelection: deps.vrmSelection,
    swapVrm: deps.swapVrm,
    importVrm: deps.importVrm,
    removeUserVrm: deps.removeUserVrm,
    isOpen,
    log,
    refreshTooltip: deps.refreshTooltip,
    onResetView: rows.viewpoint ? required(deps.onResetView, "viewpoint") : undefined,
    relations: rows.relations ? required(deps.relations, "relations") : undefined,
    host: deps.host,
  });

  return {
    el: bodyPage.el,
    refresh: bodyPage.refresh,
    dispose(): void {
      bodyPage.dispose();
      bodyPage.el.remove();
    },
  };
}

function required<T>(dep: T | undefined, row: string): T {
  if (dep === undefined) throw new Error(`character tab: the ${row} row needs its dependency`);
  return dep;
}
