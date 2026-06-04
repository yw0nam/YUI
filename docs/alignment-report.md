# YUI Phase 0 — Alignment & Verification Report

> **Date:** 2026-06-03 · **Scope:** concept/contract/event-dispatcher/prd 정합 + Global Standard 검증
> **방법:** 결정 항목을 web/context7 + Hermes 공식 docs로 cross-check (가정 금지 원칙).

---

## 1. Global Standard 검증 결과

| # | 검증 항목 | 결과 | Spec 영향 | 출처 |
|---|---|---|---|---|
| V1 | Hermes `/v1/responses` 지원 | ✅ **지원** (`/v1/chat/completions`도). `previous_response_id` server-side 상태 + `response.output_text.delta` 스트리밍 | **기본 endpoint = `/v1/responses`** 확정 (contract §Endpoint) | Hermes docs `/features/api-server` |
| V2 | STT/TTS 토폴로지 | ✅ **확정: Hermes와 무관.** ASR/TTS는 독립 OpenAI 호환 서비스 — ASR `localhost:5517`, TTS `localhost:8092`. client UI가 직접 호출 | config base URL 3개 분리(chat/stt/tts) | 사용자 확정(2026-06) + Hermes docs(audio 미노출 교차확인) |
| V3 | Control envelope transport | ✅ **확정: 서버사이드 `express` tool-call(plugin, skill 아님).** Hermes `/v1/responses`가 `function_call` 아이템 노출 + `GET /v1/runs/{id}/events` SSE → `express(...)` tool arguments(`{emotion, motion}`)로 비언어 제어신호 전송. 발화 게이트 없음(D-NO-SPEAK-GATE, 침묵=텍스트 미발신), motion은 client가 emotion에서 파생(D-MOTION-FROM-EMOTION). 발화는 별도 텍스트 스트림 | **transport 확정**(D-TRANSPORT/D-SPEECH/D-NO-SPEAK-GATE, contract §Endpoint/§3). json_schema 강제는 이론적 fallback으로 강등. 잔여 미검증은 OI-2로 이동 | Hermes docs `/features/api-server` (function_call 노출 검증) + 사용자 결정(2026-06) |
| V4 | Hermes vision 입력 | ✅ 두 endpoint 다 inline image (chat=`image_url`, responses=`input_image`) | F3 스크린샷/비전 경로 OK | Hermes docs `/features/api-server` |
| V5 | Hermes 푸시 채널 | ✅ `GET /v1/runs/{run_id}/events` SSE (tool-call progress·token delta·lifecycle) | **tool_status(F4) 렌더 소스 + P2 push 후보** | Hermes docs `/features/api-server` |
| V6 | Tauri v2 per-region hit-test | ⚠️ **네이티브 미지원.** 표준 워크어라운드 = Rust ~60fps cursor polling + `setIgnoreCursorEvents` / plugin `tauri-plugin-polygon` | **F2 spec 보강 필요** (아래 OI-1) | Tauri v2 docs, issue #13070, tauri-plugin-polygon |
| V7 | `@pixiv/three-vrm` | ✅ VRM 1.0 + `three-vrm-animation`(VRMA) + expressionManager + springBoneManager. 핫스왑 가능 | F1 그대로 유지 | context7 `/pixiv/three-vrm` |
| V8 | 음성 파이프라인 표준 | ✅ VAD = **@ricky0123/vad-web**(Silero+ONNX Runtime Web). prior art = **Amica**(three-vrm+Tauri+OpenAI 호환, 동일 스택). 립싱크 후보 = wawa-lipsync | F3·F4 라이브러리 후보 확정 | Amica repo, silero-vad, ricky0123/vad |

---

## 2. 적용한 수정 (이번 패스)

