/**
 * Shared FillerPool fixture — every filler test constructing a pool literal needs all six tiers
 * even when it only cares about one or two, so it starts from the production empty pool.
 */

import type { FillerPool } from "../config/load";
import { emptyFillerPool } from "./filler-pool";

export function fillerPool(overrides: Partial<FillerPool> = {}): FillerPool {
  return { ...emptyFillerPool(), ...overrides };
}
