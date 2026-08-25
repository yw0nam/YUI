/**
 * Shared FillerPool fixture — every filler test constructing a pool literal needs all six tiers
 * even when it only cares about one or two, so the empty defaults live here once.
 */

import type { FillerPool } from "../config/load";

export function fillerPool(overrides: Partial<FillerPool> = {}): FillerPool {
  return {
    first: [],
    repeat: [],
    long_wait: [],
    tool: {},
    timeout: [],
    unreachable: [],
    ...overrides,
  };
}