- **[중대] endpoint 되돌림:** 직전 패스에서 *검증 없는 추측*("self-host는 chat completions만 지원")으로 contract가 chat completions를 기본으로 뒤집혀 있었음. V1 검증으로 **`/v1/responses` 기본 복원**. (원칙 위반 사례 — 이후 가정은 항상 검증 후 기재.)
- **audio endpoint 분리:** contract §Endpoint + PRD §8 #1에 V2 반영 (`audio_base_url` 분리, Hermes 의존 아님).
- **structured output 정밀화:** Responses `text.format` vs Chat `response_format` 구분 + Hermes 미검증 명시 (contract, PRD §8 #2, dispatcher A3, R10).
- **Runs API SSE:** PRD §8 #8에 V5 반영 (tool_status/P2 push 메커니즘).
- **R11~R15 추가:** dispatcher A1~A7 ↔ PRD §7 양방향 매핑 완성 (직전 패스에서 dispatcher만 쓰고 PRD 누락).
- **[중대] control transport 확정:** json_schema strict-output 강제 가정을 **서버사이드 `express` tool-call**(arguments `{emotion, motion}`)로 supersede (contract §Endpoint/§3, PRD F6/F9/§5 D-TRANSPORT, dispatcher A3). 발화 텍스트는 별도 assistant 텍스트 스트림으로 분리(D-SPEECH).
- **[갱신 2026-06-04] express = tool(plugin)이지 Hermes-skill 아님 + should_speak 제거 + motion fallback:** express는 Hermes plugin tool로 등록(skill=마크다운 지시문은 function_call 안 만듦; `hermes-express-tool.md` §0). 발화 게이트 `should_speak` **제거**(D-NO-SPEAK-GATE) — firing이 client event loop 소유라 침묵=텍스트 미발신으로 표현. motion은 backend가 보통 생략, client가 emotion 전이에서 파생(D-MOTION-FROM-EMOTION). express arguments = `{emotion?, motion?}`로 축소.
- **TTS 파이프라인 명세화:** client-side 큐 → 문장 분절 → per-sentence TTS(`localhost:8092`) → ordered playback → 진폭 립싱크 동기 (contract §3 D-TTS-PIPELINE, PRD F4).
- **emotion 이중 용도:** VRM expression 구동 + TTS text prefix 부착. emotion→TTS-prefix 매핑은 required·TBD로 표기(발명 금지).
- **[중대] express·emotion optional 확정 + Responses 스트림 grounding:** 사용자가 `openai_response_sdk/`(response.md / sse-event-format.md / streaming.md) 제공. express tool-call과 emotion은 **둘 다 optional** — 없는 턴은 idle + 직전 표정, emotion 없으면 plain TTS. R16/R17 해소. tool_status는 Hermes 네이티브 tool의 function_call item(name+status) 관찰로 도출, rich_content는 P2(MVP는 텍스트 마크다운). contract §3에 실제 SSE event(`output_item.added`/`function_call_arguments.delta`/`.done`) 기준 파싱 절차 명시.

## 3. 구조/정합 (직전 패스에서 완료, 확인됨)

- contract = **단일 파일 유지** (PRD F9의 `docs/contract/` 4분할 권고를 supersede — cross-ref 폭증 방지).
- event-dispatcher §15 Test Cases → `event-dispatcher.tests.md` 분리 (stub 링크 잔류).
- emotion/motion/envelope 필드명: 3문서 일치 확인 (motion `idle/drag/happy/laughing/shy_point` — `sit` 드롭; envelope `emotion/motion/speech_text/tool_status/rich_content/_reserved` — `should_speak` 제거 2026-06-04).

---

## 4. 남은 Open Issues (결정/작업 필요)

- **OI-1 (F2 hit-test) — 결정(2026-06):** `tauri-plugin-polygon`(다각형 영역 정의)을 **우선** 채택. 안 되면 cursor-polling + `setIgnoreCursorEvents`로 **fallback**. M1에서 polygon이 멀티모니터 펫 케이스에 동작하는지 먼저 검증.
- ~~**OI-2:** express 매턴 호출 / emotion 타이밍~~ → **해소(2026-06):** express·emotion 모두 **optional**(사용자 확정). express 없는 턴은 idle + 직전 표정, emotion 없으면 prefix 없이 plain TTS. 하드 의존·neutral fallback 모두 불요(R16/R17 해소). Responses 스트림 파싱은 `openai_response_sdk/sse-event-format.md`로 grounding — function_call item을 스트림 중 관찰(최종 `output[]`엔 function_call 빠지므로 진행 중 캡처 필수), tool_status는 네이티브 tool function_call의 name+status에서 도출.
- ~~**OI-3:** audio provider 선택~~ → **해소(2026-06):** ASR `localhost:5517` / TTS `localhost:8092` 독립 OpenAI 호환 서비스로 확정.
- ~~**OI-4:** Amica 차용 수준~~ → **결정(2026-06):** MIT라 **코드 직접 차용 허용**. 구현된 부분(three-vrm 로더·VAD·TTS 파이프라인 등)은 베껴 쓰고 안 맞는 부분만 새로 작성.
