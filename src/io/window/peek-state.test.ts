import { describe, expect, it, vi } from "vitest";
import { createPeekState } from "./peek-state";

function fixture() {
  const calls: string[] = [];
  const win = {
    setAlwaysOnTop: vi.fn(async (value: boolean) => {
      calls.push(`top:${value}`);
    }),
    setAlwaysOnBottom: vi.fn(async (value: boolean) => {
      calls.push(`bottom:${value}`);
    }),
  };
  return { calls, win, state: createPeekState({ getWindow: () => win }) };
}

describe("createPeekState", () => {
  it("enters and exits in the required order with synchronous intent", async () => {
    const { calls, state } = fixture();
    const entering = state.enter();
    expect(state.active()).toBe(true);
    await entering;
    expect(calls).toEqual(["top:false", "bottom:true"]);

    const exiting = state.exit();
    expect(state.active()).toBe(false);
    await exiting;
    expect(calls).toEqual(["top:false", "bottom:true", "bottom:false", "top:true"]);
  });

  it("serializes exit behind a pending enter so the final call wins", async () => {
    const { calls, win, state } = fixture();
    let release: (() => void) | undefined;
    win.setAlwaysOnTop.mockImplementationOnce(
      () => new Promise<void>((resolve) => (release = resolve)),
    );
    const entering = state.enter();
    const exiting = state.exit();
    expect(state.active()).toBe(false);
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    expect(calls).toEqual([]);
    release?.();
    await Promise.all([entering, exiting]);
    expect(calls).toEqual(["bottom:true", "bottom:false", "top:true"]);
  });

  it("serializes enter behind a pending exit so the final call wins", async () => {
    const { calls, win, state } = fixture();
    await state.enter();
    calls.length = 0;
    let release: (() => void) | undefined;
    win.setAlwaysOnBottom.mockImplementationOnce(
      () => new Promise<void>((resolve) => (release = resolve)),
    );
    const exiting = state.exit();
    const entering = state.enter();
    expect(state.active()).toBe(true);
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    expect(calls).toEqual([]);
    release?.();
    await Promise.all([exiting, entering]);
    expect(calls).toEqual(["top:true", "top:false", "bottom:true"]);
  });

  it("makes duplicate enter and exit calls idempotent", async () => {
    const { calls, state } = fixture();
    await Promise.all([state.enter(), state.enter()]);
    await Promise.all([state.exit(), state.exit()]);
    expect(calls).toEqual(["top:false", "bottom:true", "bottom:false", "top:true"]);
  });

  it("continues restoration after failure and retries a dirty exit", async () => {
    const { calls, win, state } = fixture();
    await state.enter();
    calls.length = 0;
    win.setAlwaysOnBottom.mockRejectedValueOnce(new Error("bottom restore failed"));
    await expect(state.exit()).resolves.toBeUndefined();
    expect(win.setAlwaysOnTop).toHaveBeenLastCalledWith(true);
    expect(calls).toEqual(["top:true"]);

    await state.exit();
    expect(win.setAlwaysOnBottom).toHaveBeenLastCalledWith(false);
    expect(win.setAlwaysOnTop).toHaveBeenLastCalledWith(true);
  });

  it("dispose restores an active peek", async () => {
    const { state, win } = fixture();
    await state.enter();
    await state.dispose();
    expect(state.active()).toBe(false);
    expect(win.setAlwaysOnBottom).toHaveBeenLastCalledWith(false);
    expect(win.setAlwaysOnTop).toHaveBeenLastCalledWith(true);
  });
});
