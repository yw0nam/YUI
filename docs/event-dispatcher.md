# WORKFLOW: Client-Side Event Dispatcher

**Version**: 0.1 · **Date**: 2026-06-03 · **Author**: Workflow Architect · **Status**: Draft
**Implements**: [`concept.md`](./concept.md) §2.E, §3
**Companion specs**:
- [`contract.md`](./contract.md) — envelope/input-context 스키마 (source of truth, payload는 본 spec이 재정의하지 않음)
- [`prd.md`](./prd.md) — F6/F7 acceptance + M0~M4 마일스톤
- [`event-dispatcher.tests.md`](./event-dispatcher.tests.md) — 테스트 케이스 카탈로그 (구 §15 분리)

## 0. Overview
모든 발화 후보 event를 단일 경로로 모아 Tier별 라우팅 + 가드레일 + 로컬 ambient 또는 backend judgment로 보낸다. **firing(client) ≠ judgment(backend)** 원칙을 강제하는 단일 컴포넌트.

## 1. Process Boundary
| Component | 위치 | 비고 |
|---|---|---|
| `os_event_watcher` | **Rust (Tauri main)** | OS API 접근 전담: 활성 앱, 창 포커스, fullscreen, OS-wide idle, camera 사용. |
| `timer_scheduler`, `idle_watcher`, `user_input_source`, `backend_push_source(P2)` | Webview (TS) | timer/idle/입력은 webview. idle은 Rust `os_idle_tick` + webview 자체 입력 **둘 다 충족 시**만 idle. |
| `event_bus`, `dispatcher`, `backend_caller`, `tier1_ambient_engine` | Webview (TS) | 라우팅/가드레일/호출 전부 webview — 핫리로드 + 스크린샷 디버깅 가능. |
| `renderer` | Webview (three.js + VRM) | 최종 출력. ambient/backend 신호 합성은 renderer 책임. |

**IPC contract**: Rust → Webview 단방향 (`tauri://event` channel `os_event`). Webview는 수신 후 envelope로 정규화해 bus에 push.

## 2. 전체 다이어그램
```
[Rust] os_event_watcher ──tauri emit──┐
                                      ▼
[TS] timer · idle · user_input · [P2]backend_push  ──► event_bus (priority queue)
                                                        │
                                                        ▼
                                                   dispatcher
                                          1. classify → tier
                                          2. guardrails: DND → debounce → rate-limit
                                          3. conflict resolution
                                          ├── compacting? → 새 backend 턴 보류(큐 게이트) + 입력 disable + thinking cue
                                          ├── tier1 ──► tier1_ambient_engine ──► renderer
                                          └── tier2/3 ─► backend_caller
                                                          ├ package context
                                                          ├ POST /v1/responses (X-Hermes-Session-Id 헤더)
                                                          ├ parse express function_call(emotion/motion) + 텍스트 스트림
                                                          ├ usage → token-threshold compaction trigger
                                                          ├ emotion/motion → renderer (항상)
                                                          ├ speech_text == "" → 발화 없음(silent)
                                                          └ speech_text 있음  → TTS/말풍선
```

## 3. Sources — 트리거 조건

### 3.1 `timer_scheduler` (TS, `setInterval(1000)`, idempotency via `localStorage`)
| Event | 조건 | 빈도 상한 | tier |
|---|---|---|---|
| `time_milestone.morning` | 로컬시각 06:00–10:00 첫 진입 | 1/day | 2 |
| `time_milestone.lunch` | 12:00–13:00 진입 | 1/day | 2 |
| `time_milestone.evening` | 18:00–22:00 진입 | 1/day | 2 |
| `time_milestone.midnight` | 00:00 통과 | 1/day | 2 |
| `periodic_tick` | 60s, internal heartbeat | 60s | — |

### 3.2 `idle_watcher`
| Event | 조건 | tier |
|---|---|---|
| `idle.short` | 입력 무동작 ≥ **120s** | 2 |
| `idle.long`  | 입력 무동작 ≥ **600s** | 2 |
| `idle.returned` | idle → 입력 재감지 (state-change) | 1 (ambient cue) |

