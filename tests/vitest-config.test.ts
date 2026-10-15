import { describe, expect, it, vi } from "vitest";

const queuedMock = vi.fn(() => "default");

// The pair needs declaration order: the first test leaves a value queued for the second to look for.
describe("Vitest mock configuration", { shuffle: false }, () => {
  it("leaves a mockReturnValueOnce value queued and unused", () => {
    queuedMock.mockReturnValueOnce("queued");
  });

  it("a value queued with mockReturnValueOnce and left unused does not reach the next test", () => {
    expect(queuedMock()).toBe("default");
  });
});
