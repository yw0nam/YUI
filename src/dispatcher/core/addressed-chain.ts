/** The chain cap: how many addressed turns a window takes in a row without a user turn. */
export interface AddressedChain {
  canAdmit(): boolean;
  count(): void;
  reset(): void;
}

export function createAddressedChain(max: () => number): AddressedChain {
  let taken = 0;
  return {
    canAdmit: () => taken < max(),
    count() {
      taken += 1;
    },
    reset() {
      taken = 0;
    },
  };
}