### 3.3 `os_event_watcher` (Rust)
| Event | 조건 | dispatcher 처리 |
|---|---|---|
| `os.active_app_changed` | 활성 앱 변경 (debounce 5s) | MVP drop · P2 tier3 |
| `os.window_focus_changed` | 같은 앱 내 창 변경 | bus drop (노이즈) |
| `os.fullscreen_entered/exited` | 풀스크린 진입/종료 | **guardrail state 토글** (라우팅 X) |
| `os.camera_in_use` | 캠 사용 best-effort | **guardrail state 토글** |
| `os_idle_tick` | 5s 주기 OS-wide idle 보고 | idle_watcher 입력 |

### 3.4 `user_input_source` (`dnd_override=true`)
| Event | 조건 | tier |
|---|---|---|
| `user.text_submitted` | 채팅 enter | 2 (debounce 무시) |
| `user.voice_segment_ready` | VAD 종료 → STT 완료 | 2 |
| `user.tap` | 캐릭터 클릭 | 1 즉시 + 2 (rate-limited) |
| `user.drag_start/end` | 드래그 (→ contract §2 motion `drag`) | 1 only |

### 3.5 `backend_push_source` (Phase 2)
| Event | 조건 | tier |
|---|---|---|
| `backend.push.suggest` | SSE/WS push | 3 |
| `backend.push.tool_result` | tool 진행 push | **dispatcher 우회 → renderer 직접** |

## 4. Event Bus Contract

### 4.1 Envelope
```jsonc
{
  "seq_id": 12345,                  // bus가 부여 (monotonic)
  "source": "timer_scheduler",
  "event_name": "time_milestone.morning",
  "ts": 1717000000123,              // client epoch ms
  "payload": { /* event-specific */ },
  "hint_tier": 2,                   // source의 추정, dispatcher가 최종 결정
  "dnd_override": false             // user-initiated만 true
}
```

### 4.2 큐 정책
- **자료구조**: priority heap, key = `(tier ASC, ts ASC)`.
- **용량**: 100. 초과 시 우선순위 낮은 것부터 drop, 로깅.
- **Bus drop 조건**: schema invalid, 미지의 `event_name`, `ts` ± 60s 벗어남.

### 4.3 우선순위 (낮을수록 우선)
| 0 | `user.*` |
| 1 | `backend.push.*` |
| 2 | `idle.*`, `time_milestone.*` |
| 3 | `os.*` |
| 4 | internal |
동일 순위 내 FIFO.

## 5. Dispatcher Routing

### 5.1 Classification
| event_name pattern | tier | target |
|---|---|---|
| `time_milestone.*` | 2 | backend_caller |
| `idle.short` / `idle.long` | 2 | backend_caller |
| `idle.returned` | 1 | tier1_ambient_engine |
| `user.text_submitted` / `user.voice_segment_ready` | 2 | backend_caller |
| `user.tap` | 1 + 2 (split) | tier1 즉시 / tier2 가드레일 후 |
| `user.drag_*` | 1 | tier1_ambient_engine |
| `os.active_app_changed` | 3 | backend_caller (MVP drop) |
| `backend.push.suggest` | 3 | backend_caller (P2) |
| `os.fullscreen_*` / `os.camera_in_use` | — | guardrail 토글 |

### 5.2 Conflict resolution
- 같은 source 같은 event가 debounce 윈도우 내 재발사 → 최신으로 덮어쓰기.
- backend 호출 in-flight 중 새 tier2/3 도착 → 큐 보류. 2건 이상 보류 시 가장 오래된 drop (stale).
- **`user.text_submitted` 도착 시 in-flight tier 2/3 abort + 큐의 모든 tier 2/3 drop** (`superseded_by_user`).

## 6. Guardrails

### 6.1 DND (Do Not Disturb)
**상태**: `DND_ON ⇔ DND_OFF`. 아래 4 trigger 중 **하나라도** ON이면 DND_ON.
| Trigger | ON 조건 | OFF 조건 |
|---|---|---|
| Fullscreen | `os.fullscreen_entered` | `os.fullscreen_exited` |
| Camera | `os.camera_in_use=true` | 30s camera idle |
| Active app | `config.dnd_app_blocklist` 포함 | blocklist 밖 |
| Manual | `user.dnd_toggle` | 동일 |

**DND_ON 시**: tier 2/3 firing → silent drop + INFO 로그. tier 1 계속. `dnd_override=true`는 통과.

### 6.2 Debounce (per source)
| Source | Window |
|---|---|
| `idle_watcher` | 30s |
| `os_event_watcher` | 5s |
| `backend_push_source` | 10s |
| `user_input_source` | 0 |
| `timer_scheduler` | N/A (자체 1회) |

