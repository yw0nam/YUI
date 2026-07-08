/**
 * summon-hotkey.test.ts — 전역 입력 소환 핫키 등록/해제 모듈.
 *
 * Locks:
 *  - apply(accel): 설정된 accelerator로 register 호출.
 *  - 발동(state "Pressed"): focusWindow → summonInput 순서.
 *  - "Released"는 무시.
 *  - 같은 accelerator 재적용은 no-op(이중 등록 방지).
 *  - accelerator 변경: 이전 unregister 후 새로 register.
 *  - 빈 문자열: 기존 등록 해제 + 새 등록 없음(비활성).
 *  - register 거부(무효 accelerator/OS 점유): throw 없이 비활성 유지(fail-soft).
 *  - focusWindow 실패해도 summonInput은 호출된다.
 *  - dispose(): 등록 해제.
 */

import { describe, expect, it, vi } from "vitest";
import { createSummonHotkey, type SummonHotkeyTrigger } from "./summon-hotkey";

/** Fake deps capturing registered handlers so tests can fire the shortcut. */
function fakeDeps() {
  const handlers = new Map<string, SummonHotkeyTrigger>();
  const calls: string[] = [];
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

/** trigger 핸들러의 비동기 체인(focus → summon)이 소진될 때까지 대기. */
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
