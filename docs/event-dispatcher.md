# Client-Side Event Dispatcher

**Implements**: [`concept.md`](./concept.md) §2.E, §3
**Companion specs**:
- [`contract.md`](./contract.md) — envelope/input-context schema (source of truth; this spec does not redefine payloads)
- [`prd.md`](./prd.md) — feature reference (F6/F7 dispatcher + firing)
- [`event-dispatcher.tests.md`](./event-dispatcher.tests.md) — test case catalog

## 0. Overview
All speech-candidate events flow through a single path: classify → guardrail → route to local ambient or backend judgment. The dispatcher is the single component that enforces **firing(client) ≠ judgment(backend)**.

## 1. Process Boundary
| Component | Location | Note |
|---|---|---|
| `os_event_watcher` | **Rust (Tauri main)** | OS API access: active app, window focus, fullscreen, OS-wide idle, camera use. |
| `cowork_source`, `user_input_source` | Webview (TS) | cowork judges presence (idle < threshold) from Rust `os_idle_tick` and fires `proactive.cowork` per cadence; user input normalizes chat/voice into envelopes. |
| `event_bus`, `dispatcher`, `backend_caller`, `tier1_ambient_engine` | Webview (TS) | Routing/guardrails/calls all live in the webview — hot-reloadable and screenshot-debuggable. |
| `renderer` | Webview (three.js + VRM) | Final output. ambient/backend signal compositing is the renderer's responsibility. |

**IPC contract**: Rust → Webview one-way (`tauri://event` channel `os_event`). The webview normalizes received events into envelopes and pushes them to the bus.

## 2. Diagram
```
[Rust] os_event_watcher ──tauri emit──┐
                                      ▼
[TS] cowork · user_input  ──────────► event_bus (priority queue)
                                                        │
                                                        ▼
                                                   dispatcher
                                          1. classify → tier
                                          2. guardrails: DND → debounce → rate-limit
                                          3. conflict resolution
                                          ├── compacting? → hold new backend turn (queue gate) + disable input + thinking cue
                                          ├── tier1 ──► tier1_ambient_engine ──► renderer
                                          └── tier2/3 ─► backend_caller
                                                          ├ package context
                                                          ├ POST /v1/responses (X-Hermes-Session-Id header)
                                                          ├ parse express function_call(emotion/motion) + text stream
                                                          ├ usage → token-threshold compaction trigger
                                                          ├ emotion/motion → renderer (always)
                                                          ├ speech_text == "" → silent
                                                          └ speech_text present → TTS/bubble
```

## 3. Sources

The dispatcher ships two firing sources today: `cowork_source` and `user_input_source`. `os_event_watcher` (Rust) feeds presence/DND state but is not itself a firing source. Additional source rows (`timer_scheduler` milestones, `idle.*`, `backend_push_source`, `os.active_app_changed` as a tier3 fire) exist in classify as dormant seams; no source pushes them today.

### 3.1 `cowork_source` (co-working presence+cadence)
While the user is **present** (OS idle within `sources.proactive.cowork.present_max_idle_ms` = 60000 ms), the source fires a co-working speech candidate every `sources.proactive.cowork.interval_ms` (= 600000 ms / 10 min) — an "alongside, co-working" model. The away→present edge re-anchors the cadence (no fire on return). Idle ticks with null `os_idle_ms` (e.g. Windows) carry no presence signal and are ignored, so cowork is inert there.

| Event | Condition | Envelope source | tier | dnd_override |
|---|---|---|---|---|
| `proactive.cowork` | present (idle ≤ `present_max_idle_ms`), once per `interval_ms` | `timer_scheduler` | 2 | false |

Payload: `{ os_idle_ms }`. The `idle.*` bus names (`idle.short`/`idle.long`/`idle.returned`) remain valid dormant vocabulary; no source fires them.

### 3.2 `user_input_source` (`dnd_override=true`)
Normalizes user input into bus envelopes. Empty/whitespace text is ignored.

| Event | Condition | Envelope source | tier | dnd_override |
|---|---|---|---|---|
| `user.text_submitted` | chat enter | `user_input_source` | 2 | true |
| `user.voice_segment_ready` | VAD end → STT transcript | `user_input_source` | 2 | true |

### 3.3 `os_event_watcher` (Rust) — read-side
Emits on the `os_event` channel; consumed for DND/presence state, not as firing sources.

