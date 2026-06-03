# WORKFLOW Tests: Client-Side Event Dispatcher

**Version**: 0.1 · **Date**: 2026-06-03 · **Owner**: QA
**Parent spec**: [`event-dispatcher.md`](./event-dispatcher.md)
**Status**: Draft — `event-dispatcher.md` v0.1에서 분리 (사이즈 trim, §15 원본).

본 문서는 dispatcher의 **acceptance/regression test case**만 보관한다.
parent spec의 §4~§13(envelope/routing/guardrails/recovery)을 변경하면 본 문서도 동기화.

---

## TC List

| ID | 트리거 | 기대 |
|---|---|---|
| TC-01 | morning milestone, DND_OFF, rate 미달 | backend 호출 → 발화 가시 |
| TC-02 | milestone + DND_ON (fullscreen) | silent drop, INFO |
| TC-03 | `idle.long` + backend `should_speak=false` | silent drop, INFO, 사용자 영향 X |
| TC-04 | `idle.short` 30s 내 2회 | 두 번째 debounce drop |
| TC-05 | tier 2 60min 내 7회 | 7번째 rate-limit drop |
| TC-06 | backend 호출 중 `user.text_submitted` 도착 | abort + 큐 drop + user 즉시 처리 + 카운터 환불 |
| TC-07 | backend 15s timeout | retry 1회, 실패 시 silent drop, 환불 X |
| TC-08 | parse_error | silent drop + WARN |
| TC-09 | Rust IPC 5s 무응답 | os_event_watcher `error`, timer/idle은 계속 |
| TC-10 | 큐 100 도달 | 최저 우선순위 drop, 정상 지속 |
| TC-11 | `user.tap` | tier1 즉시 + tier2 가드레일 통과 시 호출 |
| TC-12 | 5회 연속 network 실패 | dispatcher 5min cooldown, 그동안 tier 2/3 모두 drop |
| TC-13 | DND_ON 진입 후 OFF 복귀 | ON 동안 drop, OFF 후 새 firing 정상 |
| TC-14 | tier1 blink ↔ backend expression | expression 유지 + blink 펄스 합성 |
| TC-15 | 앱 재시작 후 같은 날 morning | localStorage idempotency로 중복 발사 X |

---

## 매트릭스 매핑 (parent spec 섹션 ↔ TC)

| Parent §  | 검증 TC |
|---|---|
| §4 Event Bus / queue cap | TC-10 |
| §5.2 Conflict / abort | TC-06 |
| §6.1 DND | TC-02, TC-13 |
| §6.2 Debounce | TC-04 |
| §6.3 Rate limit | TC-05, TC-12 |
| §7.2 Backend call timeout/retry | TC-07 |
| §7.2 parse error | TC-08 |
| §7.3 silent drop classification | TC-02, TC-03, TC-06, TC-07, TC-08, TC-12 |
| §8 Tier1 additive blend | TC-14 |
| §10 Rust IPC health | TC-09 |
| §14 ABORT path | TC-06 |
| timer idempotency (§3.1) | TC-15 |
| user.tap split routing (§5.1) | TC-11 |
| happy-path E2E | TC-01 |

---

## 실행 메모

- 단위/통합 테스트 하네스는 prototype 단계(M1~M2)에 결정. v0에서는 시나리오 카탈로그.
- 각 TC는 spec 의도를 잠그는 용도이며, 구현 시 자동화 가능한 것부터 vitest/playwright로 옮긴다.
- 새 TC 추가 시 parent spec의 어떤 절을 잠그는지 위 매트릭스에 등록.
