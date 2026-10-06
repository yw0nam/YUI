/**
 * summon-hotkey.test.ts — global input-summon hotkey register/unregister module.
 *
 * Locks:
 *  - apply(accel): calls register with the configured accelerator.
 *  - fire (state "Pressed"): focusWindow → summonInput order.
 *  - "Released" is ignored.
 *  - re-applying the same accelerator is a no-op (prevents double registration).
 *  - accelerator change: unregister the previous one, then register the new one.
 *  - empty string: unregister the existing binding + no new registration (disabled).
 *  - every registration a previous page left in this process is released once, before the first apply.
 *  - register rejection (invalid accelerator/OS-occupied): stays disabled without throwing (fail-soft).
 *  - transient register rejection (fast restart, the previous process still holds the key): retried until it takes.
 *  - summonInput is still called even if focusWindow fails.
 *  - dispose(): unregisters.
 */

import { describe, expect, it, vi } from "vitest";
import { createSummonHotkey, retryOnReject, type SummonHotkeyTrigger } from "./summon-hotkey";

/** Fake deps capturing registered handlers so tests can fire the shortcut. */
function fakeDeps() {
  const handlers = new Map<string, SummonHotkeyTrigger>();
  const calls: string[] = [];
  const deps = {
    register: vi.fn(async (accelerator: string, handler: SummonHotkeyTrigger) => {
      if (handlers.has(accelerator))
        throw new Error(`RegisterEventHotKey failed for ${accelerator}`);
      handlers.set(accelerator, handler);
    }),
    unregister: vi.fn(async (accelerator: string) => {
      handlers.delete(accelerator);
    }),
    unregisterAll: vi.fn(async () => {
      handlers.clear();
    }),
    focusWindow: vi.fn(async () => {
      calls.push("focus");
    }),
    summonInput: vi.fn(() => {
      calls.push("summon");
    }),
  };
  return {
    deps,
    calls,
    trigger(accelerator: string, state = "Pressed") {
      handlers.get(accelerator)?.({ state });
    },
  };
}

/** Waits for the trigger handler's async chain (focus → summon) to drain. */
async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("createSummonHotkey — apply", () => {
  it("apply(accel) calls register with the configured accelerator", async () => {
    const f = fakeDeps();
    const hotkey = createSummonHotkey(f.deps);
    await hotkey.apply("CmdOrCtrl+Shift+Y");
    expect(f.deps.register).toHaveBeenCalledTimes(1);
    expect(f.deps.register.mock.calls[0][0]).toBe("CmdOrCtrl+Shift+Y");
    expect(hotkey.current()).toBe("CmdOrCtrl+Shift+Y");
  });

  it("re-applying the same accelerator is a no-op (prevents double registration)", async () => {
    const f = fakeDeps();
    const hotkey = createSummonHotkey(f.deps);
    await hotkey.apply("CmdOrCtrl+Shift+Y");
    await hotkey.apply("CmdOrCtrl+Shift+Y");
    expect(f.deps.register).toHaveBeenCalledTimes(1);
    expect(f.deps.unregister).not.toHaveBeenCalled();
  });

  it("on an accelerator change, unregisters the previous one then registers the new one", async () => {
    const f = fakeDeps();
    const hotkey = createSummonHotkey(f.deps);
    await hotkey.apply("CmdOrCtrl+Shift+Y");
    await hotkey.apply("Alt+Space");
    expect(f.deps.unregister).toHaveBeenCalledWith("CmdOrCtrl+Shift+Y");
    expect(f.deps.register).toHaveBeenLastCalledWith("Alt+Space", expect.any(Function));
    expect(hotkey.current()).toBe("Alt+Space");
  });

  it("an empty string unregisters the existing registration and makes no new one (inactive)", async () => {
    const f = fakeDeps();
    const hotkey = createSummonHotkey(f.deps);
    await hotkey.apply("CmdOrCtrl+Shift+Y");
    await hotkey.apply("");
    expect(f.deps.unregister).toHaveBeenCalledWith("CmdOrCtrl+Shift+Y");
    expect(f.deps.register).toHaveBeenCalledTimes(1);
    expect(hotkey.current()).toBeNull();
  });

  it("an empty string makes no calls when nothing is registered", async () => {
    const f = fakeDeps();
    const hotkey = createSummonHotkey(f.deps);
    await hotkey.apply("");
    expect(f.deps.register).not.toHaveBeenCalled();
    expect(f.deps.unregister).not.toHaveBeenCalled();
    expect(hotkey.current()).toBeNull();
  });
});

