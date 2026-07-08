/**
 * Global summon hotkey — configs/hotkeys.json의 accelerator를 OS 전역 단축키로 등록하고,
 * 발동 시 창을 앞으로 가져온 뒤 입력을 소환한다.
 *
 * fail-soft: 무효 accelerator/OS 점유로 register가 거부되면 warn 후 비활성으로 남는다 —
 * 부트/핫리로드를 깨지 않는다. 등록/해제 API는 주입받아(non-Tauri/테스트) 런타임에 묶이지 않는다.
 */

import { createLogger } from "../logger";

const log = createLogger("summon-hotkey");

/** 플러그인 shortcut 이벤트 핸들러 — state "Pressed" | "Released". */
export type SummonHotkeyTrigger = (event: { state: string }) => void;

export interface SummonHotkeyDeps {
  register(accelerator: string, handler: SummonHotkeyTrigger): Promise<void>;
  unregister(accelerator: string): Promise<void>;
  /** 창을 앞으로 + 포커스(백그라운드에서 앱 활성화 포함). */
  focusWindow(): Promise<void>;
  summonInput(): void;
  /** 입력이 이미 열려 있는지 — 열려 있으면 재소환하지 않는다(창만 앞으로). */
  isInputOpen(): boolean;
}

export interface SummonHotkey {
  /** accelerator 적용: 기존 등록 해제 후 재등록. 빈 문자열 = 비활성. 절대 reject하지 않는다. */
  apply(accelerator: string): Promise<void>;
  /** 현재 등록된 accelerator. 비활성이면 null. */
  current(): string | null;
  /** 등록 해제(teardown/HMR). */
  dispose(): Promise<void>;
}

export function createSummonHotkey(deps: SummonHotkeyDeps): SummonHotkey {
  let registered: string | null = null;
  // apply 직렬화 — 핫리로드 연타가 register/unregister를 겹치지 않게 한다.
  let chain: Promise<void> = Promise.resolve();
  // 한 번에 하나의 focus+summon 사이클만. summonInput의 is-open 클래스는 rAF 뒤에 붙어
  // isInputOpen()이 한 프레임 늦으므로, 사이클 진행 중 도착한 연타(키 리핏)를 흘려 이중 소환을 막는다.
  // ponytail: finally~rAF 사이 ~16ms 잔여 창은 사람 연타로 도달 불가라 남겨둔다.
  let inFlight = false;

  function onTrigger(event: { state: string }): void {
    if (event.state !== "Pressed") return;
    if (inFlight) return;
    inFlight = true;
    // 다른 앱에서의 재발동도 창은 항상 앞으로. 소환은 입력이 닫혀 있을 때만 —
    // 키 반복/재발동이 열림 애니메이션·에러 표시를 리셋하지 않게(로컬 "/" 가드와 동일).
    void deps
      .focusWindow()
      .catch((err) => log.warn("focus_failed", { error: String(err) }))
      .then(() => {
        if (!deps.isInputOpen()) deps.summonInput();
      })
      .finally(() => {
        inFlight = false;
      });
  }

  async function applyNow(accelerator: string): Promise<void> {
    if (accelerator === (registered ?? "")) return;
    if (registered !== null) {
      try {
        await deps.unregister(registered);
      } catch (err) {
        log.warn("unregister_failed", { accelerator: registered, error: String(err) });
      }
      registered = null;
    }
    if (accelerator === "") {
      log.info("disabled", { reason: "empty_accelerator" });
      return;
    }
    try {
      await deps.register(accelerator, onTrigger);
      registered = accelerator;
      log.info("registered", { accelerator });
    } catch (err) {
      // 무효 accelerator 또는 OS/타 앱 점유 — 비활성으로 남긴다(fail-soft).
      log.warn("register_failed", { accelerator, error: String(err) });
    }
  }

  return {
    apply(accelerator) {
      chain = chain.then(() => applyNow(accelerator));
      return chain;
    },
    current: () => registered,
    dispose() {
      chain = chain.then(() => applyNow(""));
      return chain;
    },
  };
}
