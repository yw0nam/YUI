import { describe, expect, it, vi } from "vitest";
import { createStateMirror, publishState } from "./state-mirror";

describe("publishState", () => {
  it("emits every change and the current value on an ask, and stops after teardown", () => {
    let value = 1;
    let notify: (v: number) => void = () => {};
    let ask: () => void = () => {};
    const emit = vi.fn();
    const stop = publishState({
      get: () => value,
      subscribe: (cb) => {
        notify = cb;
        return () => {
          notify = () => {};
        };
      },
      emit,
      onAsk: (cb) => {
        ask = cb;
        return () => {
          ask = () => {};
        };
      },
    });

    value = 2;
    notify(2);
    ask();
    expect(emit.mock.calls).toEqual([[2], [2]]);

    stop();
    notify(3);
    ask();
    expect(emit).toHaveBeenCalledTimes(2);
  });
});

describe("createStateMirror", () => {
  it("starts from the initial value, asks at once, follows updates and stops on dispose", () => {
    let push: (v: string) => void = () => {};
    const ask = vi.fn();
    const mirror = createStateMirror({
      initial: "none",
      on: (cb) => {
        push = cb;
        return () => {
          push = () => {};
        };
      },
      ask,
    });
    const seen: string[] = [];
    mirror.subscribe((v) => seen.push(v));

    expect(mirror.get()).toBe("none");
    expect(ask).toHaveBeenCalledTimes(1);

    push("a");
    expect(mirror.get()).toBe("a");
    expect(seen).toEqual(["a"]);

    mirror.refresh();
    expect(ask).toHaveBeenCalledTimes(2);

    mirror.dispose();
    push("b");
    expect(mirror.get()).toBe("a");
    expect(seen).toEqual(["a"]);
  });
});