| Event | Condition | Dispatcher handling |
|---|---|---|
| `active_app_changed` | active app change | os-context snapshot (read-side); DND active-app trigger via blocklist |
| `fullscreen_entered` / `fullscreen_exited` | fullscreen enter/exit | **DND state toggle** (no routing) |
| `camera_in_use` | camera use, best-effort | **DND state toggle** |
| `os_idle_tick` | ~5 s OS-wide idle report (`os_idle_ms`; **null on Windows**) | cowork presence input |

## 4. Event Bus Contract

### 4.1 Envelope
```jsonc
{
  "seq_id": 12345,                  // assigned by bus (monotonic)
  "source": "timer_scheduler",
  "event_name": "proactive.cowork",
  "ts": 1717000000123,              // client epoch ms
  "payload": { /* event-specific */ },
  "hint_tier": 2,                   // source's estimate; dispatcher decides final
  "dnd_override": false             // true only for user-initiated
}
```

Valid `source` values: `timer_scheduler`, `idle_watcher`, `os_event_watcher`, `user_input_source`, `backend_push_source`.

### 4.2 Queue policy
- **Structure**: priority-ordered array, key = `(priority ASC, ts ASC, insertion-seq ASC)` (FIFO within a tie).
- **Capacity**: 100. On overflow, the lowest-priority item is dropped + logged via `onDrop`.
- **Bus drop conditions**: schema invalid, unknown `event_name` prefix, `ts` outside ±60 s.

### 4.3 Priority (lower = first to pop)
| Priority | Prefix |
|---|---|
| 0 | `user.*` |
| 1 | `backend.push.*` |
| 2 | `idle.*`, `time_milestone.*`, `proactive.*` |
| 3 | `os.*` |
| 4 | `periodic_tick` (internal) |

## 5. Dispatcher Routing

### 5.1 Classification
| event_name pattern | tier | target |
|---|---|---|
| `user.text_submitted` / `user.voice_segment_ready` | 2 | backend_caller |
| `proactive.*` | 2 | backend_caller |
| `time_milestone.*` | 2 | backend_caller (dormant — no firing source) |
| `idle.short` / `idle.long` | 2 | backend_caller (dormant) |
| `idle.returned` | 1 | tier1_ambient_engine (dormant) |
| `user.tap` | 1 | tier1_ambient_engine |
| `user.drag_start` / `user.drag_end` | 1 | tier1_ambient_engine |
| `user.window_sit_enter` / `user.window_sit_exit` | 1 | tier1_ambient_engine |
| `os.active_app_changed` | 3 | backend_caller (dormant) |
| unknown | hint_tier ?? 3 | drop (no-op) |

tier1 render directives are local (backend-independent): `user.drag_start` → motion `drag`, `user.drag_end` → motion null, `user.window_sit_enter` → motion `window_sit`, `user.window_sit_exit` → motion null, `user.tap` / `idle.returned` → empty directive (hold; ambient cue is a renderer seam).

### 5.2 Conflict resolution
- A single in-flight backend call. New tier2/3 events queue in a 1-item pending slot; a second pending event drops the oldest (`stale_pending`).
- **`user.text_submitted` arrival** → abort the in-flight backend call, drop all pending tier2/3, and sweep remaining tier2/3 from the bus (`superseded_by_user`); tier1 leftovers still render. The user event then proceeds from B1.

## 6. Guardrails
Guardrail evaluation is **pure** — it returns a verdict only, never mutates dispatcher state, and holds no dispatcher reference. Time is read only through an injected `now()`.

### 6.1 DND (Do Not Disturb)
**State**: `DND_ON ⇔ DND_OFF`. DND_ON if **any** of the 4 triggers is on.
| Trigger | ON | OFF |
|---|---|---|
| Fullscreen | `os.fullscreen_entered` | `os.fullscreen_exited` |
| Camera | `os.camera_in_use=true` | camera idle ≥ `dnd.camera_idle_off_ms` (30000 ms) |
| Active app | active app in `dnd.app_blocklist` (default `[]`) | outside blocklist |
| Manual | `user.dnd_toggle` | toggle again |

**When DND_ON**: tier 2/3 firing → silent drop (`guardrail_drop`, INFO). tier 1 continues. `dnd_override=true` passes.

### 6.2 Debounce (per source, `debounce_ms`)
| Source | Window |
|---|---|
| `idle_watcher` | 30000 ms |
| `os_event_watcher` | 5000 ms |
| `backend_push_source` | 10000 ms |
| `user_input_source` | 0 |
| `timer_scheduler` | 0 (no window; cowork self-limits via cadence) |

A pass within the window drops the event; only a pass updates the per-source last-fire timestamp.

