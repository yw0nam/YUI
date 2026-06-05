# YUI — Build Waves Plan

> **Last updated:** 2026-06-05
> **Status:** Wave 0 in progress (parallel lanes active)

This document tracks the phased build plan for YUI. Each wave has a keystone and a set of parallel lanes. A lane is a git worktree + PR unit. Lanes within a wave may run in parallel once their shared prerequisite (the keystone) is merged.

---

## Wave 0 — Contract Refactor Keystone

**Keystone prerequisite:** `docs/contract.md` updated to `generate_express` + flat `{ emotion_id?, motion_id?, emotion_text? }` args + `should_speak` removed. All downstream lanes assume this contract.

### Parallel Lanes (run concurrently after keystone)

| # | Lane | Status | Notes |
|---|---|---|---|
| #19 | STT/VAD — configurable 1.5s silence threshold | In progress | VAD silence timeout exposed in `configs/endpoints.json` (or `configs/vad.json`) |
| #15 | Amplitude lipsync — wav playback → mouth blendshape | In progress | Reads amplitude from decoded PCM; drives `aa`/`oh` blendshape weight per frame |
| #17 | tool_status + markdown rich content | In progress | Parses `function_call` item name+status from SSE stream → renders tool status in chat UI; MVP markdown inline-render |
| #26 | os_event_watcher — macOS → Windows → Android | In progress | Priority: macOS first, then Windows, Android deferred |
| #49 | Expression Broker MCP | **DONE (external)** | Independent MCP server, **live @ `localhost:3201`**. Exposes `generate_express` (flat 3-field), `get_ids`, `update_*_ids`, `expression://vocabulary` resource. Not a lane to build — already running. |
| docs | Docs consistency sweep | In progress | Align all docs to `generate_express`/flat/no-`should_speak` contract; broker live status; this file. |

### Deferred (not in Wave 0)

| # | Item | Reason |
|---|---|---|
| #20 | Screenshot / vision capture | Requires separate UI session (modal overlay, privacy toggle). Deferred to dedicated sprint. |

---

## Wave 2 — Proactive Agent Features

**Prerequisite:** Wave 0 complete (all parallel lanes merged to `main`).

Unblocked after `#26` (os_event_watcher) lands because Tier 2/3 firing requires OS idle + app-focus data.

| # | Lane | Notes |
|---|---|---|
| #18 | input_context schema v1 | Client → backend sensor payload: `active_app`, `window_title`, `timestamp`, optional screenshot ref |
| #24 | Tier 2 firing — time-based proactive turns | Timer-triggered backend call; silence = empty `speech_text` (no `should_speak`); rate-limit + debounce + DND client-side |
| #25 | Guardrails — rate-limit / debounce / DND | Shared module used by Tier 2 (#24) and Tier 3 |

> **Tier 2 "silence" protocol:** backend silence = no assistant text emitted (`speech_text == ""`). Client skips TTS + bubble. No `should_speak` flag. Proactive turn that only shows an expression sends `generate_express` with `emotion_id` only, no text stream. (D-NO-SPEAK-GATE)

---

## Decision Log

| Date | Decision |
|---|---|
| 2026-06-05 | broker #49 marked DONE (external, live @ :3201); not a build lane |
| 2026-06-05 | `express` → `generate_express`, flat args, `should_speak` removed — locked across all waves |
| 2026-06-05 | Wave 2 "silence" confirmed = empty speech_text (no dedicated flag) |
| 2026-06-05 | #20 screenshot deferred to separate UI session |
