# YUI — Agent Guide

> **YUI = Hermes Agent(brain)의 embodied frontend(head).** VRM 캐릭터 렌더링 + 데스크톱 펫 행동 +
> I/O 표면만 담당한다. 두뇌(MCP·tool calling·search·long-term memory·agent loop·proactivity *judgment*)는
> **백엔드(Hermes)에 위임**한다. 이 파일이 정본 가이드다. 코드를 만지기 전에 읽어라.

## 핵심 원칙: firing ≠ judgment

client는 **언제 후보 이벤트가 생겼나(firing)** 만 책임진다. **말할지 / 무엇을 말할지(judgment)** 는
backend 소관이다. dispatcher가 이 경계를 강제한다 — tier 2/3 event는 backend 호출로만 발화가 되고,
backend가 `express` tool-call로 `should_speak:false`를 주면 client는 조용히 drop한다.
→ client에 brain(모드 분기·페르소나 상태·judgment)을 두지 않는다.

## 스택

| 레이어 | 기술 | 버전 |
|---|---|---|
| 셸 / OS | Tauri v2 (Rust) | tauri 2.11.x, CLI 2.11.x |
| 빌드 / dev server | Vite | 8.x (port **1420** 고정) |
| 언어 | TypeScript | 6.x (bundler mode, `noEmit`) |
| 렌더 | three.js | 0.180.x |
| VRM / 모션 | `@pixiv/three-vrm`, `@pixiv/three-vrm-animation` | 3.5.x |
| 음성 | `@ricky0123/vad-web` (Silero+ONNX) | 0.0.x (F3에서 사용) |

## 디렉터리 맵

```
YUI/
  index.html              # Vite 진입 (#app 마운트 → src/main.ts)
  vite.config.ts          # Tauri 규약: port 1420, strictPort, host 127.0.0.1
  configs/                # config-driven (하드코딩 금지). 런타임 로드 대상.
    endpoints.json          # chat/stt/tts base url (contract.md §Endpoint)
    emotion_registry.json   # emotion id → vrm_expression + fallback (contract.md §1)
    emotion_tts_prefix.json # emotion → TTS prefix. ⚠ TBD 스텁 — 토큰 발명 금지 (D-EMOTION-DUAL)
    motions.json            # MVP 3종(idle/drag/sit) registry (contract.md §2)
  src/
    main.ts               # 부트스트랩 (placeholder, 실제 조립 M1)
    contract/             # docs/contract.md §1~§4의 TS 타입 (원천=contract.md)
      types.ts              # EmotionId/EmotionSignal/MotionSignal/MotionRegistryEntry/
                            # ExpressArgs/ControlEnvelope/InputContext/ScreenSource/EndpointsConfig
      index.ts              # re-export barrel
    renderer/index.ts     # three.js + VRM 로드/표정/모션 + 진폭 립싱크 (F1)
    io/
      chat-client.ts        # Responses API SSE 파서 — express + 텍스트 스트림 (F6)
      tts-pipeline.ts       # 텍스트 스트림→큐→문장분절→TTS(:8092)→ordered playback→립싱크 (F4)
      stt-vad.ts            # VAD(@ricky0123/vad-web)→STT(:5517) (F3)
    dispatcher/
      event-bus.ts          # priority queue (event-dispatcher.md §4)
      dispatcher.ts         # classify → guardrail → route (event-dispatcher.md §5/§7)
      guardrails.ts         # DND / debounce / rate-limit (event-dispatcher.md §6)
    ambient/tier1.ts      # blink / idle sway / breath (backend 독립, F5 / §8)
    config/load.ts        # configs/*.json 로더 + 핫리로드 (F8)
    styles.css
  src-tauri/
    tauri.conf.json       # 투명·always-on-top 펫 창. identifier com.yui.desktop.
                          # macOSPrivateApi=true (투명 필수) → Cargo tauri feature macos-private-api 짝.
                          # ⚠ security.csp=null (개발 편의). OSS 전 강화 TODO.
    Cargo.toml            # tauri features=["macos-private-api"]
    src/
      lib.rs                # run() — Tauri Builder. mod os_event_watcher.
      main.rs
      os_event_watcher.rs   # OS API 접근 stub: active app / OS idle / fullscreen / camera →
                            # tauri://event "os_event" emit (event-dispatcher.md §1/§3.3/§10). 실제 호출 M1.
  docs/                   # 설계 정본 (아래 "핵심 결정 포인터")
```

> 현재 `src/` 모듈은 전부 **빌드 통과하는 placeholder**(타입 export + 시그니처 + TODO)다.
> 기능 구현은 M1+에서. 과구현 금지.

## Hermes 연동 요지

