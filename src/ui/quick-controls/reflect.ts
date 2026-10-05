/**
 * Reflect layer — repaints the switch rows from their stores; every section reflects its own nodes.
 */

import type { SwitchRow } from "./switch-row";
import { reflectSwitchRows } from "./switches/switch-rows";

interface ReflectDeps {
  /** Panel root (el) — all reflect target nodes are queried from here. */
  root: HTMLElement;
  switchRows: readonly SwitchRow[];
}

export interface Reflect {
  reflectSwitchRows(): void;
}

export function createReflect(deps: ReflectDeps): Reflect {
  const { root, switchRows } = deps;

  const reflectSwitchRowsFromDeps = (): void => reflectSwitchRows(root, switchRows);

  return {
    reflectSwitchRows: reflectSwitchRowsFromDeps,
  };
}
