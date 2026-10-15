import { describe, expect, it, vi } from "vitest";

const double = vi.fn(() => "default");

describe("Vitest mock configuration", () => {
  it("lets a test queue a mockReturnValueOnce value and leave it unused", () => {
    double.mockReturnValueOnce("queued");
  });

  it("a value queued with mockReturnValueOnce and left unused does not reach the next test", () => {
    expect(double()).toBe("default");
  });
});
