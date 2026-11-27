/** The chain cap: how many addressed turns a window takes in a row without a user turn. */
export interface AddressedChain {
  /** Whether one more fits, with `pending` already admitted but not yet counted. */
  canAdmit(pending?: number): boolean;
  /** Counts `n` admitted addressed turns, one by default. */
  count(n?: number): void;
  reset(): void;
}

export function createAddressedChain(max: () => number): AddressedChain {
  let taken = 0;
  return {
    canAdmit: (pending = 0) => taken + pending < max(),
    count(n = 1) {
      taken += n;
    },
    reset() {
      taken = 0;
    },
  };
}
