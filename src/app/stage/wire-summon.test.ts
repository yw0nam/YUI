import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ isTauri: vi.fn(() => false) }));

vi.mock("../../tauri-env", () => ({ isTauri: mocks.isTauri }));

import { showAndFocusFromSummon, wirePeek, wirePeekExitTriggers } from "./wire-summon";

describe("wirePeek", () => {
  it("returns null and registers nothing outside Tauri", async () => {
    mocks.isTauri.mockReturnValue(false);
    const register = vi.fn();

    const peekState = await wirePeek({ bus: {} as never, register, ensureActive: vi.fn() });

    expect(peekState).toBeNull();
    expect(register).not.toHaveBeenCalled();
  });
});

describe("wirePeekExitTriggers", () => {
  const setup = async () => {
    let focusHandler: ((event: { payload: boolean }) => void) | undefined;
    let trayHandler: (() => void) | undefined;
    let active = true;
    const exit = vi.fn(async () => {
      active = false;
    });
    const push = vi.fn();
    const dispose = await wirePeekExitTriggers({
      bus: { push } as never,
      peek: { active: () => active, exit },
      win: {
        onFocusChanged: vi.fn(async (handler) => {
          focusHandler = handler;
          return vi.fn();
        }),
        listen: vi.fn(async (_event, handler) => {
          trayHandler = handler;
          return vi.fn();
        }),
      },
    });
    return {
      exit,
      push,
      dispose,
      focus: (focused: boolean) => focusHandler?.({ payload: focused }),
      tray: () => trayHandler?.(),
      setActive: (next: boolean) => {
        active = next;
      },
    };
  };

  it("pushes exactly one peek exit on focus gain while active", async () => {
    const s = await setup();
    s.focus(true);
    s.focus(true);
    await Promise.resolve();
    expect(s.exit).toHaveBeenCalledTimes(1);
    expect(s.push).toHaveBeenCalledTimes(1);
    expect(s.push).toHaveBeenCalledWith(
      expect.objectContaining({ event_name: "user.peek_exit", hint_tier: 1 }),
    );
    s.dispose();
  });

  it("ignores focus loss and inactive focus gain", async () => {
    const s = await setup();
    s.focus(false);
    s.setActive(false);
    s.focus(true);
    await Promise.resolve();
    expect(s.exit).not.toHaveBeenCalled();
    expect(s.push).not.toHaveBeenCalled();
    s.dispose();
  });

  it("exits for either tray visibility toggle", async () => {
    const s = await setup();
    s.tray();
    await Promise.resolve();
    expect(s.exit).toHaveBeenCalledTimes(1);
    expect(s.push).toHaveBeenCalledTimes(1);
    s.dispose();
  });

  it("removes the focus listener when tray listener setup fails", async () => {
    const unlistenFocus = vi.fn();
    const failure = new Error("tray listen failed");

    await expect(
      wirePeekExitTriggers({
        bus: { push: vi.fn() } as never,
        peek: { active: () => false, exit: vi.fn() },
        win: {
          onFocusChanged: vi.fn(async () => unlistenFocus),
          listen: vi.fn(async () => {
            throw failure;
          }),
        },
      }),
    ).rejects.toThrow(failure);
    expect(unlistenFocus).toHaveBeenCalledOnce();
  });
});

describe("showAndFocusFromSummon", () => {
  it("awaits peek restoration before focusing and pushes the motion exit", async () => {
    const order: string[] = [];
    const push = vi.fn(() => order.push("push"));
    await showAndFocusFromSummon({
      bus: { push } as never,
      peek: {
        active: () => true,
        exit: vi.fn(async () => {
          order.push("exit-start");
          await Promise.resolve();
          order.push("exit-end");
        }),
      },
      win: {
        show: vi.fn(async () => {
          order.push("show");
        }),
        setFocus: vi.fn(async () => {
          order.push("focus");
        }),
      },
    });
    expect(order).toEqual(["show", "exit-start", "exit-end", "push", "focus"]);
    expect(push).toHaveBeenCalledWith(expect.objectContaining({ event_name: "user.peek_exit" }));
  });
});