### 6.3 Rate limit (per tier, rolling 60min)
| Tier | 상한 | 초과 시 |
|---|---|---|
| 1 | 무제한 | — |
| 2 | **6회** | drop (카운터 환불 X) |
| 3 | **2회** | drop |
| backend 호출 전체 | **20회** | dispatcher 5min cooldown 진입 |

> **슬롯 소비 = fire 시점(시도 기준, 성공 기준 아님). 환불 없음** — rate-overflow·backend network/5xx·timeout·supersede 어디서도 카운터를 되돌리지 않는다. rate-limit은 autonomous-firing 스팸에 대한 1차 방어선(PRD R5)이므로, backend 실패가 ceiling을 우회해 스팸을 재유입하는 것을 막는다.

> 위 수치는 prototype 출발점. config로 변경 가능. 1–2주 실사용 후 튜닝.

> **Cooldown 소유권**: guardrail 평가 함수는 **순수(pure)** — verdict 신호만 반환하고 dispatcher state를 mutate하지 않으며 dispatcher 참조를 갖지 않는다. `running → cooldown → running` 전이와 5min 타이머 종료는 **dispatcher가 소유**한다. cooldown은 **진입 + 타이머 종료를 항상 함께** 구현한다 — 진입만 하고 빠져나올 수 없는 state는 금지. cooldown 동안: tier2/3 firing은 drop(`guardrail_drop`), tier1은 계속 렌더, `dnd_override=true` user 턴은 여전히 우회.

### 6.4 평가 순서
`DND → debounce → rate-limit → classify → route`. 각 단계 DROP은 reason 코드와 함께 `dispatcher.drop` 로그.

> **구현 wiring 주석**: 위 순서는 INTENT(route 전에 gate)를 표현한다. dispatcher 코드의 실제 순서는 `user-supersede(기존 유지) → classify(tier 획득) → evaluate(env, tier) → route` — guardrail이 `tier`를 필요로 하고 그 `tier`는 classify가 산출하므로 classify를 먼저 부른다(§6.4 INTENT와 일치). `dnd_override`는 evaluate 최상단에서 **short-circuit** — user-initiated 턴은 DND·debounce·rate-limit을 모두 우회하며 어떤 rate-limit 카운터도 증가시키지 않는다.

## 7. Backend Caller

### 7.1 Context schema
> **Payload 스키마는 [`contract.md`](./contract.md) §4 `InputContext`가 source of truth.** 본 절은 dispatcher가 그 위에 *얹는* trigger/idle/dnd 메타데이터만 정의한다. 필드 명명은 contract와 동일하게 사용.

```jsonc
{
  // contract §4 InputContext 전체를 그대로 사용 (env.timestamp, env.timezone, env.active_app.name,
  // env.active_window_title, screenshot{enabled,source,...}, user_text, transcript, client)
  "input_context": { /* InputContext per contract.md §4 */ },

  // dispatcher가 추가하는 trigger envelope
  "trigger": {
    "source": "timer_scheduler | idle_watcher | os_event_watcher | user_input_source | backend_push_source",
    "event_name": "...",            // §3 표의 event_name
    "ts": 0,                         // bus envelope의 ts (epoch ms)
    "seq_id": 0
  },

  // dispatcher가 알고 있는 부가 상태 (contract InputContext에는 없음)
  "dispatcher_state": {
    "idle_seconds": 0,
    "dnd_state": "OFF | ON",
    "tier_hint": 2
  },

  "tier2_silence_ok": true           // Tier 2: backend가 침묵(텍스트 미발신) 선택 가능함을 알리는 힌트 (선택)
}
```

- `input_context.screenshot.enabled`: tier2 default off, tier3 default on. config override.
- `input_context.user_text` / `input_context.transcript`: user 발사일 때만 채움.
- `input_context.env.active_app.name` / `env.active_window_title`은 §10 Rust handoff의 `active_app_name` / `active_window_title`을 그대로 매핑.

