import { describe, expect, it, vi } from "vitest";
import { createAddressedChain } from "./addressed-chain";

describe("createAddressedChain", () => {
  it("admits two turns at max 2, then refuses until reset", () => {
    const chain = createAddressedChain(() => 2);

    expect(chain.canAdmit()).toBe(true);
    chain.count();
    expect(chain.canAdmit()).toBe(true);
    chain.count();
    expect(chain.canAdmit()).toBe(false);
    chain.reset();
    expect(chain.canAdmit()).toBe(true);
  });

  it("reads max on every call — a max of 0 admits none", () => {
    const max = vi.fn(() => 0);
    const chain = createAddressedChain(max);

    expect(chain.canAdmit()).toBe(false);
    expect(max).toHaveBeenCalled();
  });
});
