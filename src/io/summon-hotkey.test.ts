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
 *  - register rejection (invalid accelerator/OS-occupied): stays disabled without throwing (fail-soft).
 *  - summonInput is still called even if focusWindow fails.
 *  - when input is already open, only focusWindow runs and summonInput is skipped.
 *  - dispose(): unregisters.
 */

import { describe, expect, it, vi } from "vitest";
import { createSummonHotkey, type SummonHotkeyTrigger } from "./summon-hotkey";

/** Fake deps capturing registered handlers so tests can fire the shortcut. */
function fakeDeps() {
  const handlers = new Map<string, SummonHotkeyTrigger>();
  const calls: string[] = [];
  // Like the real surfaces, input is open after summonInput.
  let inputOpen = false;
  const deps = {
    register: vi.fn(async (accelerator: string, handler: SummonHotkeyTrigger) => {
      handlers.set(accelerator, handler);
    }),
    unregister: vi.fn(async (accelerator: string) => {
      handlers.delete(accelerator);
    }),
    focusWindow: vi.fn(async () => {
      calls.push("focus");
    }),
    summonInput: vi.fn(() => {
      calls.push("summon");
      inputOpen = true;
    }),
    isInputOpen: vi.fn(() => inputOpen),
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
  it("apply(accel)가 설정된 accelerator로 register를 호출한다", async () => {
    const f = fakeDeps();
    const hotkey = createSummonHotkey(f.deps);
    await hotkey.apply("CmdOrCtrl+Shift+Y");
    expect(f.deps.register).toHaveBeenCalledTimes(1);
    expect(f.deps.register.mock.calls[0][0]).toBe("CmdOrCtrl+Shift+Y");
    expect(hotkey.current()).toBe("CmdOrCtrl+Shift+Y");
  });

  it("같은 accelerator 재적용은 no-op(이중 등록 방지)", async () => {
    const f = fakeDeps();
    const hotkey = createSummonHotkey(f.deps);
    await hotkey.apply("CmdOrCtrl+Shift+Y");
    await hotkey.apply("CmdOrCtrl+Shift+Y");
    expect(f.deps.register).toHaveBeenCalledTimes(1);
    expect(f.deps.unregister).not.toHaveBeenCalled();
  });

  it("accelerator 변경: 이전 unregister 후 새로 register", async () => {
    const f = fakeDeps();
    const hotkey = createSummonHotkey(f.deps);
    await hotkey.apply("CmdOrCtrl+Shift+Y");
    await hotkey.apply("Alt+Space");
    expect(f.deps.unregister).toHaveBeenCalledWith("CmdOrCtrl+Shift+Y");
    expect(f.deps.register).toHaveBeenLastCalledWith("Alt+Space", expect.any(Function));
    expect(hotkey.current()).toBe("Alt+Space");
  });

  it("빈 문자열 → 기존 등록 해제 + 새 등록 없음(비활성)", async () => {
    const f = fakeDeps();
    const hotkey = createSummonHotkey(f.deps);
    await hotkey.apply("CmdOrCtrl+Shift+Y");
    await hotkey.apply("");
    expect(f.deps.unregister).toHaveBeenCalledWith("CmdOrCtrl+Shift+Y");
    expect(f.deps.register).toHaveBeenCalledTimes(1);
    expect(hotkey.current()).toBeNull();
  });

  it("등록된 게 없을 때 빈 문자열은 아무 호출도 하지 않는다", async () => {
    const f = fakeDeps();
    const hotkey = createSummonHotkey(f.deps);
    await hotkey.apply("");
    expect(f.deps.register).not.toHaveBeenCalled();
    expect(f.deps.unregister).not.toHaveBeenCalled();
    expect(hotkey.current()).toBeNull();
  });
});