### 7.2 호출 시퀀스
| Step | Action | Timeout | Failure → 처리 |
|---|---|---|---|
| B1 | `package_context` (screenshot 포함 시 캡처) | 200ms (+screenshot 1000ms) | `cap_failed` → drop |
| B2 | `POST {backend_base}/v1/responses` | 15s (스트리밍: first-chunk 5s, total 30s) | `network/5xx` → retry x1 (2s backoff), 실패 시 silent drop (rate-limit 카운터 환불 없음 — 슬롯은 발사 시 소비됨, §6.3) / `4xx` → drop, 환불 X, ERROR / `timeout` → drop, 환불 X |
| B3 | `parse_structured_output` → [`contract.md`](./contract.md) §3 `ControlEnvelope` (`{ speech_text, emotion?, motion?, tool_status?, rich_content?, _reserved? }` — should_speak 없음, D-NO-SPEAK-GATE) | 즉시 | `parse_error` → silent drop + WARN + raw 로깅 |
| B4 | `dispatch_to_renderer` (emotion → expression / motion → VRMA(없으면 emotion에서 파생) / tool_status / rich_content) per contract §3 렌더 규약. **emotion/motion은 발화 여부와 무관하게 항상 적용** | — | renderer 에러 → ambient fallback + ERROR 로그 |
| B5 | `speech_branch` — `speech_text == ""` → 발화 없음(silent, INFO 정상) / 비어있지 않음 → TTS + 말풍선 | — | — |

### 7.3 Silent drop 분류
| 종류 | 트리거 | 로그 |
|---|---|---|
| `guardrail_drop` | DND/debounce/rate-limit | INFO |
| `empty_speech` | backend 침묵(텍스트 미발신, emotion/motion만 또는 무반응) | INFO |
| `parse_error` | output 깨짐 | WARN |
| `network_drop` | retry 후 실패 | WARN |
| `http_4xx_drop` | 잘못된 요청 | ERROR |
| `superseded_by_user` | user 발화 도착 | INFO |

## 8. Tier 1 Ambient Engine
- 렌더 루프(`rAF`) hook. backend 독립. backend motion과 **additive blend** (BlendShape 채널 분리 또는 weight 합성). 충돌 해소는 renderer 책임.

| Cue | 빈도 | 메커니즘 |
|---|---|---|
| `blink` | 평균 4s ± 2s | eye BlendShape pulse 150ms |
| `idle_sway` | 항상 | spring bone + sine (head/hip) |
| `breath` | 4s 주기 | chest BlendShape sine |
| `look_around` | 30–120s 무작위 | head bone target shift |
| `tap_react` | `user.tap` 시 1회 | head bob 200ms |
| `idle_returned_cue` | `idle.returned` 1회 | 살짝 위 시선 |

Backend 응답 처리 중: expression은 backend 값 N초 유지 후 ambient blink 재개. motion 재생 중 idle_sway weight 0.3 → 0.1, 종료 시 복원.

## 9. Dispatcher State
```
[booting] → (config loaded, sources subscribed) → [running]
[running] → (total rate-limit exceeded) → [cooldown 5min] → [running]
[running] → (uncaught error)            → [degraded: tier1 only] → (수동 reset / 30min) → [running]
[running] → (compaction boundary 도달)   → [compacting] → (compress settle/skip/error/timeout) → [running]
[running] → (app shutdown)              → [draining 5s] → [stopped]
[compacting] → (stop)                   → [stopped]
```
`cooldown` 진입(total rate-limit 초과)과 5min 후 `running` 복귀는 **dispatcher가 소유** — 진입과 타이머 종료를 함께 구현해 빠져나올 수 없는 state를 만들지 않는다(§6.3). guardrail 평가 함수는 cooldown 전이에 관여하지 않는다(verdict만 반환, 순수). cooldown 동안 tier2/3 drop(`guardrail_drop`) · tier1 계속 · `dnd_override=true` 우회.

Per-source 상태: `enabled | disabled | error`. dispatcher가 source 단위 enable/disable API 제공 (디버깅).

