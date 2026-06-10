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
| TC-03 | `proactive.cowork` + backend 침묵(텍스트 미발신, emotion/motion만 또는 무반응) | 발화 없음(empty_speech), INFO, 사용자 영향 X. emotion 있으면 표정만 적용 |
| TC-04 | `proactive.cowork` present 지속 (interval_ms 내 다중 tick) | cadence self-limit — interval당 1회만 발사 (`timer_scheduler`는 debounce 미적용) |
| TC-05 | tier 2 60min 내 13회 | 13번째 rate-limit drop (`tier2_max` 12) |
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
| §3.2 cowork presence+cadence firing | TC-03, TC-04 |
| §4 Event Bus / queue cap | TC-10 |
| §5.2 Conflict / abort | TC-06 |
| §6.1 DND | TC-02, TC-13 |
| §6.2 Debounce | (dormant — no active idle source) |
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

- **하네스 구축됨:** 유닛/통합 = **vitest**(`pnpm test`), Rust = `cargo test`, E2E = 추후 **playwright**.
- 위 TC-01~15는 [`tests/dispatcher/scenarios.test.ts`](../tests/dispatcher/scenarios.test.ts)에 `it.todo`로 등록되어 러너에 pending으로 노출된다. dispatcher/guardrails/event-bus 모듈이 구현되는 대로 각 todo를 실제 단언으로 채운다.
- 각 TC는 spec 의도를 잠그는 용도. 새 TC 추가 시 parent spec의 어떤 절을 잠그는지 위 매트릭스에 등록하고 scenarios 파일에도 todo 추가.