describe("createSummonHotkey — trigger", () => {
  it("Pressed → focusWindow 후 summonInput 순서로 호출한다", async () => {
    const f = fakeDeps();
    const hotkey = createSummonHotkey(f.deps);
    await hotkey.apply("CmdOrCtrl+Shift+Y");
    f.trigger("CmdOrCtrl+Shift+Y");
    await flush();
    expect(f.deps.focusWindow).toHaveBeenCalledTimes(1);
    expect(f.deps.summonInput).toHaveBeenCalledTimes(1);
    expect(f.calls).toEqual(["focus", "summon"]);
  });

  it("Released는 무시한다", async () => {
    const f = fakeDeps();
    const hotkey = createSummonHotkey(f.deps);
    await hotkey.apply("CmdOrCtrl+Shift+Y");
    f.trigger("CmdOrCtrl+Shift+Y", "Released");
    await flush();
    expect(f.deps.focusWindow).not.toHaveBeenCalled();
    expect(f.deps.summonInput).not.toHaveBeenCalled();
  });

  it("focusWindow 실패해도 summonInput은 호출된다", async () => {
    const f = fakeDeps();
    f.deps.focusWindow.mockRejectedValueOnce(new Error("focus denied"));
    const hotkey = createSummonHotkey(f.deps);
    await hotkey.apply("CmdOrCtrl+Shift+Y");
    f.trigger("CmdOrCtrl+Shift+Y");
    await flush();
    expect(f.deps.summonInput).toHaveBeenCalledTimes(1);
  });

  it("입력이 이미 열려 있으면 focusWindow만 하고 summonInput은 건너뛴다", async () => {
    const f = fakeDeps();
    const hotkey = createSummonHotkey(f.deps);
    await hotkey.apply("CmdOrCtrl+Shift+Y");
    // First fire opens input → a re-fire (key repeat/re-invoked from another app) only brings the window forward.
    f.trigger("CmdOrCtrl+Shift+Y");
    await flush();
    f.trigger("CmdOrCtrl+Shift+Y");
    await flush();
    expect(f.deps.focusWindow).toHaveBeenCalledTimes(2);
    expect(f.deps.summonInput).toHaveBeenCalledTimes(1);
  });

  it("사이클 진행 중 도착한 연타(키 리핏)는 흘려 이중 소환하지 않는다", async () => {
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

describe("createSummonHotkey — fail-soft", () => {
  it("register 거부(무효 accelerator) → throw 없이 비활성 유지", async () => {
    const f = fakeDeps();
    f.deps.register.mockRejectedValueOnce(new Error("invalid accelerator"));
    const hotkey = createSummonHotkey(f.deps);
    await expect(hotkey.apply("NotAKey+++")).resolves.toBeUndefined();
    expect(hotkey.current()).toBeNull();
  });

  it("register 거부 후 다음 apply(유효 accelerator)로 복구된다", async () => {
    const f = fakeDeps();
    f.deps.register.mockRejectedValueOnce(new Error("invalid accelerator"));
    const hotkey = createSummonHotkey(f.deps);
    await hotkey.apply("NotAKey+++");
    await hotkey.apply("CmdOrCtrl+Shift+Y");
    expect(hotkey.current()).toBe("CmdOrCtrl+Shift+Y");
  });

  it("unregister 거부여도 apply는 계속 진행된다(새 등록 시도)", async () => {
    const f = fakeDeps();
    const hotkey = createSummonHotkey(f.deps);
    await hotkey.apply("CmdOrCtrl+Shift+Y");
    f.deps.unregister.mockRejectedValueOnce(new Error("gone"));
    await hotkey.apply("Alt+Space");
    expect(hotkey.current()).toBe("Alt+Space");
  });
});

describe("createSummonHotkey — dispose", () => {
  it("dispose()가 현재 등록을 해제한다", async () => {
    const f = fakeDeps();
    const hotkey = createSummonHotkey(f.deps);
    await hotkey.apply("CmdOrCtrl+Shift+Y");
    await hotkey.dispose();
    expect(f.deps.unregister).toHaveBeenCalledWith("CmdOrCtrl+Shift+Y");
    expect(hotkey.current()).toBeNull();
  });

  it("등록 없이 dispose()해도 아무 호출 없이 완료된다", async () => {
    const f = fakeDeps();
    const hotkey = createSummonHotkey(f.deps);
    await hotkey.dispose();
    expect(f.deps.unregister).not.toHaveBeenCalled();
  });
});