### `compacting` (세션 압축 maintenance window, D-SESSION-CONTINUITY)
- **entry:** `requestCompaction()`로 래치된 압축 요청이 **턴 경계**(`inFlight===null` && `state==="running"`)에 도달하면 동기적으로 진입한다 — in-flight backend 턴이 끝나는 순간(`startBackendCall` finally), 또는 이미 idle이면 `requestCompaction()`·pump tick 시점. 진입 시 `thinking` cue를 렌더하고 압축 thunk를 timeout과 race해 kick한다.
- **gates:** compacting 동안 **새 backend 턴 launch를 보류**한다 — boundary에서 압축이 다음 턴보다 먼저 가도록 `enqueueBackend`/`drainPending`가 압축 래치를 보고 enqueue만 한다(드물게 들어오는 tier2/3는 pending에 쌓이고 압축 후 drain). 동시에 chat 입력을 비활성화한다. 이 게이트의 보증은 **큐 레벨**(보류 이벤트가 쌓였다가 압축 후 drain)이지 UI 입력 비활성화만이 아니다.
- **exits:** compress가 정착(`compressed`/`skipped`/`error`)하거나 timeout(`compact_timeout_ms` 초과 → abort)하면 cue를 `neutral`로 풀고 `running`으로 복귀, pump 1회로 보류 이벤트를 drain한다. `stop()`이 끼어들면 `running` 복귀를 건너뛰고 `stopped`로 간다(rotation 중간에 되살리지 않음).
- **세션 부재 가드:** 세션 id가 없으면 `requestCompaction()`이 no-op이라 무의미한 압축·cue flicker가 일어나지 않는다. 압축 자체와 회전 id 적용·진단 기록은 dispatcher 외부(main.ts compact thunk)에서 일어난다 — dispatcher는 store-agnostic하다.

## 10. Handoff Contracts

### Rust → Webview (`os_event` channel)
```jsonc
{
  "event_name": "active_app_changed|window_focus_changed|fullscreen_entered|fullscreen_exited|os_idle_tick|camera_in_use",
  "ts": 0,
  "data": {
    "active_app_name": "string?", "active_window_title": "string?",
    "is_fullscreen": "bool?", "os_idle_ms": "number?", "camera_in_use": "bool?"
  }
}
```
Fire-and-forget. Webview는 5s마다 `os_idle_tick` 미수신 시 source `error` 표기.

### Dispatcher → Backend Caller (in-process)
Input: `{ envelope, tier, context }` · Output: `Promise<{ ok: bool, drop_reason?: string }>`.

### Backend Caller → Renderer (in-process event)
```jsonc
{
  "type": "render_directive",
  // contract §3 ControlEnvelope의 필드를 그대로 전달
  "emotion": { /* EmotionSignal | null */ },
  "motion":  { /* MotionSignal  | null */ },
  "speech_text": "string",            // 발화 텍스트 스트림 누적. 침묵이면 "" (D-NO-SPEAK-GATE)
  "tool_status": null,
  "rich_content": [],
  // 렌더 측 부가 핸들
  "audio_stream_id": "string?"        // TTS 스트림 핸들 (dispatcher 외부 워크플로)
}
```
필드명은 [`contract.md`](./contract.md) §3과 1:1 매칭. renderer 측 expression key 매핑은 client-local registry(contract §1) 책임.

## 11. Observable States (debug inspection)
| API (dev build only) | 반환 |
|---|---|
| `dispatcher.queue()` | 현재 큐 (seq_id, event_name, ts, tier) |
| `dispatcher.dnd_state()` | `{ on, reasons[] }` |
| `dispatcher.last_fire_per_source()` | `{ source: ts }` |
| `dispatcher.rate_limit_counters()` | `{ tier2:{count,window_start}, tier3:{...} }` |
| `dispatcher.recent_drops(n)` | 최근 n drop (reason 포함) |
| `dispatcher.in_flight_backend_call()` | `{ trigger, started_at } \| null` |

**Control surface (compaction, 모든 빌드):**
| API | 동작 |
|---|---|
| `dispatcher.requestCompaction()` | 세션 압축을 래치한다(idempotent). 다음 턴 경계(`inFlight===null`)에서 `compacting`으로 진입한다. compact thunk 부재·세션 id 부재·이미 `compacting`·`stopped`/`booting`이면 no-op. main.ts가 idle resume(focus/visibilitychange)·token threshold(`createCompactionTrigger`)·blur에서 호출한다. |
| `dispatcher.subscribeState(cb)` | 상태 전이 구독 — 매 전이마다 `cb(state)` 호출, unsubscribe fn 반환. main.ts가 이걸로 `compacting` 동안 chat 입력을 비활성화한다(`setInputEnabled(s !== "compacting")`). |

> **보류 보증은 큐 레벨이다.** `compacting` 동안 backend 턴 보류는 UI 입력 비활성화가 아니라 **dispatcher 큐 게이트**가 보장한다 — 외부(OS/timer/idle source)에서 들어오는 tier2/3 이벤트도 enqueue만 되고 launch되지 않으며, `running` 복귀 후 drain된다.