### 6.3 Rate limit (rolling `window_ms` = 3600000 ms / 60 min)
| Tier | Cap | On exceed |
|---|---|---|
| 1 | unlimited | — |
| 2 | **`tier2_max` = 12** | drop (no refund) |
| 3 | **`tier3_max` = 2** | drop (no refund) |
| overall backend calls | **`overall_max` = 26** | enter dispatcher cooldown for `cooldown_ms` = 300000 ms (5 min) |

A slot is consumed at **fire time (attempt, not success)** with **no refund** — rate-overflow, backend network failure, abort, and supersede never roll back a counter. The rate limit is the first-line defense against autonomous-firing spam (PRD R5), so a backend failure cannot bypass the ceiling.

**Cooldown ownership**: the guardrail sets `cooldownUntil` on overall-cap overflow and reports `cooldownActive()`; the `running → cooldown → running` transition and the 5-min timer are **owned by the dispatcher**, which polls `cooldownActive()` each pump to sync state (entry and exit always implemented together — no state you cannot leave). During cooldown: tier2/3 firing drops (`guardrail_drop`), tier1 keeps rendering, `dnd_override=true` user turns still bypass.

### 6.4 Evaluation order
INTENT: `DND → debounce → rate-limit → classify → route`. Each DROP logs `dispatcher.drop` with a reason code.

The dispatcher's actual wiring is `user-supersede → classify (obtain tier) → evaluate(env, tier) → route` — the guardrail needs `tier`, which classify produces, so classify runs first (consistent with the §6.4 INTENT). `dnd_override` **short-circuits** at the top of `evaluate` — user-initiated turns bypass DND, cooldown, debounce, and rate-limit, and increment no counter. The evaluate sequence is: dnd_override short-circuit → DND → cooldown → debounce → tier rate-limit → overall rate-limit (sets cooldown) → pass (consume slot).

## 7. Backend Caller

### 7.1 Context schema
> **Payload schema is owned by [`contract.md`](./contract.md) §4 `InputContext`.** This section defines only the trigger/idle metadata the dispatcher layers on top. Field naming matches the contract.

The system hint is a layered shape sent as a `system` message `client_context: <JSON>`:
```jsonc
{
  // contract §4 InputContext (env.timestamp, env.timezone, env.active_app.name,
  // env.active_window_title, env.is_fullscreen, screenshot meta, user_text), data_url stripped
  "input_context": { /* InputContext per contract.md §4 */ },

  // trigger envelope (siblings)
  "trigger": {
    "source": "user_input_source | timer_scheduler | ...",
    "event_name": "...",
    "ts": 0,                         // bus envelope ts (epoch ms)
    "seq_id": 0                      // when present
  },

  // dispatcher-known state not in InputContext (siblings)
  "dispatcher_state": {
    "idle_seconds": 0,               // from payload.os_idle_ms when present
    "tier_hint": 2                   // from envelope hint_tier when present
  }
}
```

- `trigger`, `dispatcher_state.idle_seconds`, and `dispatcher_state.tier_hint` are siblings inside the hint. `dnd_state` and `tier2_silence_ok` are not emitted.
- The user message is the user text, or the marker `(proactive: co-working check-in)` for proactive turns. Screenshot `data_url` rides as a USER `input_image` content-part; only cheap screenshot meta stays in the hint.
- `input_context.user_text` is set only on user-fired turns; `env.active_app.name` / `env.active_window_title` / `env.is_fullscreen` are filled best-effort from the os-context snapshot when present.

### 7.2 Call sequence (B1–B5)
| Step | Action | Failure → handling |
|---|---|---|
| B1 | `packageContext` — assemble InputContext (user text, timestamp, timezone, best-effort os-context, optional screenshot) | screenshot capture failure → log + proceed without screenshot |
| B2 | `streamChat` → `POST {chat_base}/v1/responses` (streaming SSE owned by `chat-client`; `X-Hermes-Session-Id` header when a session id is present; abort via linked `AbortController`) | abort → `superseded_by_user` / setup or stream error → `network_drop` (WARN; if any speech delta arrived, fire `onSpeechAbort`) |
| B3 | parse — `chat-client` `completed` event yields the [`contract.md`](./contract.md) §3 `ControlEnvelope` (`{ speech_text, emotion?, motion?, emotion_text?, tool_status?, rich_content? }` — no should_speak, D-NO-SPEAK-GATE) | no `completed` → `parse_error` (WARN) |
| B4 | render — `renderer.applyDirective(envelope)`; emotion/motion applied **regardless of speech**; `emotion_text` → `onEmotionText` (once, deduped against stream `express`); `tool_status` → `onToolStatus` | renderer error → logged, dispatcher continues |
| B5 | speech gate — streamed deltas → `onSpeechEnd`; else non-empty `speech_text` → `onSpeech`; else `empty_speech` (INFO, silent) | — |

