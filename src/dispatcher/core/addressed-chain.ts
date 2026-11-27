/** The chain cap: how many addressed turns a window takes in a row without a user turn. */
export interface AddressedChain {
  /** Whether one more fits, with `pending` already admitted but not yet counted. */
  canAdmit(pending?: number): boolean;
  /** Counts `n` admitted addressed turns, one by default. */
  count(n?: number): void;
  /** The count after the last charge; the exchange line's used. */
  taken(): number;
  /** The cap the last admission read; the exchange line's max. */
  max(): number;
  reset(): void;
}

export function createAddressedChain(max: () => number): AddressedChain {
  let taken = 0;
  return {
    canAdmit: (pending = 0) => taken + pending < max(),
    count(n = 1) {
      taken += n;
    },
    taken: () => taken,
    max,
    reset() {
      taken = 0;
    },
  };
}

/** Stamps the used count beside the max release stamped, before the context awaits. */
export function stampExchangeUsed(env: { payload?: Record<string, unknown> }, used: number): void {
  const exchange = env.payload?.exchange as { max?: unknown } | undefined;
  if (!exchange || typeof exchange.max !== "number") return;
  env.payload = { ...env.payload, exchange: { max: exchange.max, used } };
}