describe("createSummonHotkey — stale registration", () => {
  /** Drives a hotkey promise past the register backoff without waiting in real time. */
  async function settle<T>(promise: Promise<T>): Promise<T> {
    await vi.advanceTimersByTimeAsync(60_000);
    return promise;
  }

  it("registers with the new handler even when the previous page left the same accelerator", async () => {
    const f = fakeDeps();
    const stale = vi.fn();
    await f.deps.register("CmdOrCtrl+Shift+Y", stale);
    f.deps.register.mockClear();
    const onRegisterFailed = vi.fn();
    const hotkey = createSummonHotkey({ ...f.deps, onRegisterFailed });
    vi.useFakeTimers();
    try {
      await settle(hotkey.apply("CmdOrCtrl+Shift+Y"));
    } finally {
      vi.useRealTimers();
    }
    expect(onRegisterFailed).not.toHaveBeenCalled();
    expect(hotkey.current()).toBe("CmdOrCtrl+Shift+Y");
    f.trigger("CmdOrCtrl+Shift+Y");
    await flush();
    expect(f.deps.focusWindow).toHaveBeenCalled();
    expect(stale).not.toHaveBeenCalled();
  });

  it("unregisters the previous page's leftover registration too when it left a different accelerator", async () => {
    const f = fakeDeps();
    const stale = vi.fn();
    await f.deps.register("Alt+Space", stale);
    const hotkey = createSummonHotkey(f.deps);
    vi.useFakeTimers();
    try {
      await settle(hotkey.apply("CmdOrCtrl+Shift+Y"));
    } finally {
      vi.useRealTimers();
    }
    f.trigger("Alt+Space");
    await flush();
    expect(stale).not.toHaveBeenCalled();
    expect(f.deps.focusWindow).not.toHaveBeenCalled();
    expect(hotkey.current()).toBe("CmdOrCtrl+Shift+Y");
  });

  it("attempts register even when unregisterAll rejects", async () => {
    const f = fakeDeps();
    f.deps.unregisterAll.mockRejectedValueOnce(new Error("not allowed"));
    const hotkey = createSummonHotkey(f.deps);
    await hotkey.apply("CmdOrCtrl+Shift+Y");
    expect(f.deps.register).toHaveBeenCalledWith("CmdOrCtrl+Shift+Y", expect.any(Function));
    expect(hotkey.current()).toBe("CmdOrCtrl+Shift+Y");
  });
});

describe("createSummonHotkey — trigger", () => {
  it("on Pressed, calls focusWindow then summonInput in that order", async () => {
    const f = fakeDeps();
    const hotkey = createSummonHotkey(f.deps);
    await hotkey.apply("CmdOrCtrl+Shift+Y");
    f.trigger("CmdOrCtrl+Shift+Y");
    await flush();
    expect(f.deps.focusWindow).toHaveBeenCalledTimes(1);
    expect(f.deps.summonInput).toHaveBeenCalledTimes(1);
    expect(f.calls).toEqual(["focus", "summon"]);
  });

  it("ignores Released", async () => {
    const f = fakeDeps();
    const hotkey = createSummonHotkey(f.deps);
    await hotkey.apply("CmdOrCtrl+Shift+Y");
    f.trigger("CmdOrCtrl+Shift+Y", "Released");
    await flush();
    expect(f.deps.focusWindow).not.toHaveBeenCalled();
    expect(f.deps.summonInput).not.toHaveBeenCalled();
  });

  it("still calls summonInput when focusWindow fails", async () => {
    const f = fakeDeps();
    f.deps.focusWindow.mockRejectedValueOnce(new Error("focus denied"));
    const hotkey = createSummonHotkey(f.deps);
    await hotkey.apply("CmdOrCtrl+Shift+Y");
    f.trigger("CmdOrCtrl+Shift+Y");
    await flush();
    expect(f.deps.summonInput).toHaveBeenCalledTimes(1);
  });

  it("lets key-repeat presses arriving mid-cycle pass without summoning twice", async () => {
    const f = fakeDeps();
    // Hold focusWindow open to keep the first cycle in-flight.
    let releaseFocus!: () => void;
    f.deps.focusWindow.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        releaseFocus = resolve;
      }),
    );
    const hotkey = createSummonHotkey(f.deps);
    await hotkey.apply("CmdOrCtrl+Shift+Y");
    // First fire is in-flight; the second arrives in the same frame (focus not yet resolved) → must be dropped.
    f.trigger("CmdOrCtrl+Shift+Y");
    f.trigger("CmdOrCtrl+Shift+Y");
    releaseFocus();
    await flush();
    expect(f.deps.focusWindow).toHaveBeenCalledTimes(1);
    expect(f.deps.summonInput).toHaveBeenCalledTimes(1);
  });
});

describe("retryOnReject", () => {
  it("stops attempting once a try succeeds", async () => {
    const op = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("busy"))
      .mockRejectedValueOnce(new Error("busy"))
      .mockResolvedValue(undefined);
    await retryOnReject(op, 5, 0);
    expect(op).toHaveBeenCalledTimes(3);
  });

  it("rejects with the last rejection reason after exhausting every attempt", async () => {
    const op = vi.fn<() => Promise<void>>().mockRejectedValue(new Error("still held"));
    await expect(retryOnReject(op, 3, 0)).rejects.toThrow("still held");
    expect(op).toHaveBeenCalledTimes(3);
  });
});

