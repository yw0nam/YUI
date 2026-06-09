# YUI ↔ Hermes Contract

> **Version:** v0.2 draft — build-startable, 세부는 prototype에서 좁힌다. (changelog 맨 아래)
> **Scope:** client(YUI) ↔ backend(Hermes) 사이의 4개 스키마.
> **Single-file 정책:** 4종 스키마(Emotion / Motion / Control envelope / Input context)는 본 파일 단일 문서로 유지 — 4개로 쪼개면 cross-ref 폭증. PRD F9에서 `docs/contract/` 4파일을 권고했으나 **본 단일 파일로 supersede**.

**Companion specs:**
- [`concept.md`](./concept.md) §1 §4 — 원칙과 4종 산출물 정의
- [`event-dispatcher.md`](./event-dispatcher.md) — §7.1/§10이 본 문서의 `InputContext`/`ControlEnvelope`를 그대로 사용
- [`prd.md`](./prd.md) §3 F9, §8 Dependencies — 마일스톤별 검증 지점
- [`alignment-report.md`](./alignment-report.md) — Phase 0 정합 기록
- [`openai_response_sdk/`](./openai_response_sdk/) — Hermes Responses API SSE event 형식 (`sse-event-format.md`가 function_call/텍스트 스트림 파싱의 근거)

전송 계층은 [`concept.md`](./concept.md) §1대로 OpenAI 호환 API. 이 문서는 그 위에 얹는 payload만 다룬다. **제어신호(emotion_id/motion_id/emotion_text)는 서버사이드 `generate_express` tool-call의 FLAT arguments로** 전송 — inline 텍스트 태그 금지. **발화 텍스트는 tool-call이 아니라 별도 assistant 텍스트 스트림**으로 흐른다 (§3 참고). 발화 게이트(`should_speak`)는 없다 — 침묵은 backend가 텍스트를 안 보내는 것으로 표현한다(D-NO-SPEAK-GATE, §3).

### Endpoint abstraction (chat)

**검증(2026-06, Hermes 공식 docs `/features/api-server`):** Hermes는 `/v1/chat/completions`와 `/v1/responses`를 **둘 다** 노출한다. `/v1/responses`는 `previous_response_id` 기반 server-side 대화 상태 + `response.created` / `response.output_text.delta` 등 Responses event 스트리밍을 지원한다. → concept.md §1대로 **`/v1/responses`를 기본**으로 한다. endpoint는 concept §F(config-driven) 원칙상 교체 가능 — OSS 단계에서 `/v1/responses` 미지원 backend를 만나면 `/v1/chat/completions`로 fallback.

```jsonc
// configs/endpoints.json (요지)
{
  "chat_base_url":     "http://localhost:8643",  // Hermes (SSH 터널)
  "chat_endpoint":     "/v1/responses",          // default. fallback: "/v1/chat/completions"
  "chat_instructions": "You are the expression engine …", // Responses `instructions` nudge — generate_express 유도(config 소관)
  "chat_model":        "natsume",                // Hermes 모델 ID (Responses `model`). config 소관(하드코딩 금지)
  "stt_base_url":      "http://localhost:5517",  // 별도 ASR 서비스 (OpenAI 호환) → /audio/transcriptions
  "tts_base_url":      "http://localhost:8092",  // OpenAI 호환 TTS → /audio/speech (provider="openai")
  "tts_provider":      "irodori",                // "openai" | "irodori" (default irodori, §5)
  "irodori_base_url":  "http://localhost:8091"   // irodori_TTS (NOT OpenAI 호환) → /synthesize (§5)
}
```

**STT/TTS는 Hermes와 무관 (확정):** ASR/TTS는 **각각 독립된 서비스**로 서빙된다 — 기본 ASR `localhost:5517`. client UI가 이 둘을 **직접** 호출한다(Hermes를 경유하지 않음). base URL들은 서로 다른 프로세스이며 모두 config로 교체 가능. **TTS는 provider 선택형**이다(`tts_provider`): OpenAI 호환 `/audio/speech`(`localhost:8092`) 또는 **irodori_TTS**(`localhost:8091`, OpenAI 호환 아님 — §5). 둘은 additive로 공존하며 default는 `irodori`다. irodori contract·voice registry·tunables는 **§5**, 두 provider가 공유하는 `emotion_text` 어휘(이모지)는 §1·§3에 정의.

**Control transport (확정: `generate_express` tool-call):** 제어신호 전송은 Hermes(사용자 소유 backend)에 등록된 **서버사이드 `generate_express(...)` tool**로 한다. 이 tool-call의 **FLAT arguments**가 제어 필드를 싣는다: `{ emotion_id?, motion_id?, emotion_text? }`(전부 optional, motion_id는 보통 생략 — §3 D-MOTION-FROM-EMOTION). YUI client는 `/v1/responses` 출력의 `function_call` 아이템 중 **이름이 `generate_express`인 것**을 파싱해 사용한다 (+ 검증된 `GET /v1/runs/{run_id}/events` SSE로 tool-call 수신). generate_express는 Hermes 용어로 **skill이 아니라 tool(plugin)** 이다 — skill(마크다운 지시문)은 function_call을 만들지 않는다([`hermes-express-tool.md`](./hermes-express-tool.md) §0).

- **검증(2026-06):** Hermes `/v1/responses`가 `function_call` 아이템을 노출함(공식 docs). `generate_express`가 **서버사이드 tool**이므로 caller가 tool 정의를 주입할 필요가 없다.
- **발화 텍스트는 tool 페이로드 밖:** 발화는 `generate_express` arguments에 넣지 않고, Hermes의 일반 assistant 텍스트 스트림(`response.output_text.delta`)으로 토큰 단위 수신한다(§3 D-SPEECH).
- **이 결정은 이전의 "json_schema strict output으로 envelope 강제" 가정을 supersede한다.** json_schema(Responses `text.format` / Chat `response_format`)는 더 이상 plan이 아니며, `generate_express` tool-call이 불가능할 경우의 **이론적 fallback**으로만 한 줄 남긴다.

### Runtime request-shaping inputs (per-user, layered on config)

chat 요청은 위 `EndpointsConfig` 위에 **per-user 런타임 입력 2종**을 얹어 만든다. 둘 다 wire envelope(§3)을 바꾸지 않는다 — 표준 Responses 요청 필드를 어떻게 채울지만 정한다. 영속은 §3-store(localStorage `yui.agent`, D-AGENT-SETTINGS-STORE) 담당이며, **checked-in `configs/endpoints.json`을 mutate하지 않는다.**

