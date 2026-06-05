# Expression Broker (MCP) — 구현 스펙

> **상태:** **구현 완료, 가동 중 @ `localhost:3201`** (외부 구현, YUI 레포 외부). E2E 연동 검증은 [#1](https://github.com/yw0nam/YUI/issues/1) 참고.
> **레포:** **독립 레포** — YUI에도 Hermes에도 속하지 않는 별도 서비스. 둘 다 이 broker의 MCP client로 붙는다.
> **접속:** `localhost:3201` (streamable-http transport). YUI 시작 전에 broker가 먼저 기동되어 있어야 함.

## 0. 한 줄 요약

emotion/motion **어휘(vocabulary)의 단일 진실원천(SOT)** 이자, agent가 매 턴 표현 신호를 만들 때 거치는 **검증 게이트**. YUI가 자기가 *지금 렌더 가능한* id 집합을 publish하고, Hermes agent가 그걸 읽어(`get_ids`) 그 안에서만 골라 `generate_express`를 호출한다. 그 function_call이 `/v1/responses` 스트림에 떠서 YUI가 arguments를 소비한다.

## 1. 역할 경계 (firing ≠ judgment ≠ vocabulary)

```
┌──────────────┐    update_*_ids (write)     ┌─────────────────────┐
│     YUI      │ ──────────────────────────▶ │  Expression Broker  │
│ (MCP client) │                              │   (MCP server)      │
│  = writer    │ ◀── resource subscribe ──────│  = vocabulary SOT   │
│  = renderer  │   (expression://vocabulary)  │  + validation gate  │
└──────┬───────┘                              └──────────▲──────────┘
       │ reads function_call arguments                   │ get_ids (read)
       │ from /v1/responses stream                       │ generate_express (call)
       │                                                 │
       │           ┌──────────────────────┐             │
       └───────────│    Hermes Agent      │─────────────┘
   (generate_expr  │ (MCP client = brain) │
    function_call) │ = judgment           │
                   └──────────────────────┘
```

- **YUI** = *어휘의 writer* + *firing 신호의 소비자(renderer)*. 어떤 emotion/motion을 실제로 렌더할 수 있는지는 VRM 모델·VRMA 에셋을 가진 YUI만 안다 → YUI가 SOT에 publish.
- **Hermes agent** = *judgment*. "언제 happy인지"는 LLM Agent가 판단. broker에서 유효 어휘를 받아 그 안에서 `generate_express`를 호출.
- **Broker** = *어휘 보관 + 검증*. 스스로 무엇을 생성하지 않는다(아래 §4 주의).

> **핵심 원칙 — 어휘 vs firing은 성질이 다르다.**
> | | 어휘(vocabulary) | firing |
> |---|---|---|
> | tool | `get_ids` / `update_*_ids` / resource | `generate_express` |
> | 변화 빈도 | 느림 (VRM 핫스왑 시) | 매 턴/매 문장 |
> | 순서 의존 | 없음 | **있음** (어느 문장에서 happy인지) |
> | YUI 수신 채널 | broker resource (pull/subscribe) | **응답 스트림 function_call arguments** |
>
> firing payload를 broker 반환값으로 YUI에 보내지 **않는다** — 문장 경계 sync(D-TTS-PIPELINE)가 깨진다. firing은 무조건 스트림으로.

## 2. 데이터 모델 (broker가 들고 있는 상태)

```jsonc
// broker in-memory state (YUI가 update_*로 갱신)
{
  "emotion_ids": ["neutral","happy","angry","sad","relaxed",
                  "surprised","thinking","curious","sleepy","embarrassed"],
  "motion_ids":  ["idle","happy","laughing","shy_point"],
  "version":     3   // 갱신마다 증가 (변경 감지/디버그용)
}
```

- **emotion_ids** = VRM blendshape(얼굴) id. contract.md §1 enum 10종이 기본값. **TTS엔 안 쓰임.**
- **motion_ids** = VRMA(몸) registry key. contract.md §2의 model-selectable 4종. (`drag`는 client 내부 reactive 모션 — model이 고르지 않으므로 제외.)
- **TTS 태그(emotion_text)는 어휘에 두지 않는다.** FishSpeech S2 pro가 자유 텍스트(`[shocked]`, `[whisper in small voice]`, 조합 가능)를 허용하므로 hard enum이 아니다. broker가 *advisory 힌트 목록*을 노출할 수는 있으나(아래 §3.4 optional) 검증/강제는 안 한다.

## 3. MCP Surface

> SDK: [`modelcontextprotocol/python-sdk`](https://github.com/modelcontextprotocol/python-sdk) `FastMCP` 기준 (구현 언어는 §6 결정사항). transport는 Hermes/YUI의 MCP client 연결 방식에 맞춰 `streamable-http` 권장(stdio는 같은 프로세스 트리 전제라 3-프로세스 분리와 안 맞음).

### 3.1 `generate_express` — firing tool (caller: Hermes agent) ★

agent가 발화 중 표정/모션/목소리를 전환하려고 호출하는 tool. **이 tool의 function_call이 `/v1/responses` 스트림에 떠서 YUI가 arguments를 읽는다.**

```python
@mcp.tool()
def generate_express(
    emotion_id: str | None = None,   # §2 emotion_ids 중 하나. 생략 → 직전 표정 유지(hold)
    motion_id:  str | None = None,   # §2 motion_ids 중 하나. 생략 → client가 emotion에서 파생(D-MOTION-FROM-EMOTION)
    emotion_text: str | None = None, # TTS 제어 태그(자유 텍스트). 생략 → prefix 없이 plain
) -> dict:
    ...
```

- **arguments(= 모델 생성 입력)** `{ emotion_id?, motion_id?, emotion_text? }` 가 **transport 페이로드**다. YUI가 소비하는 건 *이것*(반환값 아님).
- **return value(= broker → Hermes)** = 검증 결과 ack. agent loop가 발화를 계속하도록 가벼운 JSON만:
  ```jsonc
  { "ok": true, "applied": { "emotion_id": "happy", "motion_id": null, "emotion_text": "[whisper in small voice]" },
    "warnings": [] }   // 미등록 id가 오면 warnings에 싣고 해당 필드를 drop(no-op), ok는 유지
  ```
- **handler 책임 = 검증 게이트.** `emotion_id`/`motion_id`가 현재 live 집합(§2)에 없으면 → 해당 필드 drop + warning. **발화를 막지 않는다(ok:true 유지).** `emotion_text`는 검증 안 함(자유 텍스트).
- **handler는 생성하지 않는다.** "generate"의 주체는 **모델**이다(arguments를 모델이 만든다). broker는 모델이 만든 걸 live 어휘에 대조할 뿐. → 이게 broker가 존재해야 no-op이 아닌 이유.

### 3.2 `get_ids` — 어휘 조회 (caller: Hermes agent)

```python
@mcp.tool()
def get_ids() -> dict:
    """Return the emotion/motion ids the client can currently render."""
    return { "emotion_ids": [...], "motion_ids": [...], "version": 3 }
```

- agent가 `generate_express` 인자를 고르기 전에 유효 어휘를 확인. 
- **레이턴시 주의:** 매 턴 호출하면 agent loop에 round-trip이 붙는다. 권장 = 세션 시작/변경 알림 시 1회 호출해 system prompt나 tool 스키마 enum에 주입, 이후는 §3.3 resource subscription으로 변경만 push. (`get_ids` tool 자체는 fallback/명시 조회용으로 유지.)

### 3.3 `expression://vocabulary` — 어휘 resource (subscriber: YUI, Hermes)

```python
@mcp.resource("expression://vocabulary")
def vocabulary() -> str:
    return json.dumps({ "emotion_ids": [...], "motion_ids": [...], "version": 3 })
```

- 어휘 변경 push 채널. `update_*`가 상태를 바꾸면 broker가
  `await ctx.session.send_resource_updated(AnyUrl("expression://vocabulary"))` 로 구독자에게 통지.
- YUI도 Hermes도 이걸 subscribe하면 매 턴 `get_ids` 폴링 없이 변경 시점에만 갱신.

### 3.4 `update_emotion_ids` / `update_motion_ids` — 어휘 publish (caller: YUI)

```python
@mcp.tool()
async def update_emotion_ids(ids: list[str], ctx: Context) -> dict:
    # state.emotion_ids = ids; state.version += 1
    await ctx.session.send_resource_updated(AnyUrl("expression://vocabulary"))
    return { "ok": true, "version": state.version }
```

- YUI가 부팅 시 + **VRM 모델 핫스왑 시** 자기가 렌더 가능한 집합을 선언. broker는 이걸 SOT로 저장하고 resource 구독자에게 통지.
- (optional) `update_tts_tags(tags)` — emotion_text advisory 힌트 목록을 두고 싶을 때만. **검증용 아님, 모델 힌트용.**

## 4. 필드 정의 (3채널 분리 — 의도된 분리)

| 필드 | 대상 | 채널 | 타입 | 소유/검증 |
|---|---|---|---|---|
| `emotion_id` | **얼굴** (VRM blendshape) | 표정 | enum (10종) | broker hard 검증, 미등록 drop |
| `motion_id` | **몸** (VRMA gesture) | 모션 | registry key (4종) | broker hard 검증, 미등록 drop |
| `emotion_text` | **목소리** (TTS 제어) | TTS prefix | **자유 텍스트** (FishSpeech 태그) | 검증 없음, model이 직접 생성 |
| 발화 텍스트 | 자막/TTS 본문 | **별도 텍스트 스트림** | `output_text.delta` | **`generate_express`에 없음** (D-SPEECH) |

- emotion_id(얼굴)와 emotion_text(목소리)는 **독립**이다 — `happy` 표정 + `[whisper in small voice]` 목소리 동시 가능.
- `emotion_text` 예시: `"[shocked]"`, `"[whisper in small voice]"`, `"[excited] [volume up]"`. **문장은 넣지 않는다** (발화는 텍스트 스트림). YUI는 이 태그를 TTS 큐의 해당 분절 **맨 앞에 prepend**(D-TTS-PIPELINE step 4).
- 셋 다 optional. 전부 생략된 `generate_express`는 의미 없으므로 model은 보통 최소 하나를 채운다.

## 5. YUI 소비 경로 (스트림에서 뽑기)

> 근거: [`contract.md`](./contract.md) §3, [`openai_response_sdk/sse-event-format.md`](./openai_response_sdk/sse-event-format.md).

`/v1/responses` 스트림에서 `name == "generate_express"`인 function_call item을 잡는다:

1. `response.output_item.added` — `item.type=="function_call"`, `item.name=="generate_express"`, `status:"in_progress"`.
2. `response.function_call_arguments.delta` — arguments JSON 토큰 누적.
3. `response.function_call_arguments.done` — 완성된 `arguments` 파싱 → `{ emotion_id?, motion_id?, emotion_text? }`.
4. 분배: `emotion_id`→`renderer.setEmotion`, `motion_id`→motion(없으면 emotion에서 파생), `emotion_text`→TTS 큐 prepend.

⚠ **`response.completed`의 최종 `output[]`엔 function_call이 빠진다 — 진행 중(`...arguments.done`)에 캡처 필수.** (contract.md §3와 동일.)

## 6. 구현 상태 및 E2E 검증

**구현 확정 사항 (완료):**
- [x] **구현 언어** — Python
- [x] **transport** — `streamable-http` @ `localhost:3201`
- [x] **firing tool 이름** — `generate_express` (구 `express` 완전 대체)
- [x] **flat 3필드 shape** — `{ emotion_id?, motion_id?, emotion_text? }`. `intensity/transition_ms/loop/speed/fade_ms` 등 미세 파라미터는 client 기본값 적용. 필요 시 후속에서 확장.

**E2E 연동 검증 항목 (#1):**
- [ ] Hermes agent가 broker(streamable-http @ :3201)를 tool source로 붙이는가.
- [ ] `generate_express` function_call이 `/v1/responses` 스트림에 **arguments까지** 실려 뜨는가(`output_item.added → arguments.done`).
- [ ] 안 부르는 턴(표현 전환 없음)에 idle + 직전 표정 유지되는가.
- [ ] resource subscription(`expression://vocabulary` 변경 통지)을 Hermes/YUI가 수신하는가.
- [ ] broker down 시 degrade: Hermes는 baked-in 기본 enum으로, YUI는 broker 없이도 동작(어휘 publish만 skip).