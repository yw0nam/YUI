/** The Body page: its React root, and what the panel's open redraws. */

import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { FlagSettingsStore } from "../../../settings/persisted-store";
import type { PresetEntry } from "../../../settings/preset/active-preset";
import type { RelationsStore } from "../../../settings/relations/relations-store";
import { BodyPageView } from "./body-page-view";
import { createRelationsPort } from "./relations/relations-port";
import type { VrmListDeps } from "./vrm/use-vrm-list";

export interface BodyPage {
  el: HTMLElement;
  /** Re-reads every source, the presets included, and drops an armed remove: the open hook. */
  refresh(): void;
  dispose(): void;
}

export function createBodyPage(
  deps: Omit<VrmListDeps, "revision"> & {
    /** The view reset section renders with it. */
    onResetView?: () => void;
    /** The relations section renders with it. */
    relations?: {
      store: RelationsStore;
      relationsSwitch: FlagSettingsStore;
      /** This window's preset id. */
      self: string;
      presets: () => readonly PresetEntry[];
    };
  },
): BodyPage {
  const { relations, onResetView, ...vrm } = deps;
  const el = document.createElement("div");
  el.className = "yui-tab-stack";
  const root = createRoot(el);
  const props = {
    vrm,
    relations:
      relations && createRelationsPort({ ...relations, isOpen: deps.isOpen, log: deps.log }),
    onResetView,
    log: deps.log,
  };
  let revision = 0;
  const render = (): void =>
    flushSync(() => root.render(createElement(BodyPageView, { ...props, revision })));
  render();

  return {
    el,
    refresh(): void {
      revision++;
      render();
    },
    dispose(): void {
      root.unmount();
    },
  };
}