- **[D-REASONING-EFFORT] `reasoning.effort` (per-user, optional).** Responses 표준 파라미터 `reasoning: { effort }`를 런타임 설정으로 노출한다. UI 값은 `default · low · medium · high` 4종 — 단 **`default`는 파라미터를 통째로 생략**(backend가 결정)하는 안전 기본값이고, 나머지 `low|medium|high`만 `reasoning.effort`로 실어 보낸다. backend("natsume", OpenAI 호환)가 무시할 수 있는 best-effort hint이며, 미설정/out-of-the-box 상태는 `default`(생략)다. config 파일 필드가 아니다.
- **[D-INSTRUCTIONS-OVERRIDE] `instructions` 런타임 오버라이드 (per-user, precedence).** Responses `instructions` 필드(system message)는 이미 존재하는 요청 필드다. 런타임 per-user 설정으로 이를 오버라이드할 수 있다. **precedence: 비어있지 않은 런타임 오버라이드가 우선**, 비어있으면 `EndpointsConfig.chat_instructions`(config 기본값)로 폴백한다. 오버라이드는 런타임 레이어일 뿐 `configs/endpoints.json`을 수정하지 않는다.
- **[D-ENDPOINT-OVERRIDE] 엔드포인트 오버라이드 (per-user, localStorage `yui.endpoints`).** 5개 필드(`chat_base_url`·`stt_base_url`·`tts_base_url`·`irodori_base_url`·`chat_model`)를 설정 UI에서 편집할 수 있다. 빈 값="오버라이드 없음" → bundled `EndpointsConfig` 기본값으로 폴백. URL 4종은 `^https?://`로 검증하며 무효 값은 무시(effective는 기본값 유지)하고 UI가 에러를 노출한다. `chat_model`은 URL 검증 없이 non-empty면 적용. `mergeEndpoints(config.endpoints, overrides)`가 effective config를 만들며 checked-in `configs/endpoints.json`을 mutate하지 않는다. consumer는 호출 시점에 merge를 평가하지만, **STT(`stt_base_url`)만은 부트 시점에 `sttVad`가 한 번 읽으므로 다음 부트/음성 재토글에서 반영된다.** `tts_voice`는 화자 선택과 중복이라 의도적으로 제외.

---

## 1. Emotion Vocabulary

### 목적
backend가 turn마다 보낼 수 있는 emotion enum. emotion enum은 **얼굴(표정)** 채널이다 — client-side에서 VRM expression registry로 소비된다:
- **(a) VRM expression registry:** emotion enum → VRM expression 키. 모델 핫스왑 시 backend는 손대지 않는다.

emotion의 **목소리(TTS) 차원**은 이 enum이 아니라 `generate_express`가 싣는 **별도의 자유 텍스트 `emotion_text` 채널**이다 — enum→prefix 매핑이 아니라 검증 없는 voice 태그를 model이 직접 생성한다(§3 / `generate_express`). **어휘는 이모지 태그**다(PR-A에서 FishSpeech 자유 텍스트를 대체 — §3 D-EMOTION-TEXT 표, §5). client는 이 태그를 TTS 분절 text **맨 앞에 prepend**할 뿐이라 **말풍선에는 들어가지 않는다**(prefix-only).

### Enum
- **표준 (VRM 1.0 preset 그대로):** `neutral` `happy` `angry` `sad` `relaxed` `surprised`
- **확장:** `thinking` (검색/툴 중 기본) · `curious` · `sleepy` · `embarrassed`

### Schema
```ts
type EmotionId =
  | "neutral" | "happy" | "angry" | "sad" | "relaxed" | "surprised"
  | "thinking" | "curious" | "sleepy" | "embarrassed";

interface EmotionSignal {
  id: EmotionId;
  intensity?: number;       // 0.0~1.0, default 1.0
  transition_ms?: number;   // 보간 시간, default 250
}
```

### 매핑 (client-local config)
```jsonc
// configs/emotion_registry.json
{
  "happy":       { "vrm_expression": "happy",    "fallback": "neutral" },
  "embarrassed": { "vrm_expression": "ex_blush", "fallback": "happy"   }
  // 모델별 파일로 핫스왑 가능
}
```

### 예시
```json
{ "id": "thinking", "intensity": 0.7, "transition_ms": 400 }
```

### 제약
- `intensity`는 클램프(0~1). 범위 밖이면 client가 잘라내고 경고.
- 모델에 해당 expression이 없으면 fallback 체인을 따른다. 최종은 항상 `neutral`.
- backend는 enum만 책임 — VRM 키 존재 여부는 알 필요 없다.
- viseme/phoneme은 별도 채널(§3 reserved). emotion과 섞지 않는다.
- `emotion === null` or absent → **NO-OP (hold previous)**. 오직 명시적 `{id:"neutral"}`만 neutral로 전이한다.
- emotion은 **턴마다 설정되고 발화(utterance) 동안 유지(held)** 되며, 그 턴의 **TTS 재생이 끝나면 neutral로 천천히 ease-back** 한다. 이 회귀는 위 규칙을 깨지 않는다 — 재생 종료 신호(onPlaybackEnd)가 트리거하는 **명시적 neutral 전이**일 뿐이다(`null` hold 규칙 불변). 재생이 없는 턴(빈 텍스트/TTS 비활성/전부 실패)에도 onPlaybackEnd가 발화하므로 neutral로 돌아온다.

> **[구현됨 feat/emotion-revert-on-tts-end]** 발화 종료 시 표정 회귀는 `src/renderer/ease-emotion.ts`(pure)의 `revertEmotionToNeutral(durationMs, sink)`가 담당한다 — 명시적 `{id:"neutral", transition_ms}`를 `setEmotion`으로 흘려보내 #6 크로스페이드를 그대로 재사용하고, 절대 `null`을 보내지 않는다(`null`은 hold). renderer는 `easeEmotionToNeutral(durationMs?)`로 노출하고, `src/io/speech-playback.ts`가 `onPlaybackEnd`에서 `stopMouth`/`finishSpeech`와 **같은 신호로** 호출한다(느린 ~1s ease, 스냅 아님). `setEmotion(null)` NO-OP·명시적 neutral·기본 250ms 크로스페이드는 불변.