**로그 (모든 빌드)**: `dispatcher.fire`, `dispatcher.drop`, `dispatcher.backend_call`, `dispatcher.state_change`. 로컬 파일 + (있다면) OTel.

## 12. Cleanup Inventory
| 리소스 | 생성 | 해제 | 방법 |
|---|---|---|---|
| In-flight backend fetch | B2 | 응답/abort/종료 | `AbortController.abort()` |
| 큐 보류 event | bus push | dispatch/drop/drain | 큐 제거 |
| Audio stream (TTS) | renderer | 재생완료/새 발화 | `audio.pause()` + 버퍼 해제 |
| OTel span | B1 | B5 완료 | `span.end()` |
| Rust IPC 구독 | 부팅 | 종료 | `unlisten()` |
| Timer interval | 부팅 | 종료 | `clearInterval` |

## 13. Failure & Recovery Matrix
| 실패 | 위치 | 복구 |
|---|---|---|
| Rust IPC 끊김 | os_event_watcher → webview | 5s 헬스체크 → source `error`. 재연결 polling. 사용자 알림 X. |
| Backend network down | B2 | retry x1, 실패 silent drop. 5회 연속 실패 시 dispatcher cooldown 5min. |
| Structured output 깨짐 | B3 | silent drop, raw 로깅. user-facing 영향 X. |
| VAD 오인식 | user_input_source | dispatcher 책임 밖. backend로 그대로 전달, backend가 침묵(텍스트 미발신) 가능. |
| Renderer motion 실패 | renderer | ambient fallback, dispatcher 영향 X. |
| Rate-limit 폭주 | dispatcher | cooldown 5min, 디버그 HUD에만 표시. |
| Queue 100 초과 | event_bus | 우선순위 낮은 것 drop, 정상 지속. |
| Webview crash | OS/Tauri | Tauri 재시작 (별도 워크플로). 상태 휘발, `last_fire_per_source`만 localStorage에서 복원. |

## 14. Workflow Tree (대표: `idle.long`)
| Step | Actor | Action | 실패 / 분기 |
|---|---|---|---|
| 1 | idle_watcher | Rust idle 600s + webview idle 600s 모두 충족 → `idle.long` 발사 → `event_bus.push()` | debounce 30s 내 재발사 → bus drop |
| 2 | event_bus | 스키마 검증, seq_id 부여, 큐 삽입 | schema invalid → ERROR drop / queue full → 최저 우선순위 1건 drop 후 삽입 |
| 3 | dispatcher | §6.4 순서 평가 → `tier=2, target=backend_caller` | DND_ON → silent drop / debounce hit → drop / rate-limit → drop (환불 X) |
| 4 | backend_caller | §7.2 B1–B5 | §7.3 분류대로 |
| 5 | renderer | expression + motion + text bubble + TTS 큐 | 실패 시 ambient fallback |

**ABORT path**: backend 호출 중 `user.text_submitted` 도착 → ① in-flight `AbortController.abort()` ② abort된 trigger는 이미 발사 시 슬롯을 소비했으므로 rate-limit 카운터 환불 없음(supersede 환불 X — §6.3; 근사 허용, 수치는 §17대로 튜닝 가능) ③ user event를 B1부터 즉시 진행 ④ 큐의 모든 tier 2/3 drop (`superseded_by_user`).

## 15. Test Cases
**이 섹션은 [`event-dispatcher.tests.md`](./event-dispatcher.tests.md)로 이동했습니다.** (사이즈 trim 목적, QA 소유)
spec 절을 추가/수정할 때 해당 문서의 TC ↔ § 매트릭스도 동기화.

## 16. Assumptions
> **PRD cross-ref**: 각 assumption은 [`prd.md`](./prd.md) §7 Risks의 R11~R15로 mirror되며, 검증 마일스톤은 PRD §6 exit criteria에 명시. 양방향 링크 유지.

