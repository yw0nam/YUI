# Desktop VRM Mate — Feature Spec

> **Version:** v0.1 (big-picture / 큰 줄기)
> **Status:** 프로젝트 내에서 구체화 진행 예정

---

## 0. 한 줄 정의

Hermes Agent(**brain**)의 embodied frontend(**head**).
VRM 캐릭터 렌더링 + 데스크톱 펫 행동 + I/O 표면을 담당하고,
두뇌(MCP · tool calling · search · long-term memory · agent loop)는 **백엔드에 위임**한다.

**핵심 분리 원칙:** `firing ≠ judgment`
→ client는 *언제 후보 이벤트가 생겼나*(firing)만 책임. *말할지 / 무엇을 말할지*(judgment)는 backend.

---

## 1. 아키텍처 원칙 (확정)

- **통신:** request/response IO는 전부 **OpenAI 호환 API**
  - chat → `/v1/responses`
  - STT → `/audio/transcriptions`
  - TTS → `/audio/speech` *(provider-swappable: default irodori `/synthesize`@8091[reference-voice], openai-compatible `/audio/speech`@8092 — contract §5)*
  - vision 입력 → chat image content (OpenAI 호환 범위 내)
- **예외 (명시):** Phase 2의 proactivity **push 채널(SSE/WebSocket)** 은 OpenAI 호환이 *아닌* 별도 채널. 원칙의 명시적 예외로 둔다.
- **client에는 brain이 없다** — 렌더링 / 입출력 표면만.
- **config-driven** — 개인용 우선, OSS 전환 대비해 하드코딩 금지.
- **스택:** 웹 렌더링(three.js + `@pixiv/three-vrm`) + Tauri 셸. (AI 시각 검증 루프 확보 목적 — 렌더링/UI는 브라우저에서 스크린샷 검증, 네이티브 윈도우 레이어만 분리)

---

## 2. Feature Sections

### A. VRM 렌더링
- VRM 모델 로드 + **핫스왑** (config로 모델 교체)
- VRMA 모션 재생 (prebuilt 모션셋)
- 표정/포즈 제어 (BlendShape/expression) — 백엔드 emotion 신호에 매핑
- spring bone 등 기본 물리

### B. 데스크톱 셸 / 펫 행동 *(Tauri 레이어 — AI 시각 검증이 어려운 영역, 분리 개발)*
- 투명 / always-on-top 윈도우
- **per-region hit-test** — 캐릭터 실루엣 위 = interactive, 투명 영역 = click-through (pass-through). *(드래그/쓰다듬기와 click-through 공존을 위한 필수 요건)*
- 드래그로 위치 이동
- 화면 가장자리 · 다른 앱 창 위 앉기 *(가장 손 많이 가는 부분. Desktop Homunculus 구현 참고)*
- 멀티모니터
- 클릭 / 쓰다듬기 반응

### C. 입력 (client = 센서)
- 사용자 **텍스트** 입력
- **음성** 입력 → STT(`/audio/transcriptions`)
  - **VAD(voice activity detection)** — 녹음 시작/끝 감지 (음성 모드 필수 요소)
- **화면 맥락** 수집: 활성 앱 · 창 제목 · 시간 → 백엔드 전달
- **스크린샷** 캡처 → 비전 입력으로 백엔드 전달
- *(클립보드는 범위 제외)*

### D. 출력 / 연출 (백엔드 신호 → 렌더)
- 텍스트 응답 (말풍선 / 챗 UI)
- 음성 출력 → TTS(`/audio/speech`) + **립싱크** *(TTS provider-swappable: irodori 기본 / openai-compatible — contract §5)*
  - ⚠️ OpenAI 호환 TTS는 viseme/타이밍 미제공 → 오디오 진폭 기반 or 자체 phoneme 정렬 중 택 (§4 참고)
- emotion 신호 → VRM expression 변경
- motion 트리거 → 지정 VRMA 재생
- 툴 실행 과정/상태 표시 ("검색 중…", 툴 결과 카드)
- 리치 콘텐츠 렌더 (이미지 · 링크 · 카드)
- **Ambient animation layer (Tier 1)** — blink / idle sway / 숨쉬기 등. 항상 켜짐, **백엔드 독립**(네트워크 X).

### E. 통신 / 프로토콜 (the contract)
- `[MVP]` OpenAI 호환 스트리밍 + **turn-bound 제어신호(emotion/motion)를 structured output**으로 (inline 텍스트 태그 X — 스트리밍 중 토큰 분할로 깨지기 쉬움)
- `[MVP]` **client-side event loop / dispatcher**
  - sources: timer / idle-watcher / OS-event-watcher / user-input
  - 트리거 *발사*만 담당, 판단은 위임