> **[구현됨 feat/emotion-expression #6]** emotion→expression 결정 + existence-aware fallback은 `src/renderer/emotion-resolver.ts`(pure, no three.js)가 담당한다. `EmotionResolver.resolve(signal)`은 registry fallback 체인을 따라 내려가되 각 후보 키에 대해 `expressionManager.getExpression(key) != null` 술어로 **VRM 모델이 실제로 갖고 있는 expression만 채택**하며, 사이클 가드 후 최종 terminal은 항상 `"neutral"`. 술어와 resolver는 VRM 로드/핫스왑마다 재생성(존재 집합이 모델별). `intensity` clamp·경고, 미등록 id → warn + neutral도 `resolve()` 안에서 처리. renderer(`src/renderer/index.ts`) `setEmotion(signal | null)`은 `null`이면 즉시 return(hold previous), signal이면 resolver로 결정한 뒤 `stepEmotion`이 **vrm.update(dt) 직전 프레임마다** weight를 linear lerp해 `expressionManager.setValue`를 적용하는 per-frame 크로스페이드를 시작한다. `blink` 등 tier-1 전용 expression 키는 건드리지 않아 ambient와 합성된다. `≤100ms` 반응성(다음 프레임에 전이 시작)과 `transition_ms`(기본 250, 보간 지속 시간)는 독립된 두 축이다. registry는 `RendererOptions.emotionRegistry` 또는 `setEmotionRegistry()`로 주입(motion과 병렬 구조).

### Emotion 목소리 차원 → `emotion_text` 채널

emotion enum→prefix 매핑은 없다. emotion의 목소리(TTS) 차원은 `generate_express`가 싣는 **자유 텍스트 `emotion_text`** 필드로 전달된다 — 검증 없는 voice 태그를 model이 직접 생성하고(§3 / `generate_express`), client는 이를 TTS 분절 맨 앞에 prepend한다(§3 D-TTS-PIPELINE step 4). **PR-A부터 어휘는 이모지 태그 집합**이다(§3 D-EMOTION-TEXT 표). 같은 이모지를 반복하면 강도가 세진다(예: `🥺🥺`). prefix-only라 말풍선엔 노출되지 않는다.

---

## 2. Motion Registry

### 목적
backend가 motion ID로 동작을 요청하면 client가 VRMA 파일 + 재생 옵션으로 해석. MVP 5종.

### MVP entries
| id           | kind     | loop | priority | interrupt_policy | 비고                                        |
|--------------|----------|------|----------|------------------|---------------------------------------------|
| `idle`       | ambient  | yes  | 0        | replace          | baseline. 항상 깔려 있음. 5개 variant clip. |
| `drag`       | reactive | yes  | 80       | replace          | 사용자 드래그 중.                           |
| `happy`      | oneshot  | no   | 70       | replace          | 기쁨 제스처.                                |
| `laughing`   | oneshot  | no   | 70       | replace          | 웃음 제스처.                                |
| `shy_point`  | oneshot  | no   | 70       | replace          | 부끄럼+손가락 제스처.                       |

> **`sit` 제거:** VRMA 에셋 없음 — 에셋 준비 시 재추가. (기존 D4에서 `sit`이 MVP에 포함되어 있었으나 feat/add_motion에서 드롭됨.)

`idle`은 backend 요청 없이도 client가 깔아두는 baseline. backend가 `motion: null`을 보내면 client는 `idle`로 복귀한다. `happy`/`laughing`/`shy_point`는 gesture 모션(oneshot)으로, `emotion` 채널(표정)과 **독립된** `motion` 채널로 전달된다.

Motion VRMA 에셋은 **`public/motions/`에 git-tracked으로 커밋**되어 Vite가 `/motions/<id>.vrma`로 서빙한다 (~2.4MB, 크기가 작아 커밋). VRM 모델(`resources/vrms/carlotta.vrm`, ~48MB)은 gitignore 유지.

### Schema
```ts
type MotionKind = "ambient" | "reactive" | "state" | "oneshot";
type InterruptPolicy = "replace" | "queue" | "ignore";

interface MotionSignal {
  id: string;              // registry key
  loop?: boolean;          // registry default 오버라이드
  speed?: number;          // 0.25~2.5, default 1.0
  fade_ms?: number;        // crossfade, default 200
}

interface MotionRegistryEntry {
  vrma_path: string;       // Vite-served 경로 "/motions/<id>.vrma" (public/motions/ 아래 커밋)
  variants?: string[];     // [D-MOTION-VARIANTS] 2개 이상의 VRMA 풀. 있으면 variant_policy로 entry마다 1개 선택.
  variant_policy?: "random" | "sequential"; // [D-MOTION-VARIANTS] default "random". variants가 없으면 무시.
  kind: MotionKind;
  loop: boolean;
  priority: number;        // 0~100, 높을수록 우선
  interrupt_policy: InterruptPolicy;
}
```

### 충돌 정책
- 새 motion이 현재보다 priority 낮으면 `interrupt_policy`에 따라 queue/ignore/replace.
- `oneshot`은 끝나면 직전 ambient/state로 복귀.
- backend는 priority/interrupt를 명령하지 않는다 — registry가 진실의 원천.
- 미등록 ID 수신 시 client는 무시 + 경고 로그.

### 확장
새 motion = registry entry 추가 + VRMA 드롭(`public/motions/`). backend는 ID 문자열만 알면 됨.

**[D-MOTION-VARIANTS]** `idle`처럼 하나의 논리 ID에 여러 VRMA clip을 묶는 "variant pool"을 지원한다. `variants[]`가 있으면 client가 entry마다 `variant_policy`에 따라 1개를 골라 재생(random: `Math.floor(rng()*len)` 클램프). 없는 entry는 `vrma_path` 단일 경로 — 하위 호환.

---

## 2.5 Avatar (VRM) 선택

### 목적
client가 로드할 VRM 모델과, 사용자가 고를 수 있는 모델 목록. backend는 관여하지 않는다(렌더러 입력 #4, client-local config). `configs/avatar.json`에서 로드.

### Schema
```ts
interface AvatarOption {
  id: string;                    // 안정 키 (예: "carlotta") — 선택 상태 영속화 단위
  label: string;                 // 표시 이름 (예: "Carlotta")
  url: string;                   // vrm_url과 동일 의미 — Vite 경로 또는 절대 URL
  source?: "bundled" | "file";   // "file" = 향후 OS 파일 피커로 추가(#94 P2). 미지정 시 미상.
}

interface AvatarConfig {
  vrm_url: string;               // 기본/seed 선택. 항상 필수.
  available?: AvatarOption[];    // #94 선택 가능한 VRM 목록. 없으면 vrm_url 단일 모델.
  framing?: {                    // #106 전신 fit-to-bounds 카메라 knob. 없으면 렌더러 기본값.
    margin?: number;             //   거리 패딩 비율(distance·(1+margin)). 유한 ≥ 0. default 0.1.
    fov?: number;                //   수직 FOV(도). 열린구간 (0, 180). default 30.
  };
}
```

### 규약
- `vrm_url`은 항상 필수 — `available`이 없거나 비어 있어도 단일 모델로 동작(하위 호환).
- `available`이 있으면 배열이어야 하며, 각 항목의 `id`/`label`/`url`은 비어 있지 않은 문자열, `source`는 있으면 `bundled|file`. 위반 시 `ConfigError`로 fail-loud(부분 로드 없음).
- `id`는 영속화 키이자 CSS 셀렉터 `.yui-vrm[data-vrm-id="…"]` 값이므로 두 가지 추가 제약을 받는다(`label`은 자유 텍스트 — 제약 없음):
  - **유일성:** `available[]` 안에서 `id`가 중복되면 `ConfigError`. 선택 해소는 `find(x => x.id === …)`로 첫 항목만 잡아 중복 항목이 영구 unreachable이 되고, 영속화된 override도 모호해진다.
  - **charset:** `^[A-Za-z0-9._-]+$`만 허용(비어 있지 않고 공백·따옴표 등 셀렉터 특수문자 금지). 위반 시 셀렉터 조회가 깨지고 localStorage 키로도 취약하다.
- 보통 `available[0]` 또는 `id`가 `vrm_url`과 일치하는 항목이 seed 선택이다. 선택 상태의 영속화/스왑은 client 책임(#94 P2~).
- 모델 핫스왑 시 emotion expression registry는 손대지 않는다(§1 — existence-aware fallback이 모델별 expression 집합을 재평가).
- `framing`(#106): 선택 블록. 있으면 객체여야 하고 `margin`은 유한 ≥ 0, `fov`는 열린구간 (0, 180) — 위반 시 `ConfigError` fail-loud. 렌더러는 매 VRM 로드/핫스왑/창 리사이즈마다 모델 bounding box를 측정해 카메라 거리·`lookAt`을 도출, **전신(머리→발)을 정면·중앙 정렬로 프레이밍**한다(높이/폭 둘 중 먼 거리 채택 → 좁은 창에서 팔 잘림 방지). 기본값은 렌더러 소유라 `framing`은 부분값(`margin`만 / `fov`만)도 허용한다.

---

## 3. Control Signal Envelope

### 목적
한 turn의 제어신호를 담는다. **Transport = 서버사이드 `generate_express` tool-call의 FLAT arguments = `{ emotion_id?, motion_id?, emotion_text? }`** (위 endpoint abstraction "Control transport" 참고). 전부 optional이고 motion_id는 보통 생략된다(아래 D-MOTION-FROM-EMOTION). client는 이 flat 인자를 정규화한다: `emotion_id → emotion{ id }`, `motion_id → motion{ id }`, `emotion_text → emotion_text`.

**`generate_express`는 매 턴 선택(optional)이다 (확정).** Hermes가 어떤 턴에 `generate_express`를 호출하지 않으면 client는 기본 동작한다 — motion은 `idle` 유지, emotion 변화 없음(직전 표정 유지), 발화는 정상 진행. generate_express는 "있으면 적용, 없으면 idle"인 **부가 제어 채널**이지 필수가 아니다. 따라서 generate_express 도착 타이밍·매 턴 호출은 **하드 의존이 아니다.**

**[D-NO-SPEAK-GATE] 발화 게이트(`should_speak`)는 없다 (제거 2026-06-04).** firing(언제 backend를 부를지)은 **client event loop가 소유**한다(F5/F7 트리거가 client쪽). 따라서 "이 턴에 말할지"를 backend transport 신호로 둘 필요가 없다 — **침묵 = backend가 assistant 텍스트를 내보내지 않음**(`speech_text == ""`). client는 빈 텍스트면 TTS/말풍선을 스킵하므로 별도 플래그가 불필요하다. backend가 능동적으로 발화하는 턴도 동일 — 말하면 텍스트가 오고, 안 말하면 안 온다.

**[D-EMOTION-TEXT] `emotion_text`는 자유 텍스트 TTS voice tag 채널이다.** generate_express가 `emotion_text`(예: `"😏"`, `"🥺🥺"`)를 실으면 client는 정규화 envelope의 `emotion_text` 필드에 그대로 담아 **TTS 파이프라인으로 라우팅**한다(backend-caller가 `onEmotionText` 콜백으로 전달). emotion_id(VRM 표정 enum)와 직교하는 별도 채널 — 표정과 무관하게 목소리 연출만 바꿀 수 있다. **어휘는 아래 이모지 태그 집합**이다(PR-A에서 FishSpeech 자유 텍스트를 대체; 같은 이모지 반복 = 강도 ↑). 두 TTS provider(openai/irodori)가 같은 채널을 쓰며, **prefix 방식이라 이모지는 TTS 입력 text에만 들어가고 말풍선엔 절대 노출되지 않는다.** 검증은 하지 않는다(broker가 advisory hint로만 노출 — `expression-broker-mcp.md` §3.4).

#### `emotion_text` 이모지 어휘 (PR-A)
| Emoji | 의미 | | Emoji | 의미 |
|---|---|---|---|---|
| 👂 | whisper / close to ear | | 😆 | joyfully |
| 😮‍💨 | breath / sigh / sleeping breath | | 😠 | angry / displeased / sulking |
| ⏸️ | pause / silence | | 😲 | surprise / exclamation |
| 🤭 | chuckle / giggle | | 🥱 | yawn |
| 🥵 | panting / moan / groan | | 😖 | painfully |
| 📢 | echo / reverb | | 😟 | worriedly |
| 😏 | teasing / coaxing | | 🫣 | shyly / bashful |
| 🥺 | trembling / timid | | 🙄 | exasperated |
| 🌬️ | heavy breathing | | 😊 | cheerfully / glad |
| 😮 | gasp | | 👌 | backchannel / agreement |
| 👅 | licking / chewing / wet sound | | 🙏 | pleading / begging |
| 💋 | lip noise | | 🥴 | drunkenly |
| 🫶 | gently / tenderly | | 🎵 | humming |
| 😭 | sobbing / crying / sad | | 🤐 | muffled |
| 😱 | scream / shriek | | 😌 | relieved / content |
| 😪 | sleepily / languid | | 🤔 | questioning |
| ⏩ | fast-speaking / rapid-fire | | 🥤 | gulp / swallow |
| 📞 | phone / speaker filter | | 🤧 | cough / sniffle / sneeze |
| 🐢 | slowly | | 😒 | tutting / tongue click |
| | | | 😰 | panicked / nervous / stutter |

> **강도 표현:** 이모지를 반복하면 강도가 세진다(예: `🥺` → `🥺🥺`). 여러 태그 조합도 가능(자유 텍스트라 검증 없음). 발화(자막)는 여기 넣지 않는다 — 발화는 별도 텍스트 스트림(D-SPEECH). 이 어휘의 SOT/브로커링은 `expression-broker-mcp.md` §4.

**`speech_text`는 tool 필드가 아니다.** 발화 텍스트는 `generate_express` arguments가 아니라 **별도 assistant 텍스트 스트림**(`response.output_text.delta`)으로 도착하며(D-SPEECH), client가 스트림에서 조립한다. 아래 `ControlEnvelope`는 client 내부에서 *재구성하는* 정규화 형태이고, `speech_text`는 텍스트 스트림에서 채워지는 파생 필드다.

**[D-MOTION-FROM-EMOTION] motion은 client가 emotion에서 파생한다 (확정 2026-06-04).** backend는 보통 `emotion_id`만 보낸다. `motion_id`가 없으면 client가 **emotion id가 바뀌는 순간**(전이 시점) `configs`의 emotion→motion 기본 매핑에서 제스처를 **1회** 파생 재생한다(oneshot 의미 보존; 매핑이 없는 emotion은 idle 유지). `motion_id`를 명시하면 그것이 우선 — 정서와 무관한 제스처(예: 드래그 반응, 지시 제스처)나 억제(`"idle"`)에 쓰는 **escape hatch**다. motion 채널은 schema에 optional로 남는다. (client 구현은 #16 계열 후속 — 매핑 아티팩트 신설.)

### generate_express tool 정의 (backend tool 등록 contract) — canonical artifact
> **단일 소스: [`configs/express_tool.schema.json`](../configs/express_tool.schema.json).** 아래는 그 요약. 코드/문서가 갈리면 JSON 아티팩트가 진실.

이 turn의 제어신호 transport는 `name == "generate_express"`인 function-call 하나다. **하드 계약 = function 이름(`generate_express`) + arguments JSON Schema(`parameters`).** 백엔드 generate_express tool(Hermes plugin — [`hermes-express-tool.md`](./hermes-express-tool.md))은 이 둘만 맞추면 되고(호출 여부·내용은 backend 판단 — firing≠judgment), client는 들어온 `arguments`를 이 스키마로 검증해 `ControlEnvelope`로 정규화한다.

```jsonc
// configs/express_tool.schema.json (요약). 전체는 파일 참조. FLAT 문자열 인자.
{
  "type": "function", "name": "generate_express", "strict": false,
  "parameters": {
    "type": "object", "additionalProperties": false, "required": [],   // 모든 인자 optional
    "properties": {
      "emotion_id":   { "type": "string", "enum": [/* §1 10종 */] },    // 생략 → 직전 표정 유지
      "motion_id":    { "type": "string" },                            // registry key §2. 보통 생략(emotion에서 파생). 명시 시 override
      "emotion_text": { "type": "string" }                            // TTS voice tag — 이모지 어휘(§3 D-EMOTION-TEXT 표), 예: "😏", "🥺🥺"
    }
  }
}
```
- **`strict: false`인 이유:** Responses `strict` 모드는 모든 property를 `required`로 강제 → 인자 optional 의미(D-EXPRESS-OPTIONAL)와 충돌. 그래서 비활성.
- **`should_speak`는 없다 (D-NO-SPEAK-GATE).** 발화 게이트 없음 — 침묵은 텍스트 미발신으로 표현.
- **`speech_text`는 `parameters`에 없다** — 발화는 별도 텍스트 스트림(아래). generate_express arguments에 넣지 않는다.
- **emotion_id**는 hard enum(backend 책임, §1 10종). **motion_id**는 열린 문자열 → client registry(§2)에서 검증, 미등록 시 무시+경고. backend는 보통 motion_id를 생략한다(D-MOTION-FROM-EMOTION). **emotion_text**는 자유 텍스트(TTS voice tag).
- ✅ **E2E 검증(2026-06, #63):** 실제 Hermes 스트림에서 express function_call이 이 arguments 스키마대로 도착함을 확인. 단 **두 가지 실측 차이**가 있다 — ① tool이 MCP로 등록돼 이름이 `mcp_tts_express_server_generate_express`로 namespaced된다(client는 suffix 매칭으로 흡수). ② args가 `function_call_arguments.*` 이벤트가 아니라 `output_item.added/done`의 `item.arguments`로 온다(client가 두 경로 모두 지원). 이상적으로는 backend가 tool을 un-namespaced로 노출하거나 spec대로 `function_call_arguments.*`를 emit하는 게 바람직 — 추후 backend 측 정합 논의 대상.

### Responses API 스트림에서 신호를 뽑는 법
> 근거: [`openai_response_sdk/sse-event-format.md`](./openai_response_sdk/sse-event-format.md) — Hermes 자체 구현(LangGraph→Responses SSE 변환).

한 응답 스트림은 `output_index`로 구분되는 **output item**들이 섞여 도착한다:
- **message item** = 발화 텍스트. `response.output_text.delta`(토큰) → `response.output_text.done`. → `speech_text`로 누적.
- **function_call item** = tool 호출. `response.output_item.added`(name, status:`in_progress`) → `response.function_call_arguments.delta`(인자 토큰) → `response.function_call_arguments.done`(name + 완성된 `arguments` JSON 문자열).
  - **express tool 식별은 이름 suffix로 한다 (`name.endsWith("generate_express")`)** — backend가 tool을 MCP로 등록하면 이름이 `mcp_<server>_generate_express`로 namespaced되어 온다(실측: `mcp_tts_express_server_generate_express`). plain `generate_express`도 동일 매칭. sibling MCP tool(`..._get_ids` 등)은 express가 아니므로 generic `tool_status`로 남는다.
  - express로 식별되면 `arguments` 파싱 → FLAT `{ emotion_id?, motion_id?, emotion_text? }` → 정규화(`emotion_id→emotion{id}`, `motion_id→motion{id}`, `emotion_text→emotion_text`).
  - **arguments 도착 위치(백엔드별 두 형태 모두 지원):** ① spec — `response.function_call_arguments.done`의 `arguments`. ② **실측 라이브 백엔드** — `response.function_call_arguments.*` 이벤트를 **전혀 내지 않고**, 완성된 `arguments` JSON을 `response.output_item.added`/`response.output_item.done`의 `item.arguments`에 바로 싣는다. client는 두 경로를 모두 파싱하되 **턴당 express는 정확히 한 번만** emit한다(먼저 도착한 것 채택).
  - Hermes **자체 tool**(`web_search`/`terminal`/`browser` 등) 및 sibling MCP tool(`..._get_ids`)도 **같은 function_call item**으로 노출 → `tool_status`는 이 item들의 `name`+`status`에서 **client가 관찰로 도출**한다(Hermes가 따로 채워주는 필드가 아님).
- ⚠ **`response.completed`의 최종 `output[]`에는 message item만 담기고 function_call은 빠진다.** 따라서 `generate_express`/tool 신호는 **스트림 진행 중**(`output_item.added/done` 또는 `function_call_arguments.done` 시점)에 잡아둬야 한다 — 최종 payload엔 없다.

### Schema
```ts
// generate_express tool-call FLAT arguments = { emotion_id?, motion_id?, emotion_text? } 만이 transport 페이로드.
// 아래는 client 내부 정규화 형태 (텍스트 스트림 + tool-call을 합친 render directive 입력).
// 제어 필드는 전부 optional — generate_express가 없는 턴은 이 envelope이 비어 있고 client는 기본 동작.
interface ControlEnvelope {
  // --- generate_express tool-call arguments 정규화 (있을 때만) ---
  // should_speak 없음 (D-NO-SPEAK-GATE): 침묵 = speech_text == "".
  emotion?: EmotionSignal | null; // emotion_id → { id }. 없으면 직전 표정 유지
  motion?:  MotionSignal  | null; // motion_id → { id }. 없으면 client가 emotion에서 파생(D-MOTION-FROM-EMOTION). 명시 시 override
  emotion_text?: string | null;   // emotion_text 그대로 — TTS voice tag. backend-caller가 onEmotionText로 라우팅(D-EMOTION-TEXT)

  // --- 텍스트 스트림에서 조립 (tool 필드 아님) ---
  speech_text: string;            // response.output_text.delta 누적. 발화 없으면 ""

  // --- Hermes 네이티브 tool의 function_call item을 client가 관찰해 도출 (generate_express 아님) ---
  tool_status?: {
    state:    "idle" | "running" | "done" | "error";
    label?:   string;             // function_call name 기반. ex: "검색 중…"
    tool_id?: string;             // function_call name
  } | null;

  rich_content?: RichItem[];      // P2 — MVP는 발화 텍스트의 마크다운으로 링크/이미지 렌더. 구조화 카드는 P2.

  _reserved?: {
    expression_frames?: unknown[]; // partial emotion stream (P2)
    visemes?: unknown[];           // viseme stream (P2)
  };
}

type RichItem =
  | { kind: "image"; url: string; alt?: string }
  | { kind: "link";  url: string; title: string; desc?: string }
  | { kind: "card";  title: string; body?: string; image?: string;
                     action?: Record<string, unknown> };
```

`generate_express` tool arguments의 JSON Schema(`{emotion_id?, motion_id?, emotion_text?}`)는 §1·§2 제약을 따른다. `speech_text`는 텍스트 스트림, `tool_status`는 네이티브 function_call 관찰, `rich_content`는 P2.

### 예시 — 일반 응답 (보통: emotion_id만)
`generate_express` tool-call(제어) + 별도 텍스트 스트림(발화)이 함께 도착. backend는 보통 emotion_id만 보내고 motion은 client가 파생:
```jsonc
// function_call 아이템: name == "generate_express"
{ "name": "generate_express",
  "arguments": { "emotion_id": "happy" } }
// + 별도 텍스트 스트림 (response.output_text.delta): "잘 됐다!"
// → client 정규화: emotion = { id: "happy" } → happy 표정 전이 + (emotion 전이 시) happy 제스처 1회 파생.
```

### 예시 — motion_id 명시 + emotion_text (escape hatch + voice tag)
정서와 무관한 제스처나 목소리 연출이 필요할 때 backend가 직접 싣는다:
```jsonc
{ "name": "generate_express",
  "arguments": {
    "emotion_id": "curious",
    "motion_id": "shy_point",                  // 파생 대신 이 제스처 강제
    "emotion_text": "👂"                        // TTS voice tag — 이모지 어휘(§3 D-EMOTION-TEXT)
  } }
// → client 정규화: emotion={id:"curious"}, motion={id:"shy_point"}, emotion_text="👂"(→ onEmotionText).
```

### 예시 — 침묵 (D-NO-SPEAK-GATE)
말 없이 표정만 짓기 — `generate_express`로 emotion_id만 보내고 **텍스트 스트림을 발생시키지 않는다**(should_speak 플래그 없음):
```jsonc
{ "name": "generate_express",
  "arguments": { "emotion_id": "thinking" } }
// 텍스트 스트림 미발생 → speech_text == "" → client는 TTS/말풍선 스킵, 표정만 적용.
// (아무것도 안 하려면 generate_express도 텍스트도 보내지 않으면 됨.)
```

### 예시 — 툴 실행 중 (tool_status는 Hermes 네이티브 function_call에서 도출)
Hermes가 자체 `web_search`를 돌리면 스트림에 function_call item이 뜬다 — client는 이걸 보고 tool_status를 만든다:
```jsonc
// function_call item (Hermes 자체 tool)
{ "type": "response.output_item.added",
  "item": { "type": "function_call", "name": "web_search", "status": "in_progress" } }
//   → client: tool_status = { state:"running", label:"검색 중…", tool_id:"web_search" }
// 이후 response.output_item.done(status:"completed") → tool_status state:"done"
```

### 렌더 규약 (client 시점)
1. `generate_express`에 `emotion_id`가 있으면 expression 전이 시작. 없으면 직전 표정 유지.
2. `generate_express`에 `motion_id`가 있으면 registry 조회 후 재생(override). **없으면 emotion 전이에서 1회 파생**(D-MOTION-FROM-EMOTION; 매핑 없으면 idle). **generate_express 자체가 없는 턴도 idle.**
3. **발화 게이트 없음 (D-NO-SPEAK-GATE).** 텍스트 스트림(`speech_text`)이 비어있지 않으면 TTS 파이프라인(아래 D-TTS-PIPELINE) + 말풍선에 흘린다. 비어있으면 스킵 — 별도 플래그 판정 없음.
4. `tool_status`(네이티브 function_call 관찰)로 UI 인디케이터 갱신. `completed` 시 해제.
5. `rich_content`는 P2. MVP는 발화 텍스트의 마크다운 링크/이미지를 chat UI가 인라인 렌더.
6. `_reserved`의 모든 필드는 v0에서 무시.

### 스트리밍 처리 (D-TTS-PIPELINE — client-side TTS 파이프라인, required)
발화 텍스트 스트림 → TTS → 재생 → 립싱크는 다음 순서로 처리한다(사용자 확정):

1. **텍스트 스트림 수신** — `response.output_text.delta` 토큰을 받는다.
2. **버퍼 큐 적재** — 받은 토큰을 버퍼 큐에 쌓는다.
3. **문장 분절(sentence boundary) 감지** — 큐에서 문장 경계가 감지되면 그 지점까지를 한 덩어리로 끊는다. (분절 방식은 구현 시 결정 — 새 리서치 아님.)
4. **`emotion_text` 태그 prepend (있을 때만)** — 그 시점에 `emotion_text`(이모지 voice 태그, §3 D-EMOTION-TEXT)가 있으면 분절 text 맨 앞에 prepend한다. **optional이라 없으면 태그 없이 plain text로 보낸다.** 태그는 TTS 입력에만 들어가고 말풍선에는 안 들어간다(prefix-only).
5. **per-sentence TTS 호출** — 태그가 붙은 분절을 활성 TTS provider로 전송 → wav 수신. provider는 `tts_provider`로 선택: OpenAI 호환 `/audio/speech`(`localhost:8092`) 또는 irodori_TTS `/synthesize`(`localhost:8091`, §5). 동시 합성은 `tts_max_inflight`로 상한(default 1 = serial).
6. **ordered playback (재생 순서 보존)** — TTS 응답이 순서가 뒤바뀌어 와도 **원래 문장 순서대로** 재생한다.
7. **진폭 기반 립싱크 동기** — 재생되는 wav의 진폭에 입(mouth blendshape) 움직임을 동기한다(PRD D1).

**`emotion_text` 태그는 best-effort (확정):** `emotion_text`는 optional이다 — 분절을 TTS로 보낼 시점에 있으면 태그를 prepend하고, 없으면 plain text로 보낸다. 따라서 도착 타이밍은 **하드 의존이 아니다**(neutral fallback 같은 특별 처리 불필요). 표정도 emotion 없으면 직전 상태 유지.

**"reason-then-call-tool" 백엔드의 late `emotion_text` no-op:** 텍스트 스트림 이후에 `generate_express` tool-call이 오는 경우 모든 문장이 이미 submit(태그 prepend 완료)된 뒤라, 늦게 도착한 `emotion_text`는 해당 턴에서 조용히 no-op 된다 — 최저 지연 스트리밍(D-TTS-PIPELINE)의 의도된 귀결이며 버그가 아니다.

---

## 4. Input Context Schema

### 목적
client → backend로 올리는 사용자 입력 + 환경 센서. OpenAI chat content 포맷(`text` + `image_url`)을 그대로 쓰되, YUI 메타데이터를 어디에 실을지만 규약화.

### 매핑 원칙
- **발화/transcript** → `messages[].role:"user"`의 `text` block.
- **스크린샷** → 같은 메시지의 `image_url` block. data URL 또는 HTTPS 참조.
- **환경 메타데이터** → **별도 `text` block에 fenced JSON**으로. system message에 박지 않는다 (turn마다 바뀌므로).

### Schema
```ts
interface InputContext {
  user_text?: string;             // 키보드 입력
  transcript?: { text: string; confidence?: number; lang?: string };  // STT 결과

  env: {
    timestamp: string;            // ISO 8601
    timezone:  string;            // ex: "Asia/Seoul"
    active_app?: { name: string; bundle_id?: string };
    active_window_title?: string;
    locale?: string;
  };

  screenshot?: {
    enabled: boolean;             // 토글 상태 자체를 명시
    source:  ScreenSource;
    data_url?: string;            // "data:image/png;base64,..." or "https://..."
    captured_at?: string;
    width?: number;
    height?: number;
  };

  client: { yui_version: string; persona_hint?: string };
}

type ScreenSource =
  | { kind: "monitor";     index: number; label?: string }
  | { kind: "browser_tab"; browser: string; tab_title: string; url?: string }
  | { kind: "window";      app: string; window_title: string };
```

### OpenAI chat message로의 인코딩
```json
{
  "role": "user",
  "content": [
    { "type": "text", "text": "이 페이지 요약해 줘" },
    { "type": "text", "text": "```yui-context\n{...InputContext JSON...}\n```" },
    { "type": "image_url", "image_url": { "url": "data:image/png;base64,..." } }
  ]
}
```

backend는 ` ```yui-context ` 마커로 파싱. system prompt 1줄로 약속해두면 충분.

> 실제 전송(`client.responses.create`)은 Responses API content-part를 쓴다 — 위 chat-completions 예시의 `image_url:{url}` 대신 `{ "type":"input_image", "image_url":"data:..." }`(image_url이 문자열 data URL), 텍스트는 `{ "type":"input_text", "text":... }`.

### 캡처 정책 (v0)
- 사용자 **토글 ON**일 때만 스크린샷 첨부. OFF면 `screenshot` 객체 생략.
- 토글 ON 동안에는 **매 user turn마다 자동 첨부**. "이번엔 불필요"는 backend 판단.
- source는 사용자가 monitor index / browser tab / window 중 선택.
- 긴 변 1280px 등 리사이즈는 client 강제 — base64 폭주 방지.

### 제약/주의
- 모든 필드는 **선택적** — backend는 부재에 robust해야 한다.
- transcript + user_text 동시 존재 가능(음성+키보드). 우선순위는 backend.
- `timezone`은 client가 항상 채운다 — "지금 몇 시"를 backend가 추측하게 두지 않는다.
- raw audio는 chat 요청에 싣지 않음 — STT는 `/audio/transcriptions` 별도 호출.

---

## 5. TTS Providers (openai · irodori)

### 목적
발화 분절(D-TTS-PIPELINE step 5)을 wav로 합성하는 경로. **두 provider가 additive로 공존**하며 `tts_provider`로 선택한다 — OpenAI 호환 `/audio/speech`(기존)와 **irodori_TTS**(`/synthesize`, OpenAI 호환 아님). default는 `irodori`. 둘 다 §3의 `emotion_text` 이모지 어휘를 분절 맨 앞 prefix로 받는다(말풍선엔 노출 안 됨). 합성 동시성은 provider 무관하게 `tts_max_inflight`로 상한(default 1 = serial; consumer인 tts-pipeline이 적용, loader가 아님).

### 5.1 EndpointsConfig 추가 필드 (configs/endpoints.json)
> `EndpointsConfig`(§Endpoint abstraction)의 확장이다. 기존 OpenAI TTS 필드(`tts_base_url`/`tts_model`/`tts_voice`/`tts_speed`)는 그대로 유지(`provider="openai"`일 때 쓰임). 아래는 PR-A 추가분. doc↔`src/contract/types.ts` SOT 동기 — 필드 변경 시 양쪽 갱신.

```ts
interface EndpointsConfig {
  // ... 기존 chat/stt + OpenAI TTS 필드(생략) ...

  tts_provider?: "openai" | "irodori";   // 합성 경로. 미설정 시 loader가 "irodori"로 resolve
  tts_max_inflight?: number;             // provider 무관 합성 동시성 상한. default 1(serial). consumer(tts-pipeline) 적용

  // --- provider="irodori"일 때 ---
  irodori_base_url?: string;             // irodori_TTS root. 예: "http://localhost:8091". provider=irodori면 필수
  irodori_speaker?: string;              // 활성 화자 = reference_id(voice registry 등록 키). provider=irodori면 필수
  irodori_voices?: Array<{               // 선택 가능한 화자 목록 — UI 표시 + voice registry 등록 소스
    id: string;                          //   reference_id(= /synthesize의 reference_id, /voices의 voice_id)
    label?: string;                      //   표시 이름. 없으면 id
    ref_url: string;                     //   reference clip 경로 — Vite 서빙 "/references/<id>/merged_audio.mp3"
  }>;
  irodori_num_steps?: number;            // diffusion step 수(품질/속도). 미설정 시 서버 default(40)
  irodori_cfg_scale_text?: number;       // emotion(text) adherence. 미설정 시 서버 default(3.0)
  irodori_cfg_scale_speaker?: number;    // speaker adherence. 미설정 시 서버 default(5.0)
  irodori_seconds?: number;              // 목표 발화 길이(초). 미설정 시 서버 default
}
```

- **provider 선택:** `tts_provider` 미설정 → loader가 `"irodori"`로 resolve(default). `"openai"`면 기존 `/audio/speech` 경로.
- **`irodori_voices`의 `ref_url`**은 reference clip을 가리킨다 — `resources/references/<id>/merged_audio.mp3`(gitignored, symlink)를 Vite가 `/references/*`로 서빙. 등록(§5.3) 시에만 fetch되고, per-synth 요청엔 안 실린다.
- client는 `src/io/irodori-synth.ts`(합성)와 `src/io/irodori-voices.ts`(voice-registry helper)로 이 경로를 구현한다.

### 5.2 irodori_TTS `/synthesize` (라이브 검증된 8091 contract — authoritative)
Base `http://localhost:8091`(= `irodori_base_url`로 교체 가능). **OpenAI 호환이 아니다.**

```
POST /synthesize    Content-Type: multipart/form-data   →   audio/wav (48 kHz, mono, 16-bit PCM)
```

| field | req | default | 비고 |
|---|---|---|---|
| `text` | ✅ | — | 합성할 텍스트(앞에 `emotion_text` 이모지 prefix 가능). |
| `reference_id` | — | — | 등록된 voice id(= `irodori_speaker` / `irodori_voices[].id`). |
| `reference_audio` | — | — | optional 파일 — **등록 시에만** 쓰임, per-synth엔 안 보냄. |
| `seconds` | — | — | 목표 길이(`irodori_seconds`). |
| `duration_scale` | — | `1.0` | |
| `min_seconds` | — | `0.5` | |
| `max_seconds` | — | `30.0` | |
| `num_steps` | — | `40` | `irodori_num_steps`. |
| `cfg_scale_text` | — | `3.0` | `irodori_cfg_scale_text`. |
| `cfg_scale_speaker` | — | `5.0` | `irodori_cfg_scale_speaker`. |
| `seed` | — | — | 재현용. 응답 `X-Used-Seed`에 실측값. |

- **per-synth 요청은 `text` + `reference_id` + tunables만** 싣는다(파일 동봉 안 함 — 화자는 사전 등록된 `reference_id`로 참조).
- **`reference_text`는 제거됐다 (모델이 transcript를 무시).** 더 이상 보내지 않는다.
- **응답 헤더:** `X-RTF`(real-time factor), `Server-Timing`(per-stage + `total;dur=`), `X-Used-Seed`.

### 5.3 Voice registry (`/voices`)
화자는 reference clip으로 **사전 등록**되고, 등록된 `voice_id`가 `/synthesize`의 `reference_id`가 된다. 서버는 `--voices-dir`에 영속하고 startup마다 reload한다. client는 **첫 사용 시 등록**(`irodori-voices.ts`의 `ensureRegistered`)한다.

```
POST   /voices          multipart: reference_audio(file) + voice_id   →  201
PUT    /voices          multipart: reference_audio(file) + voice_id   →  200  (기존 voice의 reference latent를 강제 갱신)
GET    /voices                                                        →  { "voices": [ { "voice_id", ... } ] }
DELETE /voices/{id}                                                   →  삭제
```

- `voice_id`(등록) == `reference_id`(합성). client는 `irodori_voices[].id`를 양쪽 키로 쓴다.
- 등록 시 `reference_audio`는 `ref_url`(`/references/<id>/merged_audio.mp3`)에서 fetch한 파일.
- **`PUT /voices`는 명시적 force-refresh(#103)** — `ensureRegistered`의 멱등 등록과 달리 GET-check·memoize 없이 항상 ref를 다시 fetch해 PUT한다(`irodori-voices.ts`의 `updateVoice`, 설정 UI의 화자 행 ↻ 버튼). reference clip이 바뀌었을 때 latent를 갱신하는 용도.

### 5.4 에러 모델
| status | 의미 | body |
|---|---|---|
| `422` | validation(예: 미등록 `reference_id`) | `detail`이 **string** *또는* `{type,loc,msg}` **배열**. client는 둘 다 처리. |
| `503` | overloaded | `Retry-After` 헤더. |
| `504` | timeout | |
| `500` | server error | |

> **검증 없는 `emotion_text`:** 이모지 prefix는 `text` 앞에 붙어 그대로 합성 입력이 된다 — irodori는 별도 검증 안 함(§3 D-EMOTION-TEXT). 미등록 `reference_id`만 `422`로 거른다.

---

## Open Questions

prototype에서 결정/검증:

1. **Emotion frame 스트리밍** — `_reserved.expression_frames`를 실제 쓸지, turn-end 한 번으로 충분한지. 텍스트 vs 표정 lag을 사람이 거슬리는지부터 측정.
2. **Viseme 채널** — 진폭 립싱크가 부족하면 `_reserved.visemes`로 phoneme 보낼지.
3. **Tool status 갱신 빈도** — turn 중간 push 필요 여부 (P2 SSE와 직결).
4. **`rich_content.card.action`** 스키마 — v0는 free-form. 어디까지 약속할지.
5. **Emotion intensity 보간 책임** — 즉시 적용 vs client-side envelope(ADSR).
6. **Motion crossfade 정책** — `replace` 시 이전 fade-out + 새 fade-in 동시 진행 여부.
7. **Screenshot 압축** — PNG vs JPEG, 품질, data URL vs 임시 HTTPS.
8. **Multi-character** — `character_id` envelope 추가 vs 채널 분리.
9. **P2 SSE push envelope** — §3 그대로 재사용할지, push 전용 필드(urgency, ttl) 추가할지.
10. **Schema 버전 협상** — `client.yui_version` 외에 별도 contract version handshake가 필요한가.

---

## Changelog

- **2026-06-08 (PR-A):** §5 추가 — **irodori_TTS** provider(라이브 검증 8091 `/synthesize` + `/voices` registry, OpenAI 호환 아님)를 기존 OpenAI TTS와 additive로 공존. `EndpointsConfig`에 `tts_provider`(default irodori)·`tts_max_inflight`·`irodori_*` 필드 추가. `emotion_text` 어휘를 FishSpeech 자유 텍스트 → **이모지 태그 집합**으로 교체(§1·§3 D-EMOTION-TEXT 표; prefix-only, 말풍선 비노출). `reference_text`는 제거(모델이 transcript 무시).
- **2026-06-08:** §2.5 추가 — `AvatarConfig.available?: AvatarOption[]` VRM 선택 manifest(#94). `vrm_url`은 필수 유지(하위 호환).
- **2026-06-06 (v0.2 draft):** `emotion_tts_prefix`(emotion-enum→TTS-prefix 매핑) 제거 — emotion의 목소리 제어는 `generate_express`의 자유 텍스트 `emotion_text` 채널로 일원화(§1, §3 D-TTS-PIPELINE step 4).
