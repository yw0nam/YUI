# Tests: Client-Side Event Dispatcher

**Owner**: QA
**Parent spec**: [`event-dispatcher.md`](./event-dispatcher.md)

This document holds the dispatcher's spec-locking acceptance/regression test cases. Changing parent-spec §4–§13 (envelope/routing/guardrails/recovery) requires syncing this catalog. The cases below are registered in [`tests/dispatcher/scenarios.test.ts`](../tests/dispatcher/scenarios.test.ts); some are `it.todo` pending implementation of the asserted behavior.

---

## TC List

| ID | Trigger | Expected |
|---|---|---|
| TC-01 | `proactive.cowork`, DND_OFF, rate under cap | backend call → speech visible |
| TC-02 | tier2 fire + DND_ON (fullscreen) | silent drop (`guardrail_drop`), INFO |
| TC-03 | `proactive.cowork` + backend silence (no speech text; emotion/motion only or no response) | `empty_speech`, INFO, no user impact. emotion applied if present |
| TC-04 | `proactive.cowork`, present held across multiple ticks within `interval_ms` | cadence self-limit — one fire per `interval_ms` (`timer_scheduler` source has 0 debounce) |
| TC-05 | tier2 13 fires within 60 min | 13th drops on rate-limit (`tier2_max` = 12) |
| TC-06 | `user.text_submitted` during in-flight backend call | abort + pending tier2/3 drop + user processed immediately; no counter refund |
| TC-07 | backend stream error | `network_drop`, no refund (no retry today) |
| TC-08 | no `completed` event | `parse_error`, silent drop, WARN |
| TC-09 | Rust IPC silent (no `os_idle_tick`) | cowork degrades (no presence signal); user input still fires |
| TC-10 | queue reaches 100 | lowest-priority dropped, continues |
| TC-11 | `user.tap` | tier1 render directive applied (no backend call) |
| TC-12 | overall backend calls exceed `overall_max` (26) | dispatcher 5-min cooldown; tier2/3 drop during it |
| TC-13 | DND_ON then OFF | drop while ON, normal firing after OFF |
| TC-14 | tier1 blink vs backend expression | expression held + blink pulse composited |

---

## Matrix (parent spec § ↔ TC)

| Parent § | TC |
|---|---|
| §3.1 cowork presence+cadence firing | TC-03, TC-04 |
| §3.2 user input firing | TC-06, TC-11 |
| §4 event bus / queue cap | TC-10 |
| §5.1 classify / tier1 routing | TC-11 |
| §5.2 conflict / abort | TC-06 |
| §6.1 DND | TC-02, TC-13 |
| §6.3 rate limit (tier) | TC-05 |
| §6.3 rate limit (overall) + cooldown | TC-12 |
| §7.2 backend call / network | TC-07 |
| §7.2 parse error | TC-08 |
| §7.3 silent drop classification | TC-02, TC-03, TC-06, TC-07, TC-08, TC-12 |
| §8 tier1 additive blend | TC-14 |
| §10 Rust IPC | TC-09 |
| §13 cowork degrade | TC-09 |
| §14 ABORT path | TC-06 |
| happy-path E2E | TC-01 |

---

## Notes

- Harness: unit/integration = **vitest** (`pnpm test`), Rust = `cargo test`, E2E = **playwright** (planned).
- §6.2 debounce has no active firing source that exercises a non-zero window (`cowork_source` self-limits via cadence; `user_input_source` is 0). No TC covers it today.
- Each TC locks a parent-spec section. When adding a TC, register which section it locks in the matrix above and add the corresponding entry to `scenarios.test.ts`.
