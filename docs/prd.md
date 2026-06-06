# YUI — Product Requirements Document

> **Version:** v0.2 (promoted PRD, sprint-ready)
> **Status:** In Review
> **Predecessor:** [`concept.md`](./concept.md) v0.1 (big-picture)
> **Last updated:** 2026-06-03

---

## 1. Product summary

**YUI**는 Hermes Agent(brain, 별도 backend)의 embodied frontend(**head**)다. VRM 캐릭터를 데스크톱 위에 투명 always-on-top 윈도우로 띄워, 사용자의 텍스트·음성·화면 맥락을 backend에 전달하고, backend의 응답을 표정·모션·립싱크·말풍선·TTS로 표현한다. brain(MCP·tool calling·memory·agent loop·발화 judgment)은 일체 client에 두지 않는다. client는 "센서 + 렌더러 + 데스크톱 펫 셸"이다.

**핵심 분리 원칙:** `firing ≠ judgment` — client는 *언제 후보 이벤트가 났나*만 보고, *말할지/뭐라 말할지*는 backend가 결정한다.

**스택 전환 이유:** 기존 `Mate-Engine`(Unity) 대신 **Tauri + three.js + `@pixiv/three-vrm`** 으로 재구축. 목적은 **AI 시각 검증 루프 확보** — 브라우저 렌더 경로 덕분에 스크린샷 기반 자동 검증/QA가 가능해진다. (Mate-Engine과의 폐기/공존 여부는 본 PRD 범위 밖.)

**타깃 사용자:**
- **Primary (now):** 작성자 본인 — 개인용 데스크톱 컴패니언. 본인 워크플로(코딩·집필 중 곁에 두고 가벼운 대화·리마인더·맥락 인지 발화).
- **Secondary (OSS 전환 대비):** VRM·자기 LLM 백엔드를 운용할 수 있는 기술 사용자. config 파일 교체로 다른 OpenAI 호환 엔드포인트·VRM·모션셋을 붙일 수 있어야 함. 하드코딩 금지, 키는 OSS 단계에서 OS keychain으로 이주 가능한 구조로.

---

## 2. Goals / Non-goals

### 2.1 Goals (measurable)

| ID | Goal | Success criteria |
|----|------|------------------|
| G1 | VRM 캐릭터가 데스크톱에 자연스럽게 "살아 있다" | Tier 1 ambient(blink/sway/breath)가 backend 없이 60초 idle에서 멈춤 없이 동작; 캐릭터 영역만 클릭 가능, 그 외는 click-through |
| G2 | 텍스트·음성 대화 왕복이 가능 | 텍스트 입력 → backend 응답 → 자막+TTS+표정 변화까지 한 사이클이 7초 이내(LAN backend 기준)에 완료 |
| G3 | backend 신호가 캐릭터 연출로 정확히 매핑 | emotion enum → expression, motion ID → VRMA 트리거가 100% (등록된 enum 한정) 매칭 |
| G4 | 맥락 인지 입력 수집 | 활성 앱·창 제목·시간이 매 요청에 첨부됨; 스크린샷 토글 ON일 때 매 대화 자동 첨부 |
| G5 | 선제 발화가 폭주하지 않는다 | Tier 2 발화는 rate-limit(분당 ≤ N) + DND(focus-mode 시 0). backend 침묵(텍스트 미발신) 존중. 1시간 idle 시뮬레이션에서 spam 0회 |
| G6 | 핫스왑 가능한 config | VRM 파일을 config로 교체하면 앱 재시작 없이 1초 내 새 모델 표시 |
| G7 | AI 시각 검증 루프 작동 | headless 스크린샷 캡처로 "현재 expression == happy" 등 시각 단언이 가능 (개발용 dev tool) |

### 2.2 Non-goals (this version)

컨셉 §5 + 명시 보류:
- **brain 일체:** MCP, tool calling, 검색, long-term memory, persona/관계 상태(호감도 등), agent loop, 발화 judgment.
- **모드 분기 로직:** chat/assistant/pet 모드 전환의 판단은 backend. client는 "현재 모드 표시"만.
- **설정 UI:** MVP는 config 파일만. GUI editor는 Phase 2.
- **자체 phoneme/viseme 립싱크:** 진폭 기반으로 충분 — 정밀 viseme는 P2.
- **멀티 캐릭터.**
- **클립보드 수집** (privacy 표면 축소).
- **자동 업데이트·코드사이닝·배포 파이프라인.**

---

## 3. MVP Feature List (locked)

각 feature: **ID · 설명 · acceptance criteria(이게 되면 done) · depends-on**.

### F1 — Render (VRM)
VRM 모델 로드/핫스왑, VRMA 모션 재생, BlendShape/expression 제어, spring bone.