The 15 s request timeout and single retry are a dormant seam; the caller performs no retry today — any stream error becomes `network_drop`. `usage` events flow to `onUsage` (a diagnostic channel feeding the token-threshold compaction trigger).

### 7.3 Result and drop classification
The caller never throws; it returns `{ ok, drop_reason? }`.
| Drop | Trigger | Log |
|---|---|---|
| `guardrail_drop` | DND / debounce / rate-limit / cooldown | INFO |
| `empty_speech` | backend silence (emotion/motion only, or no response) | INFO |
| `parse_error` | no `completed` event | WARN |
| `network_drop` | setup or stream error | WARN |
| `http_4xx_drop` | bad request | ERROR |
| `superseded_by_user` | user turn arrived / external abort | INFO |
| `stale_pending` | second pending tier2/3 displaces the oldest | INFO |

## 8. Tier 1 Ambient Engine
Render-loop (`rAF`) hook, backend-independent, **additively blended** with backend motion (channel separation or weight compositing). Conflict resolution is the renderer's responsibility.

| Cue | Frequency | Mechanism |
|---|---|---|
| `blink` | ~4 s ± 2 s | eye BlendShape pulse 150 ms |
| `idle_sway` | always | spring bone + sine (head/hip) |
| `breath` | 4 s period | chest BlendShape sine |
| `look_around` | 30–120 s random | head bone target shift |
| `tap_react` | on `user.tap` | head bob 200 ms |

Backend expression holds for N seconds, then ambient blink resumes; during motion playback `idle_sway` weight 0.3 → 0.1, restored on end.

## 9. Dispatcher State
```
[booting] → (start) → [running]
[running] → (overall rate-limit exceeded) → [cooldown] → (5 min timer ends) → [running]
[running] → (compaction boundary reached) → [compacting] → (settle / skip / error / timeout) → [running]
[running] → (stop) → [stopped]
[compacting] → (stop) → [stopped]
```
The `cooldown` entry (overall rate-limit overflow) and return to `running` after the 5-min window are **owned by the dispatcher** (entry and timer-exit implemented together; the guardrail only reports `cooldownActive()`). During cooldown, tier2/3 drop (`guardrail_drop`), tier1 continues, `dnd_override=true` bypasses. The `degraded` and `draining` states exist as enum members without active transition triggers.

### `compacting` (session-compaction maintenance window, D-SESSION-CONTINUITY)
- **Entry**: a compaction request latched via `requestCompaction()` enters synchronously at a **turn boundary** (`inFlight===null` && `state==="running"`) — the moment an in-flight turn ends (`startBackendCall` finally), or immediately at `requestCompaction()`/pump tick if already idle. On entry it renders a `thinking` cue and kicks the compaction thunk raced against a timeout.
- **Gates**: while compacting, new backend turns are **held** — `enqueueBackend`/`drainPending` see the latch and only enqueue (rare tier2/3 pile into pending and drain after compaction). Chat input is disabled in parallel. The guarantee is at the **queue level** (held events accumulate and drain post-compaction), not just UI input disablement.
- **Exits**: when compaction settles (`compressed`/`skipped`/`error`) or hits `compact_timeout_ms` (= 12000 ms → abort), the cue resets to `neutral`, state returns to `running`, and one pump drains held events. If `stop()` intervenes, the return to `running` is skipped and state goes to `stopped`.
- **No-session guard**: with no session id, `requestCompaction()` is a no-op, avoiding pointless compaction and cue flicker. Compaction itself and rotation-id application/diagnostics live outside the dispatcher (main.ts compact thunk); the dispatcher is store-agnostic.

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
Fire-and-forget.

### Dispatcher → Backend Caller (in-process)
Input: `call(env, abortSignal)` · Output: `Promise<{ ok, drop_reason? }>`.

### Backend Caller → Renderer (in-process)
`renderer.applyDirective(envelope)` with contract §3 `ControlEnvelope` fields. Renderer-side expression key mapping is the client-local registry's responsibility (contract §1).

## 11. Observable States (debug inspection)
| API | Returns |
|---|---|
| `dispatcher.state()` | current `DispatcherState` |
| `dispatcher.queue()` | pending + bus snapshot |
| `dispatcher.recentDrops(n)` | recent n drops (with reason) |
| `dispatcher.inFlight()` | `{ trigger, started_at } \| null` |