describe("createSummonHotkey — fail-soft", () => {
  /** Drives a hotkey promise past the register backoff without waiting in real time. */
  async function settle<T>(promise: Promise<T>): Promise<T> {
    await vi.advanceTimersByTimeAsync(60_000);
    return promise;
  }

  it("registers via retry even while the OS still holds the key for the previous process", async () => {
    vi.useFakeTimers();
    try {
      const f = fakeDeps();
      const failing = f.deps.register.getMockImplementation();
      f.deps.register
        .mockRejectedValueOnce(new Error("RegisterEventHotKey failed for KeyY"))
        .mockRejectedValueOnce(new Error("RegisterEventHotKey failed for KeyY"))
        .mockImplementation(failing!);
      const hotkey = createSummonHotkey(f.deps);
      await settle(hotkey.apply("CmdOrCtrl+Shift+Y"));
      expect(f.deps.register).toHaveBeenCalledTimes(3);
      expect(hotkey.current()).toBe("CmdOrCtrl+Shift+Y");
    } finally {
      vi.useRealTimers();
    }
  });

  it("a rejected register (invalid accelerator) keeps it inactive without throwing", async () => {
    vi.useFakeTimers();
    try {
      const f = fakeDeps();
      f.deps.register.mockRejectedValue(new Error("invalid accelerator"));
      const hotkey = createSummonHotkey(f.deps);
      await expect(settle(hotkey.apply("NotAKey+++"))).resolves.toBeUndefined();
      expect(hotkey.current()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("recovers on the next apply (valid accelerator) after a rejected register", async () => {
    vi.useFakeTimers();
    try {
      const f = fakeDeps();
      const working = f.deps.register.getMockImplementation();
      f.deps.register.mockRejectedValue(new Error("invalid accelerator"));
      const hotkey = createSummonHotkey(f.deps);
      await settle(hotkey.apply("NotAKey+++"));
      f.deps.register.mockImplementation(working!);
      await settle(hotkey.apply("CmdOrCtrl+Shift+Y"));
      expect(hotkey.current()).toBe("CmdOrCtrl+Shift+Y");
    } finally {
      vi.useRealTimers();
    }
  });

  it("apply keeps going even when unregister rejects (attempts the new registration)", async () => {
    const f = fakeDeps();
    const hotkey = createSummonHotkey(f.deps);
    await hotkey.apply("CmdOrCtrl+Shift+Y");
    f.deps.unregister.mockRejectedValueOnce(new Error("gone"));
    await hotkey.apply("Alt+Space");
    expect(hotkey.current()).toBe("Alt+Space");
  });
});

describe("createSummonHotkey — dispose", () => {
  it("dispose() releases the current registration", async () => {
    const f = fakeDeps();
    const hotkey = createSummonHotkey(f.deps);
    await hotkey.apply("CmdOrCtrl+Shift+Y");
    await hotkey.dispose();
    expect(f.deps.unregister).toHaveBeenCalledWith("CmdOrCtrl+Shift+Y");
    expect(hotkey.current()).toBeNull();
  });

  it("dispose() without a registration completes without any calls", async () => {
    const f = fakeDeps();
    const hotkey = createSummonHotkey(f.deps);
    await hotkey.dispose();
    expect(f.deps.unregister).not.toHaveBeenCalled();
  });
});

describe("createSummonHotkey — onRegisterFailed", () => {
  /** Drives a hotkey promise past the register backoff without waiting in real time. */
  async function settle<T>(promise: Promise<T>): Promise<T> {
    await vi.advanceTimersByTimeAsync(60_000);
    return promise;
  }

  it("calls onRegisterFailed(accelerator) when registration exhausts every retry", async () => {
    vi.useFakeTimers();
    try {
      const f = fakeDeps();
      const onRegisterFailed = vi.fn();
      f.deps.register.mockRejectedValue(new Error("held by another app"));
      const hotkey = createSummonHotkey({ ...f.deps, onRegisterFailed });
      await settle(hotkey.apply("CmdOrCtrl+Shift+Y"));
      expect(onRegisterFailed).toHaveBeenCalledWith("CmdOrCtrl+Shift+Y");
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not call it when registration succeeds", async () => {
    const f = fakeDeps();
    const onRegisterFailed = vi.fn();
    const hotkey = createSummonHotkey({ ...f.deps, onRegisterFailed });
    await hotkey.apply("CmdOrCtrl+Shift+Y");
    expect(onRegisterFailed).not.toHaveBeenCalled();
  });
});