**Acceptance:**
- VRM 1종을 config 경로에서 로드해 화면에 표시. **config의 VRM 경로 교체 시 앱 재시작 없이 1초 내 새 모델로 핫스왑**.
- emotion vocab(F9)의 enum 1개를 코드에서 호출하면 VRM expression이 ≤ 100ms 내 반영. **[구현됨 feat/emotion-expression #6]:** `setEmotion` + `EmotionResolver`(pure, existence-aware fallback, unit-tested) + per-frame crossfade(`stepEmotion`, vrm.update 직전), hold-on-null, `≤100ms` 반응성(다음 프레임 전이 시작) + `transition_ms`(기본 250, 보간 지속 시간) 두 축 분리, dev `motion-preview` EMOTION 섹션(10종 버튼 + intensity/transition 슬라이더).
- motion registry(F9)의 ID 1개를 호출하면 해당 VRMA가 재생, 종료 후 idle로 자동 복귀. **[구현됨 feat/add_motion]:** `playMotion` + `MotionController`(pure state machine) + `VRMAnimationLoaderPlugin`/`createVRMAnimationClip`/`AnimationMixer` crossfade, LoopOnce+clampWhenFinished oneshot, idle baseline 자동 재생, dev `motion-preview` 도구(screenshot-verification surface).
- spring bone이 드래그·motion 재생 중에도 깨지지 않음.

**Depends-on:** F9(emotion vocab, motion registry).

---

### F2 — Shell (Tauri 데스크톱 윈도우)
투명·always-on-top 윈도우, per-region hit-test, 드래그, 멀티모니터, 클릭/쓰다듬기.

**Acceptance:**
- 윈도우는 투명·always-on-top·테두리 없음(Windows/macOS 양쪽 동작 확인).
- **캐릭터 실루엣 영역만 hit 가능**, 그 외 픽셀은 click-through(아래 앱이 클릭됨). 알파 임계값은 config로 조정 가능.
- 캐릭터 영역을 잡고 드래그하면 윈도우가 따라옴. 떼면 그 자리에 고정.
- 멀티모니터: 다른 모니터로 드래그해서 옮길 수 있고, DPI 차이에서도 깨지지 않음.
- 캐릭터 영역 클릭/쓰다듬기 제스처가 input event로 dispatcher(F6)에 발사됨.

**Depends-on:** F1.

> ⚠️ 이 영역은 AI 시각 검증이 어렵다 — OS 네이티브 윈도우 동작 의존. 개발 중 수동 QA 체크리스트를 별도 운용.
>
> **hit-test 구현(결정 2026-06):** Tauri는 per-pixel hit-test를 기본 제공하지 않는다. `tauri-plugin-polygon`(다각형 클릭 영역 정의)을 **우선** 시도, 안 되면 Rust cursor-polling + `setIgnoreCursorEvents`로 **fallback**. M1에서 polygon의 멀티모니터 동작을 먼저 검증(D-HITTEST).

---

### F3 — Input (sensors)
텍스트, STT(`/audio/transcriptions`), VAD, 활성앱/창제목/시간 수집, 스크린샷(토글).

**Acceptance:**
- 텍스트 입력 박스에 친 메시지가 backend로 전송됨.
- 음성 모드 토글 ON: **VAD가 발화 시작/끝을 자동 감지** → 녹음 → STT → 텍스트화 → backend 전송. 침묵 ≥ 800ms에서 끝 판정.
- 매 backend 요청에 input context schema(F9) 기준으로 `{active_app, window_title, timestamp}` 자동 첨부.
- 스크린샷 토글 UI 존재. **소스 선택 가능: monitor(번호 지정) 또는 browser tab(추후 — MVP는 monitor만)**. ON일 때 매 대화에 image content로 자동 첨부.

**Depends-on:** F8(config 엔드포인트), F9(input context schema).

---

### F4 — Output (rendering of backend signals)
챗 UI(말풍선/패널), TTS(`/audio/speech`), 진폭 립싱크, emotion→expression, motion 트리거, 툴 상태 표시, 리치 콘텐츠.

**Acceptance:**
- backend 스트리밍 응답(발화 텍스트 = `response.output_text.delta`)이 토큰 단위로 챗 UI에 즉시 표시됨.
- **client-side TTS 파이프라인(확정, D-TTS-PIPELINE):** 텍스트 스트림 토큰을 **버퍼 큐에 적재** → **문장 분절(sentence boundary) 감지** → 분절된 부분까지를 **per-sentence로 TTS API 호출**(`localhost:8092`) → output wav → UI 재생. **재생 순서 보존**(TTS 응답이 순서 뒤바뀌어 와도 원래 문장 순서대로 재생).
- **emotion이 있을 때** TTS text 맨 앞에 prefix로 부착해 전송(D-EMOTION-DUAL). emotion 없으면 prefix 없이 전송. prefix 포맷은 **TTS 구현 시 사용자에게 질문해 확정**(contract §1, 지금 미정).
- TTS 응답 wav가 재생되며, **재생되는 wav의 오디오 진폭에 따라 입(mouth blendshape)이 움직임**(진폭 기반 립싱크를 재생 wav에 동기, D1).
- control envelope(F9)에서 `emotion` 신호 수신 시 ≤ 200ms 내 VRM expression 변경.
- `motion` 신호 수신 시 motion registry 매핑된 VRMA 재생.
- `tool_status` 신호 수신 시 챗 UI에 "검색 중…" 등 placeholder 카드 표시.
- 리치 콘텐츠(이미지 URL/링크/카드)가 챗 UI에 인라인 렌더됨.

> STT/TTS는 Hermes와 무관한 **별도 OpenAI 호환 서비스**다 — ASR `localhost:5517`, TTS `localhost:8092`. client가 직접 호출한다(contract §Endpoint).

**Depends-on:** F1, F6, F9.

---

### F5 — Ambient layer (Tier 1, always-on, backend-independent)
blink, idle sway, 숨쉬기.

**Acceptance:**
- 앱 실행 직후, **backend 연결 없이도** blink(평균 3~6초 간격, 랜덤)·breath(흉부 미세 sway, 4초 주기)·idle sway가 동작.
- backend 대화 중에도 멈추지 않음(말할 때는 진폭 립싱크가 입만 override).
- 60초 idle 시뮬레이션에서 freeze/glitch 0회.

**Depends-on:** F1.

---

### F6 — Protocol (OpenAI 호환 + control envelope + dispatcher)
OpenAI 호환 스트리밍 chat + turn-bound 제어신호를 structured output으로 + client-side event dispatcher.

**Acceptance:**
- chat 호출은 `/v1/responses` (또는 `/v1/chat/completions`) OpenAI 호환 스트리밍.
- backend 응답에서 **control envelope(F9)이 서버사이드 `express` tool-call로 도착** — `/v1/responses`의 `function_call` 아이템 중 이름이 `express`인 것을 파싱(+ `GET /v1/runs/{run_id}/events` SSE). arguments = `{emotion, motion}`(비언어 전용; 발화 게이트 없음, D-NO-SPEAK-GATE). 발화 텍스트는 tool-call이 아니라 별도 텍스트 스트림 — 침묵은 텍스트 미발신으로 표현. inline 텍스트 태그 파싱 X (스트리밍 분할 깨짐 방지). json_schema 강제는 이론적 fallback으로만 강등(D-TRANSPORT/D-SPEECH, contract §Endpoint).
- client-side **event dispatcher**가 timer/idle-watcher/OS-event-watcher/user-input 네 source의 이벤트를 단일 bus로 모음.
- dispatcher가 Tier 1 이벤트는 로컬에서 소비, Tier 2/3 이벤트는 backend로 패키징 전송.
- **스트리밍 ↔ 제어신호 동시성 처리는 prototype-driven으로 결정** — M1~M2에서 실제 구현해보고 결정사항을 본 PRD 부록에 기록(아래 §5 참조).

**Depends-on:** F8, F9.

---

### F7 — Proactivity (Tier 1 + Tier 2)
Tier 1은 F5로 충족. Tier 2 = 시간대 인사·장시간 idle 반응 등 가벼운 발화. rate-limit/debounce/DND 가드. 침묵은 backend가 텍스트를 안 보내는 것으로 표현(D-NO-SPEAK-GATE — 별도 should_speak 플래그 없음).

**Acceptance:**
- idle 5분/15분/30분 등 config로 정의 가능한 timer가 dispatcher에 이벤트 발사.
- 발사 시 input context schema로 패키징해 backend에 "발화 후보" 요청 전송.
- backend가 침묵을 택하면 **assistant 텍스트를 내보내지 않음** → client는 발화하지 않음(말풍선/TTS 스킵). 완전 무반응을 원하면 `express`도 보내지 않음(표정만 짓고 싶으면 emotion만 전송). 별도 should_speak 플래그 없음(D-NO-SPEAK-GATE).
- rate-limit: Tier 2 발화는 분당 ≤ N회(config, 기본 1회). 초과 시 클라이언트 드롭.
- DND: OS focus-assist/do-not-disturb가 ON이거나 active_app이 config의 focus-app 목록에 있으면 Tier 2 발사 0회.
- Tier 3은 P2지만 dispatcher source 추가가 코드 한 곳 수정으로 가능하도록 추상화 유지.

**Depends-on:** F6, F9, F3(맥락 수집).

---

### F8 — Config (file-based)
API 엔드포인트·키·모델 ID·VRM 경로·모션셋·proactivity 파라미터.

**Acceptance:**
- `config.toml`(또는 `.json`) 1개 파일에서 다음을 모두 설정 가능:
  - `endpoints.chat / stt / tts` (base URL + 모델 ID)
  - `auth.api_key` (MVP는 평문, **OSS 진입 시 OS keychain으로 이주할 추상화 레이어**는 미리 둠)
  - `vrm.path`, `motions[]`(id → vrma 파일 매핑)
  - `proactivity.tier2_rate_per_min`, `proactivity.idle_thresholds_sec[]`, `proactivity.dnd_apps[]`
  - `screenshot.enabled`, `screenshot.source` (monitor index)
- 파일 변경 감지 시 핫리로드(VRM, motion registry, proactivity 파라미터). API 키 등 민감 값은 reload만, runtime swap은 다음 호출부터.

**Depends-on:** —

---

### F9 — Contract artifacts (the spec, not code)
client ↔ Hermes 사이 계약 문서/스키마 4종.

**Acceptance:** 다음 4종이 별도 markdown/JSON schema 파일로 `docs/contract/` 아래 존재:
1. **`emotion_vocab.md`** — backend가 쏠 수 있는 emotion enum 리스트 + (a) 각 enum의 client VRM expression 매핑. emotion의 목소리(TTS) 차원은 enum→prefix 매핑이 아니라 `generate_express`가 싣는 **자유 텍스트 `emotion_text` 채널**(검증 없는 FishSpeech voice 태그)이다 — contract.md §1/§3 참고.
2. **`motion_registry.md`** — motion ID ↔ VRMA 파일 매핑. **MVP 항목: `idle`(×5 variants), `drag`, `happy`, `laughing`, `shy_point` 5종** (D4/D-MOTION-VARIANTS 반영. `sit` 드롭 — 에셋 없음). VRMA 에셋은 `public/motions/`에 커밋, Vite `/motions/<id>.vrma` 서빙.
3. **`configs/express_tool.schema.json`** (canonical) — `express` tool-call arguments = `{emotion, motion}`의 JSON Schema. 발화 게이트 없음(D-NO-SPEAK-GATE), motion은 보통 client가 emotion에서 파생(D-MOTION-FROM-EMOTION). (`speech_text`는 tool 필드 아님 — 별도 텍스트 스트림. `tool_status`/`rich_content` 전송 경로 OPEN. D-TRANSPORT.)
4. **`input_context.schema.json`** — client → backend 센서 데이터 포맷(active_app, window_title, timestamp, optional screenshot ref).

각 문서는 버전 필드(`v1`)를 포함하고, 변경 시 changelog 작성.

**Depends-on:** — (선행 산출물 — M0에서 완성)

---

## 4. Phase 2 (deferred) — 명시 보류

| 항목 | 보류 이유 |
|------|----------|
| Tier 3 proactivity (맥락 감지 후 선제 개입) | dispatcher 추상화는 유지하되, 트리거 sensing이 무거움. Tier 1·2 안정화 후 |
| Backend SSE/WebSocket push channel | OpenAI 호환 외 별도 채널 — Tier 3와 묶어서 |
| 설정 UI (GUI editor, persona 편집, 모델 업로드) | config 파일로 본인 사용엔 충분. OSS 단계 진입 신호로 |
| viseme/phoneme 정렬 립싱크 | 진폭 기반으로 1차 검증. 표현력 부족 판정 시 |
| 멀티 캐릭터 | scope explosion. 단일로 안정화 후 |
| Tauri auto-updater + 코드사이닝 + 배포 | 개인용 단계엔 불필요. OSS 직전 |
| OS keychain 이주 | 평문 config의 추상화 레이어만 미리 두고, 실제 이주는 OSS 진입 시 |
| 클립보드 입력 | privacy 표면 — 명시 보류, 필요 입증 후 재검토 |
| browser tab 스크린샷 소스 | monitor 캡처로 시작, tab은 별도 권한·구현 필요 |

---

## 5. Confirmed decisions log

본 PRD 작성 시점까지 합의된 결정 (컨셉 §6 open questions 중 일부 + 추가):

| # | 결정 | 합의일 |
|---|------|--------|
| D1 | **립싱크 = 오디오 진폭 기반** (viseme/phoneme은 P2) | 2026-06-03 |
| D2 | **스크린샷 정책 = UI 토글 + 소스 선택**(MVP monitor 인덱스). **ON일 때 매 대화 자동 첨부** | 2026-06-03 |
| D3 | **단일 캐릭터** (멀티 P2) | 2026-06-03 |
| D4 | **Motion registry MVP = `idle`(×5 variant clips), `drag`, `happy`, `laughing`, `shy_point` 5종.** `sit`은 VRMA 에셋 없어 드롭 — 에셋 준비 시 재추가. Motion VRMA 에셋은 `public/motions/`에 git-tracked 커밋(~2.4MB), Vite가 `/motions/<id>.vrma` 서빙. VRM 모델(`resources/vrms/carlotta.vrm`, ~48MB)은 gitignore 유지 (크기 임계값). | 2026-06-03 (updated feat/add_motion) |
| D-MOTION-VARIANTS | **idle variant pool + client-side 선택 (D-MOTION-VARIANTS).** `MotionRegistryEntry`에 optional `variants?: string[]` + `variant_policy?: "random" \| "sequential"` 추가. `idle`은 5개 VRMA clip(`idle_01`~`idle_05`)을 하나의 논리 ID로 묶어 entry마다 client가 random 선택 (`Math.floor(rng()*len)` 클램프). `variants` 없는 entry는 `vrma_path` 단일 경로 — 하위 호환. | feat/add_motion |
| D5 | **스트리밍 ↔ 제어신호 동시성 = prototype-driven** — M1~M2에서 실제 동작 시켜 본 뒤, 다음 중 택해 본 doc 부록에 기재: (a) envelope 먼저 보내고 텍스트 stream, (b) 텍스트 stream 끝에 envelope, (c) envelope을 별도 channel/event | 2026-06-03 |
| D6 | **스택 = Tauri + three.js + `@pixiv/three-vrm`** (AI 시각 검증 루프 목적) | 2026-06-03 |
| D7 | **client에 brain 없음** — 모드 판단·judgment·persona 상태 일체 backend | concept v0.1 |
| D-TRANSPORT | **Control 신호 전송 = 서버사이드 `express` tool-call.** Hermes에 등록된 `express(...)` **tool(plugin, skill 아님)** 의 arguments(`{emotion, motion}`)로 비언어 제어신호 전송. client는 `/v1/responses`의 `function_call`(name==`express`) 파싱 + `GET /v1/runs/{id}/events` SSE 수신. **이전 json_schema strict-output 강제 가정을 supersede** — json_schema는 이론적 fallback 한 줄로 강등 | 2026-06-03 |
| D-NO-SPEAK-GATE | **발화 게이트(`should_speak`) 제거.** firing을 client event loop가 소유하므로 "말할지"를 backend transport 신호로 둘 필요 없음. **침묵 = backend가 assistant 텍스트 미발신**(`speech_text==""`) → client가 빈 텍스트면 발화 스킵. express는 순수 비언어 `{emotion?, motion?}`로 축소. Tier 2 폭주 방지는 client-side rate-limit/DND가 담당 | 2026-06-04 |
| D-MOTION-FROM-EMOTION | **motion은 client가 emotion에서 파생.** backend는 보통 emotion만 전송. `express.motion` 생략 시 client가 emotion id 전이 순간 emotion→motion 기본 매핑에서 제스처 1회 파생(oneshot; 매핑 없으면 idle). `express.motion` 명시 시 override(정서 무관 제스처/억제용 escape hatch). motion 채널은 schema에 optional 유지. client 구현 = #16 계열 후속(매핑 아티팩트 신설) | 2026-06-04 |
| D-SPEECH | **발화 텍스트 = Hermes 일반 assistant 텍스트 스트림**(`response.output_text.delta`). tool-call 안에 넣지 않음 | 2026-06-03 |
| D-TTS-PIPELINE | **client-side TTS 파이프라인(required):** 텍스트 스트림 → 버퍼 큐 적재 → 문장 분절 감지 → per-sentence TTS(`localhost:8092`) → output wav → UI 재생 → **재생 순서 보존(ordered playback)** → 진폭 립싱크를 재생 wav에 동기 | 2026-06-03 |
| D-EMOTION-DUAL | **emotion 이중 용도:** ① VRM expression 구동 ② **TTS text 맨 앞에 prefix로 부착** → TTS가 파싱해 감정 음성 생성. emotion은 **optional**(없으면 plain TTS). **prefix 매핑은 required이나 포맷은 TTS 구현 시 사용자에게 질문해 확정(지금 미정, 발명 금지)** | 2026-06-03 |
| D-EXPRESS-OPTIONAL | **`express` tool-call·emotion 모두 optional** — 없는 턴은 idle motion + 직전 표정 유지. 매 턴 호출·도착 타이밍은 하드 의존 아님 (R16/R17 해소) | 2026-06-03 |
| D-EMOTION-EXPRESSION | **emotion→expression = existence-aware fallback + hold-on-null (구현됨, feat/emotion-expression #6).** `src/renderer/emotion-resolver.ts`(pure, no three.js)가 registry fallback 체인 탐색 시 각 후보 키를 `expressionManager.getExpression(key) != null` 술어로 검사해 **현재 VRM이 실제로 가진 expression만 채택**하며 사이클 가드 후 최종 terminal은 `"neutral"`. resolver + 술어는 VRM 핫스왑마다 재생성. `setEmotion(null)` = NO-OP(직전 표정 유지), 오직 명시적 `{id:"neutral"}`만 neutral 전이. 미등록 explicit id → warn + neutral. `≤100ms`(반응성: 다음 프레임 전이 시작)과 `transition_ms`(보간 지속 시간, default 250)는 독립된 두 축. expression weight는 `stepEmotion`이 vrm.update 직전 매 프레임 lerp 적용 → `blink` 등 tier-1 키와 충돌 없이 합성. registry는 `RendererOptions.emotionRegistry` / `setEmotionRegistry()`로 주입(motion 병렬 구조). dev `motion-preview` inspector에 EMOTION 섹션(10종 버튼 + intensity/transition 슬라이더) 추가. | feat/emotion-expression |
| D-RICH-MVP | **rich content = MVP는 발화 텍스트의 마크다운**(링크·이미지)을 chat UI가 인라인 렌더. 구조화 카드 envelope은 P2 | 2026-06-03 |
| D-HITTEST | **per-region hit-test = `tauri-plugin-polygon` 우선, cursor-polling + `setIgnoreCursorEvents` fallback** (M1 검증) | 2026-06-03 |
| D-AMICA | **Amica(MIT) 코드 직접 차용 허용** — 구현된 부분 베끼고 안 맞는 것만 새로 작성 | 2026-06-03 |
| D-CHAT-SDK | **chat-client = 공식 `openai` npm SDK 어댑터** — SSE 라인 파서를 직접 구현하지 않는다. `client.responses.create({stream:true})`의 타입된 이벤트(`response.output_text.delta`/`function_call_arguments.done`/`output_item.added`/`completed`/`error`)를 우리 `ChatStreamEvent` + `ControlEnvelope`로 매핑하는 얇은 어댑터만 작성. SSE framing·청크분할·abort는 SDK가 소유. `baseURL`=Hermes, 키는 더미(추후 keychain), Tauri webview = `dangerouslyAllowBrowser:true`. ⚠ Hermes 커스텀 필드/이벤트의 SDK 통과 여부는 [#1](https://github.com/yw0nam/YUI/issues/1) E2E에서 검증 (context7 openai-node 6.42 cross-check 2026-06-04) | 2026-06-04 |
| D-TAURI-FETCH | **Tauri webview → Hermes CORS 우회 = `@tauri-apps/plugin-http` fetch injection.** Hermes(`localhost:8643`)는 Origin 헤더 있는 요청에 403을 반환(CORS 미설정). Tauri webview에서의 직접 fetch는 CORS preflight OPTIONS → 403. 해결: `@tauri-apps/plugin-http`의 `fetch`를 `new OpenAI({ fetch: tauriFetch })`로 주입 → 요청이 Rust side를 통해 나가며 Origin 헤더 없음 → 203/200 정상 응답. Dev(Vite) 환경은 fetch 미주입(undefined) → SDK 글로벌 fetch 사용 → vite proxy 경유. 환경 감지: `selectFetch()`가 `globalThis.__TAURI_INTERNALS__` 존재 여부로 분기. **Approach B(Hermes CORS 추가)는 채택 안 함** — 백엔드 별 프로젝트 수정 없이 프론트엔드만으로 해결. `StreamChatOptions.fetch`로 주입 seam 노출. Cargo dep: `tauri-plugin-http = "2"`, capability: `http:default` + `allow` scope = Hermes/STT/TTS 3 호스트. (cross-check: context7 @tauri-apps/plugins-workspace + openai-node fetch option 2026-06-04) | 2026-06-04 |

추후 결정은 본 표에 append. 기존 항목은 변경하지 말고 supersede 표시.

---

## 6. Milestones

각 마일스톤은 **exit criteria(이게 되면 다음 단계로)** 가 명확해야 한다.

### M0 — Contract & Dispatcher spec (paper-only, ~1주)
산출물: F9 4종 문서가 `docs/contract/`에 존재.
- emotion vocab 초안(최소 8개 enum)
- motion registry(3종 + 파일 경로 placeholder)
- control envelope JSON Schema (validator로 검증 가능)
- input context JSON Schema
- dispatcher 의사코드 / source 인터페이스 spec (코드 X, doc만)

**Exit:** Hermes 측 PM/엔지니어가 본 4종 문서를 읽고 "backend에서 producer/consumer 만들 수 있다"고 sign-off.

---

### M1 — Render + Shell skeleton (~2주)
산출물: F1 + F2의 기본형. backend 통신 없음.
- Tauri 윈도우(투명·always-on-top·per-region hit-test) 띄움
- VRM 1종 로드 + 핫스왑 동작
- VRMA `idle` 재생
- 드래그·멀티모니터 동작
- 스크린샷 캡처 dev tool(headless로 현재 프레임 저장)이 동작 — 이게 G7의 시각 검증 루프 시드

**Exit:**
- 앱 실행 → VRM 캐릭터가 데스크톱 우하단에 떠 있고 click-through 동작
- config의 VRM 경로 교체 → 1초 내 새 모델
- dev tool로 스크린샷 자동 저장 가능

---

### M2 — Input + Output 통합 (~3주)
산출물: F3, F4, F5, F6 — 첫 end-to-end 대화 루프.
- 텍스트 입력 → backend chat(스트리밍) → 챗 UI 토큰 표시 → TTS 재생 → 진폭 립싱크
- control envelope 파싱 → emotion → expression, motion → VRMA 재생
- VAD + STT 음성 입력 동작
- 활성앱/창제목/시간 첨부, 스크린샷 토글 동작
- Tier 1 ambient(blink/sway/breath) 항상 ON
- D5(동시성 결정) 확정 후 본 PRD 부록에 기록

**Exit:**
- "안녕"이라 텍스트 입력 → 7초 이내 캐릭터가 표정 변화+자막+TTS 음성으로 응답
- 음성으로 "안녕"이라 말함 → 위와 동일한 응답
- 스크린샷 토글 ON + 화면 띄운 채 질문 → backend가 이미지 본 응답 반환

---

### M3 — Proactivity Tier 1+2 + 가드레일 (~2주)
산출물: F7 완성.
- idle timer source가 dispatcher에 등록되어 발사
- backend 침묵(텍스트 미발신) 존중 — 빈 응답이면 발화 스킵(D-NO-SPEAK-GATE)
- rate-limit / debounce / DND 동작
- proactivity 파라미터가 config에서 조정됨

**Exit:**
- 1시간 idle 시뮬레이션에서 Tier 2 발화 ≤ 60회(rate-limit 분당 1 가정), spam 0회
- focus-app(예: 풀스크린 게임) 활성 시 Tier 2 발화 0회
- backend가 침묵 선택(텍스트 미발신 + express 미호출) → 캐릭터 무반응 (표정도 안 바뀜). 표정만 짓는 경우는 express로 emotion만 보냄.

---

### M4 — Polish + 내부 alpha (~2주)
- 시각 검증 루프 정착: 주요 expression/motion에 대한 자동 스크린샷 회귀 테스트셋
- 메모리/CPU 프로파일, idle 시 ≤ X% CPU 목표 (수치는 M4 시작 시 결정)
- 에러 경로 정리: backend 다운, TTS 실패, VRM 로드 실패 시의 fallback UX
- config validation + 친절한 에러 메시지
- M4 시작 시점에 본 PRD § "Done" 체크리스트(§9) 전체 review

**Exit (= MVP done):** §9 acceptance/done definition 전 항목 충족.

---

## 7. Risks & mitigations

| ID | Risk | Likelihood | Impact | Mitigation |
|----|------|-----------|--------|------------|
| R1 | OpenAI 호환 TTS는 viseme/타이밍 미제공 — 립싱크 품질 한계 | High | Medium | D1로 진폭 기반 확정. 품질 부족 시 P2에서 phoneme 정렬 검토. M2 종료 후 사용자(=본인) 체감 평가 |
| R2 | Tauri 투명·always-on-top·hit-test가 OS별로 다르게 동작 (특히 macOS vs Windows) | High | High | M1에서 양 OS 동시 검증. 차이 큰 부분은 플랫폼별 분기 + 수동 QA 체크리스트 운용. AI 시각 검증 어려운 영역으로 별도 추적 |
| R3 | backend 응답 지연 시 UX freeze (특히 Tier 2 trigger 중 응답 안 옴) | Medium | Medium | client는 모든 backend 호출에 timeout(기본 10s) + 실패 시 silent drop. 사용자 입력 응답엔 "..." placeholder 표시 후 timeout 시 친절한 fallback |
| R4 | 스트리밍 중 control envelope 도착 타이밍이 텍스트 토큰보다 늦으면 표정 지연 | Medium | Low | D5 prototype-driven 결정. envelope 우선 전송 또는 명시적 사전 phase로 backend가 envelope을 first chunk로 보내도록 합의(M2에서 확정) |
| R5 | Tier 2 발화 spam — rate-limit 깨지면 토큰 새고 캐릭터가 짜증남 | Medium | High | F7 acceptance에 1시간 시뮬레이션 강제. firing이 client 소유라 client-side rate-limit/DND가 1차 방어선(backend 침묵=텍스트 미발신은 보조) |
| R6 | VAD 오작동 (배경 소음에 트리거) | Medium | Medium | 임계값 config 노출. 음성 모드는 명시 토글로만 ON (default OFF) |
| R7 | 스크린샷이 민감 정보 노출 | Medium | High | 토글 기본 OFF. 첨부 직전 UI에 "스크린샷 첨부 중" indicator 표시. 캡처 영역 config로 제한 |
| R8 | config 파일에 평문 API 키 — 유출 위험 | Low | High | MVP는 개인용이라 수용. F8의 추상화 레이어 덕에 OSS 진입 시 OS keychain으로 교체 비용 낮음 |
| R9 | three.js + VRM 메모리 누수 (핫스왑 반복 시) | Medium | Medium | F1 acceptance에 핫스왑 반복 테스트 추가(10회 swap 후 메모리 baseline +20% 이내) — M4에서 검증 |
| R10 | Control transport — **확정: 서버사이드 `express` tool-call**(D-TRANSPORT). 잔여 리스크: tool-call 파싱/수신 경로 안정성 | Medium | High | §8 Dependencies에 명시. M0 sign-off에서 backend `express` skill commitment 확보. **검증(2026-06): Hermes `/v1/responses`가 `function_call` 아이템 노출(공식 docs) + `GET /v1/runs/{id}/events` SSE.** json_schema 강제는 이론적 fallback으로만 강등(더 이상 plan 아님) |
| R16 | ~~emotion 도착 타이밍~~ **해소(2026-06): emotion optional** — 있으면 prefix, 없으면 plain TTS. 하드 의존 아님 | Low | Low | best-effort prefix (contract §3 D-TTS-PIPELINE). 특별 fallback 불요 |
| R17 | ~~express 매 턴 호출 보장~~ **해소(2026-06): express optional** — 없는 턴은 idle motion + 직전 표정 유지 | Low | Low | express 부재 = 정상 케이스 (contract §3) |
| R11 | (=dispatcher A1) Rust OS-wide idle API 접근 — Linux Wayland 미지원 가능 | Medium | Medium | M1에서 Win/macOS 우선 검증. Wayland는 idle source `error` 처리 + 대체 경로 조사 |
| R12 | (=dispatcher A2) Tauri `emit` 지연 > 50ms — fullscreen/idle 반응 지연 | Low | Low | M1에서 실측. 큰 지연 시 OS-event 폴링 주기 조정 |
| R13 | (=dispatcher A4) TTS audio life-cycle을 dispatcher가 책임지면 cleanup 복잡 | Medium | Low | M2 E2E 통합 시 audio 스트림을 dispatcher 외부 워크플로로 분리 확정 |
| R14 | (=dispatcher A5) `camera_in_use`(DND) 감지가 OS별 상이 — Linux 미지원 | Medium | Medium | M3에서 OS capability table 작성. Linux는 가드레일 약화 수용 |
| R15 | (=dispatcher A6/A7) `localStorage` milestone idempotency 휘발 / in-memory 큐 손실 | Low | Low | M3 검증(TC-15). 휘발 우려 시 tauri-plugin-store로 milestone만 persist |

> dispatcher A1~A7 ↔ R11~R15 양방향 매핑. 검증 마일스톤은 [`event-dispatcher.md`](./event-dispatcher.md) §16과 동기화.

---

## 8. Dependencies on Hermes (backend)

YUI MVP 진행에 backend 측에서 보장해야 할 사항:

1. **OpenAI 호환 chat 유지** — Hermes는 `/v1/responses`(기본) + `/v1/chat/completions`를 노출(공식 docs 검증). client가 config로 endpoint를 교체할 수 있는 한 OpenAI SDK 호환 형태 유지. ⚠ **audio는 Hermes 밖:** `/audio/transcriptions`·`/audio/speech`는 Hermes api-server가 노출하지 않으므로, YUI는 STT/TTS를 **별도 OpenAI 호환 provider**로 호출(`audio_base_url` 분리). 이 항목은 Hermes 의존이 아니라 YUI config 항목.
2. **서버사이드 `express` tool 등록 (optional 비언어 제어 채널)** — emotion/motion 연출을 원하면 Hermes에 `express(...)` **tool(plugin — `hermes-express-tool.md`, skill 아님)** 을 등록해 `{emotion?, motion?}`를 tool-call로 노출. client는 응답 스트림에서 `function_call`(name==`express`)을 파싱(근거: `openai_response_sdk/sse-event-format.md`). **express는 optional** — 호출 안 하는 턴은 client가 idle로 처리하므로 매 턴 보장·도착 타이밍은 **하드 의존이 아니다**(R16/R17 해소). **검증(2026-06): Hermes `/v1/responses`가 function_call item을 스트림에 노출(Hermes 자체 SSE 구현 docs).** json_schema 강제는 dependency 아님.
3. **침묵 = 텍스트 미발신 (D-NO-SPEAK-GATE)** — Tier 2 발화 요청에 backend가 "지금은 말 안 함"을 택하면 **assistant 텍스트를 내보내지 않는다**(별도 should_speak 플래그 없음). client는 빈 텍스트면 발화를 스킵한다. 컨셉 §3 Tier 2 silence 규약.
4. **emotion / motion enum 합의** — F9 #1, #2의 vocabulary를 backend가 generation 단계에서 enum constrain.
5. **input context schema 수용** — F9 #4의 active_app/window_title/timestamp 필드를 chat 요청의 system 또는 metadata로 받아 처리.
6. **이미지 입력 처리** — 스크린샷이 image content로 첨부될 때 비전 모델 라우팅 (OpenAI 호환 image content 형식).
7. **응답 지연 SLA** — text-only 응답 ≤ 5s p95 (LAN 기준). 초과 시 client는 timeout 처리.
8. **(Phase 2) push channel** — Tier 3을 위한 SSE/WebSocket. MVP에는 불필요하지만 dispatcher source 추가만으로 합류 가능하도록 spec 미리 정렬. **검증(2026-06): Hermes는 `GET /v1/runs/{run_id}/events` SSE로 tool-call progress·token delta·lifecycle event를 제공** — 이게 tool_status(F4) 렌더 소스이자 P2 push 채널의 유력 후보. M0에서 채택 여부 검토.

이 항목들은 Hermes 측 PRD/issue에 mirror 되어야 한다. M0 exit 게이트가 곧 Hermes 측 sign-off.

---

## 9. Acceptance / Done definition

**"YUI MVP done"이란:**

- [ ] F1~F9 모든 acceptance criteria 충족 (M4 종료 시 전수 체크)
- [ ] 본인이 1주일 연속 일상 사용에서 critical bug 0건
- [ ] 텍스트 대화 1회 왕복 ≤ 7초 (LAN backend, p95)
- [ ] 음성 대화 1회 왕복 ≤ 10초 (LAN backend, p95)
- [ ] 1시간 idle 시뮬레이션에서 Tier 2 spam 0회, freeze 0회
- [ ] Tier 1 ambient는 backend 끊은 채로도 1시간 freeze/glitch 0회
- [ ] VRM/motion/proactivity 파라미터를 config 파일 수정으로 전부 바꿀 수 있음 (재시작 없이도 핫리로드 — 단, API 키는 다음 호출부터)
- [ ] Windows + macOS 둘 다에서 F2(투명·always-on-top·hit-test·드래그·멀티모니터) 동작 확인
- [ ] AI 시각 검증 dev tool로 주요 expression(≥ 4종) + motion(5종: idle/drag/happy/laughing/shy_point)에 대한 스크린샷 회귀 테스트셋 존재
- [ ] §8 dependencies가 모두 Hermes 측에서 충족됨 (특히 express tool 등록 + emotion/motion enum 합의)
- [ ] D5(동시성) 결정사항이 본 PRD에 기록됨
- [ ] `docs/contract/` 4종 문서가 v1로 frozen

이 체크리스트 전체가 통과한 시점이 MVP done. 그 다음은 Phase 2 (§4) — 또는 OSS 전환 준비.

---

## Appendix — pending records

- **D5 동시성 결정 결과**: _M2 종료 시 기재_
- **M4 CPU/메모리 baseline 수치**: _M4 시작 시 기재_
- **Mate-Engine과의 관계 (폐기 vs 공존)**: 본 PRD scope 밖. 별도 결정 필요.
