import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UserTurnRouted } from "../../io/bridge/settings-bridge";
import { createSequence } from "./sequence";

describe("createSequence", () => {
  const send = {
    sendId: "s1",
    targets: ["natsume", "perlica"],
    text: "hi",
    mention: "everyone" as const,
  };
  let emit: ReturnType<typeof vi.fn<(event: UserTurnRouted) => void>>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "info").mockImplementation(() => {});
    emit = vi.fn<(event: UserTurnRouted) => void>();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("emits to the next target only when the current one reports done for this send", () => {
    const seq = createSequence({ emit });
    seq.run(send);

    expect(emit.mock.calls).toEqual([
      [{ sendId: "s1", to: "natsume", text: "hi", mention: "everyone" }],
    ]);
    seq.turnDone({ sendId: "s1", preset: "natsume" });
    expect(emit.mock.calls.at(-1)).toEqual([
      { sendId: "s1", to: "perlica", text: "hi", mention: "everyone" },
    ]);
    seq.turnDone({ sendId: "s1", preset: "perlica" });
    expect(emit).toHaveBeenCalledTimes(2);
  });

  it("ignores a done for another send or another preset", () => {
    const seq = createSequence({ emit });
    seq.run(send);

    seq.turnDone({ sendId: "s0", preset: "natsume" });
    seq.turnDone({ sendId: "s1", preset: "perlica" });

    expect(emit).toHaveBeenCalledTimes(1);
  });

  it("ignores a second done for the same send and preset", () => {
    const seq = createSequence({ emit });
    seq.run(send);

    seq.turnDone({ sendId: "s1", preset: "natsume" });
    seq.turnDone({ sendId: "s1", preset: "natsume" });

    expect(emit).toHaveBeenCalledTimes(2);
  });

  it("moves on after 60 seconds without a done", () => {
    const seq = createSequence({ emit });
    seq.run(send);

    vi.advanceTimersByTime(59_999);
    expect(emit).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(emit.mock.calls.at(-1)?.[0]).toMatchObject({ to: "perlica" });
  });

  it("ignores a run that arrives while another send is current", () => {
    const onIdle = vi.fn();
    const seq = createSequence({ emit, onIdle });
    seq.run({ sendId: "s1", targets: ["natsume"], text: "one" });
    seq.run({ sendId: "s2", targets: ["perlica"], text: "two" });

    expect(emit.mock.calls).toEqual([[{ sendId: "s1", to: "natsume", text: "one" }]]);
    expect(seq.current()?.sendId).toBe("s1");
    seq.turnDone({ sendId: "s1", preset: "natsume" });
    expect(emit).toHaveBeenCalledTimes(1);
    expect(seq.current()).toBeNull();
    expect(onIdle).toHaveBeenCalledOnce();
  });
});