전송 계층은 전부 **OpenAI 호환 API** (concept.md §1). 세 base URL은 **서로 다른 프로세스**다 (config 교체 가능):

- **chat → Hermes `/v1/responses` (`localhost:8642`, SSH 터널).** `previous_response_id` server-side 상태 +
  Responses 이벤트 스트리밍. fallback `/v1/chat/completions`.
- **STT → `localhost:5517` `/audio/transcriptions`** (독립 ASR, Hermes 무관).
- **TTS → `localhost:8092` `/audio/speech`** (독립 TTS, Hermes 무관).

**제어신호 transport = 서버사이드 `express` tool-call** (D-TRANSPORT):
`/v1/responses` 스트림의 `function_call` 아이템 중 **name == `express`** 의 arguments =
`{ emotion?, motion?, should_speak? }`. **발화 텍스트는 tool-call이 아니라 별도 assistant 텍스트 스트림**
(`response.output_text.delta`, D-SPEECH). `express`·`emotion`은 **둘 다 optional** — 없는 턴은
motion idle + 직전 표정 유지. ⚠ function_call은 최종 `output[]`에서 빠지므로 **스트림 진행 중**
(`...arguments.done` 시점)에 캡처해야 한다. SSE 형식 원천: `docs/openai_response_sdk/sse-event-format.md`.

**tool_status** 는 Hermes 네이티브 tool(web_search/terminal/browser 등)의 function_call item을
client가 관찰해 도출한다 (express 아님). **rich_content** 는 P2 — MVP는 발화 텍스트 마크다운 인라인 렌더.

## 핵심 결정 포인터 (docs/)

- **`docs/contract.md`** — TS 타입의 **원천**. §1 Emotion / §2 Motion / §3 Control envelope /
  §4 Input context / §Endpoint. `src/contract/types.ts`는 여기서 파생. 스키마 변경은 여기부터.
- **`docs/prd.md`** — F1~F9 + **결정 로그 D-*** (§5): D-TRANSPORT / D-SPEECH / D-TTS-PIPELINE /
  D-EMOTION-DUAL. 마일스톤 M0~M4 (§6).
- **`docs/event-dispatcher.md`** — 컴포넌트 경계(§1), source 트리거(§3), event bus(§4), 라우팅(§5),
  guardrails(§6), backend caller B1~B5(§7), tier1 ambient(§8), Rust↔Webview handoff(§10).
- **`docs/concept.md`** — 큰 줄기 + non-goals(§5, Hermes 위임 목록).
- **`docs/alignment-report.md`** — Phase 0 cross-check 기록 (V1~V8 검증, OI 결정).
- **`docs/openai_response_sdk/`** — Hermes Responses SSE event 형식 (chat-client 파싱 근거).

## 빌드 / 실행

```bash
pnpm install            # 의존성
pnpm dev                # Vite dev server (port 1420) — 브라우저 단독 (셸 없음)
pnpm tauri dev          # Tauri 앱 (투명 펫 창) — beforeDevCommand로 pnpm dev 자동 기동
pnpm build              # tsc(타입체크) + vite build → dist/
pnpm tauri build        # 네이티브 번들
pnpm tauri info         # 툴체인/버전 확인
cd src-tauri && cargo check   # Rust 컴파일 체크 (Mate-Engine 외 CI 없음 — 이게 검증)
```

> 렌더링/UI는 `pnpm dev`로 브라우저에서 스크린샷 검증(AI 시각 루프), 네이티브 윈도우 레이어만 Tauri로 분리.

## 안티패턴 (하지 말 것)

- **client에 brain을 두지 말 것.** judgment(말할지/내용)·페르소나 상태·모드 분기는 backend. client는 firing + 렌더만.
- **inline 제어 태그 금지.** emotion/motion을 발화 텍스트 안에 `[happy]` 같은 inline 토큰으로 박지 않는다 —
  스트리밍 토큰 분할로 깨진다. 제어는 `express` tool-call arguments로만.
- **미검증 가정 금지.** "아마 이럴 것"으로 결정하지 말고 docs(contract/prd/event-dispatcher/alignment) 우선.
  docs에 없으면 web/context7 cross-check 후 docs에 먼저 기록. (Phase 0에서 미검증 추측으로 endpoint가
  뒤집힌 전례 있음 — alignment-report §2.)
- **emotion_tts_prefix 토큰 발명 금지.** prefix 포맷은 TTS 구현 시 사용자에게 질문해 확정 (D-EMOTION-DUAL, 현재 TBD).
- **하드코딩 금지.** 엔드포인트/모델/VRM 경로/모션셋은 `configs/`. OSS 단계 API 키는 OS keychain.
- **과구현 금지.** scaffold/placeholder 단계에선 빌드 통과가 목표. 기능은 해당 마일스톤에서.