- `[Phase 2]` 백엔드 **SSE/WebSocket push**가 이 dispatcher의 *또 다른 source*로 합류 (교체 아님 — 누적)

```
sources: timer / idle-watcher / OS-event-watcher / user-input / [P2] backend-SSE
   → event bus
   → dispatcher
        ├ Tier 1 → 로컬 애니메이션 (백엔드 X)
        └ Tier 2·3 → 맥락 패키징 → 백엔드 호출 → 렌더
```

### F. 설정 / 커스텀
- `[MVP]` config 파일 기반 (API 엔드포인트 · 키, 모델, VRM 경로, 모션셋)
- `[Phase 2]` 설정 UI, 사용자 모델 업로드, 페르소나 편집
- 🔒 OSS 단계 진입 시 API 키는 평문 config 대신 **OS keychain**(Tauri secure storage)로

### G. 모드 (혼합형 처리)
- 챗 · 비서 · 펫 인격이 한 캐릭터에 공존
- **자동 해소:** persona/모드 상태는 backend 소관(non-goal). client는 모드 전환 트리거 발사 + 현재 모드 표시만. client에 모드 분기 로직을 두지 않는다.

---

## 3. Proactivity — 3 Tier 라우팅

| Tier | 내용 | firing | judgment / content |
|------|------|--------|--------------------|
| **1 — ambient liveliness** | blink, idle sway, 숨쉬기, 둘러보기 | client | client (백엔드 X) |
| **2 — 가벼운 발화** | 시간대 인사, 장시간 idle 반응 | client (timer/watcher) | **backend** (persona-aware, 확정) |
| **3 — 맥락 개입** | 맥락 감지 후 선제 제안 | client (sensing) + [P2] backend push | backend |

- **로드맵:** 초기 Tier 1·2 → 최종 Tier 3.
- **필수 가드레일:** Tier 2/3는 **rate-limit + debounce + DND(focus 감지)**. 없으면 토큰 새고 캐릭터가 짜증남.
- **Tier 2 silence 규약:** 백엔드가 "지금은 말 안 함"을 표현할 수 있어야 함 — **별도 플래그 없이 assistant 텍스트를 내보내지 않으면 침묵**이다(D-NO-SPEAK-GATE, contract §3). 표정만 짓고 싶으면 `express`로 emotion만 보낸다. 폭주 방지는 client-side rate-limit/debounce/DND가 안전망(firing이 client 소유).

---

## 4. The Contract (정의해야 할 핵심 산출물)

client ↔ Hermes 사이 계약. 스키마 확정은 프로젝트 내 작업이나, **존재 자체가 required**.

- **Emotion vocabulary** — 백엔드가 쏠 수 있는 emotion enum ↔ client의 VRM expression 매핑 레지스트리
- **Motion registry** — 백엔드 motion ID ↔ client VRMA 파일 매핑 (prebuilt 모션 목록과 직결)
- **Control signal envelope** — emotion / motion(+tool-status / rich-content)을 담는 `express` tool-call 스키마. 발화 게이트(should_speak) 없음 — 침묵=텍스트 미발신(D-NO-SPEAK-GATE)
- **Input context schema** — client → backend로 올리는 센서 데이터(활성 앱, 창 제목, 시간, 스크린샷) 포맷

---

## 5. 🚫 Non-goals (Hermes에 위임 — client가 만들지 않음)

- MCP / tool calling
- search
- long-term memory + 관계 · 페르소나 상태 (호감도 등)
- agent loop
- proactivity 트리거 **judgment** (말할지 · 내용 결정)

→ client는 위 결과를 *렌더링 / 표시*만. 트리거 **firing · sourcing**은 client 책임.

---

## 6. ❓ Open Questions (프로젝트 내 구체화)

1. **스트리밍 ↔ 제어신호 동시성** — emotion이 텍스트보다 늦게 도착하면 표정 지연. control envelope 형태 확정 시 해결.
2. **스크린샷 캡처 정책** — 매 턴 / 트리거 시 / 백엔드 요청 시 중 택.
3. **lipsync 방식** — 오디오 진폭 기반 vs 자체 phoneme 정렬.
4. **단일 캐릭터 vs 멀티 캐릭터**
5. **prebuilt 모션 정확한 목록** (= Motion registry 초기 항목)
6. **패키징 / 배포** — Tauri updater, 코드사이닝 등

---

## 7. 레퍼런스

- **Amica** (semperai/amica, MIT) — three-vrm + Tauri + OpenAI 호환 챗. 구조 레퍼런스.
- **ChatVRM** (pixiv) — 더 단순한 출발점.
- **Desktop Homunculus** (not-elm/desktop-homunculus, MIT) — 창 위 앉기 등 네이티브 윈도우 동작 구현 참고.
