import { describe, it } from "vitest";

/**
 * Dispatcher acceptance-scenario catalog (TC-01..TC-15).
 *
 * 이 파일은 시나리오 카탈로그를 러너에 연결만 한다 — 각 TC는 `it.todo`로 pending 표시되어
 * `pnpm test` 출력에 "구현 대기" 목록으로 드러난다. dispatcher / guardrails / event-bus
 * 모듈이 구현되는 M1~M2에 각 todo를 실제 단언으로 채운다.
 */
describe("event dispatcher acceptance scenarios", () => {
  it.todo("TC-01 morning milestone · DND_OFF · rate 미달 → backend 호출 → 발화 가시");
  it.todo("TC-02 milestone + DND_ON(fullscreen) → silent drop, INFO");
  it.todo("TC-03 idle.long + backend should_speak=false → silent drop, 사용자 영향 X");
  it.todo("TC-04 idle.short 30s 내 2회 → 두 번째 debounce drop");
  it.todo("TC-05 tier2 60min 내 7회 → 7번째 rate-limit drop");
  it.todo("TC-06 backend 호출 중 user.text_submitted → abort + 큐 drop + 즉시 처리 + 카운터 환불");
  it.todo("TC-07 backend 15s timeout → retry 1회, 실패 시 silent drop, 환불 X");
  it.todo("TC-08 parse_error → silent drop + WARN");
  it.todo("TC-09 Rust IPC 5s 무응답 → os_event_watcher error, timer/idle 지속");
  it.todo("TC-10 큐 100 도달 → 최저 우선순위 drop, 정상 지속");
  it.todo("TC-11 user.tap → tier1 즉시 + tier2 가드레일 통과 시 호출");
  it.todo("TC-12 5회 연속 network 실패 → dispatcher 5min cooldown, tier2/3 drop");
  it.todo("TC-13 DND_ON 진입 후 OFF 복귀 → ON 동안 drop, OFF 후 정상");
  it.todo("TC-14 tier1 blink ↔ backend expression → expression 유지 + blink 펄스 합성");
  it.todo("TC-15 앱 재시작 후 같은 날 morning → localStorage idempotency로 중복 발사 X");
});