**Control surface (compaction, all builds):**
| API | Behavior |
|---|---|
| `dispatcher.requestCompaction()` | Latch session compaction (idempotent). Enters `compacting` at the next turn boundary (`inFlight===null`). No-op if compact thunk absent, session id absent, already `compacting`, or in `stopped`/`booting`. main.ts calls it on idle resume (focus), token threshold (`createCompactionTrigger`), and blur. |
| `dispatcher.subscribeState(cb)` | Subscribe to transitions — `cb(state)` per transition, returns an unsubscribe fn. main.ts uses it to disable chat input while `compacting` (`setInputEnabled(s !== "compacting")`). |

The hold guarantee while `compacting` is at the **queue level** — external (cowork) tier2/3 events only enqueue, never launch, and drain after the return to `running`.

**Logs (all builds)**: `dispatcher.fire`, `dispatcher.drop`, `dispatcher.backend_call`, `dispatcher.state_change`.

## 12. Cleanup Inventory
| Resource | Created | Released | Method |
|---|---|---|---|
| In-flight backend fetch | B2 | response / abort / stop | `AbortController.abort()` |
| Pending queue event | bus push | dispatch / drop / drain | queue removal |
| Compaction abort | compacting entry | settle / timeout / stop | `AbortController.abort()` |
| Rust IPC subscription | start | stop | `unlisten()` |
| Pump interval | start | stop | `clearInterval` |

## 13. Failure & Recovery Matrix
| Failure | Location | Recovery |
|---|---|---|
| Rust IPC disconnect | os_event_watcher → webview | cowork degrades (no presence signal). No user-facing alert. |
| Backend network down | B2 | silent `network_drop`. Overall cap overflow → dispatcher cooldown 5 min. |
| Structured output broken | B3 | silent `parse_error`, no user-facing impact. |
| VAD misrecognition | user_input_source | outside dispatcher scope — passed to backend, which may stay silent. |
| Renderer error | renderer | logged, dispatcher continues. |
| Rate-limit flood | dispatcher | cooldown 5 min. |
| Queue 100 exceeded | event_bus | lowest-priority dropped, continues. |

## 14. Workflow Tree (representative: `proactive.cowork`)
| Step | Actor | Action | Failure / branch |
|---|---|---|---|
| 1 | cowork_source | present (idle ≤ `present_max_idle_ms`) and `interval_ms` reached → fire `proactive.cowork` → `event_bus.push()` | not present → no fire; away→present edge re-anchors, no fire |
| 2 | event_bus | validate, assign seq_id, insert | schema/unknown/ts-window → bus drop / queue full → lowest-priority drop |
| 3 | dispatcher | §6.4 evaluate → `tier=2, target=backend_caller` | DND_ON → drop / debounce hit → drop / rate-limit → drop (no refund) |
| 4 | backend_caller | §7.2 B1–B5 | §7.3 classification |
| 5 | renderer | expression + motion + bubble + TTS | error → logged |

**ABORT path**: backend call in flight + `user.text_submitted` arrives → ① abort the in-flight `AbortController` ② no counter refund (slot consumed at fire, §6.3) ③ user event proceeds from B1 ④ all pending tier2/3 dropped (`superseded_by_user`).

## 15. Test Cases
Moved to [`event-dispatcher.tests.md`](./event-dispatcher.tests.md). Keep the TC ↔ § matrix there in sync when adding or editing spec sections.

## 16. Assumptions
| # | Assumption | Note |
|---|---|---|
| A1 | Rust has OS-wide idle API access (macOS `CGEventSourceSecondsSinceLastEventType`, Win `GetLastInputInfo`, Linux X11 `XScreenSaverQueryInfo`) | `os_idle_ms` is null on Windows → cowork inert there |
| A2 | Control transport = server-side `express` tool-call (D-TRANSPORT). Hermes `/v1/responses` exposes `function_call` items; wire arguments are FLAT `{ emotion_id?, motion_id?, emotion_text? }` (non-verbal only; no should_speak, D-NO-SPEAK-GATE; motion derived from emotion, D-MOTION-FROM-EMOTION). `express` is optional per turn. | `function_call` is absent from final `output[]` → captured during streaming |
| A3 | TTS stream is a separate workflow (dispatcher-external) | dispatcher does not own audio life-cycle |
| A4 | `camera_in_use` detection is best-effort, OS capability varies (Linux unsupported) | Linux guardrail weaker |
| A5 | The queue is in-memory only; loss on app exit is acceptable | persistence is overkill for ambient/proactive firing |
