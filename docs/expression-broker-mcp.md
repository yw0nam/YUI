# Expression Broker (MCP) — 설계 스펙

> **상태:** v0 설계 확정 — 구현 시작 가능. E2E(실제 Hermes 스트림)는 [#1](https://github.com/yw0nam/YUI/issues/1)에서 검증.
> **레포:** **독립 레포** — YUI에도 Hermes에도 속하지 않는 별도 서비스. 둘 다 이 broker의 MCP client로 붙는다.

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
   (same wire as   │ (MCP client = brain) │
    old express)   │ = judgment           │
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
- **TTS 태그(emotion_text)는 hard 검증 어휘에 두지 않는다.** PR-A부터 어휘는 **이모지 태그 집합**이다(아래 §4 표 — FishSpeech 자유 텍스트를 대체). 자유 텍스트라(이모지 반복으로 강도 표현, 조합 가능) hard enum이 아니므로 broker는 검증/강제하지 않는다. broker가 이 이모지 목록을 *advisory 힌트*로 노출할 수는 있다(§3.4 `update_tts_tags`, optional).

## 3. MCP Surface

> SDK: [`modelcontextprotocol/python-sdk`](https://github.com/modelcontextprotocol/python-sdk) `FastMCP` 기준 (구현 언어는 §6 결정사항). transport는 Hermes/YUI의 MCP client 연결 방식에 맞춰 `streamable-http` 권장(stdio는 같은 프로세스 트리 전제라 3-프로세스 분리와 안 맞음).

### 3.1 `generate_express` — firing tool (caller: Hermes agent) ★

agent가 발화 중 표정/모션/목소리를 전환하려고 호출하는 tool. **이 tool의 function_call이 `/v1/responses` 스트림에 떠서 YUI가 arguments를 읽는다.**

```python
@mcp.tool()
def generate_express(
    emotion_id: str | None = None,   # §2 emotion_ids 중 하나. 생략 → 직전 표정 유지(hold)
    motion_id:  str | None = None,   # §2 motion_ids 중 하나. 생략 → client가 emotion에서 파생(D-MOTION-FROM-EMOTION)
    emotion_text: str | None = None, # TTS 제어 태그(이모지 어휘 §4, 자유 텍스트). 생략 → prefix 없이 plain
) -> dict:
    ...
```

- **arguments(= 모델 생성 입력)** `{ emotion_id?, motion_id?, emotion_text? }` 가 **transport 페이로드**다. YUI가 소비하는 건 *이것*(반환값 아님).
- **return value(= broker → Hermes)** = 검증 결과 ack. agent loop가 발화를 계속하도록 가벼운 JSON만:
  ```jsonc
  { "ok": true, "applied": { "emotion_id": "happy", "motion_id": null, "emotion_text": "👂" },
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
- (optional) `update_tts_tags(tags)` — emotion_text advisory 힌트 목록을 두고 싶을 때만. **검증용 아님, 모델 힌트용.** PR-A 기준 힌트는 §4의 이모지 어휘.

## 4. 필드 정의 (3채널 분리 — 의도된 분리)

| 필드 | 대상 | 채널 | 타입 | 소유/검증 |
|---|---|---|---|---|
| `emotion_id` | **얼굴** (VRM blendshape) | 표정 | enum (10종) | broker hard 검증, 미등록 drop |
| `motion_id` | **몸** (VRMA gesture) | 모션 | registry key (4종) | broker hard 검증, 미등록 drop |
| `emotion_text` | **목소리** (TTS 제어) | voice 태그 | **이모지 어휘** (자유 텍스트, 아래 표) | 검증 없음, model이 직접 생성 |
| 발화 텍스트 | 자막/TTS 본문 | **별도 텍스트 스트림** | `output_text.delta` | **`generate_express`에 없음** (D-SPEECH) |

- emotion_id(얼굴)와 emotion_text(목소리)는 **독립**이다 — `happy` 표정 + `👂`(whisper) 목소리 동시 가능.
- `emotion_text` 예시: `"😏"`, `"🥺🥺"`, `"😆🎵"`. **문장은 넣지 않는다** (발화는 텍스트 스트림). YUI는 이 태그를 TTS 큐의 해당 분절 **맨 앞에 prepend**(D-TTS-PIPELINE step 4) — prefix-only라 말풍선엔 안 들어간다. 두 TTS provider(openai/irodori, contract §5)가 같은 채널을 쓴다.
- 셋 다 optional. 전부 생략된 `generate_express`는 의미 없으므로 model은 보통 최소 하나를 채운다.

### `emotion_text` 이모지 어휘 (renderable vocabulary, PR-A)
broker가 브로커링하는 `emotion_text` 어휘는 아래 이모지 집합이다(PR-A에서 FishSpeech 자유 텍스트를 대체). **같은 이모지를 반복하면 강도가 세진다**(예: `🥺` → `🥺🥺`), 조합도 가능. broker는 이를 advisory hint로만 노출하고 **검증/강제는 안 한다**(§3.1) — 모델이 직접 생성, YUI가 TTS 분절 prefix로 소비.

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

> 동일 표가 contract.md §3 D-EMOTION-TEXT에도 있다(SOT는 본 broker 스펙 §4 + contract §3 — 어휘 변경 시 양쪽 갱신).

## 5. YUI 소비 경로 (스트림에서 뽑기)

> 근거: [`contract.md`](./contract.md) §3, [`openai_response_sdk/sse-event-format.md`](./openai_response_sdk/sse-event-format.md).

`/v1/responses` 스트림에서 `name == "generate_express"`인 function_call item을 잡는다:

1. `response.output_item.added` — `item.type=="function_call"`, `item.name=="generate_express"`, `status:"in_progress"`.
2. `response.function_call_arguments.delta` — arguments JSON 토큰 누적.
3. `response.function_call_arguments.done` — 완성된 `arguments` 파싱 → `{ emotion_id?, motion_id?, emotion_text? }`.
4. 분배: `emotion_id`→`renderer.setEmotion`, `motion_id`→motion(없으면 emotion에서 파생), `emotion_text`→TTS 큐 prepend.

⚠ **`response.completed`의 최종 `output[]`엔 function_call이 빠진다 — 진행 중(`...arguments.done`)에 캡처 필수.** (contract.md §3와 동일.)

## 6. 결정/검증 필요 사항

**구현 전 잠가야 할 결정:**
- [x] **구현 언어** — Python ✅
- [x] **transport** — `streamable-http` ✅
- [x] **firing tool 이름** — `generate_express` ✅ contract.md §3의 `express`→이 이름으로 일괄 갱신.
- [x] **render 미세 파라미터** — flat 3필드 shape ✅(D1). contract의 `intensity/transition_ms/loop/speed/fade_ms`를 버린다 → client 기본값만 적용. (후속에 필요 시 nested로 확장.)

### 결정 로그 (확정)

> broker는 라이브 서비스로 구축됨 (레포 `yw0nam/tts_express_broker`, v1.27.2, `http://localhost:3201/mcp`, streamable-http). 아래 D1–D6은 #49에서 확정, #107을 재정의(client측 emotion_id→emoji 매핑 폐기 → "YUI를 broker MCP client로 연결"로 축소).

- **D1 — generate_express shape:** flat 3필드 `{emotion_id?, motion_id?, emotion_text?}`로 고정. contract의 미세 파라미터(intensity/transition_ms/loop/speed/fade_ms)는 버리고 client 기본값을 적용한다. *근거: 최소 계약 표면, 후속 확장 가능.*
- **D2 — emotion_text producer = Model A (agent 생성, broker 게이트):** Hermes agent가 broker가 publish한 `enum` 표에서 이모지/토큰을 골라 emotion_text를 생성하고, broker가 enum 게이트한다. YUI는 emotion_id→emoji 매핑을 하지 않고 emotion_text를 주입하지도 않는다 — (a) 표를 publish하고 (b) 스트림에 도착한 emotion_text를 TTS 분절 prefix로 소비할 뿐(`src/io/tts-pipeline.ts` 기구현). **따라서 YUI 어디에도 emotion_id→emoji 매핑이 없다.** *주의(cross-team E2E): D2는 Hermes agent가 실제로 emoji emotion_text를 emit해야 성립 — #1/#2에서 추적.*
- **D3 — emoji 표 소유 = YUI `configs/`, provider 조건부:** YUI가 canonical irodori emoji→meaning 표를 `configs/`에 소유한다(no-hardcoding; 본 스펙상 어휘 owner는 YUI). broker의 39-entry `DEFAULT_EMOTION_TEXT_MAP`과 정렬되도록 seed한다. provider 조건: `tts_provider==="irodori"` ⇒ YUI가 `update_emotion_text("enum", <table>)`; `openai-compatible`/fishspeech ⇒ `update_emotion_text("free", null)`.
- **D4 — broker-down degrade:** broker가 다운돼도 YUI는 부팅·동작해야 한다 — best-effort publish, 경고 로그, 부팅 차단 금지. broker 상태는 in-memory & ephemeral이므로 YUI는 매 부팅 + 재연결 시 재-publish한다.
- **D5 — YUI MCP client:** YUI에 streamable-http MCP client(`@modelcontextprotocol/sdk`)를 추가한다. `broker_base_url`은 `configs/endpoints.json`에 둔다(라이브 포트 **3201**; broker README의 기본 8000과 다름 — config 우선, no-hardcoding). YUI는 WRITER라 resource를 subscribe하지 않고 boot/hot-swap/reconnect 시 `update_*`만 호출한다.
- **D6 — publish 타이밍:** boot(설정 로드 후 1회) + VRM 핫스왑 + broker 재연결. emotion ids ← `configs/emotion_registry.json`, motion ids ← `configs/motions.json`, emoji 표 ← `configs/`의 emoji 파일.

> **스펙 대비 broker 확장:** broker는 위 §2/§3 원안을 넘어 `emotion_text_mode`/`update_emotion_text` **enum 게이트**를 추가했다 — `mode="free"`(pass-through, table=null) 또는 `mode="enum"`(표 키만 허용; 미등록 토큰 drop + 경고, 발화 미차단; multi-codepoint emoji를 greedy 토크나이즈). `get_ids()`는 이제 `emotion_text_mode`/`emotion_text_map`/`version`도 반환한다. **emotion_text 어휘 규칙은 provider별로 [`tts_emotion/`](./tts_emotion/)에 둔다**(irodori=enum, openai-compatible/fishspeech=free).

**Hermes에서 E2E 검증(#1):**
- [ ] Hermes agent가 MCP server(streamable-http)를 tool source로 붙이는가.
- [ ] `generate_express` function_call이 `/v1/responses` 스트림에 **arguments까지** 실려 뜨는가(`output_item.added → arguments.done`).
- [ ] 안 부르는 턴(표현 전환 없음)에 idle + 직전 표정 유지되는가.
- [ ] resource subscription(`expression://vocabulary` 변경 통지)을 Hermes/YUI가 수신하는가.
- [ ] broker down 시 degrade: Hermes는 baked-in 기본 enum으로, YUI는 broker 없이도 동작(어휘 publish만 skip).