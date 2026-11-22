/** The Together page: its React root, and the chain-cap reflection it runs on open. */

import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { Logger } from "../../../logger";
import type {
  GuardrailsSettingsStore,
  RateLimitDefaults,
} from "../../../settings/backend/guardrails-settings";
import type { PetWindows } from "../../../settings/preset/pet-windows";
import type { PresetRegistry } from "../../../settings/preset/preset-registry";
import type { SwitchRow } from "../switch-row";
import type { ChainCapReflect } from "./chain-cap/chain-cap-row";
import { TogetherPageView } from "./together-page-view";

type WindowsPort = Pick<PetWindows, "get" | "open" | "close" | "subscribe" | "invalidate">;

export interface TogetherPage {
  el: HTMLElement;
  /** Repaints the chain cap from its store and the bundled defaults. */
  reflect(): void;
  dispose(): void;
}

export function createTogetherPage(deps: {
  /** The page's switch-row descriptors, in row-table order. */
  rows: readonly SwitchRow[];
  rateLimitSettings?: GuardrailsSettingsStore;
  getRateLimitDefaults?: () => RateLimitDefaults | undefined;
  registry?: Pick<PresetRegistry, "get" | "subscribe">;
  petWindows?: WindowsPort;
  /** A bound window's own preset; turning it off would close the window showing this list. */
  boundId?: string | null;
  log: Logger;
}): TogetherPage {
  const el = document.createElement("div");
  el.className = "yui-tab-stack";
  const capReflect: ChainCapReflect = { current: null };
  const root = createRoot(el);
  flushSync(() => root.render(createElement(TogetherPageView, { ...deps, capReflect })));

  return {
    el,
    reflect(): void {
      capReflect.current?.();
    },
    dispose(): void {
      root.unmount();
    },
  };
}
