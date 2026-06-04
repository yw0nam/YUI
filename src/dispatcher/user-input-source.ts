/**
 * user_input_source — 사용자 입력을 bus envelope로 정규화하는 source. (event-dispatcher.md §3.4)
 *
 * MVP(#21 spine): 채팅 텍스트 제출 → `user.text_submitted` (tier2, dnd_override=true).
 * 프로덕션 chat UI(#18, mock-HTML 승인 게이트)는 별도 — 본 모듈은 텍스트를 받아 bus에 넣는
 * 얇은 producer일 뿐이다. 음성 입력(user.voice_segment_ready)은 STT 파이프라인(#3)에서 연결.
 */

import type { EventBus, BusEnvelope } from "./event-bus";

export interface UserInputSource {
  /** 채팅 텍스트 제출 → bus push. 빈/공백 문자열은 무시. */
  submit(text: string): void;
}

export function createUserInputSource(bus: EventBus): UserInputSource {
  return {
    submit(text) {
      const trimmed = text.trim();
      if (trimmed.length === 0) return;
      const env: BusEnvelope = {
        source: "user_input_source",
        event_name: "user.text_submitted",
        ts: Date.now(),
        payload: { text: trimmed },
        hint_tier: 2,
        dnd_override: true, // user-initiated → DND/debounce 우회 (§3.4, §6.1).
      };
      bus.push(env);
    },
  };
}
