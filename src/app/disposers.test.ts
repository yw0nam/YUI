import { describe, expect, it, vi } from "vitest";
import { createDisposers } from "./disposers";

describe("createDisposers", () => {
  it("runs a registration made after dispose immediately", () => {
    const disposers = createDisposers();
    disposers.dispose();
    expect(disposers.isDisposed()).toBe(true);

    const late = vi.fn();
    disposers.register(late);

    expect(late).toHaveBeenCalledOnce();
  });

  it("drains LIFO, keeps going through failures, and rethrows the first error", () => {
    const disposers = createDisposers();
    const order: string[] = [];
    const first = vi.fn(() => order.push("first"));
    const second = vi.fn(() => {
      order.push("second");
      throw new Error("second");
    });
    const third = vi.fn(() => {
      order.push("third");
      throw new Error("third");
    });
    disposers.register(first);
    disposers.register(second);
    disposers.register(third);

    expect(() => disposers.dispose()).toThrow("third");
    expect(order).toEqual(["third", "second", "first"]);
  });
});