| # | Assumption | 검증 마일스톤 | PRD Risk | 비고 |
|---|---|---|---|---|
| A1 | Rust가 OS-wide idle API 접근 가능 (macOS `CGEventSourceSecondsSinceLastEventType`, Win `GetLastInputInfo`, Linux X11 `XScreenSaverQueryInfo`) | **M1** (Shell skeleton 단계, Win/macOS 우선) | R11 | Linux Wayland 환경 idle 감지 불가 → source `error` |
| A2 | Tauri `emit` 지연 < 50ms | **M1** | R12 | 큰 지연 시 fullscreen/idle 반응 어색 |
| A3 | Control transport = **서버사이드 `express` tool-call**(확정, D-TRANSPORT). **검증됨:** Hermes `/v1/responses` 스트림이 `function_call` item 노출(자체 SSE 구현 `openai_response_sdk/sse-event-format.md`). wire arguments = FLAT `{emotion_id?, motion_id?, emotion_text?}`(비언어 전용; `emotion_text`는 provider별 TTS voice tag로 추가됨; should_speak 없음 D-NO-SPEAK-GATE, motion은 client가 emotion에서 파생 D-MOTION-FROM-EMOTION); client가 `emotion_id→emotion{id}` 등으로 정규화(contract §3). 발화는 별도 텍스트 스트림(침묵=미발신). **express는 optional** — 없는 턴은 idle + 직전 표정이라 매 턴 호출·타이밍은 하드 의존 아님(R16/R17 해소). | — (해소) | R10 | function_call은 최종 `output[]`에 빠지므로 스트림 중 캡처. contract §Endpoint/§3 연결 |
| A4 | TTS 스트림은 별도 워크플로 (dispatcher 외부) | **M2** (E2E 통합 시 audio life-cycle 분리 확정) | R13 | dispatcher가 audio life-cycle을 책임지면 cleanup inventory 변경 |
| A5 | `camera_in_use` 감지는 best-effort, OS별 capability 상이 (Linux는 미지원) | **M3** (가드레일 단계) | R14 | Linux 가드레일 약화 — OS capability table 필요 |
| A6 | `localStorage`가 milestone idempotency에 충분 (앱 재시작 후 유지) | **M3** (proactivity 검증 단계, TC-15) | R15 | 휘발 시 같은 날 milestone 중복 → tauri-plugin-store 대체 가능 |
| A7 | 큐는 in-memory only, 앱 종료 시 손실 OK | **정책 확정** — 변경 없으면 ongoing | R15 (묶음) | 손실 우려 시 persist 필요. ambient/timer엔 과한 설계 |

## 17. Open Questions
| # | 질문 | 결정 시점 |
|---|---|---|
| 1 | rate-limit/debounce 수치는 prototype 출발점. config 노출 필수. | **M3 종료 후 1–2주 실사용 튜닝** (prd.md §6 M3 exit) |
| 2 | DND `dnd_app_blocklist` 기본값 (Zoom/Teams/Meet/Discord 통화 감지) — 별도 리서치 | **M3 시작 시** |
| 3 | Phase 2 backend push 인증/heartbeat 정책 — 별도 워크플로 spec | **Phase 2** (prd.md §4) |
| 4 | Multi-character (concept.md §6 Q4, prd.md D3=단일로 확정): 캐릭터당 dispatcher vs 단일 dispatcher 라우팅 | **Phase 2** — D3 supersede 시 |
| 5 | Screenshot 캡처 cost (concept.md §6 Q2, prd.md D2=토글+monitor): tier 2 default off 잠정 결정. 사용자 토글 UI? | **M2** (Input 통합 시 toggle UI 확정) |
| 6 | Webview crash 후 복원 범위: morning milestone만? idle 카운터도? | **M3** |
| 7 | Inspection API 보안: dev build only vs prod hidden hotkey | **M4** (Polish) |

## 18. Spec vs Reality Audit Log
| Date | Finding | Action |
|---|---|---|
| 2026-06-03 | 초기 spec v0.1. YUI 코드 미존재, concept.md 단독 기반. | Reality Checker는 첫 코드 등장 후 재실행 |

## 19. Workflow Registry 메모
YUI 첫 spec. 다음 후보 (Missing):
- `WORKFLOW-vrm-load-and-hotswap.md` (§2.A)
- `WORKFLOW-stt-vad-pipeline.md` (§2.C)
- `WORKFLOW-tts-lipsync-pipeline.md` (§2.D, §6 Q3)
- `WORKFLOW-screenshot-capture-policy.md` (§6 Q2)
- `WORKFLOW-tauri-window-hit-test.md` (§2.B)
- `WORKFLOW-config-and-hotreload.md` (§2.F)
- `WORKFLOW-backend-push-subscription.md` (P2, §2.E)

다음 spec 작성 시 `docs/REGISTRY.md` 동시 생성 권고.
